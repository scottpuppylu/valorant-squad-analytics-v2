import type { CanonicalMatch } from '@vsa/contracts/canonical';
import { ProviderUnavailableError, requireCapability, supports, type DataProviderAdapter, type GetMatchInput, type ProviderCapability } from './adapter.ts';

/**
 * ProviderRouter (design-level, minimal): an ordered primary → fallback list per capability.
 * It returns ONE provider's evidence with its provenance and NEVER merges conflicting evidence from several providers;
 * a future reconciliation policy must be explicit (docs/DATA_SOURCE_STRATEGY.md). Fallback happens only on a
 * ProviderUnavailableError; any other error propagates.
 */
export class ProviderRouter {
  private readonly adapters: readonly DataProviderAdapter[];
  constructor(adapters: readonly DataProviderAdapter[]) {
    this.adapters = adapters;
  }

  candidates(capability: ProviderCapability): DataProviderAdapter[] {
    return this.adapters.filter((adapter) => supports(adapter, capability));
  }

  async getMatch(input: GetMatchInput & { providerId?: string }): Promise<{ match: CanonicalMatch; servedBy: string }> {
    const candidates = this.candidates('MATCH_DETAIL').filter((a) => !input.providerId || a.providerId === input.providerId);
    if (candidates.length === 0) throw new Error('no provider supports MATCH_DETAIL');
    const unavailable: string[] = [];
    for (const adapter of candidates) {
      try {
        const match = await requireCapability(adapter, 'MATCH_DETAIL', 'getMatch')(input);
        return { match, servedBy: adapter.providerId };
      } catch (error) {
        if (!(error instanceof ProviderUnavailableError)) throw error;
        unavailable.push(adapter.providerId);
      }
    }
    throw new ProviderUnavailableError(unavailable.join(','), 'every candidate was unavailable');
  }
}
