import type { CanonicalMatch, RankContext as CanonicalRankContext } from '@vsa/contracts/canonical';
import {
  PRODUCT_CONTRACT_VERSION, type ProductAnalytics, type ProductDimension, type ProductLineup, type ProductMetric, type ProductProfile, type ProductSharedRating,
  type ProductStatus, type ProductTeamResult, type ReasonCode, type RoleKey,
} from '@vsa/contracts/product';
import { agentRoles } from '../agents/agentCatalog.ts';
import { aggregateAdvancedMetrics } from '../event/aggregateAdvancedMetrics.ts';
import { projectMatchViews } from '../event/matchView.ts';
import type { MatchPerformance, MatchRecord, PlayerScores } from '../event/matchViewTypes.ts';
import { rankEvidenceFromCanonical, rankLookup } from '../rank/canonicalRank.ts';
import { computeSharedMatch } from '../shared-match/sharedMatch.ts';
import { MIN_MATCHES, NEUTRAL_SIGMA, SHARED_MATCH_RATING_VERSION, SHRINK_K, type MemberRating } from '../shared-match/rating.ts';
import { SHARED_MATCH_EVIDENCE_VERSION } from '../shared-match/pairEvidence.ts';
import { ADAPTIVE_WINDOW_VERSION } from '../strength/scope/versions.ts';
import type { ScoreResult } from '../strength/scoring/types.ts';
import { dimensions, SCORING_RULE_VERSION } from '../strength/scoring/versions.ts';
import { competitiveMatches, computeStrength, type StrengthResult } from '../strength/strength.ts';
import { TEAM_FIT_VERSION } from '../team-composition/fit.ts';
import { TEAM_COMPOSITION_VERSION, type Lineup } from '../team-composition/recommend.ts';
import { buildTeamCompositionEngine } from '../team-composition/teamComposition.ts';
import { TEAM_COMPOSITION_V2_VERSION, type TeamCompositionV2Result } from '../team-composition/v2.ts';

/**
 * `product-contract-v1` read models from the ACCEPTED algorithm outputs. This module never computes a new score: it
 * selects, labels and reshapes. Input = the canonical evidence of ONE population (the caller decides who is in it:
 * the exporter passes only members with public consent; the private operator report passes everyone).
 */
export const PRODUCT_BUILDER_VERSION = 'product-builder-v1' as const;

/** team-responsibility-v1 labels whose deciding rate reproduced in the TEAM-COMPOSITION-02 holdout (first contact, trade). */
export const VALIDATED_GENERAL_RESPONSIBILITIES: ReadonlySet<string> = new Set(['PRIMARY_ENTRY', 'SECOND_ENTRY_TRADE']);
export const WITHHELD_RESPONSIBILITY_LABELS = ['INFO_SETUP', 'SPACE_CONTROL', 'UTILITY_SUPPORT', 'SITE_HOLD', 'CLUTCH', 'FLEX', 'ROTATION_SUPPORT'] as const;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const omission = (s: ScoreResult): ReasonCode[] => {
  const reason = s.trace.omissionReason ?? '';
  if (/six dimensions/u.test(reason)) return ['needs_six_dimensions'];
  if (/70%/u.test(reason)) return ['evidence_below_threshold'];
  return s.status === 'unavailable' ? ['insufficient_sample'] : [];
};

function scoreMetric(s: ScoreResult | undefined, key: ProductMetric['explanationKey'], extra: ReasonCode[] = []): ProductMetric {
  if (!s) {
    return { version: SCORING_RULE_VERSION, status: 'insufficient', value: null, confidence: null, confidenceModel: 'none', sampleSize: null,
      eligibility: { eligible: false, reasons: ['no_competitive_matches', ...extra] }, evidenceSummary: ['provider_visible_history'], explanationKey: key };
  }
  const reasons = omission(s);
  return {
    version: SCORING_RULE_VERSION, status: s.status, value: finite(s.value) ? s.value : null, confidence: finite(s.confidence) ? s.confidence : null,
    confidenceModel: 'sample-coverage', sampleSize: { matches: s.sample.matches, rounds: s.sample.rounds },
    eligibility: { eligible: s.status !== 'unavailable', reasons: [...reasons, ...extra] },
    evidenceSummary: [...(s.status === 'partial' ? ['event_evidence_partial' as const] : []), 'provider_visible_history'],
    explanationKey: key,
  };
}

function profileOf(result: StrengthResult, competitive: readonly MatchRecord[], lookup: ReturnType<typeof rankLookup>): ProductProfile {
  const scores: PlayerScores | undefined = result.communityScore;
  const entries = result.entries;
  const perf = entries.map((e) => e.performance);
  const rounds = sum(entries.map((e) => e.rounds));
  const weighted = (pick: (p: MatchPerformance) => number | undefined, weight: (p: MatchPerformance, rounds: number) => number) => {
    const valid = entries.filter((e) => finite(pick(e.performance)));
    const w = sum(valid.map((e) => weight(e.performance, e.rounds)));
    return w > 0 ? sum(valid.map((e) => pick(e.performance)! * weight(e.performance, e.rounds))) / w : null;
  };
  const advanced = aggregateAdvancedMetrics(perf);
  const opening = entries.filter((e) => e.performance.eventEvidence?.opening === 'reconstructed' && finite(e.performance.firstKills) && finite(e.performance.firstDeaths));
  const kastEntries = entries.filter((e) => e.performance.eventEvidence?.kast === 'reconstructed' && finite(e.performance.kast));
  const status = (s: string | undefined): ProductStatus => (s === 'reconstructed' || s === 'derived' ? 'available' : s === 'partial' ? 'partial' : 'unavailable');
  const window = result.currentWindow;
  const windowReasons: ReasonCode[] = [
    ...(window.status === 'unavailable' ? ['window_unavailable' as const, 'insufficient_sample' as const] : window.status === 'partial' ? ['window_partial' as const] : []),
    ...(window.reasons.includes('stale_recent_evidence') ? ['stale_recent_evidence' as const] : []),
  ];
  const current = window.status === 'unavailable' ? undefined : result.currentStrength;
  const currentMetric = current ? { ...scoreMetric(current.overall, 'current-strength', windowReasons), version: `${SCORING_RULE_VERSION}+${ADAPTIVE_WINDOW_VERSION}` }
    : { ...scoreMetric(undefined, 'current-strength'), version: `${SCORING_RULE_VERSION}+${ADAPTIVE_WINDOW_VERSION}`,
      eligibility: { eligible: false, reasons: entries.length ? windowReasons : ['no_competitive_matches' as const] } };
  const dims: ProductDimension[] = dimensions.map((d) => {
    const s = scores?.[d];
    return { dimension: d, status: s?.status ?? 'insufficient', value: s && finite(s.value) ? s.value : null, confidence: s && finite(s.confidence) ? s.confidence : 0 };
  });
  const byAgent = new Map<string, { matches: number; wins: number }>();
  const byRole = new Map<RoleKey, number>();
  const byMap = new Map<string, { matches: number; wins: number }>();
  for (const e of entries) {
    const won = e.performance.teamWon === true ? 1 : 0;
    const a = byAgent.get(e.performance.agent) ?? { matches: 0, wins: 0 }; a.matches += 1; a.wins += won; byAgent.set(e.performance.agent, a);
    const role = agentRoles[e.performance.agent]; if (role) byRole.set(role, (byRole.get(role) ?? 0) + 1);
    const m = byMap.get(e.match.map) ?? { matches: 0, wins: 0 }; m.matches += 1; m.wins += won; byMap.set(e.match.map, m);
  }
  const last = [...competitive].reverse().find((m) => m.performances.some((p) => p.playerId === result.memberId));
  const rank = last ? lookup(result.memberId, last.playedAt, last.id) : null;
  const tier = rank?.evidence?.normalized ?? null;
  const roundImpact = scores?.roundImpact;
  return {
    memberId: result.memberId,
    primaryRole: entries[0]?.player.role ?? null,
    competitiveMatches: entries.length, competitiveRounds: rounds,
    communityScore: scoreMetric(scores?.overall, 'community-score'),
    dimensions: dims,
    currentStrength: currentMetric,
    currentWindow: { status: window.status, matches: window.current.matches, rounds: window.current.rounds, activeDays: window.current.activeDays,
      from: window.current.from ?? null, to: window.current.to ?? null, confidence: window.status === 'unavailable' ? null : 100 * window.confidence.overall },
    recentForm: { status: result.recentForm.status, delta: finite(result.recentForm.delta) ? result.recentForm.delta : null,
      recentMatches: result.recentForm.recentMatches, baselineMatches: result.recentForm.baselineMatches },
    basic: {
      acs: weighted((p) => p.acs, (_p, r) => r), headshotPercentage: weighted((p) => p.headshotPercentage, (p) => Math.max(p.kills, 1)),
      kpr: rounds > 0 ? sum(perf.map((p) => p.kills)) / rounds : null, apr: rounds > 0 ? sum(perf.map((p) => p.assists)) / rounds : null,
    },
    advanced: {
      kast: { status: kastEntries.length === 0 ? 'unavailable' : kastEntries.length === entries.length ? 'available' : 'partial',
        rate: kastEntries.length ? sum(kastEntries.map((e) => e.performance.kast! * e.rounds)) / sum(kastEntries.map((e) => e.rounds)) : null, rounds: sum(kastEntries.map((e) => e.rounds)) },
      opening: { status: opening.length === 0 ? 'unavailable' : opening.length === entries.length ? 'available' : 'partial',
        firstKills: opening.length ? sum(opening.map((e) => e.performance.firstKills!)) : null, firstDeaths: opening.length ? sum(opening.map((e) => e.performance.firstDeaths!)) : null,
        rounds: sum(opening.map((e) => e.rounds)) },
      trade: { status: status(advanced.trade.status), tradeKills: advanced.trade.value?.tradeKills ?? null, tradedDeaths: advanced.trade.value?.tradedDeaths ?? null,
        tradeAssists: advanced.trade.value?.tradeAssists ?? null, rounds: advanced.coverage.reconstructedRounds ?? 0 },
      clutch: { status: status(advanced.clutch.status), attempts: advanced.clutch.value?.clutchAttempts ?? null, wins: advanced.clutch.value?.clutchWins ?? null },
      roundImpact: scoreMetric(roundImpact, 'round-impact'),
    },
    rank: tier && rank && rank.status !== 'unknown'
      ? { status: 'known', tierLabel: tier.label, tierOrdinal: tier.tierOrdinal, asOf: rank.evidence!.effectiveAt, source: rank.evidence!.kind === 'match_snapshot' ? 'match-snapshot' : 'history' }
      : { status: 'unknown', tierLabel: null, tierOrdinal: null, asOf: null, source: 'none' },
    agents: [...byAgent.entries()].map(([agentName, v]) => ({ agentName, role: agentRoles[agentName] ?? null, ...v }))
      .sort((a, b) => b.matches - a.matches || a.agentName.localeCompare(b.agentName)),
    roles: [...byRole.entries()].map(([role, matches]) => ({ role, matches })).sort((a, b) => b.matches - a.matches || a.role.localeCompare(b.role)),
    maps: [...byMap.entries()].map(([mapName, v]) => ({ mapName, ...v })).sort((a, b) => b.matches - a.matches || a.mapName.localeCompare(b.mapName)),
  };
}

const sharedRating = (r: MemberRating): ProductSharedRating => ({
  status: r.status, rating: finite(r.rating) ? r.rating : null, outperformShare: finite(r.outperformShare) ? r.outperformShare : null,
  sharedMatches: r.sharedMatches, partners: r.partners, evidencedPartners: r.evidencedPartners, confidence: r.confidence,
});

function lineupOf(lineup: Lineup, v2: TeamCompositionV2Result | null): ProductLineup {
  const guidance = v2 ? new Map(v2.members.map((m) => [m.memberId, m])) : new Map();
  return {
    label: lineup.label, teamFit: lineup.teamFit, fitScore: lineup.fitScore, confidence: lineup.confidence, comparableToBest: lineup.comparableToBest, v2Applied: v2 !== null,
    roleDistribution: { ...lineup.roleDistribution },
    members: [...lineup.members].sort((a, b) => (a.memberId < b.memberId ? -1 : 1)).map((m) => {
      const g = guidance.get(m.memberId);
      const general = m.responsibility && VALIDATED_GENERAL_RESPONSIBILITIES.has(m.responsibility) ? m.responsibility : null;
      const side = (s: { responsibility: string | null; confidence: number } | undefined): ReasonCode[] =>
        !s ? [] : s.responsibility ? [] : s.confidence === 0 ? ['insufficient_side_evidence'] : ['no_distinct_responsibility'];
      return {
        memberId: m.memberId, agentName: m.agent, role: m.role,
        generalResponsibility: general, withheldResponsibility: m.responsibility && !general ? m.responsibility : null,
        attackResponsibility: g?.attack.responsibility ?? null, defenseResponsibility: g?.defense.responsibility ?? null,
        attackConfidence: g ? g.attack.confidence : null, defenseConfidence: g ? g.defense.confidence : null,
        attackReasons: side(g?.attack), defenseReasons: side(g?.defense),
        fit: m.fit, confidence: m.confidence, experimental: m.experimental, evidenceLevel: m.evidenceLevel,
        samples: { member: m.samples.member, role: m.samples.role, agent: m.samples.agent, agentMap: m.samples.agent_map, map: m.samples.map },
      };
    }),
  };
}

/** Every 5-member subset of `memberIds` (sorted), deterministic order. */
export function fiveMemberSets(memberIds: readonly string[]): string[][] {
  const ids = [...new Set(memberIds)].sort();
  const out: string[][] = [];
  const walk = (start: number, pick: string[]) => {
    if (pick.length === 5) { out.push([...pick]); return; }
    for (let i = start; i < ids.length; i += 1) walk(i + 1, [...pick, ids[i]!]);
  };
  walk(0, []);
  return out;
}

export interface ProductBuildOptions { teamMaps?: readonly string[] }

export function buildProductAnalytics(memberIds: readonly string[], matches: readonly CanonicalMatch[], rankRows: readonly CanonicalRankContext[] = [],
  options: ProductBuildOptions = {}): ProductAnalytics {
  const ids = [...new Set(memberIds)].sort();
  const population = new Set(ids);
  // Defence in depth: only members of the requested population are tracked; everyone else is an untracked participant.
  const scoped = matches.map((m) => ({ ...m, participants: m.participants.map((p) => (p.memberId && !population.has(p.memberId) ? { ...p, memberId: null, accountId: null } : p)) }));
  const views = projectMatchViews(scoped);
  const competitive = competitiveMatches(views);
  const rank = rankEvidenceFromCanonical(rankRows.filter((r) => population.has(r.memberId)));
  const lookup = rankLookup(rank);
  const strength = computeStrength(ids, views);
  const shared = computeSharedMatch(ids, scoped, rank);
  const ratingOf = new Map(shared.ratings.members.map((m) => [m.memberId, m]));
  const aggregates = new Map(shared.pairAggregates.map((p) => [`${p.a}|${p.b}`, p]));
  const team = buildTeamCompositionEngine(scoped);
  const maps = (options.teamMaps ?? team.maps).filter((m) => team.maps.includes(m));
  const results: ProductTeamResult[] = [];
  for (const set of fiveMemberSets(ids)) for (const map of maps) {
    const r = team.recommend(set, map);
    results.push({ memberIds: set, map, status: r.v1.status, reason: r.v1.status === 'ok' ? null : 'no_agent_evidence', comparableBand: r.v1.comparableBand,
      lineups: r.v1.lineups.map((l, i) => lineupOf(l, i === 0 ? r.v2 : null)) });
  }
  const times = scoped.filter((m) => m.participants.some((p) => p.memberId !== null)).map((m) => m.startedAt).sort();
  return {
    productContractVersion: PRODUCT_CONTRACT_VERSION,
    coverage: { firstMatchAt: times[0] ?? null, lastMatchAt: times.at(-1) ?? null, matchesObserved: times.length, competitiveMatches: competitive.length },
    profiles: strength.map((s) => profileOf(s, competitive, lookup)),
    sharedMatch: {
      version: SHARED_MATCH_RATING_VERSION, evidenceVersion: SHARED_MATCH_EVIDENCE_VERSION, neutralSigma: NEUTRAL_SIGMA, shrinkK: SHRINK_K, minMatches: MIN_MATCHES,
      members: ids.map((id) => {
        const r = ratingOf.get(id);
        const empty: MemberRating = { memberId: id, status: 'unavailable', sharedMatches: 0, averageRelativeMargin: null, partners: 0, evidencedPartners: 0, validShare: 0, confidence: 0 };
        return { memberId: id, combined: sharedRating(r?.combined ?? empty), competitive: sharedRating(r?.competitive ?? empty), unrated: sharedRating(r?.unrated ?? empty), recent: sharedRating(r?.recent ?? empty) };
      }),
      pairs: shared.coverage.map((cell) => {
        const agg = aggregates.get(`${cell.a}|${cell.b}`);
        const ra = ratingOf.get(cell.a)?.combined; const rb = ratingOf.get(cell.b)?.combined;
        const scored = agg?.sharedMatches ?? 0;
        return {
          memberA: cell.a, memberB: cell.b, sharedMatches: cell.shared, competitiveMatches: cell.competitive, unratedMatches: cell.unrated, sameTeamMatches: cell.sameTeam,
          scoredMatches: scored, ratingA: ra && finite(ra.rating) ? ra.rating : null, ratingB: rb && finite(rb.rating) ? rb.rating : null,
          relativeDifference: agg?.averageRelativeMargin ?? null, medianDifference: agg?.medianRelativeMargin ?? null,
          aOutperformed: agg?.aOutperformed ?? 0, bOutperformed: agg?.bOutperformed ?? 0, neutral: agg?.neutral ?? 0,
          recent: { matches: agg?.recent.matches ?? 0, aOutperformed: agg?.recent.aOutperformed ?? 0, bOutperformed: agg?.recent.bOutperformed ?? 0, neutral: agg?.recent.neutral ?? 0 },
          confidence: agg?.confidence ?? 0,
          eligibility: { eligible: scored >= MIN_MATCHES, reasons: cell.shared === 0 ? ['no_shared_matches'] : scored < MIN_MATCHES ? ['below_min_shared_matches'] : [] },
        };
      }),
      coverage: { possiblePairs: shared.coverageSummary.possiblePairs, pairsWithShared: shared.coverageSummary.pairsWithShared, pairUnits: shared.pairs.length,
        scoredUnits: shared.ratings.units.length, minShared: shared.coverageSummary.min, medianShared: shared.coverageSummary.median, maxShared: shared.coverageSummary.max },
    },
    teamBuilder: {
      v1Version: TEAM_COMPOSITION_VERSION, v2Version: TEAM_COMPOSITION_V2_VERSION, fitVersion: TEAM_FIT_VERSION, maps,
      emittableAttack: ['ATTACK_PLANT_SUPPORT', 'ATTACK_POST_PLANT', 'ATTACK_PRIMARY_ENTRY', 'ATTACK_SECOND_ENTRY_TRADE'],
      emittableDefense: ['DEFENSE_FIRST_CONTACT', 'DEFENSE_INFO_SUPPORT'],
      withheldLabels: [...WITHHELD_RESPONSIBILITY_LABELS],
      results,
    },
  };
}
