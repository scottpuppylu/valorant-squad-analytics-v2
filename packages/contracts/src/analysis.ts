import { z } from 'zod';
import { GameMode, HistoryCompleteness, InternalId, NonNegativeInt } from './common.ts';
import { ANALYTICS_CONTRACT_VERSION } from './versions.ts';

/**
 * Internal analysis results (keyed by internal member ids — NOT public). The exporter maps them to public snapshots.
 * Every result carries its algorithm id, sample size, eligibility and explanation metadata; confidence is separate
 * from any score.
 */
export const Eligibility = z.object({
  eligible: z.boolean(),
  reasons: z.array(z.string().min(1).max(120)),
}).strict();

export const SampleSize = z.object({
  matches: NonNegativeInt,
  rounds: NonNegativeInt,
}).strict();

export const BasicPlayerMetrics = z.object({
  matchesPlayed: NonNegativeInt,
  wins: NonNegativeInt,
  losses: NonNegativeInt,
  kills: NonNegativeInt,
  deaths: NonNegativeInt,
  assists: NonNegativeInt,
  /** kills / deaths; null when deaths = 0 (undefined ratio, never silently 0 or infinity). */
  kd: z.number().nonnegative().nullable(),
  /** Average damage per round over matches with damage evidence; null when none has it. */
  adr: z.number().nonnegative().nullable(),
}).strict();
export type BasicPlayerMetrics = z.infer<typeof BasicPlayerMetrics>;

export const PlayerAnalysisResult = z.object({
  memberId: InternalId,
  algorithmId: z.string().min(1).max(60),
  sampleSize: SampleSize,
  metrics: BasicPlayerMetrics,
  eligibility: Eligibility,
  explanation: z.array(z.string().min(1).max(200)),
}).strict();
export type PlayerAnalysisResult = z.infer<typeof PlayerAnalysisResult>;

/** Pair-level association (e.g. future duo synergy). Contract only in the bootstrap. */
export const PairAnalysisResult = z.object({
  memberIds: z.tuple([InternalId, InternalId]),
  algorithmId: z.string().min(1).max(60),
  sampleSize: SampleSize,
  value: z.number().nullable(),
  confidence: z.number().min(0).max(100).nullable(),
  eligibility: Eligibility,
  explanation: z.array(z.string().min(1).max(200)),
}).strict();
export type PairAnalysisResult = z.infer<typeof PairAnalysisResult>;

export const AnalysisResult = z.object({
  analyticsContractVersion: z.literal(ANALYTICS_CONTRACT_VERSION),
  scope: z.object({ mode: GameMode, historyCompleteness: HistoryCompleteness }).strict(),
  matchesConsidered: NonNegativeInt,
  players: z.array(PlayerAnalysisResult),
  pairs: z.array(PairAnalysisResult),
}).strict();
export type AnalysisResult = z.infer<typeof AnalysisResult>;
