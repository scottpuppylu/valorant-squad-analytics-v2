import type { CanonicalRepository } from '@vsa/canonical-data';
import { MAX_MATCH_PAGE_SIZE, requireCapability, supports, type DataProviderAdapter, type IdentityResolver } from '@vsa/source-adapters';

export interface IngestSummary {
  providerId: string;
  accountsConsidered: number;
  accountsSkippedNoConsent: number;
  matchesListed: number;
  matchesStored: number;
  matchesAlreadyStored: number;
  rankContexts: number;
}

/**
 * adapter → canonical repository. Bounded (pages × page size per account) and consent-gated: an account is fetched
 * only with data-collection consent, and only consenting members are linked inside a match (everyone else is an
 * untracked participant).
 */
export class IngestService {
  private readonly repository: CanonicalRepository;
  private readonly adapter: DataProviderAdapter;
  private readonly now: () => string;
  constructor(repository: CanonicalRepository, adapter: DataProviderAdapter, now: () => string = () => new Date().toISOString()) {
    this.repository = repository;
    this.adapter = adapter;
    this.now = now;
  }

  async ingestGroup(groupId: string, options: { maxMatchesPerAccount?: number } = {}): Promise<IngestSummary> {
    const maxMatches = options.maxMatchesPerAccount ?? 50;
    const listMatches = requireCapability(this.adapter, 'MATCH_HISTORY', 'listMatches');
    const getMatch = requireCapability(this.adapter, 'MATCH_DETAIL', 'getMatch');
    const consent = new Map((await this.repository.listConsents(groupId)).map((c) => [c.memberId, c]));
    const accounts = (await this.repository.listSourceAccounts(groupId)).filter((a) => a.providerId === this.adapter.providerId);
    const collecting = accounts.filter((a) => consent.get(a.memberId)?.dataCollectionAllowed === true);
    const identity = new Map(collecting.map((a) => [a.providerAccountRef, { memberId: a.memberId, accountId: a.accountId }]));
    const resolveIdentity: IdentityResolver = (ref) => identity.get(ref) ?? null;
    const summary: IngestSummary = { providerId: this.adapter.providerId, accountsConsidered: accounts.length, accountsSkippedNoConsent: accounts.length - collecting.length,
      matchesListed: 0, matchesStored: 0, matchesAlreadyStored: 0, rankContexts: 0 };

    for (const account of collecting) {
      let cursor: string | null = null;
      let seen = 0;
      const maxPages = Math.ceil(maxMatches / MAX_MATCH_PAGE_SIZE);
      for (let page = 0; page < maxPages; page += 1) {
        const result = await listMatches({ providerAccountRef: account.providerAccountRef, cursor, limit: Math.min(MAX_MATCH_PAGE_SIZE, maxMatches - seen) });
        for (const matchRef of result.matchRefs) {
          seen += 1;
          summary.matchesListed += 1;
          if (await this.repository.hasMatch(this.adapter.providerId, matchRef)) { summary.matchesAlreadyStored += 1; continue; }
          await this.repository.saveMatch(await getMatch({ matchRef, resolveIdentity, observedAt: this.now() }));
          summary.matchesStored += 1;
        }
        cursor = result.nextCursor;
        if (cursor === null || seen >= maxMatches) break;
      }
      if (supports(this.adapter, 'RANK')) {
        const contexts = await requireCapability(this.adapter, 'RANK', 'getRankContext')({ providerAccountRef: account.providerAccountRef, memberId: account.memberId, accountId: account.accountId, observedAt: this.now() });
        await this.repository.saveRankContext(contexts);
        summary.rankContexts += contexts.length;
      }
      await this.repository.recordIngestState({ providerId: this.adapter.providerId, accountId: account.accountId, nextCursor: cursor, matchesSeen: seen, at: this.now(), error: null });
    }
    return summary;
  }
}
