import type { CanonicalMatch, RankContext } from '@vsa/contracts/canonical';
import { ProviderError } from './errors.ts';

/**
 * The provider abstraction. An adapter DECLARES what it actually supports; callers must check capabilities, and
 * unsupported operations are simply absent (no adapter is forced to implement everything).
 * Adapters return CANONICAL contracts only — provider payload types never leave an adapter.
 *
 * Capability vocabulary (`provider-capabilities-v1`, docs/PROVIDER_ARCHITECTURE.md):
 *   IDENTITY        resolve a player handle to a provider-scoped account reference
 *   MATCH_HISTORY   list provider-visible match references for an account (bounded pages)
 *   MATCH_DETAIL    one match → CanonicalMatch
 *   RANK            rank context rows (provider semantics, never MMR)
 *   FORWARD_LIVE    live / forward-only events from a running client (no history)
 *   STATIC_CONTENT  game content catalogs (agents, maps, …) — separate provenance from match evidence
 * Pagination and history-depth metadata are properties of MATCH_HISTORY results, not separate capabilities.
 */
export const PROVIDER_CAPABILITIES = ['IDENTITY', 'MATCH_HISTORY', 'MATCH_DETAIL', 'RANK', 'FORWARD_LIVE', 'STATIC_CONTENT'] as const;
export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];
export const PROVIDER_CAPABILITY_VOCABULARY_VERSION = 'provider-capabilities-v1';

/** Former names → current vocabulary. `FORWARD_EVENTS` (canonical-schema-v2 era docs) is FORWARD_LIVE. */
export const LEGACY_CAPABILITY_ALIASES: Readonly<Record<string, ProviderCapability>> = Object.freeze({ FORWARD_EVENTS: 'FORWARD_LIVE' });

/** Strict parse: a known capability or a legacy alias; anything else is rejected (never guessed). */
export function parseCapability(name: string): ProviderCapability {
  if ((PROVIDER_CAPABILITIES as readonly string[]).includes(name)) return name as ProviderCapability;
  const alias = LEGACY_CAPABILITY_ALIASES[name];
  if (alias) return alias;
  throw new RangeError(`unknown provider capability: ${name.slice(0, 40)}`);
}

/** Upper bound for one listMatches page: every acquisition step is bounded. */
export const MAX_MATCH_PAGE_SIZE = 20;

export interface ResolveAccountInput { handle: string; signal?: AbortSignal }
export interface ResolvedAccount { providerAccountRef: string; handle: string }

export interface ListMatchesInput { providerAccountRef: string; cursor: string | null; limit: number; signal?: AbortSignal }
/**
 * History-depth metadata (internal only). A provider exposes a VISIBLE subset of a career: `lifetimeComplete` is always
 * false; `providerReportedTotal` is null unless the provider documents and returns a total.
 */
export interface HistoryDepthMetadata {
  completeness: 'provider-visible' | 'unknown';
  lifetimeComplete: false;
  pageOffset: number | null;
  pageSize: number;
  returned: number;
  providerReportedTotal: number | null;
}
export interface ListMatchesResult { matchRefs: string[]; nextCursor: string | null; history?: HistoryDepthMetadata }

/** Maps a provider account reference to the internal member/account identity (null = untracked participant). */
export type IdentityResolver = (providerAccountRef: string) => { memberId: string; accountId: string } | null;

export interface GetMatchInput { matchRef: string; resolveIdentity: IdentityResolver; observedAt: string; signal?: AbortSignal }
export interface RankContextInput { providerAccountRef: string; memberId: string; accountId: string; observedAt: string; signal?: AbortSignal }

export interface DataProviderAdapter {
  readonly providerId: string;
  /** The ADAPTER's version — independent of the canonical schema version. */
  readonly providerVersion: string;
  /**
   * Namespace of the account / match references this adapter accepts and emits (default: providerId). Two adapters
   * share refs only when they share a namespace (e.g. a henrik-v4 import archive and the live Henrik API).
   */
  readonly recordNamespace?: string;
  capabilities(): ReadonlySet<ProviderCapability>;
  resolveAccount?(input: ResolveAccountInput): Promise<ResolvedAccount>;
  listMatches?(input: ListMatchesInput): Promise<ListMatchesResult>;
  getMatch?(input: GetMatchInput): Promise<CanonicalMatch>;
  getRankContext?(input: RankContextInput): Promise<RankContext[]>;
}

export const recordNamespaceOf = (adapter: DataProviderAdapter): string => adapter.recordNamespace ?? adapter.providerId;

/** The adapter does not declare the capability (or does not implement it). Eligible for router fallback. */
export class UnsupportedCapabilityError extends ProviderError {
  constructor(providerId: string, capability: ProviderCapability) {
    super({ kind: 'CAPABILITY_UNSUPPORTED', providerId, capability, message: `provider ${providerId} does not support ${capability}` });
    this.name = 'UnsupportedCapabilityError';
  }
}

/** A transient provider outage (eligible for fallback). */
export class ProviderUnavailableError extends ProviderError {
  constructor(providerId: string, reason: string, capability: ProviderCapability | null = null) {
    super({ kind: 'PROVIDER_UNAVAILABLE', providerId, capability, message: `provider ${providerId} unavailable: ${reason}` });
    this.name = 'ProviderUnavailableError';
  }
}

export function supports(adapter: DataProviderAdapter, capability: ProviderCapability): boolean {
  return adapter.capabilities().has(capability);
}

export type CapabilityMethod = 'resolveAccount' | 'listMatches' | 'getMatch' | 'getRankContext';
export const CAPABILITY_METHOD: Readonly<Record<CapabilityMethod, ProviderCapability>> = Object.freeze({
  resolveAccount: 'IDENTITY', listMatches: 'MATCH_HISTORY', getMatch: 'MATCH_DETAIL', getRankContext: 'RANK',
});

/** Narrow an adapter to one capability's method or throw a typed error. */
export function requireCapability<M extends CapabilityMethod>(
  adapter: DataProviderAdapter, capability: ProviderCapability, method: M,
): NonNullable<DataProviderAdapter[M]> {
  const fn = adapter[method];
  if (!supports(adapter, capability) || typeof fn !== 'function') throw new UnsupportedCapabilityError(adapter.providerId, capability);
  return fn.bind(adapter) as NonNullable<DataProviderAdapter[M]>;
}
