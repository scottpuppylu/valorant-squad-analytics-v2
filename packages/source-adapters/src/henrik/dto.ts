import { z } from 'zod';

/**
 * Henrik response envelopes (docs.henrikdev.xyz, API v4.x reference, checked 2026-10-09). INTERNAL to this adapter:
 * never re-exported from the package. Only the fields the adapter reads are validated; everything else is ignored
 * (the v4 match document itself is interpreted by normalizeV4.ts, which tolerates missing / partial evidence).
 */
const NonEmpty = z.string().min(1).max(200);
const Json = z.record(z.string(), z.unknown());

/** GET /valorant/v2/account/{name}/{tag} */
export const HenrikAccountResponse = z.object({
  data: z.object({ puuid: NonEmpty, name: z.string().max(40).optional(), tag: z.string().max(10).optional(), region: z.string().max(10).optional() }),
});

/** GET /valorant/v4/by-puuid/matches/{affinity}/{platform}/{puuid} — data is an array of full v4 match documents. */
export const HenrikMatchListResponse = z.object({
  data: z.array(z.object({ metadata: z.object({ match_id: NonEmpty }) })).max(100),
});

/** GET /valorant/v4/match/{affinity}/{match_id} */
export const HenrikMatchResponse = z.object({
  data: Json.and(z.object({ metadata: z.object({ match_id: NonEmpty }) })),
});

const Tier = z.object({ id: z.number().int().nonnegative().optional(), name: z.string().min(1).max(40).optional() }).nullish();
const Season = z.object({ id: z.string().max(80).optional(), short: z.string().max(16).optional() }).nullish();

/** GET /valorant/v3/by-puuid/mmr/{affinity}/{platform}/{puuid} — every block optional (rank absence is not an error). */
export const HenrikMmrResponse = z.object({
  data: z.object({
    current: z.object({ tier: Tier, rr: z.number().int().nullish(), last_change: z.number().int().nullish(), elo: z.number().int().nullish() }).nullish(),
    peak: z.object({ season: Season, tier: Tier, rr: z.number().int().nullish() }).nullish(),
    seasonal: z.array(z.object({ season: Season, end_tier: Tier, end_rr: z.number().int().nullish() })).max(200).nullish(),
  }),
});
