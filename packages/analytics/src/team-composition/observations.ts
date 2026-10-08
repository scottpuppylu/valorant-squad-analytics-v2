// Ported from legacy `src/analytics/teamComposition/observations.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged.
import { calculatePlayerScores } from '../strength/scoring/calculateScores.ts';
import { defaultProfile } from '../strength/scoring/profiles.ts';
import type { Dimension } from '../strength/scoring/versions.ts';
import type { MatchPerformance, MatchRecord, Player, PlayerRole } from '../event/matchViewTypes.ts';
import { agentRoles, resolveAgent } from '../agents/agentCatalog.ts';
import { isAbsoluteStrengthMode } from '../strength/modeEligibility.ts';

/**
 * TASK-ANALYTICS-TEAM-COMPOSITION-01 — one observation per (member, Competitive match), from the canonical projection
 * (event-metrics-v2, agent-catalog-v1). Competitive only (mode-eligibility-policy-v1: individual / map / agent / role
 * strength evidence). Members are PEOPLE: performances are already member-merged by the canonical assembly.
 *
 * `performance` = the one-match role-aware profile: overall-profile-v1 weights over the single-match community-score-v2
 * dimensions the member has (≥ 4 of Firepower / Round Impact / Entry / Teamplay / Role Value). No new weights; missing
 * evidence is null, never 0 or 50. Behaviour fields are raw counts for responsibility evidence.
 */
export const TEAM_OBSERVATION_VERSION = 'team-observation-v1' as const;

const ONE_MATCH_DIMENSIONS = ['firepower', 'roundImpact', 'entry', 'teamplay', 'roleValue'] as const satisfies readonly Dimension[];

export interface MemberObservation {
  memberId: string;
  matchId: string;
  playedAt: string;
  map: string;
  agent: string;
  /** agent-catalog-v1 role; undefined for an unresolved agent (fails closed for role-dependent evidence). */
  role: PlayerRole | undefined;
  agentKnown: boolean;
  rounds: number;
  won: boolean | null;
  roundDiff: number | null;
  performance: number | null;
  firepower: number | null;
  behaviour: {
    firstKills: number | null; firstDeaths: number | null; tradeKills: number | null; tradeAssists: number | null;
    kastRate: number | null; assists: number; clutchAttempts: number | null; clutchWins: number | null; deaths: number;
  };
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function observationFor(match: MatchRecord, performance: MatchPerformance): MemberObservation {
  const rounds = Math.max(0, match.scoreFor + match.scoreAgainst);
  const role = agentRoles[performance.agent];
  const known = resolveAgent({ name: performance.agent }).status === 'known';
  const player = { id: performance.playerId, handle: '', displayName: '', agents: [performance.agent], ...(role ? { role } : {}) } as unknown as Player;
  const scores = calculatePlayerScores(player, {} as never, [{ ...match, performances: [performance] }], defaultProfile);
  const dims: Partial<Record<Dimension, number>> = {};
  for (const dimension of ONE_MATCH_DIMENSIONS) {
    const result = scores[dimension];
    if (result.status !== 'unavailable' && finite(result.value)) dims[dimension] = result.value;
  }
  const present = ONE_MATCH_DIMENSIONS.filter((dimension) => dims[dimension] !== undefined);
  let profile: number | null = null;
  if (present.length >= 4) {
    const weight = present.reduce((sum, dimension) => sum + defaultProfile.weights[dimension], 0);
    profile = present.reduce((sum, dimension) => sum + defaultProfile.weights[dimension] * dims[dimension]!, 0) / weight;
  }
  const advanced = performance.advancedMetrics;
  const opening = performance.eventEvidence?.opening === 'reconstructed';
  const trade = advanced?.evidence.trade === 'reconstructed' ? advanced.trade : undefined;
  const clutch = advanced?.evidence.clutch === 'reconstructed' ? advanced.clutch : undefined;
  const won = typeof performance.teamWon === 'boolean' ? performance.teamWon : null;
  const forRounds = performance.teamRoundsWon ?? match.scoreFor; const againstRounds = performance.teamRoundsLost ?? match.scoreAgainst;
  return {
    memberId: performance.playerId, matchId: match.id, playedAt: match.playedAt, map: match.map, agent: performance.agent, role, agentKnown: known, rounds,
    won, roundDiff: finite(forRounds) && finite(againstRounds) ? forRounds - againstRounds : null,
    performance: profile, firepower: dims.firepower ?? null,
    behaviour: {
      firstKills: opening && finite(performance.firstKills) ? performance.firstKills : null,
      firstDeaths: opening && finite(performance.firstDeaths) ? performance.firstDeaths : null,
      tradeKills: finite(trade?.tradeKills) ? trade!.tradeKills! : null, tradeAssists: finite(trade?.tradeAssists) ? trade!.tradeAssists! : null,
      kastRate: performance.eventEvidence?.kast === 'reconstructed' && finite(performance.kast) ? performance.kast : null,
      assists: performance.assists, deaths: performance.deaths,
      clutchAttempts: finite(clutch?.clutchAttempts) ? clutch!.clutchAttempts! : null, clutchWins: finite(clutch?.clutchWins) ? clutch!.clutchWins! : null,
    },
  };
}

/** All Competitive member observations, canonical order (time, match, member); duplicates (same member+match) dropped. */
export function buildObservations(matches: readonly MatchRecord[]): MemberObservation[] {
  const seen = new Set<string>();
  const out: MemberObservation[] = [];
  const ordered = [...matches].filter((match) => isAbsoluteStrengthMode(match.gameMode))
    .sort((x, y) => x.playedAt.localeCompare(y.playedAt) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  for (const match of ordered) {
    for (const performance of [...match.performances].sort((x, y) => (x.playerId < y.playerId ? -1 : 1))) {
      const key = `${performance.playerId}|${match.id}`;
      if (seen.has(key) || !(match.scoreFor + match.scoreAgainst > 0)) continue;
      seen.add(key);
      out.push(observationFor(match, performance));
    }
  }
  return out;
}
