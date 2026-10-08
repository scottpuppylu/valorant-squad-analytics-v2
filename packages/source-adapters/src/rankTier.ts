/**
 * Adapter-side tier-name normalization for RankContext rows (`valorant-tier-order-v1`). Must equal
 * `normalizeTier({ name })` in @vsa/analytics (tests/providerWave.test.ts asserts it for every tier); duplicated so
 * adapters never depend on analytics. Name-first: an unknown or future tier name stays null, never guessed.
 */
export const ADAPTER_TIER_MODEL_VERSION = 'valorant-tier-order-v1';
const FAMILIES = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant', 'Immortal'] as const;

const BY_NAME = new Map<string, { key: string; tierOrdinal: number | null }>([
  ...FAMILIES.flatMap((family, index) => [1, 2, 3].map((d): [string, { key: string; tierOrdinal: number }] => [`${family.toLowerCase()} ${d}`, { key: `${family.toLowerCase()}_${d}`, tierOrdinal: index * 3 + d }])),
  ['radiant', { key: 'radiant', tierOrdinal: FAMILIES.length * 3 + 1 }],
  ['unrated', { key: 'unranked', tierOrdinal: null }],
  ['unranked', { key: 'unranked', tierOrdinal: null }],
]);

export function normalizeTierName(name: string | null | undefined): { normalizedTierKey: string | null; tierOrdinal: number | null } {
  const text = typeof name === 'string' ? name.trim().replace(/\s+/gu, ' ').toLowerCase() : '';
  const tier = text ? BY_NAME.get(text) : undefined;
  return { normalizedTierKey: tier?.key ?? null, tierOrdinal: tier?.tierOrdinal ?? null };
}
