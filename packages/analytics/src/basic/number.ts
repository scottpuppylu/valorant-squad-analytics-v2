/**
 * Ported verbatim (PURE_REUSABLE) from legacy `src/utils/number.ts` at release 1a4c790: `safeDivide`.
 */
export function safeDivide(numerator: number, denominator: number, fallback = 0): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return fallback;
  }

  return numerator / denominator;
}
