/**
 * Contract versions. Each is independent: a provider adapter's version is NEVER the canonical schema version, and the
 * product being "V2" never renames an accepted algorithm (algorithm ids live with their implementations).
 */
export const CANONICAL_SCHEMA_VERSION = 'canonical-schema-v1' as const;
export const ANALYTICS_CONTRACT_VERSION = 'analytics-contract-v1' as const;
export const PUBLIC_SNAPSHOT_VERSION = 'public-snapshot-v1' as const;
export const MANIFEST_VERSION = 'manifest-v1' as const;
export const CONTROL_CONTRACT_VERSION = 'control-contract-v1' as const;
