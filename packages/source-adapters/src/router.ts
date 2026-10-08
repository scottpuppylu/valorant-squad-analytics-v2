import type { CanonicalMatch, RankContext } from '@vsa/contracts/canonical';
import {
  CAPABILITY_METHOD, ProviderUnavailableError, recordNamespaceOf, supports, UnsupportedCapabilityError, type CapabilityMethod, type DataProviderAdapter, type GetMatchInput,
  type ListMatchesInput, type ListMatchesResult, type ProviderCapability, type RankContextInput, type ResolveAccountInput, type ResolvedAccount,
} from './adapter.ts';
import { isFallbackEligible, isProviderError, ProviderError, type ProviderErrorKind } from './errors.ts';
import type { ProviderHealthTracker } from './health.ts';

export interface ProviderRouterOptions {
  /** Explicit ordered provider ids per capability. Without a route: registration order, filtered by declared support. */
  routes?: Partial<Record<ProviderCapability, readonly string[]>>;
  health?: ProviderHealthTracker;
}

export interface RouteSelector {
  /** Pin one provider: no fallback at all. */
  providerId?: string;
  /** Required namespace of the refs in the input (account / match refs are provider-scoped). */
  recordNamespace?: string;
}

export interface RouteAttempt { providerId: string; outcome: 'served' | ProviderErrorKind }
export interface Routed<T> { result: T; servedBy: string; recordNamespace: string; attempts: RouteAttempt[] }

/**
 * Capability router (`provider-router-v1`). Deterministic: the same adapters, routes and inputs always give the same
 * candidate order. It returns exactly ONE provider's result with its provenance and never merges evidence.
 *
 * Fallback happens ONLY on: network unavailable / timeout, provider temporarily unavailable (5xx), or capability
 * unsupported / not configured. Conflicts (PROVIDER_CONFLICT), auth failures, not-found, malformed data, rate limits
 * and budget exhaustion propagate immediately. Ref-bearing operations (history, detail, rank) only fall back inside
 * one record namespace, because a provider's account / match refs mean nothing to another provider.
 */
export class ProviderRouter {
  private readonly adapters: readonly DataProviderAdapter[];
  private readonly routes: Partial<Record<ProviderCapability, readonly string[]>>;
  private readonly health: ProviderHealthTracker | null;

  constructor(adapters: readonly DataProviderAdapter[], options: ProviderRouterOptions = {}) {
    const ids = adapters.map((a) => a.providerId);
    if (new Set(ids).size !== ids.length) throw new ProviderError({ kind: 'MISCONFIGURED', providerId: 'router', message: 'duplicate provider id in router' });
    for (const [capability, route] of Object.entries(options.routes ?? {})) {
      if (route.some((id) => !ids.includes(id)) || new Set(route).size !== route.length) {
        throw new ProviderError({ kind: 'MISCONFIGURED', providerId: 'router', message: `route for ${capability} names an unknown or repeated provider` });
      }
    }
    this.adapters = adapters;
    this.routes = options.routes ?? {};
    this.health = options.health ?? null;
  }

  /** Providers that declare the capability, in routing order. */
  candidates(capability: ProviderCapability, selector: RouteSelector = {}): DataProviderAdapter[] {
    return this.ordered(capability, selector).filter((a) => supports(a, capability));
  }

  resolveAccount(input: ResolveAccountInput, selector: RouteSelector = {}): Promise<Routed<ResolvedAccount>> {
    return this.run('resolveAccount', selector, false, (a) => a.resolveAccount!(input));
  }

  listMatches(input: ListMatchesInput, selector: RouteSelector = {}): Promise<Routed<ListMatchesResult>> {
    return this.run('listMatches', selector, true, (a) => a.listMatches!(input));
  }

  async getMatch(input: GetMatchInput, selector: RouteSelector = {}): Promise<{ match: CanonicalMatch; servedBy: string; recordNamespace: string; attempts: RouteAttempt[] }> {
    const routed = await this.run('getMatch', selector, true, (a) => a.getMatch!(input));
    return { match: routed.result, servedBy: routed.servedBy, recordNamespace: routed.recordNamespace, attempts: routed.attempts };
  }

  getRankContext(input: RankContextInput, selector: RouteSelector = {}): Promise<Routed<RankContext[]>> {
    return this.run('getRankContext', selector, true, (a) => a.getRankContext!(input));
  }

  private ordered(capability: ProviderCapability, selector: RouteSelector): DataProviderAdapter[] {
    const route = this.routes[capability];
    let list = route ? route.map((id) => this.adapters.find((a) => a.providerId === id)!) : this.adapters.filter((a) => supports(a, capability));
    if (selector.providerId !== undefined) list = list.filter((a) => a.providerId === selector.providerId);
    if (selector.recordNamespace !== undefined) list = list.filter((a) => recordNamespaceOf(a) === selector.recordNamespace);
    return list;
  }

  private async run<T>(method: CapabilityMethod, selector: RouteSelector, refBearing: boolean, call: (adapter: DataProviderAdapter) => Promise<T>): Promise<Routed<T>> {
    const capability = CAPABILITY_METHOD[method];
    let list = this.ordered(capability, selector);
    // Ref-bearing input: stay inside the first candidate's namespace unless the caller named one.
    if (refBearing && selector.recordNamespace === undefined && list.length) {
      const namespace = recordNamespaceOf(list.find((a) => supports(a, capability)) ?? list[0]!);
      list = list.filter((a) => recordNamespaceOf(a) === namespace);
    }
    const attempts: RouteAttempt[] = [];
    for (const adapter of list) {
      if (!supports(adapter, capability) || typeof adapter[method] !== 'function') {
        attempts.push({ providerId: adapter.providerId, outcome: 'CAPABILITY_UNSUPPORTED' });
        continue;
      }
      try {
        const result = await call(adapter);
        this.health?.recordSuccess(adapter.providerId);
        attempts.push({ providerId: adapter.providerId, outcome: 'served' });
        return { result, servedBy: adapter.providerId, recordNamespace: recordNamespaceOf(adapter), attempts };
      } catch (error) {
        this.health?.recordFailure(adapter.providerId, error);
        if (!isFallbackEligible(error)) throw error;
        attempts.push({ providerId: adapter.providerId, outcome: isProviderError(error) ? error.kind : 'PROVIDER_UNAVAILABLE' });
      }
    }
    if (attempts.every((a) => a.outcome === 'CAPABILITY_UNSUPPORTED' || a.outcome === 'CAPABILITY_NOT_CONFIGURED')) throw new UnsupportedCapabilityError('router', capability);
    throw new ProviderUnavailableError(attempts.map((a) => a.providerId).join(','), 'every candidate was unavailable', capability);
  }
}
