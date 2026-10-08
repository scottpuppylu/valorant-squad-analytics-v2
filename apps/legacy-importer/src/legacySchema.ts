import { z } from 'zod';

/**
 * The legacy private staging schema, as AUDITED (docs/V2_DATA_IMPORT.md): `rebuild-staging-v1` + `rank-staging-v1`.
 * Every row is parsed before use; anything that does not match fails closed.
 */
export const EXPECTED_SOURCE_VERSIONS = { rebuild_staging: 'rebuild-staging-v1', rank_staging: 'rank-staging-v1' } as const;
export const SOURCE_SYSTEM = 'legacy-rebuild-staging' as const;

const Uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
const Instant = z.union([z.date(), z.string()]).transform((v) => (v instanceof Date ? v : new Date(v)).toISOString());

export const LegacyAccountRow = z.object({
  account_public_id: Uuid,
  member_public_id: Uuid,
  community_name: z.string().min(1).max(40),
  is_primary: z.boolean(),
  provider_puuid: z.string().min(1).max(200).nullable(),
}).strict();
export type LegacyAccountRow = z.infer<typeof LegacyAccountRow>;

export const LegacyMatchRow = z.object({
  provider_match_id: z.string().min(1).max(200),
  payload_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  fetched_at: Instant,
  payload: z.record(z.string(), z.unknown()),
}).strict();
export type LegacyMatchRow = z.infer<typeof LegacyMatchRow>;

export const LegacyRankRow = z.object({
  evidence_key: z.string().min(1).max(200),
  account_public_id: Uuid,
  kind: z.enum(['current', 'peak', 'seasonal', 'history', 'match_snapshot']),
  source: z.string().min(1).max(80),
  effective_at: Instant,
  season_short: z.string().nullable(),
  provider_tier_id: z.number().int().nullable(),
  provider_tier_name: z.string().nullable(),
  rr: z.number().int().nullable(),
  provider_elo: z.number().int().nullable(),
  rr_change: z.number().int().nullable(),
  match_ref: z.string().nullable(),
  queue: z.string().nullable(),
  normalized_tier_key: z.string().nullable(),
  tier_ordinal: z.number().int().nullable(),
  tier_model_version: z.string().min(1).max(40),
}).strict();
export type LegacyRankRow = z.infer<typeof LegacyRankRow>;
