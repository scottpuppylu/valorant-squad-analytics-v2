// Ported from legacy `src/analytics/scope/observations.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged.
import type { PerformanceEntry } from '../types.ts';
import type { WindowSample } from './types.ts';

const dayMs = 86_400_000;

/** Lightweight analytical fact derived from one public player-match performance. */
export interface ScopeObservation {
  entry: PerformanceEntry;
  playerId: string;
  matchId: string;
  playedAtMs: number;
  day: string;
  /** Same round denominator community-score-v2 uses (scoreFor + scoreAgainst). */
  rounds: number;
  minutes: number;
  seasonKey?: string;
  /** KAST/Opening reconstructed, or legacy/Demo evidence without explicit event status. */
  evidenceComplete: boolean;
}

export function toObservation(entry: PerformanceEntry): ScopeObservation {
  const evidence = entry.performance.eventEvidence;
  return {
    entry,
    playerId: entry.playerId,
    matchId: entry.match.id,
    playedAtMs: Date.parse(entry.match.playedAt),
    day: entry.match.playedAt.slice(0, 10),
    rounds: Math.max(0, entry.rounds),
    minutes: Math.max(0, entry.match.durationMinutes),
    ...(entry.match.seasonKey ? { seasonKey: entry.match.seasonKey } : {}),
    evidenceComplete: !evidence || (evidence.kast === 'reconstructed' && evidence.opening === 'reconstructed'),
  };
}

/** Deterministic newest-first order; ties broken by public match id descending. */
export function newestFirst(a: ScopeObservation, b: ScopeObservation): number {
  return b.playedAtMs - a.playedAtMs || b.matchId.localeCompare(a.matchId);
}

export function sampleOf(observations: ScopeObservation[]): WindowSample {
  if (observations.length === 0) return { matches: 0, rounds: 0, minutes: 0, activeDays: 0, spanDays: 0, seasons: [] };
  let newest = observations[0]!;
  let oldest = observations[0]!;
  for (const observation of observations) {
    if (observation.playedAtMs > newest.playedAtMs) newest = observation;
    if (observation.playedAtMs < oldest.playedAtMs) oldest = observation;
  }
  return {
    matches: observations.length,
    rounds: observations.reduce((sum, item) => sum + item.rounds, 0),
    minutes: observations.reduce((sum, item) => sum + item.minutes, 0),
    activeDays: new Set(observations.map((item) => item.day)).size,
    spanDays: (newest.playedAtMs - oldest.playedAtMs) / dayMs,
    from: oldest.entry.match.playedAt,
    to: newest.entry.match.playedAt,
    seasons: [...new Set(observations.flatMap((item) => item.seasonKey ? [item.seasonKey] : []))].sort(),
  };
}

export const daysBetween = (laterMs: number, earlierMs: number) => (laterMs - earlierMs) / dayMs;
