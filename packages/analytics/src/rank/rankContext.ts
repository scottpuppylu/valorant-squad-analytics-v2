// Ported from legacy `src/analytics/rank/rankContext.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged.
import type { NormalizedTier } from './tiers.ts';

/**
 * TASK-DATA-RANK-01 — provider-independent rank EVIDENCE interface and point-in-time resolver
 * (`rank-context-v1`). Shared-Match / Internal-Strength tasks consume only this; provider response shapes stay in
 * server/rankEvidence. Every record separates OBSERVED provider facts from DERIVED normalization (`normalized`).
 *
 * Rank is context / prior / calibration — never a final score, weight or multiplier.
 */
export const RANK_CONTEXT_VERSION = 'rank-context-v1' as const;

export type RankEvidenceKind =
  /** The account's tier recorded inside a specific match document (match-time evidence). */
  | 'match_snapshot'
  /** One provider rank/RR history entry (typically one per Competitive match). */
  | 'history'
  /** "Current" snapshot as of the observation time. */
  | 'current'
  /** Highest tier ever per provider; NOT a point-in-time rank. */
  | 'peak'
  /** Per-season summary (final tier, games, wins) as of the observation time. */
  | 'seasonal';

export interface RankEvidence {
  accountId: string;
  kind: RankEvidenceKind;
  source: string;
  /** When the value was TRUE: the match start for match_snapshot/history, the fetch time for current/peak/seasonal. */
  effectiveAt: string;
  /** When this project observed / ingested it. */
  ingestedAt: string;
  seasonId: string | null;
  seasonShort: string | null;
  /** Observed provider facts (never rewritten). */
  providerTierId: number | null;
  providerTierName: string | null;
  rr: number | null;
  /** Provider's undocumented numeric `elo` field: NOT Riot MMR, never presented as such. */
  providerElo: number | null;
  rrChange: number | null;
  /** Private match reference (staging HMAC), when the evidence belongs to one match. */
  matchRef: string | null;
  queue: string | null;
  /** Derived deterministic normalization (ordering metadata only). */
  normalized: NormalizedTier | null;
}

export type RankContextStatus =
  /** Evidence recorded for this exact match (match_snapshot or history at the match start). */
  | 'exact_match'
  /** The most recent evidence strictly BEFORE the timestamp. */
  | 'prior_observation'
  /** Nothing known at or before the timestamp (later evidence is never projected backward). */
  | 'unknown';

export interface RankContext {
  version: typeof RANK_CONTEXT_VERSION;
  status: RankContextStatus;
  evidence: RankEvidence | null;
  /** at − evidence.effectiveAt in ms (0 for exact). */
  ageMs: number | null;
  /** True when evidence exists only AFTER `at`: informational, deliberately not used. */
  laterEvidenceExists: boolean;
}

const POINT_IN_TIME: ReadonlySet<RankEvidenceKind> = new Set(['match_snapshot', 'history', 'current']);

/**
 * "What rank evidence was known around this point in time?" — strict no-future-leakage contract:
 *  1. the account's tier recorded INSIDE this match (`match_snapshot`, same matchRef or same start time) →
 *     exact_match. A `history` entry of the same match is POST-match state (its RR/tier already include this
 *     match's result), so it is never used for that match;
 *  2. else the latest point-in-time evidence strictly before `at` (excluding post-match rows of this match) →
 *     prior_observation;
 *  3. else unknown. `peak` and `seasonal` (season-final values include results after the match) are never used,
 *     and a later observation is never backfilled into the past.
 */
export function resolveRankContextAt(evidence: readonly RankEvidence[], accountId: string, at: string, matchRef?: string | null): RankContext {
  const atMs = Date.parse(at);
  if (!Number.isFinite(atMs)) throw new Error('resolveRankContextAt requires a valid ISO timestamp.');
  const own = evidence.filter((row) => row.accountId === accountId && POINT_IN_TIME.has(row.kind) && Number.isFinite(Date.parse(row.effectiveAt)));
  const sameMatch = (row: RankEvidence) => Boolean(matchRef) && row.matchRef === matchRef;
  const exact = own.find((row) => row.kind === 'match_snapshot' && (sameMatch(row) || Date.parse(row.effectiveAt) === atMs));
  const laterEvidenceExists = own.some((row) => Date.parse(row.effectiveAt) > atMs);
  if (exact) return { version: RANK_CONTEXT_VERSION, status: 'exact_match', evidence: exact, ageMs: 0, laterEvidenceExists };
  let prior: RankEvidence | null = null;
  for (const row of own) {
    const time = Date.parse(row.effectiveAt);
    if (time < atMs && !sameMatch(row) && (!prior || time > Date.parse(prior.effectiveAt))) prior = row;
  }
  if (prior) return { version: RANK_CONTEXT_VERSION, status: 'prior_observation', evidence: prior, ageMs: atMs - Date.parse(prior.effectiveAt), laterEvidenceExists };
  return { version: RANK_CONTEXT_VERSION, status: 'unknown', evidence: null, ageMs: null, laterEvidenceExists };
}

export type RankHistoryCompleteness = 'complete' | 'partial' | 'unknown';

export interface RankCoverage {
  accountId: string;
  rankCoverageStart: string | null;
  rankCoverageEnd: string | null;
  rankObservationCount: number;
  /** Always 'unknown' unless a documented provider contract proves more (none does today). */
  rankHistoryCompleteness: RankHistoryCompleteness;
}

export function rankCoverage(evidence: readonly RankEvidence[], accountId: string): RankCoverage {
  const times = evidence.filter((row) => row.accountId === accountId && (row.kind === 'match_snapshot' || row.kind === 'history'))
    .map((row) => Date.parse(row.effectiveAt)).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    accountId,
    rankCoverageStart: times.length ? new Date(times[0]!).toISOString() : null,
    rankCoverageEnd: times.length ? new Date(times.at(-1)!).toISOString() : null,
    rankObservationCount: times.length,
    rankHistoryCompleteness: 'unknown',
  };
}
