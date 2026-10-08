/**
 * PRODUCT read-model contract (`product-contract-v1`): UI-oriented, provider-neutral outputs DERIVED from the accepted
 * algorithms (never new formulas). Keyed by INTERNAL member ids; the exporter maps them to public ids, applies consent
 * and the strict public allowlist (public.ts). Every product-visible analytic carries, where it applies:
 *   version · status · value · confidence (+ its model, or 'none') · sampleSize · eligibility · evidenceSummary · explanationKey.
 * Reason / evidence entries are stable CODES (the UI translates them); never free text from an algorithm.
 */
export const PRODUCT_CONTRACT_VERSION = 'product-contract-v1' as const;

export const PRODUCT_STATUSES = ['available', 'partial', 'unavailable', 'insufficient'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** How a confidence number was produced. 'none' = the metric has no confidence model (show sample size instead). */
export const CONFIDENCE_MODELS = ['sample-coverage', 'adaptive-window', 'shared-match', 'team-fit', 'side-evidence', 'none'] as const;
export type ConfidenceModel = (typeof CONFIDENCE_MODELS)[number];

export const EXPLANATION_KEYS = [
  'community-score', 'current-strength', 'recent-form', 'shared-match', 'team-fit', 'kast', 'opening', 'trade', 'clutch', 'round-impact',
  'sample-confidence', 'basic-stats', 'rank-context', 'responsibility',
] as const;
export type ExplanationKey = (typeof EXPLANATION_KEYS)[number];

export const REASON_CODES = [
  'no_competitive_matches', 'insufficient_sample', 'evidence_below_threshold', 'needs_six_dimensions', 'unknown_role', 'window_unavailable',
  'window_partial', 'baseline_unavailable', 'event_evidence_partial', 'no_shared_matches', 'below_min_shared_matches', 'no_rank_evidence',
  'insufficient_role_evidence', 'insufficient_side_evidence', 'responsibility_not_validated', 'no_agent_evidence', 'experimental_agent',
  'stale_recent_evidence', 'provider_visible_history', 'no_distinct_responsibility',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export interface ProductSample { matches: number; rounds: number }
export interface ProductEligibility { eligible: boolean; reasons: ReasonCode[] }

export interface ProductMetric {
  version: string;
  status: ProductStatus;
  value: number | null;
  confidence: number | null;
  confidenceModel: ConfidenceModel;
  sampleSize: ProductSample | null;
  eligibility: ProductEligibility;
  evidenceSummary: ReasonCode[];
  explanationKey: ExplanationKey;
}

export const DIMENSION_KEYS = ['firepower', 'roundImpact', 'entry', 'teamplay', 'clutch', 'economy', 'consistency', 'roleValue'] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];
export const ROLE_KEYS = ['Duelist', 'Initiator', 'Controller', 'Sentinel'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export interface ProductDimension { dimension: DimensionKey; status: ProductStatus; value: number | null; confidence: number }
export interface ProductWindow { status: ProductStatus; matches: number; rounds: number; activeDays: number; from: string | null; to: string | null; confidence: number | null }
export interface ProductRecentForm { status: 'up' | 'flat' | 'down' | 'insufficient'; delta: number | null; recentMatches: number; baselineMatches: number }
export interface ProductAdvanced {
  kast: { status: ProductStatus; rate: number | null; rounds: number };
  opening: { status: ProductStatus; firstKills: number | null; firstDeaths: number | null; rounds: number };
  trade: { status: ProductStatus; tradeKills: number | null; tradedDeaths: number | null; tradeAssists: number | null; rounds: number };
  clutch: { status: ProductStatus; attempts: number | null; wins: number | null };
  roundImpact: ProductMetric;
}
export interface ProductRank { status: 'known' | 'unknown'; tierLabel: string | null; tierOrdinal: number | null; asOf: string | null; source: 'match-snapshot' | 'history' | 'none' }
export interface ProductAgentRow { agentName: string; role: RoleKey | null; matches: number; wins: number }
export interface ProductRoleRow { role: RoleKey; matches: number }
export interface ProductMapRow { mapName: string; matches: number; wins: number }

export interface ProductProfile {
  memberId: string;
  primaryRole: RoleKey | null;
  competitiveMatches: number;
  competitiveRounds: number;
  communityScore: ProductMetric;
  dimensions: ProductDimension[];
  currentStrength: ProductMetric;
  currentWindow: ProductWindow;
  recentForm: ProductRecentForm;
  basic: { acs: number | null; headshotPercentage: number | null; kpr: number | null; apr: number | null };
  advanced: ProductAdvanced;
  rank: ProductRank;
  agents: ProductAgentRow[];
  roles: ProductRoleRow[];
  maps: ProductMapRow[];
}

export interface ProductSharedRating { status: ProductStatus; rating: number | null; outperformShare: number | null; sharedMatches: number; partners: number; evidencedPartners: number; confidence: number }
export interface ProductSharedMember { memberId: string; combined: ProductSharedRating; competitive: ProductSharedRating; unrated: ProductSharedRating; recent: ProductSharedRating }
export interface ProductSharedPair {
  memberA: string; memberB: string;
  sharedMatches: number; competitiveMatches: number; unratedMatches: number; sameTeamMatches: number; scoredMatches: number;
  ratingA: number | null; ratingB: number | null;
  /** Mean winsorized one-match Firepower margin A − B (points), over scored shared matches. */
  relativeDifference: number | null;
  medianDifference: number | null;
  aOutperformed: number; bOutperformed: number; neutral: number;
  recent: { matches: number; aOutperformed: number; bOutperformed: number; neutral: number };
  confidence: number;
  eligibility: ProductEligibility;
}
export interface ProductSharedMatch {
  version: string; evidenceVersion: string; neutralSigma: number; shrinkK: number; minMatches: number;
  members: ProductSharedMember[];
  pairs: ProductSharedPair[];
  coverage: { possiblePairs: number; pairsWithShared: number; pairUnits: number; scoredUnits: number; minShared: number | null; medianShared: number | null; maxShared: number | null };
}

export interface ProductTeamMember {
  memberId: string; agentName: string; role: RoleKey;
  /** team-responsibility-v1 label, shown only when its deciding rate is holdout-validated; else null. */
  generalResponsibility: string | null;
  /** A V1 label that exists but is withheld from display (not validated), or null. */
  withheldResponsibility: string | null;
  attackResponsibility: string | null; defenseResponsibility: string | null;
  attackConfidence: number | null; defenseConfidence: number | null;
  attackReasons: ReasonCode[]; defenseReasons: ReasonCode[];
  fit: number; confidence: number; experimental: boolean; evidenceLevel: string;
  samples: { member: number; role: number; agent: number; agentMap: number; map: number };
}
export interface ProductLineup {
  label: 'RECOMMENDED_HISTORICAL_FIT' | 'ALTERNATIVE';
  teamFit: number; fitScore: number; confidence: number; comparableToBest: boolean; v2Applied: boolean;
  roleDistribution: Record<RoleKey, number>;
  members: ProductTeamMember[];
}
export interface ProductTeamResult { memberIds: string[]; map: string; status: 'ok' | 'insufficient_evidence'; reason: ReasonCode | null; comparableBand: number | null; lineups: ProductLineup[] }
export interface ProductTeamBuilder {
  v1Version: string; v2Version: string; fitVersion: string;
  maps: string[];
  emittableAttack: string[]; emittableDefense: string[]; withheldLabels: string[];
  results: ProductTeamResult[];
}

/** The complete internal product read model (one group, one evidence population). */
export interface ProductAnalytics {
  productContractVersion: typeof PRODUCT_CONTRACT_VERSION;
  coverage: { firstMatchAt: string | null; lastMatchAt: string | null; matchesObserved: number; competitiveMatches: number };
  profiles: ProductProfile[];
  sharedMatch: ProductSharedMatch;
  teamBuilder: ProductTeamBuilder;
}
