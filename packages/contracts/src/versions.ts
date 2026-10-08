/**
 * Contract versions. Each is independent: a provider adapter's version is NEVER the canonical schema version, and the
 * product being "V2" never renames an accepted algorithm (algorithm ids live with their implementations).
 *
 * canonical-schema-v2 (V2-DATA-IMPORT-01): rich participant / round / round-participant / kill evidence, private player
 * snapshots, preserved provider modes, explicit evidence statuses and acquisition provenance. v1 only ever held
 * synthetic bootstrap data.
 */
export const CANONICAL_SCHEMA_VERSION = 'canonical-schema-v2' as const;
export const ANALYTICS_CONTRACT_VERSION = 'analytics-contract-v1' as const;
export const PUBLIC_SNAPSHOT_VERSION = 'public-snapshot-v1' as const;
export const MANIFEST_VERSION = 'manifest-v1' as const;
export const CONTROL_CONTRACT_VERSION = 'control-contract-v2' as const;
