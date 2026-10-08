import type { CanonicalMatch } from '@vsa/contracts/canonical';
import { resolveAgent } from '../agents/agentCatalog.ts';
import { normalizeSeasonKey } from '../strength/scope/season.ts';
import type { AdvancedMetrics } from './advancedMetricTypes.ts';
import { EventMetricEngine, EVENT_INPUT_NORMALIZATION_VERSION } from './eventMetricEngine.ts';
import type { MatchPerformance, MatchRecord } from './matchViewTypes.ts';
import type { EventMetricMatchInput, MetricKillInput, MetricParticipantInput, MetricRoundInput, ReconstructedAdvancedMetrics } from './types.ts';

/**
 * `match-view-v1` — canonical match → the accepted per-match projection (legacy `server/dataset/matchAssembly.ts`
 * `reconstructMatchFacts` + `assembleMatch`, and `server/sharedMatch/stagingMatches.ts` `evidenceTopology`), now over
 * provider-neutral canonical evidence. Same gates, same denominators, same evidence statuses:
 *  - the event engine (event-metrics-v1 or -v2) sees every round-present participant plus the tracked members;
 *  - only TRACKED members (canonical `memberId`) get a performance, and only with observed stats, a known agent key,
 *    finite kills / deaths / assists / score / damage and presence in every recorded round;
 *  - per-match ACS / ADR = score / damage ÷ RECORDED rounds (the accepted per-match projection). The basic-stats ADR
 *    (basic-player-stats-v1) uses team score rounds instead — see docs/SCORING.md;
 *  - two tracked accounts of one member in one match → the match is withheld (identity conflict, never summed).
 * The agent analytics key is the catalog name of a known stable agent id (stable id first); an unknown id keeps the
 * provider name and stays UNKNOWN for every role lookup.
 */
export const MATCH_VIEW_VERSION = 'match-view-v1' as const;

export interface ParticipantFact { observedRounds: number; presentEveryRound: boolean; metrics: ReconstructedAdvancedMetrics; tradeEdges: [string, number][] }

export type MatchViewResult =
  | { kind: 'projected'; match: MatchRecord; facts: Map<string, ParticipantFact> }
  | { kind: 'no_performance' }
  | { kind: 'identity_conflict' };

const roundId = (roundNumber: number) => `r${roundNumber}`;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const opt = (value: number | null | undefined) => (finite(value) ? value : undefined);

/** The agent analytics key: catalog name for a known stable id, else the provider name as given. */
export function agentKey(agentId: string | null, agentName: string | null): string | null {
  const resolved = resolveAgent({ id: agentId, name: agentName });
  return resolved.status === 'known' ? resolved.definition.displayName : agentName;
}

/** Legacy `src/utils/gameMode.ts` (body unchanged) — applied to the source's own queue labels. */
export function normalizeGameMode(queueId?: string | null, queueName?: string | null): string {
  const label = queueName || queueId || 'Unknown';
  const normalized = label.toLowerCase();
  if (normalized.includes('competitive')) return 'Competitive';
  if (normalized.includes('premier')) return 'Premier';
  if (normalized.includes('unrated')) return 'Unrated';
  if (normalized.includes('custom')) return 'Custom';
  return label;
}

/** Accepted analytics mode label: the canonical mode when it is one of the accepted labels, else the legacy queue rule. */
export function gameModeLabel(match: Pick<CanonicalMatch, 'mode' | 'queue'>): string {
  const exact: Partial<Record<CanonicalMatch['mode'], string>> = { competitive: 'Competitive', unrated: 'Unrated', premier: 'Premier', custom: 'Custom' };
  return exact[match.mode] ?? normalizeGameMode(match.queue.id, match.queue.name);
}

/** Legacy `publicAdvancedMetrics` (matchAssembly.ts; body unchanged). */
export function publicAdvancedMetrics(metrics: ReconstructedAdvancedMetrics): AdvancedMetrics {
  const nonZero = <T extends object>(value: T): Partial<T> => Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== 0),
  ) as Partial<T>;
  const compactTrade = metrics.trade.value ? nonZero(metrics.trade.value) : undefined;
  const compactObjectives = metrics.objectives.value ? nonZero(metrics.objectives.value) : undefined;
  const compactAbilities = metrics.abilityCasts.value ? nonZero(metrics.abilityCasts.value) : undefined;
  const compactImpact = metrics.impactContext.value ? nonZero(metrics.impactContext.value) : undefined;
  const clutch = metrics.clutch.value;
  const compactClutch = clutch ? {
    ...(clutch.clutchAttempts ? { clutchAttempts: clutch.clutchAttempts } : {}),
    ...(clutch.clutchWins ? { clutchWins: clutch.clutchWins } : {}),
    ...(Object.values(clutch.attemptsByOpponents).some(Boolean) ? { attemptsByOpponents: nonZero(clutch.attemptsByOpponents) } : {}),
    ...(clutch.winsByOpponents && Object.values(clutch.winsByOpponents).some(Boolean) ? { winsByOpponents: nonZero(clutch.winsByOpponents) } : {}),
  } : undefined;
  const economy = metrics.economy.value;
  const compactEconomy = economy ? {
    ...nonZero({
      loadoutValueTotal: economy.loadoutValueTotal, loadoutValueAverage: economy.loadoutValueAverage,
      spentTotal: economy.spentTotal, spentAverage: economy.spentAverage, damage: economy.damage, kills: economy.kills,
    }),
    damagePer1000SpentStatus: economy.damagePer1000SpentStatus,
    ...(economy.damagePer1000Spent === undefined ? {} : { damagePer1000Spent: economy.damagePer1000Spent }),
    killsPer1000SpentStatus: economy.killsPer1000SpentStatus,
    ...(economy.killsPer1000Spent === undefined ? {} : { killsPer1000Spent: economy.killsPer1000Spent }),
  } : undefined;
  return {
    ruleVersion: metrics.ruleVersion,
    coverage: metrics.coverage,
    evidence: {
      trade: metrics.trade.status,
      clutch: metrics.clutch.status,
      objectives: metrics.objectives.status,
      abilityCasts: metrics.abilityCasts.status,
      economy: metrics.economy.status,
      impactContext: metrics.impactContext.status,
      roleValueInputs: metrics.roleValueInputs.status,
    },
    ...(compactTrade && Object.keys(compactTrade).length > 0 ? { trade: compactTrade } : {}),
    ...(compactClutch && Object.keys(compactClutch).length > 0 ? { clutch: compactClutch } : {}),
    ...(compactObjectives && Object.keys(compactObjectives).length > 0 ? { objectives: compactObjectives } : {}),
    ...(compactAbilities && Object.keys(compactAbilities).length > 0 ? { abilityCasts: compactAbilities } : {}),
    ...(compactEconomy ? { economy: compactEconomy } : {}),
    ...(compactImpact && Object.keys(compactImpact).length > 0 ? { impactContext: compactImpact } : {}),
  };
}

/** Engine input over one canonical match (legacy evidenceTopology + reconstructMatchFacts input assembly). */
export function eventInput(match: CanonicalMatch): EventMetricMatchInput {
  const byKey = new Map(match.participants.map((p) => [p.participantKey, p]));
  const participantRows = new Map<string, MetricParticipantInput>();
  const rounds = [...match.rounds].sort((a, b) => a.roundNumber - b.roundNumber);
  for (const round of rounds) for (const item of round.participants) {
    const participant = byKey.get(item.participantKey);
    if (participant) participantRows.set(participant.participantKey, { id: participant.participantKey, teamKey: participant.teamKey, abilityStatus: 'missing', economyStatus: 'missing' });
  }
  for (const p of match.participants) {
    if (p.memberId === null) continue;
    const agent = agentKey(p.agentId, p.agentName);
    participantRows.set(p.participantKey, {
      id: p.participantKey, teamKey: p.teamKey, ...(agent ? { agent } : {}),
      assists: opt(p.stats.assists), kills: opt(p.stats.kills), damage: opt(p.stats.damageDealt),
      abilityStatus: p.abilityCasts.status, ability1Casts: opt(p.abilityCasts.ability1), ability2Casts: opt(p.abilityCasts.ability2),
      grenadeCasts: opt(p.abilityCasts.grenade), ultimateCasts: opt(p.abilityCasts.ultimate),
      economyStatus: p.economy.status, loadoutValueTotal: opt(p.economy.loadoutValueTotal), loadoutValueAverage: opt(p.economy.loadoutValueAverage),
      spentTotal: opt(p.economy.spentTotal), spentAverage: opt(p.economy.spentAverage),
    });
  }
  const roundInputs: MetricRoundInput[] = rounds.map((round) => ({
    id: roundId(round.roundNumber), number: round.roundNumber,
    ...(round.winningTeamKey ? { winningTeam: round.winningTeamKey } : {}),
    participantsStatus: round.participantsStatus,
    participantIds: round.participants.filter((item) => byKey.has(item.participantKey)).map((item) => item.participantKey),
    plantStatus: round.plant.status,
    ...(round.plant.participantKey && byKey.has(round.plant.participantKey) ? { plantParticipantId: round.plant.participantKey } : {}),
    defuseStatus: round.defuse.status,
    ...(round.defuse.participantKey && byKey.has(round.defuse.participantKey) ? { defuseParticipantId: round.defuse.participantKey } : {}),
  }));
  const kills: MetricKillInput[] = match.events
    .filter((e) => e.type === 'kill' && byKey.has(e.actorParticipantKey) && byKey.has(e.targetParticipantKey))
    .map((e) => ({ roundId: roundId(e.roundNumber), sequence: e.sequence, timeInRoundMs: e.timeInRoundMs, killerId: e.actorParticipantKey, victimId: e.targetParticipantKey,
      assistantIds: [...new Set(e.assistantParticipantKeys)].filter((id) => byKey.has(id)) }));
  return { normalizationVersion: EVENT_INPUT_NORMALIZATION_VERSION, roundsStatus: match.evidence.rounds, killsStatus: match.evidence.kills,
    participants: [...participantRows.values()], rounds: roundInputs, kills };
}

/** Canonical match → accepted per-match view (tracked members only). Pure and deterministic. */
export function projectMatchView(match: CanonicalMatch, engine: EventMetricEngine = new EventMetricEngine()): MatchViewResult {
  const tracked = match.participants.filter((p) => p.memberId !== null);
  if (tracked.length === 0) return { kind: 'no_performance' };
  const members = tracked.map((p) => p.memberId!);
  if (new Set(members).size !== members.length) return { kind: 'identity_conflict' };
  const input = eventInput(match);
  const reconstruction = engine.reconstruct(input);
  const edgesByTrader = new Map<string, [string, number][]>();
  for (const edge of reconstruction.directTradeEdges) edgesByTrader.set(edge.traderId, [...(edgesByTrader.get(edge.traderId) ?? []), [edge.victimId, edge.count]]);
  const facts = new Map<string, ParticipantFact>();
  for (const p of tracked) {
    const reconstructed = reconstruction.players.get(p.participantKey);
    if (!reconstructed) continue;
    facts.set(p.participantKey, {
      observedRounds: input.rounds.length,
      presentEveryRound: input.rounds.length > 0 && input.rounds.every((round) => round.participantIds.includes(p.participantKey)),
      metrics: reconstructed.metrics,
      tradeEdges: edgesByTrader.get(p.participantKey) ?? [],
    });
  }
  const teams = new Map(match.teams.map((t) => [t.teamKey, t]));
  const visibleTeams = [...new Set(tracked.map((p) => p.teamKey).filter((key) => key && key !== 'unknown'))].sort();
  const teamGroups = new Map(visibleTeams.length <= 2 ? visibleTeams.map((key, index) => [key, index === 0 ? 'A' as const : 'B' as const]) : []);
  const performances = tracked.flatMap((p): MatchPerformance[] => {
    const fact = facts.get(p.participantKey);
    const reconstructed = fact?.metrics;
    const observedRounds = fact?.observedRounds ?? 0;
    const agent = agentKey(p.agentId, p.agentName);
    const s = p.stats;
    if (s.status !== 'observed' || !agent || !finite(s.kills) || !finite(s.deaths) || !finite(s.assists) || !finite(s.score) || !finite(s.damageDealt)
      || fact?.presentEveryRound !== true) return [];
    let headshotPercentage: number | undefined;
    if (finite(s.headshots) && finite(s.bodyshots) && finite(s.legshots)) {
      const shotTotal = s.headshots + s.bodyshots + s.legshots;
      headshotPercentage = shotTotal === 0 ? 0 : s.headshots / shotTotal;
    }
    const team = teams.get(p.teamKey);
    return [{
      playerId: p.memberId!,
      ...(teamGroups.has(p.teamKey) ? { teamGroup: teamGroups.get(p.teamKey)! } : {}),
      ...(typeof team?.won === 'boolean' ? { teamWon: team.won } : {}),
      ...(team && finite(team.roundsWon) && team.roundsWon >= 0 ? { teamRoundsWon: team.roundsWon } : {}),
      ...(team && finite(team.roundsLost) && team.roundsLost >= 0 ? { teamRoundsLost: team.roundsLost } : {}),
      agent, kills: s.kills, deaths: s.deaths, assists: s.assists,
      acs: s.score / observedRounds, adr: s.damageDealt / observedRounds,
      eventEvidence: {
        kast: reconstructed?.kast.status === 'reconstructed' ? 'reconstructed' : reconstructed?.kast.status === 'partial' ? 'partial' : 'unavailable',
        opening: reconstructed?.opening.status === 'reconstructed' ? 'reconstructed' : reconstructed?.opening.status === 'partial' ? 'partial' : 'unavailable',
      },
      ...(reconstructed?.kast.status === 'reconstructed' && reconstructed.kast.value ? { kast: reconstructed.kast.value.rate } : {}),
      ...(headshotPercentage === undefined ? {} : { headshotPercentage }),
      ...(reconstructed?.opening.status === 'reconstructed' && reconstructed.opening.value ? {
        firstKills: reconstructed.opening.value.firstKills, firstDeaths: reconstructed.opening.value.firstDeaths,
      } : {}),
      ...(reconstructed ? { advancedMetrics: publicAdvancedMetrics(reconstructed) } : {}),
    }];
  });
  if (performances.length === 0) return { kind: 'no_performance' };
  const firstTeam = teams.get(tracked[0]!.teamKey);
  const seasonKey = normalizeSeasonKey(match.season.key);
  return {
    kind: 'projected', facts,
    match: {
      id: match.matchKey, playedAt: match.startedAt, map: match.mapName ?? 'Unknown', gameMode: gameModeLabel(match), opponent: 'opponent',
      scoreFor: firstTeam?.roundsWon ?? 0, scoreAgainst: firstTeam?.roundsLost ?? 0, won: firstTeam?.won === true,
      durationMinutes: Math.max(1, Math.round((match.durationMs ?? 0) / 60_000)),
      ...(seasonKey ? { seasonKey } : {}),
      performances,
    },
  };
}

/** Every projected match of a canonical collection (identity conflicts and member-less matches withheld). */
export function projectMatchViews(matches: readonly CanonicalMatch[], engine: EventMetricEngine = new EventMetricEngine()): MatchRecord[] {
  return matches.flatMap((m) => { const r = projectMatchView(m, engine); return r.kind === 'projected' ? [r.match] : []; });
}

export type { AdvancedMetrics };
