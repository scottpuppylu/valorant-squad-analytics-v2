// Ported from legacy `src/analytics/sharedMatch/rating.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged.
import { pooledWithinMemberSd } from './candidates.ts';
import type { PairMatchEvidence, SharedMode } from './pairEvidence.ts';

/**
 * TASK-SCORING-SHARED-MATCH-01 — `shared-match-rating-v1` (group-relative; NOT Riot MMR, NOT a global skill rating).
 *
 * Signal: the community-score-v2 FIREPOWER dimension of each member in ONE match (role-specific ACS/ADR/KPR/KD
 * benchmarks). Chosen in Phase A because event-metrics-v1 dimensions (Round Impact, Entry, Teamplay, KAST) are
 * available for only ~3–5 % of real pair units (the engine fails closed on any self-kill / revive / posthumous-kill
 * round), and among the always-available signals Firepower is the least Duelist-biased (docs/SHARED_MATCH_RATING.md).
 *
 * Per pair-match unit (A < B by member id): margin = s_A − s_B. σ = pooled within-member SD of s (match noise,
 * computed from the evaluated population — never tuned to member order). Outcome: A / B / NEUTRAL with a neutral band
 * |margin| < NEUTRAL_SIGMA·σ. Margins used in means are winsorized at ±CLIP_SIGMA·σ (one extreme match cannot
 * dominate). Rank is never an input.
 *
 * Member rating: each shared match counts ONCE for the member (its units are weighted 1/(other members in that
 * match)); outperform share p = Σw·u / Σw with u = 1 (ahead), ½ (neutral), 0 (behind); shrunk toward ½ by n/(n+8)
 * (the project's existing pair-evidence shrinkage, docs/SYNERGY.md); rating = 100·p. 50 = even shared-match evidence.
 * Unavailable (no number) below MIN_MATCHES valid shared matches — missing evidence never becomes 50.
 */
export const SHARED_MATCH_RATING_VERSION = 'shared-match-rating-v1' as const;
export const NEUTRAL_SIGMA = 0.2;
export const CLIP_SIGMA = 2;
export const SHRINK_K = 8;
export const MIN_MATCHES = 5;
/** Recent window = the existing fixed-recent convention (最近 N 場: 10 / 30); the larger option. */
export const RECENT_MATCHES = 30;

export type UnitOutcome = 'A_OUTPERFORMED_B' | 'B_OUTPERFORMED_A' | 'NEUTRAL';
export interface ScoredUnit {
  matchRef: string; playedAt: string; mode: SharedMode; a: string; b: string;
  margin: number; clippedMargin: number; outcome: UnitOutcome;
  /** Explainability: per-component differences (A − B); null where a side lacks the evidence. */
  components: Record<'firepower' | 'acs' | 'adr' | 'kpr' | 'killDiffPerRound' | 'kast' | 'roundImpact', number | null>;
  rankTierDifference: number | null;
}

export interface Calibration { sigma: number; neutralBand: number; clip: number }

export function signal(pair: PairMatchEvidence, side: 'a' | 'b'): number | null {
  return pair[side].dimensions.firepower ?? null;
}

export function isScorable(pair: PairMatchEvidence): boolean {
  return pair.valid.stats && signal(pair, 'a') !== null && signal(pair, 'b') !== null;
}

export function calibrate(pairs: readonly PairMatchEvidence[]): Calibration | null {
  const sigma = pooledWithinMemberSd(pairs.filter(isScorable), 'firepower');
  return sigma && sigma > 0 ? { sigma, neutralBand: NEUTRAL_SIGMA * sigma, clip: CLIP_SIGMA * sigma } : null;
}

const diff = (x: number | null | undefined, y: number | null | undefined) => (typeof x === 'number' && typeof y === 'number' ? x - y : null);

export function scoreUnit(pair: PairMatchEvidence, calibration: Calibration): ScoredUnit | null {
  if (!isScorable(pair)) return null;
  const margin = signal(pair, 'a')! - signal(pair, 'b')!;
  const outcome: UnitOutcome = Math.abs(margin) < calibration.neutralBand ? 'NEUTRAL' : margin > 0 ? 'A_OUTPERFORMED_B' : 'B_OUTPERFORMED_A';
  return {
    matchRef: pair.matchRef, playedAt: pair.playedAt, mode: pair.mode, a: pair.a.memberId, b: pair.b.memberId,
    margin, clippedMargin: Math.max(-calibration.clip, Math.min(calibration.clip, margin)), outcome,
    components: {
      firepower: margin, acs: diff(pair.a.acs, pair.b.acs), adr: diff(pair.a.adr, pair.b.adr), kpr: diff(pair.a.kpr, pair.b.kpr),
      killDiffPerRound: diff(pair.a.killDiffPerRound, pair.b.killDiffPerRound), kast: diff(pair.a.kast, pair.b.kast),
      roundImpact: diff(pair.a.dimensions.roundImpact, pair.b.dimensions.roundImpact),
    },
    rankTierDifference: pair.rankTierDifference,
  };
}

/** One logical unit per (pair, match): duplicates never add evidence. */
export function scoreUnits(pairs: readonly PairMatchEvidence[], calibration: Calibration): ScoredUnit[] {
  const seen = new Set<string>();
  const out: ScoredUnit[] = [];
  for (const pair of pairs) {
    const key = `${pair.a.memberId}|${pair.b.memberId}|${pair.matchRef}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const unit = scoreUnit(pair, calibration);
    if (unit) out.push(unit);
  }
  return out;
}

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const average = (values: number[]) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : null);

export interface PairAggregate {
  a: string; b: string; sharedMatches: number; competitiveMatches: number; unratedMatches: number;
  aOutperformed: number; bOutperformed: number; neutral: number;
  averageRelativeMargin: number | null; medianRelativeMargin: number | null;
  recent: { matches: number; aOutperformed: number; bOutperformed: number; neutral: number; averageRelativeMargin: number | null };
  confidence: number;
}

export function aggregatePair(units: readonly ScoredUnit[]): PairAggregate {
  const sorted = [...units].sort((x, y) => Date.parse(y.playedAt) - Date.parse(x.playedAt));
  const count = (list: readonly ScoredUnit[], outcome: UnitOutcome) => list.filter((unit) => unit.outcome === outcome).length;
  const recent = sorted.slice(0, RECENT_MATCHES);
  const n = sorted.length;
  return {
    a: sorted[0]?.a ?? '', b: sorted[0]?.b ?? '', sharedMatches: n,
    competitiveMatches: sorted.filter((unit) => unit.mode === 'Competitive').length, unratedMatches: sorted.filter((unit) => unit.mode === 'Unrated').length,
    aOutperformed: count(sorted, 'A_OUTPERFORMED_B'), bOutperformed: count(sorted, 'B_OUTPERFORMED_A'), neutral: count(sorted, 'NEUTRAL'),
    averageRelativeMargin: average(sorted.map((unit) => unit.clippedMargin)), medianRelativeMargin: median(sorted.map((unit) => unit.margin)),
    recent: { matches: recent.length, aOutperformed: count(recent, 'A_OUTPERFORMED_B'), bOutperformed: count(recent, 'B_OUTPERFORMED_A'),
      neutral: count(recent, 'NEUTRAL'), averageRelativeMargin: average(recent.map((unit) => unit.clippedMargin)) },
    confidence: 100 * Math.sqrt(Math.min(n / 30, 1)),
  };
}

export interface MemberRating {
  memberId: string;
  status: 'available' | 'unavailable';
  /** 0–100, 50 = even shared-match evidence; undefined when unavailable. */
  rating?: number;
  /** Unshrunk outperform share (0–1) for transparency. */
  outperformShare?: number;
  sharedMatches: number;
  /** Weighted mean of winsorized Firepower margins vs the peers present (points), context only. */
  averageRelativeMargin: number | null;
  partners: number;
  /** Distinct partners with ≥ 3 scorable shared matches. */
  evidencedPartners: number;
  /** Scorable units / all eligible units involving the member. */
  validShare: number;
  confidence: number;
}

/** Member-level shared-match rating over a set of scored units (one mode, both modes, or a recent window). */
export function memberRating(memberId: string, units: readonly ScoredUnit[], eligibleUnits: number, partnerUniverse: number): MemberRating {
  const mine = units.filter((unit) => unit.a === memberId || unit.b === memberId);
  const byMatch = new Map<string, ScoredUnit[]>();
  for (const unit of mine) byMatch.set(unit.matchRef, [...(byMatch.get(unit.matchRef) ?? []), unit]);
  let weighted = 0; let weights = 0; let marginSum = 0;
  for (const list of byMatch.values()) {
    const w = 1 / list.length;
    for (const unit of list) {
      const isA = unit.a === memberId;
      const u = unit.outcome === 'NEUTRAL' ? 0.5 : (unit.outcome === 'A_OUTPERFORMED_B') === isA ? 1 : 0;
      weighted += w * u; weights += w;
      marginSum += w * (isA ? unit.clippedMargin : -unit.clippedMargin);
    }
  }
  const n = byMatch.size;
  const partnerCounts = new Map<string, number>();
  for (const unit of mine) {
    const partner = unit.a === memberId ? unit.b : unit.a;
    partnerCounts.set(partner, (partnerCounts.get(partner) ?? 0) + 1);
  }
  const evidencedPartners = [...partnerCounts.values()].filter((count) => count >= 3).length;
  const validShare = eligibleUnits > 0 ? mine.length / eligibleUnits : 0;
  const diversity = partnerUniverse > 0 ? Math.min(evidencedPartners / Math.min(4, partnerUniverse), 1) : 0;
  const confidence = 100 * Math.sqrt(Math.min(n / 30, 1) * diversity) * Math.min(validShare, 1);
  const base = { memberId, sharedMatches: n, averageRelativeMargin: weights ? marginSum / weights : null, partners: partnerCounts.size, evidencedPartners, validShare, confidence };
  if (n < MIN_MATCHES || weights === 0) return { ...base, status: 'unavailable' };
  const p = weighted / weights;
  const shrunk = 0.5 + (p - 0.5) * (n / (n + SHRINK_K));
  return { ...base, status: 'available', rating: 100 * shrunk, outperformShare: p };
}

/** Units restricted to a member's most recent RECENT_MATCHES shared matches. */
export function recentUnitsFor(memberId: string, units: readonly ScoredUnit[]): ScoredUnit[] {
  const mine = units.filter((unit) => unit.a === memberId || unit.b === memberId);
  const refs = [...new Map(mine.map((unit) => [unit.matchRef, unit.playedAt])).entries()]
    .sort((x, y) => Date.parse(y[1]) - Date.parse(x[1])).slice(0, RECENT_MATCHES).map(([ref]) => ref);
  const keep = new Set(refs);
  return mine.filter((unit) => keep.has(unit.matchRef));
}

export interface SharedMatchMemberResult {
  memberId: string;
  combined: MemberRating;
  competitive: MemberRating;
  unrated: MemberRating;
  recent: MemberRating;
}

/** Full deterministic computation from pair evidence (all members). Rank is never read. */
export function computeSharedMatchRatings(memberIds: readonly string[], input: readonly PairMatchEvidence[]) {
  // Canonical order (time, match, pair) so the result — including floating-point sums — never depends on input order.
  const pairs = [...input].sort((x, y) => Date.parse(x.playedAt) - Date.parse(y.playedAt) || (x.matchRef < y.matchRef ? -1 : x.matchRef > y.matchRef ? 1 : 0)
    || (x.a.memberId < y.a.memberId ? -1 : x.a.memberId > y.a.memberId ? 1 : 0) || (x.b.memberId < y.b.memberId ? -1 : x.b.memberId > y.b.memberId ? 1 : 0));
  const calibration = calibrate(pairs);
  if (!calibration) return { version: SHARED_MATCH_RATING_VERSION, calibration: null, units: [], members: [] as SharedMatchMemberResult[] };
  const units = scoreUnits(pairs, calibration);
  const eligible = (memberId: string, mode?: SharedMode) => {
    const seen = new Set<string>();
    for (const pair of pairs) if ((pair.a.memberId === memberId || pair.b.memberId === memberId) && (!mode || pair.mode === mode)) seen.add(`${pair.a.memberId}|${pair.b.memberId}|${pair.matchRef}`);
    return seen.size;
  };
  const universe = new Set(memberIds).size - 1;
  const members = [...new Set(memberIds)].sort().map((memberId) => {
    const recent = recentUnitsFor(memberId, units);
    return {
      memberId,
      combined: memberRating(memberId, units, eligible(memberId), universe),
      competitive: memberRating(memberId, units.filter((unit) => unit.mode === 'Competitive'), eligible(memberId, 'Competitive'), universe),
      unrated: memberRating(memberId, units.filter((unit) => unit.mode === 'Unrated'), eligible(memberId, 'Unrated'), universe),
      recent: memberRating(memberId, recent, recent.length, universe),
    };
  });
  return { version: SHARED_MATCH_RATING_VERSION, calibration, units, members };
}
