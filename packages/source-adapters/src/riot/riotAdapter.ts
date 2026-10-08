import type { CanonicalMatch, RankContext } from '@vsa/contracts/canonical';
import type { DataProviderAdapter, ProviderCapability, ResolvedAccount, ListMatchesResult } from '../adapter.ts';
import { CapabilityNotConfiguredError } from '../errors.ts';

export const RIOT_PROVIDER_ID = 'riot';
export const RIOT_ADAPTER_VERSION = 'riot-adapter-v1-contract';

/**
 * What Riot DOCUMENTS (developer.riotgames.com, checked 2026-10-09), not what this adapter can do:
 *   IDENTITY        account-v1 (RSO `accounts/me` for opted-in users; by-riot-id)
 *   MATCH_HISTORY   val-match-v1 matchlists/by-puuid
 *   MATCH_DETAIL    val-match-v1 matches/{matchId}
 *   STATIC_CONTENT  val-content-v1 contents
 * RANK is NOT documented per player (val-ranked-v1 = act leaderboards only). Every VALORANT product needs a
 * production key and player opt-in; personal-key applications are not supported for VALORANT.
 */
export const RIOT_DOCUMENTED_CAPABILITIES: readonly ProviderCapability[] = ['IDENTITY', 'MATCH_HISTORY', 'MATCH_DETAIL', 'STATIC_CONTENT'];

/** Governance state carried into code so nobody "just configures a key". */
export const RIOT_ACCESS_STATUS = Object.freeze({
  productionKeyApproved: false,
  rsoApproved: false,
  supportTicket: '139243830',
  supportResponseReceived: false,
});

const REASON = 'riot production access / RSO not approved (support ticket #139243830 open, no response)';

/**
 * Contract-ready Riot adapter. It declares NO runtime capability, sends no request and holds no credential; every
 * operation fails with CAPABILITY_NOT_CONFIGURED. Implementing it requires an approved production key and RSO — a
 * separate, explicitly authorized task (docs/PROVIDER_ARCHITECTURE.md).
 */
export class RiotAdapter implements DataProviderAdapter {
  readonly providerId = RIOT_PROVIDER_ID;
  readonly providerVersion = RIOT_ADAPTER_VERSION;
  readonly documentedCapabilities = RIOT_DOCUMENTED_CAPABILITIES;

  capabilities(): ReadonlySet<ProviderCapability> {
    return new Set();
  }

  async resolveAccount(): Promise<ResolvedAccount> { throw new CapabilityNotConfiguredError(this.providerId, 'IDENTITY', REASON); }
  async listMatches(): Promise<ListMatchesResult> { throw new CapabilityNotConfiguredError(this.providerId, 'MATCH_HISTORY', REASON); }
  async getMatch(): Promise<CanonicalMatch> { throw new CapabilityNotConfiguredError(this.providerId, 'MATCH_DETAIL', REASON); }
  async getRankContext(): Promise<RankContext[]> { throw new CapabilityNotConfiguredError(this.providerId, 'RANK', 'riot documents no per-player rank endpoint'); }
}
