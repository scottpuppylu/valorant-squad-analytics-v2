import { AnalysisResult, type PlayerAnalysisResult } from '@vsa/contracts/analysis';
import { ANALYTICS_CONTRACT_VERSION } from '@vsa/contracts/versions';
import type { CanonicalMatch, CanonicalParticipant } from '@vsa/contracts/canonical';
import type { GameMode, HistoryCompleteness } from '@vsa/contracts/common';
import { safeDivide } from './number.ts';

/**
 * `basic-player-stats-v1` — the accepted basic aggregation, ported from legacy `aggregatePlayerStats`
 * (`src/utils/aggregateStats.ts`, release 1a4c790) onto canonical contracts. No new formula:
 *  rounds  = rounds of the match (sum of both teams' rounds won)
 *  kd      = kills / deaths, undefined (null) when deaths = 0
 *  adr     = round-weighted average damage per round = Σ damage / Σ rounds over matches WITH damage evidence
 *  wins / losses from the participant team's result (draws count as neither)
 * Scope: Competitive only — the accepted mode-eligibility policy for "how well does this person play" metrics.
 */
export const BASIC_PLAYER_STATS_ALGORITHM = 'basic-player-stats-v1' as const;
export const BASIC_PLAYER_STATS_DESCRIPTION = 'Matches, wins, losses, kills, deaths, assists, K/D and ADR over Competitive matches.';

const roundsOf = (match: CanonicalMatch) => match.teams.reduce((total, team) => total + team.roundsWon, 0);

interface Entry { match: CanonicalMatch; participant: CanonicalParticipant }

export function computeBasicPlayerStats(matches: readonly CanonicalMatch[], memberIds: readonly string[], options: { mode?: GameMode } = {}): AnalysisResult {
  const mode = options.mode ?? 'competitive';
  const eligible = matches.filter((m) => m.mode === mode);
  const historyCompleteness: HistoryCompleteness = eligible.length > 0 && eligible.every((m) => m.evidence.historyCompleteness === 'provider-visible') ? 'provider-visible' : 'unknown';
  const players: PlayerAnalysisResult[] = [...memberIds].sort().map((memberId) => {
    const reasons: string[] = [];
    const entries: Entry[] = [];
    let collisions = 0;
    for (const match of eligible) {
      const mine = match.participants.filter((p) => p.memberId === memberId);
      if (mine.length > 1) { collisions += 1; continue; } // a member twice in one match is withheld, never summed
      if (mine[0]) entries.push({ match, participant: mine[0] });
    }
    if (collisions > 0) reasons.push(`${collisions} match(es) withheld: member appears more than once`);
    const rounds = entries.reduce((total, { match }) => total + roundsOf(match), 0);
    const kills = entries.reduce((total, { participant }) => total + participant.stats.kills, 0);
    const deaths = entries.reduce((total, { participant }) => total + participant.stats.deaths, 0);
    const assists = entries.reduce((total, { participant }) => total + participant.stats.assists, 0);
    const teamResult = ({ match, participant }: Entry) => match.teams.find((t) => t.teamKey === participant.teamKey)?.won ?? null;
    const withDamage = entries.filter(({ participant }) => participant.stats.damageDealt !== null);
    const damageRounds = withDamage.reduce((total, { match }) => total + roundsOf(match), 0);
    const damage = withDamage.reduce((total, { participant }) => total + participant.stats.damageDealt!, 0);
    if (entries.length === 0) reasons.push(`no ${mode} matches`);
    return {
      memberId,
      algorithmId: BASIC_PLAYER_STATS_ALGORITHM,
      sampleSize: { matches: entries.length, rounds },
      metrics: {
        matchesPlayed: entries.length,
        wins: entries.filter((e) => teamResult(e) === true).length,
        losses: entries.filter((e) => teamResult(e) === false).length,
        kills, deaths, assists,
        kd: deaths > 0 ? kills / deaths : null,
        adr: withDamage.length > 0 && damageRounds > 0 ? safeDivide(damage, damageRounds) : null,
      },
      eligibility: { eligible: entries.length > 0, reasons },
      explanation: [
        `${entries.length} ${mode} match(es), ${rounds} round(s)`,
        `K/D = kills ÷ deaths${deaths === 0 ? ' (undefined: no deaths)' : ''}`,
        withDamage.length > 0 ? `ADR = damage ÷ rounds over ${withDamage.length} match(es) with damage evidence` : 'ADR unavailable: no damage evidence',
      ],
    };
  });
  return AnalysisResult.parse({
    analyticsContractVersion: ANALYTICS_CONTRACT_VERSION,
    scope: { mode, historyCompleteness },
    matchesConsidered: eligible.length,
    players,
    pairs: [],
  });
}

/** Observation summary over ALL stored modes (browsing facts, not performance): count and first/last start time. */
export interface ObservationSummary { memberId: string; matchesObserved: number; firstObservedAt: string | null; lastObservedAt: string | null }

export function summarizeObservations(matches: readonly CanonicalMatch[], memberIds: readonly string[]): ObservationSummary[] {
  return [...memberIds].sort().map((memberId) => {
    const times = matches.filter((m) => m.participants.some((p) => p.memberId === memberId)).map((m) => m.startedAt).sort();
    return { memberId, matchesObserved: times.length, firstObservedAt: times[0] ?? null, lastObservedAt: times.at(-1) ?? null };
  });
}
