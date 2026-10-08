// Ported from legacy `src/scoring/types.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged.
import type { PlayerRole } from '../../event/matchViewTypes.ts';
import type { Dimension } from './versions.ts';

export interface Benchmark {
  metric: string; context: PlayerRole | 'global' | 'unknown_role'; poor: number; strong: number;
  direction: 'higher' | 'lower'; version: string;
}
export interface ComponentTrace {
  metric: string; rawValue?: number; normalizedValue?: number;
  configuredWeight: number; usedWeight: number; evidenceStatus: string;
  benchmark: Benchmark; denominator: number; observedCoverage: number; selectedRole?: PlayerRole; omissionReason?: string;
}
export interface ScoreResult {
  status: 'available' | 'partial' | 'unavailable'; value?: number;
  coverage: { availableWeight: number; requiredWeight: number; ratio: number; observedRatio?: number };
  sample: { matches: number; rounds: number; relevantEvents?: number };
  confidence: number; ruleVersion: string; benchmarkVersion: string;
  trace: {
    dimension: Dimension | 'overall'; components: ComponentTrace[]; selectedRole?: PlayerRole;
    roles?: Partial<Record<PlayerRole, number>>; profileVersion?: string;
    prior?: { mean: number; strength: number; wins: number; attempts: number; rawConversion: number; shrunkConversion: number };
    context?: { abilityCasts?: number; positiveSpendObservations?: number };
    dimensions?: Array<{ dimension: Dimension; configuredWeight: number; usedWeight: number; status: ScoreResult['status']; value?: number; coverage: number }>;
    omissionReason?: string;
  };
}
export type ScoringProfile = { version: string; weights: Record<Dimension, number> };
