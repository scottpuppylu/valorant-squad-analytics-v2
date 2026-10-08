/**
 * Provider-NEUTRAL entry point: capability vocabulary, errors, router, transport, identity, provenance, health.
 * Provider-specific adapters live behind their own subpaths (`/henrik`, `/riot`, `/overwolf`, `/import`, `/fake`) so
 * an import of provider code is always visible (check:architecture PROVIDER_TYPES_OUTSIDE_ADAPTERS).
 */
export * from './adapter.ts';
export * from './errors.ts';
export { canonicalMatchKey, canonicalParticipantKey } from './keys.ts';
export { ProviderRouter, type ProviderRouterOptions, type RouteAttempt, type Routed, type RouteSelector } from './router.ts';
export { healthOfKind, PROVIDER_HEALTH_STATES, ProviderHealthTracker, type ProviderHealthState } from './health.ts';
export {
  assertConsistent, CANDIDATE_START_WINDOW_MS, factConflicts, groupLogicalMatches, LOGICAL_MATCH_IDENTITY_VERSION, relateMatches, type CrossProviderLink,
  type LogicalMatchGrouping, type MatchIdentityRelation,
} from './identity.ts';
export { provenanceOf, publicProvenance, rankProvenanceOf, type IngestionProvenance } from './provenance.ts';
export { ADAPTER_TIER_MODEL_VERSION, normalizeTierName } from './rankTier.ts';
export { MAX_CONCURRENCY, MAX_CONFIGURED_RPM, RateLimiter, realSleep, type RateLimiterOptions, type Sleep } from './transport/rateLimiter.ts';
export { ProviderMetrics, RequestBudget, safeLogLine, type ProviderLogSink, type ProviderMetricRow } from './transport/observability.ts';
export { MAX_RESPONSE_BYTES, MAX_RETRIES, MAX_TIMEOUT_MS, ProviderHttpClient, retryAfterSeconds, type FetchLike, type GetJsonOptions, type ProviderHttpClientOptions } from './transport/httpClient.ts';
export { FakeProviderAdapter } from './fake/fakeProvider.ts';
