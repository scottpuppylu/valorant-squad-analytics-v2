import type { AdvancedMetrics } from './advancedMetricTypes.ts';
import type { ScoreResult } from '../strength/scoring/types.ts';
import type { Dimension } from '../strength/scoring/versions.ts';

/**
 * INTERNAL per-match view the accepted algorithms consume (`match-view-v1`), produced ONLY by `projectMatchView` from a
 * canonical match (event/matchView.ts). It mirrors the accepted legacy `MatchRecord` / `MatchPerformance` contract
 * (`src/types/valorant.ts`, frozen) field for field, so the ported algorithm bodies stay byte-identical:
 *  - `playerId` is the INTERNAL V2 member id (a person), never a provider id;
 *  - `id` is the canonical match key (`cm_…`), never a provider match id;
 *  - `gameMode` keeps the accepted labels ('Competitive', 'Unrated', …) that mode-eligibility-policy-v1 compares.
 * This view is never published; product read models are built from algorithm outputs (packages/exporter).
 */
export type PlayerRole = 'Duelist' | 'Initiator' | 'Controller' | 'Sentinel';
export type AgentName = string;
export type MapName = string;
export type GameMode = string;

export interface Player {
  id: string;
  handle?: string;
  displayName?: string;
  role?: PlayerRole;
  agents?: AgentName[];
}

export interface MatchPerformance {
  /** Internal V2 member id (the person). */
  playerId: string;
  accountId?: string;
  teamGroup?: 'A' | 'B';
  teamWon?: boolean;
  teamRoundsWon?: number;
  teamRoundsLost?: number;
  agent: AgentName;
  kills: number;
  deaths: number;
  assists: number;
  acs: number;
  adr: number;
  kast?: number;
  eventEvidence?: {
    kast: 'reconstructed' | 'partial' | 'unavailable';
    opening: 'reconstructed' | 'partial' | 'unavailable';
  };
  headshotPercentage?: number;
  firstKills?: number;
  firstDeaths?: number;
  clutchAttempts?: number;
  clutchWins?: number;
  advancedMetrics?: AdvancedMetrics;
}

export interface MatchRecord {
  /** Canonical match key. */
  id: string;
  playedAt: string;
  map: MapName;
  gameMode: GameMode;
  opponent: string;
  scoreFor: number;
  scoreAgainst: number;
  won: boolean;
  durationMinutes: number;
  seasonKey?: string;
  performances: MatchPerformance[];
}

/** Legacy statistics record shape; the accepted score engine ignores it (kept for the frozen call signatures). */
export interface RawPlayerStats {
  playerId: string;
  matches: number;
  rounds: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  acs: number;
  adr: number;
  kpr: number;
  apr: number;
}

export type ScoreCategory = 'overall' | Dimension;
export type PlayerScores = Record<ScoreCategory, ScoreResult> & { confidence: number };
