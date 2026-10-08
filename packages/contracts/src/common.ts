import { z } from 'zod';

/** ISO-8601 UTC instant with milliseconds, e.g. 2026-10-01T18:00:00.000Z (the form `Date#toISOString` produces). */
export const IsoInstant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u, 'ISO-8601 UTC instant with milliseconds');

/** Internal identifiers (never exported publicly): lowercase slug-like keys. */
export const InternalId = z.string().regex(/^[a-z0-9][a-z0-9_-]{2,63}$/u, 'internal id');

/** Public member identifier: derived, non-reversible, never a provider account id. */
export const PublicMemberId = z.string().regex(/^m_[0-9a-f]{16}$/u, 'public member id');
export const PublicGroupId = z.string().regex(/^g_[0-9a-f]{16}$/u, 'public group id');

export const HistoryCompleteness = z.enum(['unknown', 'provider-visible']);
export type HistoryCompleteness = z.infer<typeof HistoryCompleteness>;

export const GameMode = z.enum(['competitive', 'unrated', 'other', 'unknown']);
export type GameMode = z.infer<typeof GameMode>;

export const NonNegativeInt = z.number().int().nonnegative();
