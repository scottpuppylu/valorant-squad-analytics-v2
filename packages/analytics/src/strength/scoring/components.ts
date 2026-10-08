// Ported from legacy `src/scoring/components.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged.
import { clamp } from '../../basic/number.ts';
import { SCORING_RULE_VERSION, BENCHMARK_VERSION } from './versions.ts';
import type { Dimension } from './versions.ts';
import type { ComponentTrace, ScoreResult } from './types.ts';

export function calculateConfidence(matches: number, rounds: number, coverage: number): number {
  return clamp(100 * Math.sqrt(Math.min(Math.max(matches, 0) / 30, 1) * Math.min(Math.max(rounds, 0) / 600, 1)) * clamp(coverage, 0, 1));
}
export function dimensionResult(dimension: Dimension, components: ComponentTrace[], sample: ScoreResult['sample'], forcePartial = false): ScoreResult {
  const requiredWeight = components.reduce((sum, item) => sum + item.configuredWeight, 0);
  const availableWeight = components.reduce((sum, item) => sum + (item.normalizedValue !== undefined ? item.configuredWeight : 0), 0);
  const ratio = requiredWeight > 0 ? availableWeight / requiredWeight : 0;
  const observedRatio=requiredWeight>0 ? components.reduce((sum,item) => sum+(item.normalizedValue !== undefined ? item.configuredWeight*item.observedCoverage : 0),0)/requiredWeight : 0;
  const scoreable = ratio + 1e-12 >= .7;
  const status = !scoreable ? 'unavailable' : ratio < 1 - 1e-12 || forcePartial || components.some((item) => item.normalizedValue !== undefined && item.observedCoverage < 1) ? 'partial' : 'available';
  const traced = components.map((item) => ({ ...item, usedWeight: scoreable && item.normalizedValue !== undefined ? item.configuredWeight / availableWeight : 0 }));
  return {
    status, ...(scoreable ? { value: clamp(traced.reduce((sum, item) => sum + (item.normalizedValue ?? 0) * item.usedWeight, 0)) } : {}),
    coverage: { availableWeight, requiredWeight, ratio, observedRatio }, sample,
    confidence: calculateConfidence(sample.matches, sample.rounds, observedRatio), ruleVersion: SCORING_RULE_VERSION, benchmarkVersion: BENCHMARK_VERSION,
    trace: { dimension, components: traced, ...(!scoreable ? { omissionReason: 'Configured component evidence below 70%' } : {}) },
  };
}
