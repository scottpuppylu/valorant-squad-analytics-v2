import type { RankContext } from '@vsa/contracts/canonical';
import { resolveRankContextAt, type RankContext as ResolvedRankContext, type RankEvidence, type RankEvidenceKind } from './rankContext.ts';
import { UNRANKED_TIER, VALORANT_TIERS, type NormalizedTier } from './tiers.ts';

const KIND: Record<RankContext['kind'], RankEvidenceKind> = {
  'match-snapshot': 'match_snapshot', history: 'history', current: 'current', peak: 'peak', seasonal: 'seasonal',
};
const BY_KEY = new Map<string, NormalizedTier>([...VALORANT_TIERS.map((t): [string, NormalizedTier] => [t.key, t]), [UNRANKED_TIER.key, UNRANKED_TIER]]);

/**
 * Canonical rank rows → the accepted provider-independent `RankEvidence` (rank-context-v1). Evidence is keyed by the
 * MEMBER (V2 analytics are member-level; a member's accounts are already merged). `providerElo` keeps the provider's
 * meaning and is never read by any algorithm. Normalization comes from the stored tier key (valorant-tier-order-v1).
 */
export function rankEvidenceFromCanonical(rows: readonly RankContext[]): RankEvidence[] {
  return rows.map((row) => ({
    accountId: row.memberId, kind: KIND[row.kind], source: row.sourceEndpoint, effectiveAt: row.effectiveAt, ingestedAt: row.effectiveAt,
    seasonId: null, seasonShort: row.seasonKey, providerTierId: row.providerTierId, providerTierName: row.providerTierName, rr: row.rr,
    providerElo: row.providerElo, rrChange: row.rrChange, matchRef: row.matchKey, queue: row.queue,
    normalized: row.normalizedTierKey ? BY_KEY.get(row.normalizedTierKey) ?? null : null,
  }));
}

/** Point-in-time rank context of a member at a match (exact in-match snapshot, else strictly prior evidence; never later). */
export function rankLookup(evidence: readonly RankEvidence[]) {
  const byMember = new Map<string, RankEvidence[]>();
  for (const row of evidence) byMember.set(row.accountId, [...(byMember.get(row.accountId) ?? []), row]);
  return (memberId: string, playedAt: string, matchKey: string): ResolvedRankContext => resolveRankContextAt(byMember.get(memberId) ?? [], memberId, playedAt, matchKey);
}
