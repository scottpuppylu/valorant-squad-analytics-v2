// Ported from legacy `src/analytics/rank/tiers.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged.

/**
 * TASK-DATA-RANK-01 — deterministic VALORANT competitive tier ORDERING (`valorant-tier-order-v1`).
 *
 * `tierOrdinal` is comparison / ordering metadata ONLY. It is not a strength score, not a multiplier and not an
 * MMR estimate: ordinal distances carry no claim of equal skill intervals (Gold→Platinum is not "the same gap" as
 * Immortal→Radiant). Rank is context / prior / calibration for later tasks, never a final score.
 *
 * Normalization is by the provider's tier NAME (an observed fact). Numeric provider tier ids are kept as observed
 * facts but only mapped when the current ranking schema is known to apply: the id ↔ tier table changed when
 * Ascendant was introduced (pre-Ascendant ids 21–24 meant Immortal 1–3 / Radiant).
 */
export const RANK_TIER_MODEL_VERSION = 'valorant-tier-order-v1' as const;

const DIVISIONS = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant', 'Immortal'] as const;
export type TierFamily = (typeof DIVISIONS)[number] | 'Radiant' | 'Unranked';

export interface NormalizedTier {
  /** Canonical key, e.g. 'gold_2', 'radiant', 'unranked'. */
  key: string;
  label: string;
  family: TierFamily;
  /** 1..3 inside a family; null for Radiant / Unranked. */
  division: number | null;
  /** Ordering only (Iron 1 = 1 … Radiant = 25); null for Unranked or unknown. NOT a strength value. */
  tierOrdinal: number | null;
  ranked: boolean;
}

const RANKED: NormalizedTier[] = [
  ...DIVISIONS.flatMap((family, familyIndex) => [1, 2, 3].map((division) => ({
    key: `${family.toLowerCase()}_${division}`, label: `${family} ${division}`, family, division,
    tierOrdinal: familyIndex * 3 + division, ranked: true,
  }))),
  { key: 'radiant', label: 'Radiant', family: 'Radiant', division: null, tierOrdinal: DIVISIONS.length * 3 + 1, ranked: true },
];
export const UNRANKED_TIER: NormalizedTier = { key: 'unranked', label: 'Unranked', family: 'Unranked', division: null, tierOrdinal: null, ranked: false };
export const VALORANT_TIERS: readonly NormalizedTier[] = Object.freeze([...RANKED]);

const BY_NAME = new Map<string, NormalizedTier>([
  ...RANKED.map((tier): [string, NormalizedTier] => [tier.label.toLowerCase(), tier]),
  ['unrated', UNRANKED_TIER], ['unranked', UNRANKED_TIER],
]);
/** Current (post-Ascendant) provider/Riot competitive tier ids: 0 unrated, 3..26 Iron 1..Immortal 3, 27 Radiant. */
const CURRENT_SCHEMA_ID: ReadonlyMap<number, NormalizedTier> = new Map([
  [0, UNRANKED_TIER],
  ...RANKED.map((tier): [number, NormalizedTier] => [tier.tierOrdinal! + 2, tier]),
]);

/** Name-first normalization. An unknown or future tier name stays UNKNOWN (null), never guessed. */
export function normalizeTier(input: { name?: string | null; id?: number | null; currentSchema?: boolean }): NormalizedTier | null {
  const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/gu, ' ').toLowerCase() : '';
  if (name) return BY_NAME.get(name) ?? null;
  if (input.currentSchema === true && Number.isSafeInteger(input.id)) return CURRENT_SCHEMA_ID.get(input.id!) ?? null;
  return null;
}

/** Ordering comparator for known tiers (unranked/unknown sort first). Ordering only. */
export function compareTiers(left: NormalizedTier | null, right: NormalizedTier | null): number {
  return (left?.tierOrdinal ?? 0) - (right?.tierOrdinal ?? 0);
}
