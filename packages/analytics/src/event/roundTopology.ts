// Ported from legacy `server/metrics/roundTopology.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged.
import type { MetricKillInput, MetricParticipantInput, MetricRoundInput } from './types.ts';

/**
 * TASK-ANALYTICS-EVENT-RECONSTRUCTION-ROBUSTNESS-01 — per-round event topology analysis (`round-topology-v1`).
 *
 * The provider's kill feed has no revive or ability-origin events, so life state is reconstructed only from what the
 * feed proves:
 *   - a death makes the victim DEAD;
 *   - a later death of the same player PROVES a revive happened in between (the revive moment is unknown);
 *   - a kill credited to a player who is recorded dead is either a POSTHUMOUS (persistent-utility) kill or a kill after
 *     an unrecorded revive — the feed cannot tell which;
 *   - killer == victim is a SELF / environmental kill; a same-team killer is a TEAM kill. Neither is an opponent kill.
 * Life state is therefore a three-valued timeline (alive / dead / unknown) per player, never a guess.
 *
 * TRUE ambiguity (the round's topology cannot be trusted at all): a killer/victim outside the round's participants or
 * of unknown team, an exact duplicate event, or a round without observed participants.
 */
export const ROUND_TOPOLOGY_VERSION = 'round-topology-v1' as const;

export type TopologyIssue =
  | 'SELF_KILL' | 'TEAM_KILL' | 'REVIVE' | 'POSTHUMOUS_KILL'
  | 'INVALID_PLAYER_REFERENCE' | 'IMPOSSIBLE_EVENT_ORDER' | 'MISSING_ROUND_PARTICIPANTS';

export type LifeState = 'alive' | 'dead' | 'unknown';

export interface ClassifiedEvent {
  event: MetricKillInput;
  /** Opponent kill: killer ≠ victim, both known, different teams. Only these count as kills / openings / trades. */
  opponentKill: boolean;
  selfKill: boolean;
  teamKill: boolean;
  /** The killer was recorded dead before this event (posthumous or after an unrecorded revive). */
  killerRecordedDead: boolean;
  /** The victim was recorded dead before this event (a revive is proven). */
  victimRevived: boolean;
}

export interface RoundTopology {
  version: typeof ROUND_TOPOLOGY_VERSION;
  /** False ⇒ nothing about this round is trusted (true ambiguity). */
  trusted: boolean;
  issues: Map<TopologyIssue, number>;
  events: ClassifiedEvent[];
  /**
   * Life state of every round participant BEFORE event i (index 0 = round start) and after the last event
   * (index events.length). 'unknown' wherever the feed cannot decide.
   */
  lifeBefore: Map<string, LifeState>[];
  /** Players whose life timeline contains an unknown span. */
  uncertainPlayers: Set<string>;
}

const bump = (issues: Map<TopologyIssue, number>, issue: TopologyIssue) => issues.set(issue, (issues.get(issue) ?? 0) + 1);

export function analyzeRoundTopology(round: MetricRoundInput, events: readonly MetricKillInput[], participants: ReadonlyMap<string, MetricParticipantInput>): RoundTopology {
  const issues = new Map<TopologyIssue, number>();
  const ids = round.participantIds;
  const present = new Set(ids);
  let trusted = true;
  if (round.participantsStatus !== 'observed' || ids.length === 0) { bump(issues, 'MISSING_ROUND_PARTICIPANTS'); trusted = false; }
  if (ids.some((id) => !participants.has(id) || participants.get(id)?.teamKey === 'unknown')) { bump(issues, 'INVALID_PLAYER_REFERENCE'); trusted = false; }
  const team = (id: string) => participants.get(id)?.teamKey;
  const deaths = new Map<string, number>();
  const classified: ClassifiedEvent[] = [];
  let previous: MetricKillInput | undefined;
  for (const event of events) {
    if (!present.has(event.killerId) || !present.has(event.victimId) || team(event.killerId) === 'unknown' || team(event.victimId) === 'unknown') {
      bump(issues, 'INVALID_PLAYER_REFERENCE'); trusted = false;
    }
    if (previous && previous.killerId === event.killerId && previous.victimId === event.victimId && previous.timeInRoundMs === event.timeInRoundMs) {
      bump(issues, 'IMPOSSIBLE_EVENT_ORDER'); trusted = false;
    }
    const selfKill = event.killerId === event.victimId;
    const teamKill = !selfKill && team(event.killerId) !== undefined && team(event.killerId) === team(event.victimId);
    const killerRecordedDead = !selfKill && (deaths.get(event.killerId) ?? 0) > 0;
    const victimRevived = (deaths.get(event.victimId) ?? 0) > 0;
    if (selfKill) bump(issues, 'SELF_KILL');
    if (teamKill) bump(issues, 'TEAM_KILL');
    if (killerRecordedDead) bump(issues, 'POSTHUMOUS_KILL');
    if (victimRevived) bump(issues, 'REVIVE');
    classified.push({ event, opponentKill: !selfKill && !teamKill, selfKill, teamKill, killerRecordedDead, victimRevived });
    deaths.set(event.victimId, (deaths.get(event.victimId) ?? 0) + 1);
    previous = event;
  }

  // Three-valued life timeline. After a death a player is DEAD unless the feed later shows them again:
  //   a later DEATH proves a revive happened somewhere in between → UNKNOWN until that death (alive just before it);
  //   a later KILL credited to them → UNKNOWN from the death on (posthumous or revived), and UNKNOWN after it unless
  //   a further death follows.
  const n = classified.length;
  const lifeBefore: Map<string, LifeState>[] = Array.from({ length: n + 1 }, () => new Map(ids.map((id) => [id, 'alive' as LifeState])));
  const uncertainPlayers = new Set<string>();
  for (const id of ids) {
    const mentions = classified.map((item, index) => ({ index, asVictim: item.event.victimId === id, asKiller: item.event.killerId === id && !item.selfKill }))
      .filter((mention) => mention.asVictim || mention.asKiller);
    let state: LifeState = 'alive';
    let cursor = 0; // index in lifeBefore being written
    for (let m = 0; m < mentions.length; m += 1) {
      const mention = mentions[m]!;
      for (; cursor <= mention.index; cursor += 1) lifeBefore[cursor]!.set(id, state);
      // Being killed proves the player was alive immediately before this event.
      if (mention.asVictim) lifeBefore[mention.index]!.set(id, 'alive');
      if (mention.asVictim) {
        // Is there any later mention? Then the player was alive again at some unknown time before it.
        const later = mentions[m + 1];
        state = later ? 'unknown' : 'dead';
        if (later) uncertainPlayers.add(id);
        if (later?.asVictim) {
          // Alive immediately before the later death is proven; the interval before stays unknown.
          for (; cursor < later.index; cursor += 1) lifeBefore[cursor]!.set(id, 'unknown');
          lifeBefore[later.index]!.set(id, 'alive');
          cursor = later.index;
          state = 'alive';
        }
      } else if (state !== 'alive') {
        // A kill while recorded dead or unknown: stays unknown (posthumous vs revived is undecidable).
        state = 'unknown';
        uncertainPlayers.add(id);
      }
    }
    for (; cursor <= n; cursor += 1) lifeBefore[cursor]!.set(id, state);
  }
  return { version: ROUND_TOPOLOGY_VERSION, trusted, issues, events: classified, lifeBefore, uncertainPlayers };
}

/** [min, max] number of a team's players alive before event index i (unknown counts only toward max). */
export function aliveBounds(topology: RoundTopology, index: number, teamKey: string, teamOf: (id: string) => string | undefined): [number, number] {
  let min = 0; let max = 0;
  for (const [id, state] of topology.lifeBefore[index]!) {
    if (teamOf(id) !== teamKey) continue;
    if (state === 'alive') { min += 1; max += 1; } else if (state === 'unknown') max += 1;
  }
  return [min, max];
}
