import type { CanonicalMatch } from '@vsa/contracts/canonical';
import type { IdentityResolver } from '../adapter.ts';
import { HENRIK_PROVIDER_ID, normalizeHenrikV4Match } from './normalizeV4.ts';

/** How an import archive's payload format is interpreted. Registered per payload format; unknown formats are rejected. */
export interface ArchivePayloadFormat {
  readonly payloadFormat: string;
  /** Namespace of the record refs inside (an archive of henrik-v4 documents shares refs with the live Henrik API). */
  readonly recordNamespace: string;
  /** The payload's own record ref (e.g. its match id), or null if absent. */
  recordRef(payload: Record<string, unknown>): string | null;
  /** Provider account refs participating in the payload (for MATCH_HISTORY over an archive). */
  participantRefs(payload: Record<string, unknown>): string[];
  normalize(payload: Record<string, unknown>, ctx: { resolveIdentity: IdentityResolver; observedAt: string; acquisitionSource: string; normalizerVersion: string }): CanonicalMatch;
}

const rec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const HENRIK_V4_MATCH_ARCHIVE_FORMAT: ArchivePayloadFormat = {
  payloadFormat: 'henrik-v4-match',
  recordNamespace: HENRIK_PROVIDER_ID,
  recordRef: (payload) => (rec(payload.metadata) && typeof payload.metadata.match_id === 'string' && payload.metadata.match_id ? payload.metadata.match_id : null),
  participantRefs: (payload) => (Array.isArray(payload.players) ? payload.players.flatMap((p) => (rec(p) && typeof p.puuid === 'string' && p.puuid ? [p.puuid] : [])) : []),
  normalize: (payload, ctx) => normalizeHenrikV4Match(payload, { resolveIdentity: ctx.resolveIdentity, observedAt: ctx.observedAt, acquisitionSource: ctx.acquisitionSource,
    provenance: { acquisition: 'provider-adapter', normalizerVersion: ctx.normalizerVersion } }).match,
};
