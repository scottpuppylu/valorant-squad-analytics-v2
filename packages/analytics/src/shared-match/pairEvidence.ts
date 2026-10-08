// Ported from legacy `src/analytics/sharedMatch/pairEvidence.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged.
import { calculatePlayerScores } from '../strength/scoring/calculateScores.ts';
import { defaultProfile } from '../strength/scoring/profiles.ts';
import type { Dimension } from '../strength/scoring/versions.ts';
import type { MatchPerformance, MatchRecord, Player, PlayerRole, RawPlayerStats } from '../event/matchViewTypes.ts';
import { AGENT_ROLES_CATALOG_V0 } from '../agents/agentCatalog.ts';
import { isSameMatchRelativeMode } from '../strength/modeEligibility.ts';
import type { RankContext } from '../rank/rankContext.ts';

/**
 * TASK-SCORING-SHARED-MATCH-01 — Phase A: the SAME-MATCH pair evidence dataset (`shared-match-evidence-v1`).
 *
 * Eligibility follows mode-eligibility-policy-v1: only SAME_MATCH_RELATIVE modes (Competitive, Unrated), kept
 * distinguishable. Every eligible match with k tracked members yields k·(k−1)/2 UNORDERED pair-match units
 * (A = the lexicographically smaller member id), never A↔B and B↔A twice. Per-member, per-match signals come from
 * the unchanged community-score-v2 engine (role-aware benchmarks) on a ONE-match selection plus plain match
 * stats. Rank is attached as pre-match CONTEXT only and never enters a signal or a margin.
 */
export const SHARED_MATCH_EVIDENCE_VERSION = 'shared-match-evidence-v1' as const;

export type SharedMode = 'Competitive' | 'Unrated';
/** Per-match dimensions that are meaningful for ONE match (Consistency needs ≥ 5 matches; Clutch / Economy are sparse). */
export const SINGLE_MATCH_DIMENSIONS = ['firepower', 'roundImpact', 'entry', 'teamplay', 'roleValue'] as const satisfies readonly Dimension[];

export interface MemberMatchSignals {
  memberId: string;
  agent: string;
  role: PlayerRole | null;
  rounds: number;
  teamGroup: 'A' | 'B' | null;
  teamWon: boolean | null;
  acs: number;
  adr: number;
  kpr: number;
  apr: number;
  /** (kills − deaths) / rounds: a K/D-direction signal without the deaths = 0 explosion. */
  killDiffPerRound: number;
  kast: number | null;
  fkpr: number | null;
  fdpr: number | null;
  /** community-score-v2 dimension values (0–100, role-aware benchmarks) for this one match; null = not scoreable. */
  dimensions: Partial<Record<Dimension, number>>;
  /** Engine Overall for one match (usually unavailable: its 6-of-8 gate needs multi-match dimensions). */
  engineOverall: number | null;
  /**
   * Candidate C: overall-profile-v1 weights of the SINGLE_MATCH_DIMENSIONS renormalized over the numeric ones,
   * only when ≥ 4 of 5 are numeric (no new weights; missing never becomes 0 or 50).
   */
  matchProfile: number | null;
}

export interface PairMatchEvidence {
  version: typeof SHARED_MATCH_EVIDENCE_VERSION;
  matchRef: string;
  playedAt: string;
  mode: SharedMode;
  map: string;
  seasonKey: string | null;
  rounds: number;
  sameTeam: boolean;
  a: MemberMatchSignals;
  b: MemberMatchSignals;
  /** Pre-match tier context (exact in-match snapshot when available); descriptive only. */
  rankA: { tierOrdinal: number | null; status: RankContext['status'] };
  rankB: { tierOrdinal: number | null; status: RankContext['status'] };
  /** a − b tier ordinal when both known; ordering metadata only, never a weight. */
  rankTierDifference: number | null;
  valid: { stats: boolean; matchProfile: boolean; kast: boolean; remakeOrShort: boolean };
}

/** Matches shorter than this are not comparable (remakes / surrenders are too short to carry evidence). */
export const MIN_COMPARABLE_ROUNDS = 10;

export function sharedMode(gameMode: string): SharedMode | null {
  if (!isSameMatchRelativeMode(gameMode)) return null;
  return gameMode === 'Competitive' ? 'Competitive' : gameMode === 'Unrated' ? 'Unrated' : null;
}

const STATS: RawPlayerStats = { playerId: '', matches: 0, rounds: 0, wins: 0, kills: 0, deaths: 0, assists: 0, acsTotal: 0, adrTotal: 0, headshotPercentageTotal: 0 } as unknown as RawPlayerStats;

export function memberMatchSignals(match: MatchRecord, performance: MatchPerformance): MemberMatchSignals {
  const rounds = Math.max(match.scoreFor + match.scoreAgainst, 0);
  // shared-match-evidence-v1 is FROZEN on agent catalog v0 (the catalog its accepted ratings were computed with).
  const role = AGENT_ROLES_CATALOG_V0[performance.agent] ?? null;
  const player = { id: performance.playerId, role: role ?? 'Duelist' } as Player;
  const single: MatchRecord = { ...match, performances: [performance] };
  const scores = calculatePlayerScores(player, { ...STATS, playerId: performance.playerId }, [single], defaultProfile, { roles: AGENT_ROLES_CATALOG_V0 });
  const dimensions: Partial<Record<Dimension, number>> = {};
  for (const dimension of SINGLE_MATCH_DIMENSIONS) {
    const result = scores[dimension];
    if (result.status !== 'unavailable' && typeof result.value === 'number') dimensions[dimension] = result.value;
  }
  const numeric = SINGLE_MATCH_DIMENSIONS.filter((dimension) => dimensions[dimension] !== undefined);
  let matchProfile: number | null = null;
  if (numeric.length >= 4) {
    const weight = numeric.reduce((sum, dimension) => sum + defaultProfile.weights[dimension], 0);
    matchProfile = numeric.reduce((sum, dimension) => sum + defaultProfile.weights[dimension] * dimensions[dimension]!, 0) / weight;
  }
  const per = (value: number) => (rounds > 0 ? value / rounds : 0);
  const opening = performance.eventEvidence?.opening === 'reconstructed' && performance.firstKills !== undefined && performance.firstDeaths !== undefined;
  return {
    memberId: performance.playerId, agent: performance.agent, role, rounds,
    teamGroup: performance.teamGroup ?? null, teamWon: typeof performance.teamWon === 'boolean' ? performance.teamWon : null,
    acs: performance.acs, adr: performance.adr, kpr: per(performance.kills), apr: per(performance.assists),
    killDiffPerRound: per(performance.kills - performance.deaths),
    kast: performance.eventEvidence?.kast === 'reconstructed' && typeof performance.kast === 'number' ? performance.kast : null,
    fkpr: opening ? per(performance.firstKills!) : null, fdpr: opening ? per(performance.firstDeaths!) : null,
    dimensions, engineOverall: scores.overall.status !== 'unavailable' && typeof scores.overall.value === 'number' ? scores.overall.value : null,
    matchProfile,
  };
}

export type RankContextLookup = (memberId: string, playedAt: string, matchRef: string) => RankContext | null;

/** All unordered pair-match units of one projected match (empty for ineligible modes). */
export function pairMatchesFor(matchRef: string, match: MatchRecord, rankFor?: RankContextLookup): PairMatchEvidence[] {
  const mode = sharedMode(match.gameMode);
  if (!mode) return [];
  const byMember = new Map<string, MatchPerformance>();
  for (const performance of match.performances) if (!byMember.has(performance.playerId)) byMember.set(performance.playerId, performance);
  const ids = [...byMember.keys()].sort();
  const signals = new Map(ids.map((id) => [id, memberMatchSignals(match, byMember.get(id)!)]));
  const rounds = match.scoreFor + match.scoreAgainst;
  const rank = (id: string) => {
    const context = rankFor?.(id, match.playedAt, matchRef) ?? null;
    return { tierOrdinal: context?.evidence?.normalized?.tierOrdinal ?? null, status: context?.status ?? 'unknown' as const };
  };
  const out: PairMatchEvidence[] = [];
  for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) {
    const a = signals.get(ids[i]!)!; const b = signals.get(ids[j]!)!;
    const rankA = rank(a.memberId); const rankB = rank(b.memberId);
    out.push({
      version: SHARED_MATCH_EVIDENCE_VERSION, matchRef, playedAt: match.playedAt, mode, map: match.map, seasonKey: match.seasonKey ?? null,
      rounds, sameTeam: a.teamGroup !== null && a.teamGroup === b.teamGroup, a, b, rankA, rankB,
      rankTierDifference: rankA.tierOrdinal !== null && rankB.tierOrdinal !== null ? rankA.tierOrdinal - rankB.tierOrdinal : null,
      valid: { stats: rounds >= MIN_COMPARABLE_ROUNDS, matchProfile: a.matchProfile !== null && b.matchProfile !== null,
        kast: a.kast !== null && b.kast !== null, remakeOrShort: rounds < MIN_COMPARABLE_ROUNDS },
    });
  }
  return out;
}

/** Deduplicate by match reference (re-ingesting a match never adds evidence). */
export function uniqueByMatch<T extends { matchRef: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.matchRef) ? false : (seen.add(item.matchRef), true)));
}
