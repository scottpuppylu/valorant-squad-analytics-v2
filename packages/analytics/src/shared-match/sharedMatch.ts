import type { CanonicalMatch } from '@vsa/contracts/canonical';
import { EventMetricEngine } from '../event/eventMetricEngine.ts';
import { projectMatchViews } from '../event/matchView.ts';
import type { RankEvidence } from '../rank/rankContext.ts';
import { rankLookup } from '../rank/canonicalRank.ts';
import { coverageSummary, pairCoverage, type PairCoverage } from './coverage.ts';
import { pairMatchesFor, type PairMatchEvidence } from './pairEvidence.ts';
import { aggregatePair, computeSharedMatchRatings, type PairAggregate } from './rating.ts';

/**
 * shared-match-evidence-v1 + shared-match-rating-v1 over canonical matches. FROZEN inputs exactly as accepted:
 * the per-match projection uses event-metrics-v1 (SHARED_MATCH_EVIDENCE_EVENT_ENGINE) and the signal uses the frozen
 * agent catalog v0 (inside pairEvidence.ts). Rank is attached as context only. NOT MMR, NOT a skill rating, NOT a win
 * probability: a group-relative "who out-performed whom in the SAME match" summary.
 */
export const SHARED_MATCH_EVIDENCE_EVENT_ENGINE = 'event-metrics-v1' as const;

export interface SharedMatchComputation {
  pairs: PairMatchEvidence[];
  ratings: ReturnType<typeof computeSharedMatchRatings>;
  coverage: PairCoverage[];
  coverageSummary: ReturnType<typeof coverageSummary>;
  pairAggregates: PairAggregate[];
}

export function computeSharedMatch(memberIds: readonly string[], matches: readonly CanonicalMatch[], rank: readonly RankEvidence[] = []): SharedMatchComputation {
  const views = projectMatchViews(matches, new EventMetricEngine({ ruleVersion: SHARED_MATCH_EVIDENCE_EVENT_ENGINE }));
  const lookup = rankLookup(rank);
  const pairs = views.flatMap((match) => pairMatchesFor(match.id, match, (memberId, playedAt, matchRef) => lookup(memberId, playedAt, matchRef)));
  const ratings = computeSharedMatchRatings(memberIds, pairs);
  const coverage = pairCoverage(memberIds, pairs);
  const byPair = new Map<string, typeof ratings.units>();
  for (const unit of ratings.units) byPair.set(`${unit.a}|${unit.b}`, [...(byPair.get(`${unit.a}|${unit.b}`) ?? []), unit]);
  const pairAggregates = [...byPair.keys()].sort().map((key) => aggregatePair(byPair.get(key)!));
  return { pairs, ratings, coverage, coverageSummary: coverageSummary(coverage), pairAggregates };
}
