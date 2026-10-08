/**
 * Henrik-specific entry point (`@vsa/source-adapters/henrik`). Exports the adapter, its constants and the v4
 * normalizer FUNCTIONS — never the Henrik response DTO schemas (henrik/dto.ts stays internal).
 * Allowed importers: packages/source-adapters and the one-way legacy importer (PROVIDER_TYPES_OUTSIDE_ADAPTERS).
 */
export {
  HENRIK_ADAPTER_VERSION, HENRIK_AFFINITIES, HENRIK_BASE_URL, HENRIK_CAPABILITIES, HENRIK_MAX_LIVE_REQUESTS, HENRIK_NORMALIZER_VERSION, HenrikAdapter,
  type HenrikAdapterConfig, type HenrikAffinity, type HenrikPlatform,
} from './henrikAdapter.ts';
export { HENRIK_V4_MATCH_ARCHIVE_FORMAT } from './archiveFormat.ts';
export {
  deriveRoundSide, HENRIK_PAYLOAD_VERSION, HENRIK_PROVIDER_ID, LEGACY_IMPORT_NORMALIZER_VERSION, NormalizationError, normalizeHenrikV4Match, normalizeMode,
  type NormalizeContext, type NormalizeDiagnostics,
} from './normalizeV4.ts';
