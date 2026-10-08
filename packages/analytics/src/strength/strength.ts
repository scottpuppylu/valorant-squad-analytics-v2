import { agentRoles } from '../agents/agentCatalog.ts';
import type { MatchRecord, Player, PlayerRole, PlayerScores } from '../event/matchViewTypes.ts';
import { isAbsoluteStrengthMode } from './modeEligibility.ts';
import { resolveAdaptiveWindow } from './scope/adaptiveWindow.ts';
import { policyFor } from './scope/policies.ts';
import { populationFromMatches } from './scope/population.ts';
import type { AdaptiveWindowResult, ScopePopulation } from './scope/types.ts';
import { calculatePlayerScores } from './scoring/calculateScores.ts';
import type { PerformanceEntry } from './types.ts';

/**
 * Community Score (`community-score-v2` / `community-benchmarks-v1` / `overall-profile-v1`) and Current Strength
 * (community-score-v2 Overall over the `currentStrength` adaptive window, `adaptive-window-v1`, `feature-scope-policy-v3`).
 *
 * The population and call sequence are exactly the accepted legacy real-data audit (scripts/event-metrics-rollout.ts,
 * TASK-ANALYTICS-EVENT-METRICS-V2-ROLLOUT-01 / TASK-DATA-AGENT-CATALOG-01):
 *  - Competitive only (mode-eligibility-policy-v1), ordered by (playedAt, match id);
 *  - population anchor / floor from the Competitive matches, coverage 'unverified' (provider-visible history);
 *  - Community Score = `analyticsFromEntries` over ALL of the member's Competitive entries (全部已追蹤);
 *  - Current Strength = the same score over the window's entries, only when the window is not unavailable;
 *  - Recent Form = Overall(current) − Overall(baseline) of the `recentForm` window pair, ±2 (unchanged formula).
 * The member's role is the most-played KNOWN role by rounds; with none, it is undefined (no fallback role is guessed —
 * agent-catalog-v1). Weights, benchmarks and gates are the ported, unchanged scoring modules.
 */
export const STRENGTH_PIPELINE_VERSION = 'strength-pipeline-v1' as const;

export function competitiveMatches(matches: readonly MatchRecord[]): MatchRecord[] {
  return [...matches].filter((m) => isAbsoluteStrengthMode(m.gameMode))
    .sort((x, y) => x.playedAt.localeCompare(y.playedAt) || x.id.localeCompare(y.id));
}

export function strengthPopulation(competitive: readonly MatchRecord[]): ScopePopulation {
  return populationFromMatches([...competitive], 'unverified');
}

export function memberPlayer(memberId: string, entries: readonly { performance: { agent: string }; rounds: number }[]): Player {
  const roles = new Map<PlayerRole, number>();
  for (const entry of entries) { const role = agentRoles[entry.performance.agent]; if (role) roles.set(role, (roles.get(role) ?? 0) + entry.rounds); }
  const role = [...roles.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0]?.[0];
  return { id: memberId, handle: memberId, displayName: memberId, ...(role ? { role } : {}) };
}

/** The member's Competitive entries (one per match). */
export function memberEntries(memberId: string, competitive: readonly MatchRecord[]): PerformanceEntry[] {
  const raw = competitive.flatMap((match) => match.performances.filter((p) => p.playerId === memberId)
    .map((performance) => ({ playerId: memberId, match, performance, rounds: match.scoreFor + match.scoreAgainst })));
  const player = memberPlayer(memberId, raw);
  return raw.map((entry) => ({ ...entry, player }));
}

/** Legacy `analyticsFromEntries` scores half (src/analytics/analysis.ts): one performance per match, unchanged engine. */
export function scoresFromEntries(player: Player, entries: readonly PerformanceEntry[]): PlayerScores | undefined {
  if (entries.length === 0) return undefined;
  const matches: MatchRecord[] = entries.map(({ match, performance }) => ({ ...match, performances: [performance] }));
  return calculatePlayerScores(player, {} as never, matches);
}

export interface StrengthResult {
  memberId: string;
  entries: PerformanceEntry[];
  communityScore: PlayerScores | undefined;
  currentWindow: AdaptiveWindowResult;
  currentStrength: PlayerScores | undefined;
  recentForm: RecentFormResult;
}

export interface RecentFormResult {
  status: 'up' | 'flat' | 'down' | 'insufficient';
  delta?: number;
  recentOverall?: number;
  baselineOverall?: number;
  recentMatches: number;
  baselineMatches: number;
  window: AdaptiveWindowResult;
}

/** Legacy `recentFormFromWindow` (body unchanged). */
export function recentFormFromWindow(player: Player, window: AdaptiveWindowResult): RecentFormResult {
  const recentMatches = window.current.matches;
  const baselineMatches = window.baseline?.matches ?? 0;
  if (window.status === 'unavailable') return { status: 'insufficient', recentMatches, baselineMatches, window };
  const recentValue = scoresFromEntries(player, window.currentEntries)?.overall.value;
  const baselineValue = scoresFromEntries(player, window.baselineEntries)?.overall.value;
  if (recentValue === undefined || baselineValue === undefined) return { status: 'insufficient', recentMatches, baselineMatches, window };
  const delta = recentValue - baselineValue;
  return {
    status: delta > 2 ? 'up' : delta < -2 ? 'down' : 'flat', delta,
    recentOverall: recentValue, baselineOverall: baselineValue,
    recentMatches, baselineMatches, window,
  };
}

/** Community Score + Current Strength + Recent Form of every member over one match collection (any modes; filtered here). */
export function computeStrength(memberIds: readonly string[], matches: readonly MatchRecord[]): StrengthResult[] {
  const competitive = competitiveMatches(matches);
  const population = strengthPopulation(competitive);
  return [...new Set(memberIds)].sort().map((memberId) => {
    const entries = memberEntries(memberId, competitive);
    const player = entries[0]?.player ?? memberPlayer(memberId, []);
    const communityScore = scoresFromEntries(player, entries);
    const currentWindow = resolveAdaptiveWindow(entries, policyFor('currentStrength'), { population });
    const currentStrength = currentWindow.status === 'unavailable' ? undefined : scoresFromEntries(player, currentWindow.currentEntries);
    const recentForm = recentFormFromWindow(player, resolveAdaptiveWindow(entries, policyFor('recentForm'), { population }));
    return { memberId, entries, communityScore, currentWindow, currentStrength, recentForm };
  });
}
