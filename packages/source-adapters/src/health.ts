import { isProviderError, type ProviderErrorKind } from './errors.ts';

export const PROVIDER_HEALTH_STATES = ['AVAILABLE', 'RATE_LIMITED', 'AUTH_FAILED', 'TEMPORARY_ERROR', 'CAPABILITY_UNAVAILABLE', 'MISCONFIGURED'] as const;
export type ProviderHealthState = (typeof PROVIDER_HEALTH_STATES)[number];

/** Error kind → health. Request-level outcomes (not found, bad request, malformed, conflict) do not change health. */
export function healthOfKind(kind: ProviderErrorKind): ProviderHealthState | null {
  switch (kind) {
    case 'RATE_LIMITED': return 'RATE_LIMITED';
    case 'AUTH_FAILED': return 'AUTH_FAILED';
    case 'NETWORK_UNAVAILABLE': case 'TIMEOUT': case 'PROVIDER_UNAVAILABLE': return 'TEMPORARY_ERROR';
    case 'CAPABILITY_UNSUPPORTED': case 'CAPABILITY_NOT_CONFIGURED': return 'CAPABILITY_UNAVAILABLE';
    case 'MISCONFIGURED': case 'REQUEST_BUDGET_EXHAUSTED': return 'MISCONFIGURED';
    default: return null;
  }
}

/** Last observed health per provider. Holds provider ids and states only. */
export class ProviderHealthTracker {
  private readonly states = new Map<string, { state: ProviderHealthState; at: string }>();
  private readonly now: () => string;
  constructor(now: () => string = () => new Date().toISOString()) {
    this.now = now;
  }
  recordSuccess(providerId: string): void {
    this.states.set(providerId, { state: 'AVAILABLE', at: this.now() });
  }
  recordFailure(providerId: string, error: unknown): void {
    const state = isProviderError(error) ? healthOfKind(error.kind) : 'TEMPORARY_ERROR';
    if (state) this.states.set(providerId, { state, at: this.now() });
  }
  get(providerId: string): { state: ProviderHealthState; at: string } | null {
    return this.states.get(providerId) ?? null;
  }
  snapshot(): { providerId: string; state: ProviderHealthState; at: string }[] {
    return [...this.states.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([providerId, v]) => ({ providerId, ...v }));
  }
}
