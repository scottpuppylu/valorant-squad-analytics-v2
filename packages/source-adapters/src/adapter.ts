import type { CanonicalMatch, RankContext } from '@vsa/contracts/canonical';

/**
 * The provider abstraction. An adapter DECLARES what it actually supports; callers must check capabilities, and
 * unsupported operations are simply absent (no adapter is forced to implement everything).
 * Adapters return CANONICAL contracts only — provider payload types never leave an adapter.
 */
export const PROVIDER_CAPABILITIES = ['IDENTITY', 'MATCH_HISTORY', 'MATCH_DETAIL', 'RANK', 'FORWARD_EVENTS', 'STATIC_CONTENT'] as const;
export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

/** Upper bound for one listMatches page: every acquisition step is bounded. */
export const MAX_MATCH_PAGE_SIZE = 20;

export interface ResolveAccountInput { handle: string }
export interface ResolvedAccount { providerAccountRef: string; handle: string }

export interface ListMatchesInput { providerAccountRef: string; cursor: string | null; limit: number }
export interface ListMatchesResult { matchRefs: string[]; nextCursor: string | null }

/** Maps a provider account reference to the internal member/account identity (null = untracked participant). */
export type IdentityResolver = (providerAccountRef: string) => { memberId: string; accountId: string } | null;

export interface GetMatchInput { matchRef: string; resolveIdentity: IdentityResolver; observedAt: string }
export interface RankContextInput { providerAccountRef: string; memberId: string; observedAt: string }

export interface DataProviderAdapter {
  readonly providerId: string;
  /** The ADAPTER's version — independent of the canonical schema version. */
  readonly providerVersion: string;
  capabilities(): ReadonlySet<ProviderCapability>;
  resolveAccount?(input: ResolveAccountInput): Promise<ResolvedAccount>;
  listMatches?(input: ListMatchesInput): Promise<ListMatchesResult>;
  getMatch?(input: GetMatchInput): Promise<CanonicalMatch>;
  getRankContext?(input: RankContextInput): Promise<RankContext[]>;
}

export class UnsupportedCapabilityError extends Error {
  constructor(providerId: string, capability: ProviderCapability) {
    super(`provider ${providerId} does not support ${capability}`);
    this.name = 'UnsupportedCapabilityError';
  }
}

/** A transient provider outage (eligible for fallback). Anything else is a hard failure. */
export class ProviderUnavailableError extends Error {
  constructor(providerId: string, reason: string) {
    super(`provider ${providerId} unavailable: ${reason}`);
    this.name = 'ProviderUnavailableError';
  }
}

export function supports(adapter: DataProviderAdapter, capability: ProviderCapability): boolean {
  return adapter.capabilities().has(capability);
}

/** Narrow an adapter to one capability's method or throw a typed error. */
export function requireCapability<M extends 'resolveAccount' | 'listMatches' | 'getMatch' | 'getRankContext'>(
  adapter: DataProviderAdapter, capability: ProviderCapability, method: M,
): NonNullable<DataProviderAdapter[M]> {
  const fn = adapter[method];
  if (!supports(adapter, capability) || typeof fn !== 'function') throw new UnsupportedCapabilityError(adapter.providerId, capability);
  return fn.bind(adapter) as NonNullable<DataProviderAdapter[M]>;
}
