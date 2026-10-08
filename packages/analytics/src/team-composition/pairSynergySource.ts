// Ported excerpt of legacy `src/analytics/teamComposition/holdout.ts` (PairSynergySource + shrunkMapSynergy; bodies unchanged).
// V2 note: duo-synergy-v1 itself is not ported in this wave; Team Composition reports pair synergy as context only (never scored).
export interface PairSynergySource {
  /** duo-synergy-v1 index for the pair over TRAIN Competitive matches (null when unavailable), and its shared sample. */
  global(a: string, b: string): { value: number | null; matches: number };
  /** Map-scoped duo-synergy-v1 index (null when unavailable). */
  onMap(a: string, b: string, map: string): { value: number | null; matches: number };
}

/** Map-scoped pair synergy shrunk toward global: (n_map·s_map + K·s_global) / (n_map + K); falls back to global. */
export function shrunkMapSynergy(source: PairSynergySource, a: string, b: string, map: string, k = 8): number | null {
  const global = source.global(a, b); const local = source.onMap(a, b, map);
  if (global.value === null) return local.value;
  if (local.value === null) return global.value;
  return (local.matches * local.value + k * global.value) / (local.matches + k);
}
