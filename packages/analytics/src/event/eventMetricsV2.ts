// Ported from legacy `server/metrics/eventMetricsV2.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged.
import type {
  ClutchBreakdown, ClutchMetrics, ClutchOpponentCount, ImpactContextMetrics, KastMetrics, ObjectiveMetrics, OpeningMetrics,
  RoleValueInputs, TradeMetrics,
} from './advancedMetricTypes.ts';
import {
  completeBase, completeRoundCollection, directAbility, directEconomy, evidence, groupEvents, objectiveFor, TRADE_WINDOW_MS,
} from './eventMetricEngine.ts';
import { aliveBounds, analyzeRoundTopology, type ClassifiedEvent, type RoundTopology } from './roundTopology.ts';
import type { EventMetricMatchInput, MatchMetricReconstruction, MetricKillInput, MetricTraceEntry, PlayerMetricReconstruction } from './types.ts';

/**
 * `event-metrics-v2` (TASK-ANALYTICS-EVENT-RECONSTRUCTION-ROBUSTNESS-01). Same outputs and evidence contract as v1,
 * but a legitimate complex round no longer invalidates the whole match:
 *   - SELF / environmental kills (Spike, fall, Clove "Not Dead Yet") and TEAM kills are deaths, never kills, openings,
 *     trade-eligible deaths or retaliations;
 *   - revives / multiple life segments are modelled by a three-valued life timeline (round-topology-v1);
 *   - KAST, Opening and Trade use opponent kills only and need no life state;
 *   - Clutch and the alive-count parts of Impact are decided only when every interpretation consistent with the kill
 *     feed gives the same answer; otherwise that metric is PARTIAL (no value), never zero.
 * A round is trusted only if round-topology-v1 trusts it (true ambiguity — invalid reference, duplicate event, missing
 * participants — fails closed exactly like v1). Unknown evidence never becomes 0.
 */
export const EVENT_METRIC_RULE_VERSION_V2 = 'event-metrics-v2' as const;

const emptyClutchBreakdown = (): ClutchBreakdown => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
const eventKey = (event: MetricKillInput) => `${event.roundId}|${event.sequence}`;
const increment = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

interface TradeStateV2 {
  directTradeEdges: Map<string, { traderId: string; victimId: string; count: number }>;
  tradedDeathEvents: Set<string>;
  tradeKillsByPlayer: Map<string, number>;
  tradedDeathsByPlayer: Map<string, number>;
  tradeAssistsByPlayer: Map<string, number>;
  /** Opponent-kill deaths only (self / team / environmental deaths cannot be traded). */
  deathsByPlayer: Map<string, number>;
}

/** v1 trade semantics restricted to opponent kills; every death is evaluated on its own (multiple life segments). */
function reconstructTradesV2(topologies: Map<string, RoundTopology>, teams: Map<string, string>): TradeStateV2 {
  const state: TradeStateV2 = { directTradeEdges: new Map(), tradedDeathEvents: new Set(), tradeKillsByPlayer: new Map(),
    tradedDeathsByPlayer: new Map(), tradeAssistsByPlayer: new Map(), deathsByPlayer: new Map() };
  const tradeKillEvents = new Set<string>();
  for (const topology of topologies.values()) {
    if (!topology.trusted) continue;
    const kills = topology.events.filter((item) => item.opponentKill).map((item) => item.event);
    for (const death of kills) {
      increment(state.deathsByPlayer, death.victimId);
      const victimTeam = teams.get(death.victimId);
      const retaliation = kills.find((candidate) => candidate.victimId === death.killerId && teams.get(candidate.killerId) === victimTeam
        && (candidate.timeInRoundMs > death.timeInRoundMs || (candidate.timeInRoundMs === death.timeInRoundMs && candidate.sequence >= death.sequence))
        && candidate.timeInRoundMs <= death.timeInRoundMs + TRADE_WINDOW_MS);
      if (!retaliation) continue;
      state.tradedDeathEvents.add(eventKey(death));
      increment(state.tradedDeathsByPlayer, death.victimId);
      const pairKey = JSON.stringify([retaliation.killerId, death.victimId]);
      const edge = state.directTradeEdges.get(pairKey) ?? { traderId: retaliation.killerId, victimId: death.victimId, count: 0 };
      edge.count += 1;
      state.directTradeEdges.set(pairKey, edge);
      const key = eventKey(retaliation);
      if (tradeKillEvents.has(key)) continue;
      tradeKillEvents.add(key);
      increment(state.tradeKillsByPlayer, retaliation.killerId);
      for (const assistantId of new Set(retaliation.assistantIds)) if (teams.get(assistantId) === victimTeam) increment(state.tradeAssistsByPlayer, assistantId);
    }
  }
  return state;
}

type Decision = boolean | 'unknown';
const decide = (certainTrue: boolean, certainFalse: boolean): Decision => (certainTrue ? true : certainFalse ? false : 'unknown');

export function reconstructV2(input: EventMetricMatchInput): MatchMetricReconstruction {
  const participants = new Map(input.participants.map((participant) => [participant.id, participant]));
  const teams = new Map(input.participants.map((participant) => [participant.id, participant.teamKey]));
  const teamOf = (id: string) => teams.get(id);
  const eventsByRound = groupEvents(input.kills);
  const baseComplete = completeBase(input);
  const topologies = new Map(input.rounds.map((round) => [round.id, analyzeRoundTopology(round, eventsByRound.get(round.id) ?? [], participants)]));
  const trade = reconstructTradesV2(topologies, teams);
  const players = new Map<string, PlayerMetricReconstruction>();

  for (const player of input.participants) {
    const trace: MetricTraceEntry[] = [];
    const everyRoundPresent = input.rounds.length > 0 && input.rounds.every((round) => round.participantIds.includes(player.id) && round.participantsStatus === 'observed');
    const allTrusted = input.rounds.every((round) => topologies.get(round.id)!.trusted);
    const eventComplete = baseComplete && everyRoundPresent && player.teamKey !== 'unknown' && allTrusted;
    const tradeValue: TradeMetrics = {
      tradeKills: trade.tradeKillsByPlayer.get(player.id) ?? 0, tradedDeaths: trade.tradedDeathsByPlayer.get(player.id) ?? 0,
      tradeAssists: trade.tradeAssistsByPlayer.get(player.id) ?? 0, deathsEligibleForTrade: trade.deathsByPlayer.get(player.id) ?? 0,
      tradeKillEvents: trade.tradeKillsByPlayer.get(player.id) ?? 0,
    };
    let qualifiedRounds = 0; let survivedRounds = 0; let firstKills = 0; let firstDeaths = 0;
    let kastKnown = eventComplete;
    const impact: ImpactContextMetrics = { openingKills: 0, tradeKills: tradeValue.tradeKills, manDisadvantageKills: 0, clutchStateKills: 0,
      multiKillRounds: 0, twoKillRounds: 0, threePlusKillRounds: 0, roundWonKills: 0 };
    let clutchAttempts = 0; let clutchWins = 0; let clutchWinnerComplete = true; let impactWinnerComplete = true;
    let clutchKnown = eventComplete; let impactKnown = eventComplete;
    const attemptsByOpponents = emptyClutchBreakdown(); const winsByOpponents = emptyClutchBreakdown();
    const opponent = (id: string) => teamOf(id) !== undefined && teamOf(id) !== player.teamKey;

    for (const round of input.rounds) {
      if (!round.participantIds.includes(player.id)) continue;
      const topology = topologies.get(round.id)!;
      if (!topology.trusted) { trace.push({ domain: 'kast', roundNumber: round.number, branch: 'omitted', reason: 'untrusted-topology' }); continue; }
      const events: ClassifiedEvent[] = topology.events;
      const opponentKills = events.filter((item) => item.opponentKill);
      // Opening: the earliest OPPONENT kill (self / team / environmental deaths never open a duel).
      const opening = opponentKills[0]?.event;
      if (opening?.killerId === player.id) firstKills += 1;
      if (opening?.victimId === player.id) firstDeaths += 1;
      // KAST — each letter decided independently.
      const madeKill = opponentKills.some((item) => item.event.killerId === player.id);
      if (madeKill && !input.participants.some((participant) => participant.teamKey === round.winningTeam)) impactWinnerComplete = false;
      const assisted = events.some((item) => item.event.assistantIds.includes(player.id) && opponent(item.event.victimId));
      const deaths = events.filter((item) => item.event.victimId === player.id);
      const endState = topology.lifeBefore[events.length]!.get(player.id) ?? 'alive';
      if (deaths.length === 0) survivedRounds += 1;
      const finalDeath = deaths.at(-1);
      // Traded: the player's FINAL death of the round (the one that ended their round), when it was an opponent kill.
      const traded = endState === 'dead' && finalDeath !== undefined && finalDeath.opponentKill && trade.tradedDeathEvents.has(eventKey(finalDeath.event));
      const survived: Decision = endState === 'alive' ? true : endState === 'dead' ? false : 'unknown';
      if (madeKill || assisted || traded || survived === true) qualifiedRounds += 1;
      else if (survived === 'unknown') { kastKnown = false; trace.push({ domain: 'kast', roundNumber: round.number, branch: 'unknown', reason: 'end-of-round-life-state-undecidable' }); }

      // Clutch + Impact with alive-count BOUNDS (decided only when all consistent interpretations agree).
      let attempted = false; let attemptAmbiguous = false; let playerRoundKills = 0;
      for (let index = 0; index < events.length; index += 1) {
        const item = events[index]!;
        if (item.opponentKill && item.event.killerId === player.id) {
          playerRoundKills += 1;
          const [ownMin, ownMax] = aliveBounds(topology, index, player.teamKey, teamOf);
          const oppBounds = opponentBounds(topology, index, player.teamKey, teamOf);
          const disadvantage = decide(ownMax < oppBounds[0], ownMin >= oppBounds[1]);
          const clutchState = decide(ownMin === 1 && ownMax === 1, ownMin > 1 || ownMax < 1);
          if (disadvantage === 'unknown' || clutchState === 'unknown') impactKnown = false;
          if (disadvantage === true) impact.manDisadvantageKills += 1;
          if (clutchState === true) impact.clutchStateKills += 1;
          if (round.winningTeam === player.teamKey) impact.roundWonKills += 1;
          trace.push({ domain: 'impact', roundNumber: round.number, eventSequence: item.event.sequence, branch: `kill-${playerRoundKills}`, count: 1 });
        }
        if (attempted || attemptAmbiguous) continue;
        const selfState = topology.lifeBefore[index + 1]!.get(player.id);
        const [ownMin, ownMax] = aliveBounds(topology, index + 1, player.teamKey, teamOf);
        const [oppMin, oppMax] = opponentBounds(topology, index + 1, player.teamKey, teamOf);
        const certain = selfState === 'alive' && ownMin === 1 && ownMax === 1 && oppMin === oppMax && oppMin >= 1 && oppMin <= 5;
        const possible = selfState !== 'dead' && ownMin <= 1 && ownMax >= 1 && oppMax >= 1 && oppMin <= 5;
        if (certain) {
          attempted = true; clutchAttempts += 1; attemptsByOpponents[oppMin as ClutchOpponentCount] += 1;
          if (!input.participants.some((participant) => participant.teamKey === round.winningTeam)) clutchWinnerComplete = false;
          else if (round.winningTeam === player.teamKey) { clutchWins += 1; winsByOpponents[oppMin as ClutchOpponentCount] += 1; }
          trace.push({ domain: 'clutch', roundNumber: round.number, eventSequence: item.event.sequence, branch: `attempt-1v${oppMin}`, count: 1 });
        } else if (possible && (ownMin !== ownMax || oppMin !== oppMax || selfState !== 'alive')) {
          attemptAmbiguous = true; clutchKnown = false;
          trace.push({ domain: 'clutch', roundNumber: round.number, eventSequence: item.event.sequence, branch: 'unknown', reason: 'alive-count-undecidable' });
        }
      }
      if (playerRoundKills >= 2) impact.multiKillRounds += 1;
      if (playerRoundKills === 2) impact.twoKillRounds += 1;
      if (playerRoundKills >= 3) impact.threePlusKillRounds += 1;
    }
    impact.openingKills = firstKills;

    const coverage = { eligibleRounds: input.rounds.length, reconstructedRounds: eventComplete ? input.rounds.length : 0, omittedRounds: eventComplete ? 0 : input.rounds.length };
    const tradeEvidence = eventComplete ? evidence('reconstructed', tradeValue) : evidence<TradeMetrics>('unavailable');
    const kast = eventComplete && kastKnown
      ? evidence<KastMetrics>('reconstructed', { qualifiedRounds, eligibleRounds: input.rounds.length, rate: qualifiedRounds / input.rounds.length, survivedRounds })
      : evidence<KastMetrics>('partial', undefined, coverage);
    const opening = eventComplete ? evidence<OpeningMetrics>('reconstructed', { firstKills, firstDeaths }) : evidence<OpeningMetrics>('partial', undefined, coverage);
    const clutch = eventComplete && clutchKnown
      ? evidence<ClutchMetrics>('reconstructed', { clutchAttempts, ...(clutchWinnerComplete ? { clutchWins, winsByOpponents } : {}), attemptsByOpponents })
      : evidence<ClutchMetrics>('partial', undefined, coverage);
    if (clutch.status === 'reconstructed' && !clutchWinnerComplete) clutch.status = 'partial';
    const impactContext = eventComplete && impactKnown && impactWinnerComplete
      ? evidence('reconstructed', impact) : evidence<ImpactContextMetrics>('partial', undefined, coverage);
    const objectives = completeRoundCollection(input) ? objectiveFor(player.id, input.rounds, participants) : evidence<ObjectiveMetrics>('unavailable');
    const abilityCasts = directAbility(player);
    const economy = directEconomy(player);
    const roleValue: RoleValueInputs = {
      available: [
        ...(player.agent ? ['agent' as const] : []), ...(player.assists !== undefined ? ['assists' as const] : []),
        ...(player.damage !== undefined ? ['damage' as const] : []), ...(objectives.value ? ['objectives' as const] : []),
        ...(tradeEvidence.value ? ['tradeAssists' as const] : []), ...(kast.value ? ['kast' as const, 'survival' as const] : []),
        ...(abilityCasts.value ? ['abilityCasts' as const] : []),
      ],
      unavailable: ['utilityEffects'],
    };
    players.set(player.id, {
      metrics: { ruleVersion: EVENT_METRIC_RULE_VERSION_V2, coverage, trade: tradeEvidence, kast, opening, clutch, objectives, abilityCasts, economy,
        impactContext, roleValueInputs: evidence('derived', roleValue) },
      trace,
    });
  }
  return { ruleVersion: EVENT_METRIC_RULE_VERSION_V2, players, directTradeEdges: [...trade.directTradeEdges.values()] };
}

/** [min, max] alive opponents (any team other than `ownTeam`) before event `index`. */
function opponentBounds(topology: RoundTopology, index: number, ownTeam: string, teamOf: (id: string) => string | undefined): [number, number] {
  let min = 0; let max = 0;
  for (const [id, state] of topology.lifeBefore[index]!) {
    const team = teamOf(id);
    if (team === undefined || team === ownTeam) continue;
    if (state === 'alive') { min += 1; max += 1; } else if (state === 'unknown') max += 1;
  }
  return [min, max];
}
