import type { DataProviderAdapter, ProviderCapability } from './adapter.ts';

/**
 * Interface skeletons for future providers. They declare NO capabilities until implemented, make no network calls and
 * hold no credentials. Planned capabilities are documentation (docs/DATA_SOURCE_STRATEGY.md), not runtime facts.
 */
abstract class SkeletonAdapter implements DataProviderAdapter {
  abstract readonly providerId: string;
  abstract readonly providerVersion: string;
  capabilities(): ReadonlySet<ProviderCapability> {
    return new Set();
  }
}

/** Planned (not implemented): IDENTITY, MATCH_HISTORY, MATCH_DETAIL, RANK — server-side key only, never in a browser. */
export class HenrikAdapter extends SkeletonAdapter {
  readonly providerId = 'henrik';
  readonly providerVersion = 'henrik-adapter-v0-skeleton';
}

/** Planned (not implemented): IDENTITY (RSO), MATCH_HISTORY, MATCH_DETAIL — requires Riot production approval. */
export class RiotAdapter extends SkeletonAdapter {
  readonly providerId = 'riot';
  readonly providerVersion = 'riot-adapter-v0-skeleton';
}

/** Planned (not implemented): FORWARD_EVENTS from a user-installed client app, forward-only, no history. */
export class OverwolfAdapter extends SkeletonAdapter {
  readonly providerId = 'overwolf';
  readonly providerVersion = 'overwolf-adapter-v0-skeleton';
}
