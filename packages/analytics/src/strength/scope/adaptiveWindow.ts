// Ported from legacy `src/analytics/scope/adaptiveWindow.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged.
import type { PerformanceEntry } from '../types.ts';
import { daysBetween, newestFirst, sampleOf, toObservation, type ScopeObservation } from './observations.ts';
import type { BaselineBounds, FeatureScopePolicy, WindowBounds } from './policies.ts';
import type { AdaptiveWindowResult, ScopePopulation, ScopeReason, ScopeStatus, WindowConfidence, WindowSample } from './types.ts';
import { ADAPTIVE_WINDOW_VERSION } from './versions.ts';

/** Optional rank evidence. Absent today (rank_observations is not ingested); never fabricated. */
export interface RankEvidence {
  status: ScopeStatus;
  /** ISO times at which an observed rank tier changed (regime boundaries), any order. */
  tierChanges?: string[];
}

export interface AdaptiveWindowOptions {
  population: ScopePopulation;
  rank?: RankEvidence;
}

const meets = (sample: WindowSample, matches: number, rounds: number, activeDays: number) =>
  sample.matches >= matches && sample.rounds >= rounds && sample.activeDays >= activeDays;

function seasonEvidence(observations: ScopeObservation[]): ScopeStatus {
  const withSeason = observations.filter((item) => item.seasonKey).length;
  return withSeason === 0 ? 'unavailable' : withSeason === observations.length ? 'available' : 'partial';
}

function confidence(sample: WindowSample, observations: ScopeObservation[], bounds: WindowBounds, anchorMs: number): WindowConfidence {
  const sampleScore = Math.sqrt(Math.min(sample.matches / bounds.targetMatches, 1) * Math.min(sample.rounds / bounds.targetRounds, 1));
  const newest = observations.reduce((max, item) => Math.max(max, item.playedAtMs), Number.NEGATIVE_INFINITY);
  const age = Number.isFinite(newest) ? Math.max(0, daysBetween(anchorMs, newest)) : bounds.maxLookbackDays;
  const freshness = Math.min(1, Math.max(0, 1 - Math.max(0, age - bounds.freshDays) / Math.max(1, bounds.maxLookbackDays - bounds.freshDays)));
  const temporal = Math.min(sample.activeDays / bounds.targetActiveDays, 1) * freshness;
  const evidenceRounds = observations.filter((item) => item.evidenceComplete).reduce((sum, item) => sum + item.rounds, 0);
  const evidence = sample.rounds > 0 ? evidenceRounds / sample.rounds : 0;
  // Basic stats stay valid without reconstructed events, so missing advanced evidence can at most
  // halve window confidence instead of collapsing it to zero.
  return { sample: sampleScore, temporal, evidence, overall: Math.sqrt(sampleScore * temporal) * (0.5 + 0.5 * evidence) };
}

/**
 * adaptive-window-v1 — deterministic, reproducible, versioned. Not an AI decision.
 *
 * Current window: walk the player's eligible observations newest -> oldest (within maxLookbackDays of
 * the POPULATION anchor, never wall clock) and stop at the first of: target reached (rounds AND
 * minimum matches AND minimum active days), maxMatches, an Act boundary (unless the policy allows
 * crossing), a rank-regime boundary once the minimum is met (only with real rank evidence), or the
 * maxSpanDays cap once the minimum is met. Match count alone never completes a window: rounds and
 * active days are required, so 30 matches in 9 days and 30 matches over 180 days select differently.
 *
 * Baseline (only when the policy declares one): strictly older observations than every current
 * observation (non-overlapping), until it reaches a comparable effective sample.
 */
export function resolveAdaptiveWindow(entries: PerformanceEntry[], policy: FeatureScopePolicy, options: AdaptiveWindowOptions): AdaptiveWindowResult {
  const bounds = policy.window;
  if (!bounds || policy.horizon !== 'ADAPTIVE') throw new Error(`Feature ${policy.feature} has no adaptive window policy.`);
  const reasons = new Set<ScopeReason>();
  const queueAllowed = (mode: string) => policy.queues === 'all' || policy.queues.includes(mode);
  const all = entries.map(toObservation).filter((item) => Number.isFinite(item.playedAtMs)).sort(newestFirst);
  const queued = all.filter((item) => queueAllowed(item.entry.match.gameMode));
  if (queued.length < all.length) reasons.add('queue_restricted_by_policy');
  const anchorMs = options.population.anchor ? Date.parse(options.population.anchor) : (all[0]?.playedAtMs ?? 0);
  const eligible = queued.filter((item) => item.playedAtMs <= anchorMs && daysBetween(anchorMs, item.playedAtMs) <= bounds.maxLookbackDays);

  const seasonStatus = seasonEvidence(eligible);
  if (seasonStatus === 'unavailable') reasons.add('season_evidence_unavailable');
  if (seasonStatus === 'partial') reasons.add('season_evidence_partial');
  const rankStatus = options.rank?.status ?? options.population.rankStatus;
  if (rankStatus !== 'available') reasons.add('rank_evidence_unavailable');
  const rankBoundaryMs = policy.rankContext === 'optional' && rankStatus === 'available'
    ? Math.max(Number.NEGATIVE_INFINITY, ...(options.rank?.tierChanges ?? []).map(Date.parse).filter((time) => Number.isFinite(time) && time <= anchorMs))
    : Number.NEGATIVE_INFINITY;

  const current: ScopeObservation[] = [];
  let rankBoundaryUsed = false;
  let stopped = false;
  const actKey = eligible[0]?.seasonKey;
  for (const observation of eligible) {
    const sample = sampleOf(current);
    const minimumMet = meets(sample, bounds.minMatches, bounds.minRounds, bounds.minActiveDays);
    if (current.length >= bounds.maxMatches) { reasons.add('max_matches_reached'); stopped = true; break; }
    if (!policy.crossSeason && seasonStatus !== 'unavailable' && actKey && observation.seasonKey !== actKey) {
      reasons.add('act_boundary_respected'); stopped = true; break;
    }
    if (minimumMet && observation.playedAtMs < rankBoundaryMs) { reasons.add('rank_boundary_respected'); rankBoundaryUsed = true; stopped = true; break; }
    if (minimumMet && current[0] && daysBetween(current[0].playedAtMs, observation.playedAtMs) > bounds.maxSpanDays) {
      reasons.add('time_span_cap_reached'); stopped = true; break;
    }
    current.push(observation);
    const next = sampleOf(current);
    if (meets(next, bounds.minMatches, bounds.targetRounds, bounds.minActiveDays)) {
      reasons.add('target_rounds_reached'); stopped = true; break;
    }
  }
  if (!stopped) reasons.add('lookback_exhausted');
  const currentSample = sampleOf(current);
  const targetMet = meets(currentSample, bounds.minMatches, bounds.targetRounds, bounds.minActiveDays);
  const minimumMet = meets(currentSample, bounds.minMatches, bounds.minRounds, bounds.minActiveDays);
  if (minimumMet) { reasons.add('minimum_sample_reached'); reasons.add('minimum_active_days_reached'); }
  else if (currentSample.matches < bounds.minMatches || currentSample.rounds < bounds.minRounds) reasons.add('insufficient_sample');
  else reasons.add('insufficient_active_days');
  if (current[0] && daysBetween(anchorMs, current[0].playedAtMs) > bounds.freshDays) reasons.add('stale_recent_evidence');
  if (eligible.length === 0) reasons.add('no_matching_evidence');

  // Truthful population limits: a window that ran out of evidence may be missing older durable rows.
  const floorMs = options.population.floor ? Date.parse(options.population.floor) : Number.NaN;
  const reachedFloor = !stopped && Number.isFinite(floorMs) && daysBetween(anchorMs, floorMs) < bounds.maxLookbackDays;
  let status: ScopeStatus = targetMet ? 'available' : minimumMet ? 'partial' : 'unavailable';
  if (reachedFloor && options.population.complete === false) {
    reasons.add('transport_window_truncated');
    if (status === 'available') status = 'partial';
  } else if (reachedFloor && options.population.complete === 'unverified') reasons.add('population_coverage_unverified');

  let baseline: AdaptiveWindowResult['baseline'];
  let baselineEntries: PerformanceEntry[] = [];
  let seasonCrossed = false;
  if (policy.baseline && status !== 'unavailable') {
    const resolved = resolveBaseline(queued, current, currentSample, policy.baseline, reasons, actKey);
    baseline = resolved.sample;
    baselineEntries = resolved.observations.map((item) => item.entry);
    seasonCrossed = resolved.seasonCrossed;
    if (baseline.status === 'unavailable') { reasons.add('insufficient_baseline'); status = 'unavailable'; }
    else if (baseline.status === 'partial' && status === 'available') status = 'partial';
  }

  return {
    ruleVersion: ADAPTIVE_WINDOW_VERSION,
    purpose: policy.feature,
    status,
    current: currentSample,
    ...(baseline ? { baseline } : {}),
    boundaries: { seasonCrossed, seasonEvidence: seasonStatus, rankBoundaryUsed, rankEvidence: rankStatus },
    confidence: confidence(currentSample, current, bounds, anchorMs),
    reasons: [...reasons].sort(),
    currentEntries: current.map((item) => item.entry),
    baselineEntries,
  };
}

function resolveBaseline(queued: ScopeObservation[], current: ScopeObservation[], currentSample: WindowSample,
  bounds: BaselineBounds, reasons: Set<ScopeReason>, actKey: string | undefined) {
  const oldestCurrent = current.at(-1);
  // Non-overlap by deterministic ORDER position, so exact-timestamp ties can never be shared.
  const startIndex = oldestCurrent ? queued.indexOf(oldestCurrent) + 1 : queued.length;
  const required = Math.max(bounds.minRounds, Math.ceil(bounds.minRoundsRatio * currentSample.rounds));
  const target = Math.max(bounds.targetRounds, currentSample.rounds);
  const selected: ScopeObservation[] = [];
  let seasonCrossed = false;
  for (const observation of queued.slice(startIndex)) {
    if (selected.length >= bounds.maxMatches) break;
    if (oldestCurrent && daysBetween(oldestCurrent.playedAtMs, observation.playedAtMs) > bounds.maxLookbackDays) break;
    const crosses = actKey !== undefined && observation.seasonKey !== actKey;
    if (crosses && !bounds.crossSeason) break;
    if (crosses) seasonCrossed = true;
    selected.push(observation);
    if (sampleOf(selected).rounds >= target && selected.length >= bounds.minMatches) break;
  }
  if (seasonCrossed) reasons.add('season_crossed_in_baseline');
  const sample = sampleOf(selected);
  const status: ScopeStatus = sample.matches >= bounds.minMatches && sample.rounds >= target ? 'available'
    : sample.matches >= bounds.minMatches && sample.rounds >= required ? 'partial' : 'unavailable';
  return { sample: { ...sample, status }, observations: selected, seasonCrossed };
}
