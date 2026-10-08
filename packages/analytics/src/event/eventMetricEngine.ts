// Ported from legacy `server/metrics/eventMetricEngine.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged; normalization gate constant renamed (EVENT_INPUT_NORMALIZATION_VERSION); parameter property expanded (erasableSyntaxOnly).
import type {
  AbilityCastMetrics, ClutchBreakdown, ClutchMetrics, ClutchOpponentCount, EconomyMetrics, ImpactContextMetrics,
  KastMetrics, MetricEvidence, ObjectiveMetrics, OpeningMetrics, RoleValueInputs, TradeMetrics,
} from './advancedMetricTypes.ts';
import type {
  EventMetricMatchInput, MatchMetricReconstruction, MetricKillInput, MetricParticipantInput,
  MetricRoundInput, MetricTraceEntry, PlayerMetricReconstruction,
} from './types.ts';
import { reconstructV2 } from './eventMetricsV2.ts';

/**
 * V2: the engine accepts input produced by the canonical projection (event/matchView.ts), which stamps this version.
 * It replaces legacy `DURABLE_NORMALIZATION_VERSION` ('durable-evidence-v2') as the "accepted normalization" gate.
 */
export const EVENT_INPUT_NORMALIZATION_VERSION = 'canonical-schema-v2' as const;

/** The original rules: kept unchanged, callable and reproducible (the rollback engine). */
export const EVENT_METRIC_RULE_VERSION_V1 = 'event-metrics-v1' as const;
export type EventMetricRuleVersion = typeof EVENT_METRIC_RULE_VERSION_V1 | 'event-metrics-v2';
/**
 * TASK-ANALYTICS-EVENT-METRICS-V2-ROLLOUT-01: the ONE switch that decides the engine of every default
 * `new EventMetricEngine()` (projection, analysis facts, fact hydration, static export) and therefore the analysis-facts
 * engine key. Rollback = set it back to EVENT_METRIC_RULE_VERSION_V1: stale facts are re-hydrated from raw evidence by
 * the existing freshness guard; no raw-data migration. Explicit `{ ruleVersion }` always overrides it.
 */
export const CANONICAL_EVENT_METRIC_RULE_VERSION: EventMetricRuleVersion = 'event-metrics-v2';
export const TRADE_WINDOW_MS = 5_000;

const emptyClutchBreakdown = (): ClutchBreakdown => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
const eventKey = (event: MetricKillInput) => `${event.roundId}|${event.sequence}`;
export const evidence = <T>(status: MetricEvidence<T>['status'], value?: T, coverage?: MetricEvidence<T>['coverage']): MetricEvidence<T> => ({
  status,
  ...(value === undefined ? {} : { value }),
  ...(coverage === undefined ? {} : { coverage }),
});

function orderedEvents(events: MetricKillInput[]): MetricKillInput[] {
  return [...events].sort((a, b) => a.timeInRoundMs - b.timeInRoundMs || a.sequence - b.sequence);
}

export function groupEvents(events: MetricKillInput[]): Map<string, MetricKillInput[]> {
  const grouped = new Map<string, MetricKillInput[]>();
  for (const event of events) {
    const list = grouped.get(event.roundId) ?? [];
    list.push(event);
    grouped.set(event.roundId, list);
  }
  for (const [roundId, list] of grouped) grouped.set(roundId, orderedEvents(list));
  return grouped;
}

export function completeBase(input: EventMetricMatchInput): boolean {
  return input.normalizationVersion === EVENT_INPUT_NORMALIZATION_VERSION
    && input.roundsStatus === 'observed'
    && input.killsStatus === 'observed';
}

export function completeRoundCollection(input: EventMetricMatchInput): boolean {
  return input.normalizationVersion === EVENT_INPUT_NORMALIZATION_VERSION
    && input.roundsStatus === 'observed';
}

interface TradeState {
  directTradeEdges: Map<string, { traderId: string; victimId: string; count: number }>;
  tradedDeathEvents: Set<string>;
  tradeKillEvents: Set<string>;
  tradeKillsByPlayer: Map<string, number>;
  tradedDeathsByPlayer: Map<string, number>;
  tradeAssistsByPlayer: Map<string, number>;
  deathsByPlayer: Map<string, number>;
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function reconstructTrades(eventsByRound: Map<string, MetricKillInput[]>, teams: Map<string, string>): TradeState {
  const state: TradeState = {
    directTradeEdges: new Map(),
    tradedDeathEvents: new Set(), tradeKillEvents: new Set(), tradeKillsByPlayer: new Map(),
    tradedDeathsByPlayer: new Map(), tradeAssistsByPlayer: new Map(), deathsByPlayer: new Map(),
  };
  for (const events of eventsByRound.values()) {
    for (const death of events) {
      increment(state.deathsByPlayer, death.victimId);
      const victimTeam = teams.get(death.victimId);
      if (!victimTeam) continue;
      const retaliation = events.find((candidate) => (
        candidate.victimId === death.killerId
        && teams.get(candidate.killerId) === victimTeam
        && (candidate.timeInRoundMs > death.timeInRoundMs
          || (candidate.timeInRoundMs === death.timeInRoundMs && candidate.sequence >= death.sequence))
        && candidate.timeInRoundMs <= death.timeInRoundMs + TRADE_WINDOW_MS
      ));
      if (!retaliation) continue;
      state.tradedDeathEvents.add(eventKey(death));
      increment(state.tradedDeathsByPlayer, death.victimId);
      const pairKey = JSON.stringify([retaliation.killerId, death.victimId]);
      const edge = state.directTradeEdges.get(pairKey) ?? { traderId: retaliation.killerId, victimId: death.victimId, count: 0 };
      edge.count += 1;
      state.directTradeEdges.set(pairKey, edge);
      const retaliationKey = eventKey(retaliation);
      if (state.tradeKillEvents.has(retaliationKey)) continue;
      state.tradeKillEvents.add(retaliationKey);
      increment(state.tradeKillsByPlayer, retaliation.killerId);
      for (const assistantId of new Set(retaliation.assistantIds)) {
        if (teams.get(assistantId) === victimTeam) increment(state.tradeAssistsByPlayer, assistantId);
      }
    }
  }
  return state;
}

function validTopology(round: MetricRoundInput, events: MetricKillInput[], participants: Map<string, MetricParticipantInput>): boolean {
  if (round.participantsStatus !== 'observed' || round.participantIds.length === 0) return false;
  const alive = new Set(round.participantIds);
  if ([...alive].some((id) => !participants.has(id) || participants.get(id)?.teamKey === 'unknown')) return false;
  for (const event of events) {
    if (!alive.has(event.killerId) || !alive.has(event.victimId) || event.killerId === event.victimId) return false;
    alive.delete(event.victimId);
  }
  return true;
}

export function objectiveFor(
  playerId: string,
  rounds: MetricRoundInput[],
  participants: Map<string, MetricParticipantInput>,
): MetricEvidence<ObjectiveMetrics> {
  let plants = 0;
  let defuses = 0;
  for (const round of rounds) {
    for (const [status, participantId, kind] of [
      [round.plantStatus, round.plantParticipantId, 'plant'],
      [round.defuseStatus, round.defuseParticipantId, 'defuse'],
    ] as const) {
      if (status === 'missing' || status === 'unavailable') return evidence<ObjectiveMetrics>('partial', undefined, { eligibleRounds: rounds.length, reconstructedRounds: 0, omittedRounds: rounds.length });
      if (status === 'present' && (!participantId || !participants.has(participantId))) return evidence<ObjectiveMetrics>('partial', undefined, { eligibleRounds: rounds.length, reconstructedRounds: 0, omittedRounds: rounds.length });
      if (status === 'present' && participantId === playerId) {
        if (kind === 'plant') plants += 1;
        else defuses += 1;
      }
    }
  }
  return evidence('reconstructed', { plants, defuses });
}

export function directAbility(player: MetricParticipantInput): MetricEvidence<AbilityCastMetrics> {
  const values = [player.ability1Casts, player.ability2Casts, player.grenadeCasts, player.ultimateCasts];
  if (player.abilityStatus !== 'observed' || values.some((value) => value === undefined)) return evidence(player.abilityStatus === 'missing' ? 'unavailable' : 'partial');
  return evidence('derived', {
    ability1Casts: player.ability1Casts!, ability2Casts: player.ability2Casts!,
    grenadeCasts: player.grenadeCasts!, ultimateCasts: player.ultimateCasts!,
  });
}

export function directEconomy(player: MetricParticipantInput): MetricEvidence<EconomyMetrics> {
  const values = [player.loadoutValueTotal, player.loadoutValueAverage, player.spentTotal, player.spentAverage, player.damage, player.kills];
  if (player.economyStatus !== 'observed' || values.some((value) => value === undefined)) return evidence(player.economyStatus === 'missing' ? 'unavailable' : 'partial');
  const value = {
    loadoutValueTotal: player.loadoutValueTotal!, loadoutValueAverage: player.loadoutValueAverage!,
    spentTotal: player.spentTotal!, spentAverage: player.spentAverage!, damage: player.damage!, kills: player.kills!,
    damagePer1000SpentStatus: player.spentTotal! > 0 ? 'derived' as const : 'unavailable' as const,
    ...(player.spentTotal! > 0 ? { damagePer1000Spent: 1000 * player.damage! / player.spentTotal! } : {}),
    killsPer1000SpentStatus: player.spentTotal! > 0 ? 'derived' as const : 'unavailable' as const,
    ...(player.spentTotal! > 0 ? { killsPer1000Spent: 1000 * player.kills! / player.spentTotal! } : {}),
  };
  return evidence('derived', value);
}

export class EventMetricEngine {
  /**
   * `event-metrics-v1` (original rules, unchanged) or `event-metrics-v2` (round-topology-aware;
   * docs/EVENT_RECONSTRUCTION_ROBUSTNESS.md). Without an explicit version: CANONICAL_EVENT_METRIC_RULE_VERSION.
   */
  private readonly options: { ruleVersion?: EventMetricRuleVersion };
  constructor(options: { ruleVersion?: EventMetricRuleVersion } = {}) { this.options = options; }

  get ruleVersion(): EventMetricRuleVersion { return this.options.ruleVersion ?? CANONICAL_EVENT_METRIC_RULE_VERSION; }

  reconstruct(input: EventMetricMatchInput): MatchMetricReconstruction {
    if (this.ruleVersion === 'event-metrics-v2') return reconstructV2(input);
    const participants = new Map(input.participants.map((participant) => [participant.id, participant]));
    const teams = new Map(input.participants.map((participant) => [participant.id, participant.teamKey]));
    const eventsByRound = groupEvents(input.kills);
    const baseComplete = completeBase(input);
    const trade = reconstructTrades(eventsByRound, teams);
    const players = new Map<string, PlayerMetricReconstruction>();

    for (const player of input.participants) {
      const trace: MetricTraceEntry[] = [];
      const presentRounds = input.rounds.filter((round) => round.participantIds.includes(player.id));
      const everyRoundPresent = input.rounds.length > 0 && presentRounds.length === input.rounds.length
        && input.rounds.every((round) => round.participantsStatus === 'observed');
      const eventComplete = baseComplete && everyRoundPresent && player.teamKey !== 'unknown'
        && input.rounds.every((round) => validTopology(round, eventsByRound.get(round.id) ?? [], participants));

      const tradeValue: TradeMetrics = {
        tradeKills: trade.tradeKillsByPlayer.get(player.id) ?? 0,
        tradedDeaths: trade.tradedDeathsByPlayer.get(player.id) ?? 0,
        tradeAssists: trade.tradeAssistsByPlayer.get(player.id) ?? 0,
        deathsEligibleForTrade: trade.deathsByPlayer.get(player.id) ?? 0,
        tradeKillEvents: trade.tradeKillsByPlayer.get(player.id) ?? 0,
      };
      const tradeEvidence = eventComplete
        ? evidence('reconstructed', tradeValue)
        : evidence<TradeMetrics>('unavailable');

      let qualifiedRounds = 0;
      let survivedRounds = 0;
      let firstKills = 0;
      let firstDeaths = 0;
      const impact: ImpactContextMetrics = {
        openingKills: 0, tradeKills: tradeValue.tradeKills, manDisadvantageKills: 0, clutchStateKills: 0,
        multiKillRounds: 0, twoKillRounds: 0, threePlusKillRounds: 0, roundWonKills: 0,
      };
      let clutchAttempts = 0;
      let clutchWins = 0;
      let clutchWinnerComplete = true;
      let impactWinnerComplete = true;
      const attemptsByOpponents = emptyClutchBreakdown();
      const winsByOpponents = emptyClutchBreakdown();
      let topologyComplete = eventComplete;

      for (const round of input.rounds) {
        const events = eventsByRound.get(round.id) ?? [];
        if (!round.participantIds.includes(player.id)) continue;
        const opening = events[0];
        if (opening?.killerId === player.id) firstKills += 1;
        if (opening?.victimId === player.id) firstDeaths += 1;
        const madeKill = events.some((event) => event.killerId === player.id);
        if (madeKill && !input.participants.some((participant) => participant.teamKey === round.winningTeam)) impactWinnerComplete = false;
        const assisted = events.some((event) => event.assistantIds.includes(player.id));
        const death = events.find((event) => event.victimId === player.id);
        if (!death) survivedRounds += 1;
        const traded = death ? trade.tradedDeathEvents.has(eventKey(death)) : false;
        if (madeKill || assisted || !death || traded) qualifiedRounds += 1;

        if (!validTopology(round, events, participants)) {
          topologyComplete = false;
          trace.push({ domain: 'clutch', roundNumber: round.number, branch: 'omitted', reason: 'incomplete-topology' });
          continue;
        }
        const alive = new Set(round.participantIds);
        let attempted = false;
        let playerRoundKills = 0;
        for (let index = 0; index < events.length; index += 1) {
          const current = events[index]!;
          const ownAliveBefore = [...alive].filter((id) => teams.get(id) === player.teamKey).length;
          const opponentAliveBefore = [...alive].filter((id) => teams.get(id) !== player.teamKey).length;
          if (current.killerId === player.id) {
            playerRoundKills += 1;
            if (ownAliveBefore < opponentAliveBefore) impact.manDisadvantageKills += 1;
            if (ownAliveBefore === 1) impact.clutchStateKills += 1;
            if (round.winningTeam === player.teamKey) impact.roundWonKills += 1;
            trace.push({ domain: 'impact', roundNumber: round.number, eventSequence: current.sequence, branch: `kill-${playerRoundKills}`, count: 1 });
          }
          alive.delete(current.victimId);
          if (!attempted && alive.has(player.id)) {
            const ownAlive = [...alive].filter((id) => teams.get(id) === player.teamKey).length;
            const opponentAlive = [...alive].filter((id) => teams.get(id) !== player.teamKey).length;
            if (ownAlive === 1 && opponentAlive >= 1 && opponentAlive <= 5) {
              attempted = true;
              clutchAttempts += 1;
              attemptsByOpponents[opponentAlive as ClutchOpponentCount] += 1;
              if (!input.participants.some((participant) => participant.teamKey === round.winningTeam)) clutchWinnerComplete = false;
              else if (round.winningTeam === player.teamKey) {
                clutchWins += 1;
                winsByOpponents[opponentAlive as ClutchOpponentCount] += 1;
              }
              trace.push({ domain: 'clutch', roundNumber: round.number, eventSequence: current.sequence, branch: `attempt-1v${opponentAlive}`, count: 1 });
            }
          }
        }
        if (playerRoundKills >= 2) impact.multiKillRounds += 1;
        if (playerRoundKills === 2) impact.twoKillRounds += 1;
        if (playerRoundKills >= 3) impact.threePlusKillRounds += 1;
      }
      impact.openingKills = firstKills;

      const coverage = { eligibleRounds: input.rounds.length, reconstructedRounds: eventComplete ? input.rounds.length : 0, omittedRounds: eventComplete ? 0 : input.rounds.length };
      const kast = eventComplete
        ? evidence('reconstructed', { qualifiedRounds, eligibleRounds: input.rounds.length, rate: qualifiedRounds / input.rounds.length, survivedRounds })
        : evidence<KastMetrics>('partial', undefined, coverage);
      const opening = eventComplete
        ? evidence<OpeningMetrics>('reconstructed', { firstKills, firstDeaths })
        : evidence<OpeningMetrics>('partial', undefined, coverage);
      const clutch = topologyComplete
        ? evidence('reconstructed', {
          clutchAttempts,
          ...(clutchWinnerComplete ? { clutchWins, winsByOpponents } : {}),
          attemptsByOpponents,
        })
        : evidence<ClutchMetrics>('partial', undefined, coverage);
      if (topologyComplete && !clutchWinnerComplete && clutch.value) clutch.status = 'partial';
      const impactContext = topologyComplete && impactWinnerComplete
        ? evidence('reconstructed', impact)
        : evidence<ImpactContextMetrics>('partial', undefined, coverage);
      const objectives = completeRoundCollection(input) ? objectiveFor(player.id, input.rounds, participants) : evidence<ObjectiveMetrics>('unavailable');
      const abilityCasts = directAbility(player);
      const economy = directEconomy(player);
      const roleValue: RoleValueInputs = {
        available: [
          ...(player.agent ? ['agent' as const] : []),
          ...(player.assists !== undefined ? ['assists' as const] : []),
          ...(player.damage !== undefined ? ['damage' as const] : []),
          ...(objectives.value ? ['objectives' as const] : []),
          ...(tradeEvidence.value ? ['tradeAssists' as const] : []),
          ...(kast.value ? ['kast' as const, 'survival' as const] : []),
          ...(abilityCasts.value ? ['abilityCasts' as const] : []),
        ],
        unavailable: ['utilityEffects'],
      };
      const roleValueInputs = evidence('derived', roleValue);
      players.set(player.id, {
        metrics: {
          ruleVersion: EVENT_METRIC_RULE_VERSION_V1, coverage, trade: tradeEvidence, kast, opening, clutch,
          objectives, abilityCasts, economy, impactContext, roleValueInputs,
        },
        trace,
      });
    }
    return { ruleVersion: EVENT_METRIC_RULE_VERSION_V1, players, directTradeEdges: [...trade.directTradeEdges.values()] };
  }
}
