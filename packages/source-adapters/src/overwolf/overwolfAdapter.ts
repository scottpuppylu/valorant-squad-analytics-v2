import type { DataProviderAdapter, ProviderCapability } from '../adapter.ts';

export const OVERWOLF_PROVIDER_ID = 'overwolf';
export const OVERWOLF_ADAPTER_VERSION = 'overwolf-adapter-v1-design';

/**
 * Overwolf is evaluated as FORWARD_LIVE only: game events from a user-installed Overwolf desktop app during play
 * (VALORANT GEP: match_info, kill / death / assist, spike planted / defused, match_start / match_end …). It has no
 * documented history, needs an approved Overwolf app and Riot game-compliance, and its match ids are Overwolf-generated
 * (`pseudo_match_id`) — never assumed to equal any other provider's ids. docs/PROVIDER_MATRIX.md.
 */
export const OVERWOLF_DOCUMENTED_CAPABILITIES: readonly ProviderCapability[] = ['FORWARD_LIVE'];

/**
 * Design-only push contract for FORWARD_LIVE (no implementation in V2). Live events are a different shape from pull
 * adapters: a client app would buffer one match locally and hand a COMPLETED, consented match to the collector, which
 * normalizes it like any other source. Nothing here is wired to a runtime.
 */
export interface ForwardLiveSource {
  readonly providerId: string;
  /** Subscribe to completed-match envelopes; returns an unsubscribe function. */
  subscribe(listener: (envelope: { payloadFormat: string; observedAt: string; payload: Record<string, unknown> }) => void): () => void;
}

/** Declares no runtime capability; there is no Overwolf runtime, SDK or request in this repository. */
export class OverwolfAdapter implements DataProviderAdapter {
  readonly providerId = OVERWOLF_PROVIDER_ID;
  readonly providerVersion = OVERWOLF_ADAPTER_VERSION;
  readonly documentedCapabilities = OVERWOLF_DOCUMENTED_CAPABILITIES;
  capabilities(): ReadonlySet<ProviderCapability> {
    return new Set();
  }
}
