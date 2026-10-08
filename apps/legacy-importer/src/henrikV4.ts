/**
 * The Henrik v4 normalizer lives in @vsa/source-adapters (V2-PROVIDER-WAVE-01; logic unchanged). The importer keeps
 * its legacy provenance through the normalizer's defaults (`legacy-import`, `legacy-henrik-v4-import-v1`).
 */
export {
  deriveRoundSide, HENRIK_PAYLOAD_VERSION, HENRIK_PROVIDER_ID, LEGACY_IMPORT_NORMALIZER_VERSION, NormalizationError, normalizeHenrikV4Match, normalizeMode,
  type NormalizeContext, type NormalizeDiagnostics,
} from '@vsa/source-adapters/henrik';
