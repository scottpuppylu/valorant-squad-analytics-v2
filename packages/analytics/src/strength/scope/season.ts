// Ported from legacy `src/analytics/scope/season.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged.

/**
 * Public Act key from the provider's human-readable season short code (e.g. "e9a3", "v26a1").
 * Provider season UUIDs are never exposed. Unrecognized formats stay unclassified (未分類),
 * never guessed. No hardcoded Riot season calendar exists in this project.
 */
const seasonPattern = /^([ev])(\d{1,2})a(\d{1,2})$/u;

export function normalizeSeasonKey(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim().toLowerCase();
  return seasonPattern.test(value) ? value : undefined;
}

export function seasonLabel(key: string | undefined): string {
  const match = key ? seasonPattern.exec(key) : null;
  return match ? `${match[1]!.toUpperCase()}${match[2]}:A${match[3]}` : '未知 Act／未分類';
}

/** Option label; the highest observed key is 最新有紀錄 (never "current official Act"). */
export function actOptionLabel(key: string, index: number): string {
  return index === 0 ? `${seasonLabel(key)}（最新有紀錄）` : seasonLabel(key);
}

/** Deterministic newest-first ordering of public keys by episode then act number. */
export function compareSeasonKeysDesc(a: string, b: string): number {
  const pa = seasonPattern.exec(a);
  const pb = seasonPattern.exec(b);
  if (!pa || !pb) return a.localeCompare(b);
  return Number(pb[2]) - Number(pa[2]) || Number(pb[3]) - Number(pa[3]) || pb[1]!.localeCompare(pa[1]!);
}
