// Ported from legacy `src/scoring/normalize.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged.
import { clamp } from '../../basic/number.ts';
import type { Benchmark } from './types.ts';

export function normalizeRange(value: number, poor: number, strong: number): number | undefined {
  if (![value,poor,strong].every(Number.isFinite) || poor === strong) return undefined;
  return clamp(100 * (value - poor) / (strong - poor));
}
export function normalizeBenchmark(value: number | undefined, benchmark: Benchmark): number | undefined {
  return value === undefined ? undefined : normalizeRange(value, benchmark.poor, benchmark.strong);
}
