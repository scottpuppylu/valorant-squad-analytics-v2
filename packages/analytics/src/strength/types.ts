import type { MatchPerformance, MatchRecord, Player } from '../event/matchViewTypes.ts';

/** One member's performance in one match (legacy `src/analytics/types.ts` PerformanceEntry, unchanged). */
export interface PerformanceEntry {
  player: Player;
  playerId: string;
  match: MatchRecord;
  performance: MatchPerformance;
  rounds: number;
}
