import type { ProviderCapability } from './adapter.ts';

/**
 * Structured provider error classification (`provider-errors-v1`). Messages are code-defined: they never contain a
 * URL, header, credential, account reference, match id or response body.
 */
export const PROVIDER_ERROR_KINDS = [
  'NETWORK_UNAVAILABLE', // DNS / connection failure before any HTTP status
  'TIMEOUT', // the transport's own deadline elapsed
  'ABORTED', // the caller's AbortSignal fired
  'PROVIDER_UNAVAILABLE', // 5xx / documented temporary outage
  'RATE_LIMITED', // 429
  'AUTH_FAILED', // 401 / 403
  'NOT_FOUND', // 404
  'BAD_REQUEST', // other 4xx
  'MALFORMED_RESPONSE', // non-JSON or contract-violating 2xx body
  'CAPABILITY_UNSUPPORTED', // the adapter does not declare the capability
  'CAPABILITY_NOT_CONFIGURED', // declared in principle, but credentials / approval are absent
  'MISCONFIGURED', // invalid local configuration (e.g. limiter above the policy ceiling)
  'REQUEST_BUDGET_EXHAUSTED', // the request budget would be exceeded: fail closed, no request sent
  'PROVIDER_CONFLICT', // two sources disagree about evidence that must be identical
] as const;
export type ProviderErrorKind = (typeof PROVIDER_ERROR_KINDS)[number];

/**
 * Router fallback is allowed ONLY for these kinds: network unavailable, provider temporarily unavailable (5xx / timeout),
 * or capability unsupported / not configured. Never on conflict, auth, not-found, malformed data, rate limit or budget.
 */
export const FALLBACK_ELIGIBLE: ReadonlySet<ProviderErrorKind> = new Set<ProviderErrorKind>([
  'NETWORK_UNAVAILABLE', 'TIMEOUT', 'PROVIDER_UNAVAILABLE', 'CAPABILITY_UNSUPPORTED', 'CAPABILITY_NOT_CONFIGURED',
]);

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly providerId: string;
  readonly capability: ProviderCapability | null;
  readonly httpStatus: number | null;
  /** Seconds, from a documented Retry-After / reset header (429 only). */
  readonly retryAfterSeconds: number | null;
  constructor(input: { kind: ProviderErrorKind; providerId: string; capability?: ProviderCapability | null; message?: string; httpStatus?: number | null; retryAfterSeconds?: number | null }) {
    super(input.message ?? `provider ${input.providerId} ${input.kind}${input.capability ? ` (${input.capability})` : ''}`);
    this.name = 'ProviderError';
    this.kind = input.kind;
    this.providerId = input.providerId;
    this.capability = input.capability ?? null;
    this.httpStatus = input.httpStatus ?? null;
    this.retryAfterSeconds = input.retryAfterSeconds ?? null;
  }
}

export const isProviderError = (error: unknown): error is ProviderError => error instanceof ProviderError;
export const isFallbackEligible = (error: unknown): boolean => isProviderError(error) && FALLBACK_ELIGIBLE.has(error.kind);

/** Declared-but-unconfigured capability (e.g. Riot without production approval). Never a fake implementation. */
export class CapabilityNotConfiguredError extends ProviderError {
  constructor(providerId: string, capability: ProviderCapability, reason: string) {
    super({ kind: 'CAPABILITY_NOT_CONFIGURED', providerId, capability, message: `provider ${providerId} ${capability} not configured: ${reason}` });
    this.name = 'CapabilityNotConfiguredError';
  }
}

/** Two sources disagree. Carries only field NAMES, never values. The router never falls back or merges on it. */
export class ProviderConflictError extends ProviderError {
  readonly fields: readonly string[];
  constructor(providerIds: readonly string[], fields: readonly string[]) {
    super({ kind: 'PROVIDER_CONFLICT', providerId: providerIds.join(','), message: `PROVIDER_CONFLICT between ${providerIds.join(',')}: ${fields.join(',')}` });
    this.name = 'ProviderConflictError';
    this.fields = [...fields];
  }
}
