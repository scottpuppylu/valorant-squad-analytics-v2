import type { CanonicalMatch, RankContext } from '@vsa/contracts/canonical';
import {
  MAX_MATCH_PAGE_SIZE, type DataProviderAdapter, type GetMatchInput, type ListMatchesInput, type ListMatchesResult,
  type ProviderCapability, type RankContextInput, type ResolveAccountInput, type ResolvedAccount,
} from '../adapter.ts';
import { FAKE_ACCOUNTS, FAKE_MATCHES } from './fixtures.ts';
import { canonicalMatchKey, FAKE_PROVIDER_ID, FAKE_PROVIDER_VERSION, normalizeFakeMatch } from './normalize.ts';
import type { FakeAccount, FakeMatchPayload } from './payload.ts';

export interface FakeProviderOptions {
  matches?: readonly FakeMatchPayload[];
  accounts?: readonly FakeAccount[];
  /** Emulates a provider credential living inside an adapter. It must never reach any public output. */
  providerSecret?: string;
}

/** Fully deterministic offline provider over synthetic fixtures. No network. */
export class FakeProviderAdapter implements DataProviderAdapter {
  readonly providerId = FAKE_PROVIDER_ID;
  readonly providerVersion = FAKE_PROVIDER_VERSION;
  private readonly matches: readonly FakeMatchPayload[];
  private readonly accounts: readonly FakeAccount[];
  readonly providerSecret: string;

  constructor(options: FakeProviderOptions = {}) {
    this.matches = options.matches ?? FAKE_MATCHES;
    this.accounts = options.accounts ?? FAKE_ACCOUNTS;
    this.providerSecret = options.providerSecret ?? 'FAKE-PROVIDER-SECRET-DO-NOT-PUBLISH';
  }

  capabilities(): ReadonlySet<ProviderCapability> {
    return new Set<ProviderCapability>(['IDENTITY', 'MATCH_HISTORY', 'MATCH_DETAIL', 'RANK']);
  }

  async resolveAccount(input: ResolveAccountInput): Promise<ResolvedAccount> {
    const account = this.accounts.find((a) => a.handle === input.handle);
    if (!account) throw new Error('unknown fake account');
    return { providerAccountRef: account.fakePuuid, handle: account.handle };
  }

  /** Newest first; cursor = offset; page size bounded. */
  async listMatches(input: ListMatchesInput): Promise<ListMatchesResult> {
    const limit = Math.min(Math.max(1, input.limit), MAX_MATCH_PAGE_SIZE);
    const offset = input.cursor === null ? 0 : Number.parseInt(input.cursor, 10);
    if (!Number.isInteger(offset) || offset < 0) throw new Error('invalid cursor');
    const refs = [...this.matches]
      .filter((m) => m.players.some((p) => p.fakePuuid === input.providerAccountRef))
      .sort((a, b) => b.startedAtEpochMs - a.startedAtEpochMs || a.fakeMatchId.localeCompare(b.fakeMatchId))
      .map((m) => m.fakeMatchId);
    const page = refs.slice(offset, offset + limit);
    return { matchRefs: page, nextCursor: offset + limit < refs.length ? String(offset + limit) : null };
  }

  async getMatch(input: GetMatchInput): Promise<CanonicalMatch> {
    const payload = this.matches.find((m) => m.fakeMatchId === input.matchRef);
    if (!payload) throw new Error('unknown fake match');
    return normalizeFakeMatch(payload, input.resolveIdentity, input.observedAt);
  }

  /**
   * Rank evidence as the fake provider "observed" it: one match-time snapshot per Competitive match (tier at that match,
   * with a deterministic one-division climb in the second act) plus one CURRENT row at observation time. Accounts without
   * a tier have no rank evidence at all (the product must show "unknown", never a guess).
   */
  async getRankContext(input: RankContextInput): Promise<RankContext[]> {
    const account = this.accounts.find((a) => a.fakePuuid === input.providerAccountRef);
    if (!account || !account.tierName) return [];
    const families = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant', 'Immortal'];
    const [family, division] = account.tierName.split(' ') as [string, string];
    const base = families.indexOf(family) * 3 + Number(division);
    const tier = (ordinal: number) => {
      const f = families[Math.floor((ordinal - 1) / 3)]!; const d = ((ordinal - 1) % 3) + 1;
      return { providerTierId: ordinal + 2, providerTierName: `${f} ${d}`, normalizedTierKey: `${f.toLowerCase()}_${d}`, tierOrdinal: ordinal };
    };
    const common = { memberId: input.memberId, accountId: input.accountId, providerId: this.providerId, rr: null, rrChange: null, providerElo: null, queue: 'competitive',
      tierModelVersion: 'valorant-tier-order-v1' };
    const played = [...this.matches].filter((m) => m.queue === 'competitive' && m.players.some((p) => p.fakePuuid === account.fakePuuid))
      .sort((a, b) => a.startedAtEpochMs - b.startedAtEpochMs);
    const snapshots: RankContext[] = played.map((m) => ({ ...common, ...tier(m.act === 'v26a5' ? base + 1 : base), rankContextId: `rank-${input.accountId}-${m.fakeMatchId.slice(-4)}`,
      kind: 'match-snapshot', effectiveAt: new Date(m.startedAtEpochMs).toISOString(), matchKey: canonicalMatchKey(this.providerId, m.fakeMatchId),
      sourceEndpoint: 'fake:match', seasonKey: m.act }));
    return [...snapshots, { ...common, ...tier(base + 1), rankContextId: `rank-${input.accountId}-current`, kind: 'current', effectiveAt: input.observedAt, matchKey: null,
      sourceEndpoint: 'fake:current', seasonKey: null }];
  }
}
