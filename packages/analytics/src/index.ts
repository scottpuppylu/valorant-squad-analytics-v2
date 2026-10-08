/**
 * Accepted analytics over CANONICAL contracts only (no SQL, no provider payload types, no I/O). Layout:
 *   basic/            basic-player-stats-v1 (bootstrap)
 *   agents/           agent-catalog-v1 (+ frozen catalog v0 for shared-match-evidence-v1)
 *   event/            match-view-v1 projection, event-metrics-v1 / -v2, round-topology-v1
 *   rank/             valorant-tier-order-v1, rank-context-v1
 *   strength/         community-score-v2 (+ benchmarks / overall profile), adaptive-window-v1, Current Strength, Recent Form
 *   shared-match/     shared-match-evidence-v1, shared-match-rating-v1
 *   team-composition/ team-composition-v1 (team-fit-hierarchy-v1, team-responsibility-v1), team-composition-v2
 *   (weapons/         weapon-analytics-v2 is not ported in this wave)
 * Every algorithm keeps its accepted identifier; the bodies are ported unchanged (see docs/V2_PRODUCT_UI.md).
 */
export {
  BASIC_PLAYER_STATS_ALGORITHM, BASIC_PLAYER_STATS_DESCRIPTION, computeBasicPlayerStats, roundsPlayed, summarizeObservations, type ObservationSummary,
} from './basic/basicPlayerStats.ts';
export { clamp, round, safeDivide, standardDeviation } from './basic/number.ts';
export {
  AGENT_CATALOG_VERSION, AGENT_DEFINITIONS, AGENT_ROLES_CATALOG_V0, agentRoles, primaryRoleForAgents, resolveAgent, validateAgentCatalog,
  type AgentCatalogValidation, type AgentDefinition, type AgentResolution, type AgentRole,
} from './agents/agentCatalog.ts';

export * from './event/advancedMetricTypes.ts';
export type * from './event/types.ts';
export type * from './event/matchViewTypes.ts';
export { analyzeRoundTopology, aliveBounds, ROUND_TOPOLOGY_VERSION, type RoundTopology, type TopologyIssue } from './event/roundTopology.ts';
export { CANONICAL_EVENT_METRIC_RULE_VERSION, EVENT_INPUT_NORMALIZATION_VERSION, EVENT_METRIC_RULE_VERSION_V1, EventMetricEngine, TRADE_WINDOW_MS, type EventMetricRuleVersion } from './event/eventMetricEngine.ts';
export { EVENT_METRIC_RULE_VERSION_V2 } from './event/eventMetricsV2.ts';
export { aggregateAdvancedMetrics, type AggregatedAdvancedMetrics } from './event/aggregateAdvancedMetrics.ts';
export { agentKey, eventInput, gameModeLabel, MATCH_VIEW_VERSION, projectMatchView, projectMatchViews, publicAdvancedMetrics, type MatchViewResult, type ParticipantFact } from './event/matchView.ts';

export { compareTiers, normalizeTier, RANK_TIER_MODEL_VERSION, UNRANKED_TIER, VALORANT_TIERS, type NormalizedTier } from './rank/tiers.ts';
export { RANK_CONTEXT_VERSION, rankCoverage, resolveRankContextAt, type RankContext, type RankEvidence, type RankEvidenceKind } from './rank/rankContext.ts';
export { rankEvidenceFromCanonical, rankLookup } from './rank/canonicalRank.ts';

export { isAbsoluteStrengthMode, isSameMatchRelativeMode, MODE_ELIGIBILITY_POLICY_VERSION } from './strength/modeEligibility.ts';
export { BENCHMARK_VERSION, dimensions, OVERALL_PROFILE_VERSION, SCORING_RULE_VERSION, type Dimension } from './strength/scoring/versions.ts';
export type { ScoreResult } from './strength/scoring/types.ts';
export { calculatePlayerScores, compareScoreResults } from './strength/scoring/calculateScores.ts';
export { defaultProfile } from './strength/scoring/profiles.ts';
export { ADAPTIVE_WINDOW_VERSION, FEATURE_SCOPE_POLICY_VERSION } from './strength/scope/versions.ts';
export { policyFor } from './strength/scope/policies.ts';
export type { AdaptiveWindowResult, ScopeReason, ScopeStatus, WindowConfidence, WindowSample } from './strength/scope/types.ts';
export {
  competitiveMatches, computeStrength, memberEntries, recentFormFromWindow, scoresFromEntries, STRENGTH_PIPELINE_VERSION, strengthPopulation,
  type RecentFormResult, type StrengthResult,
} from './strength/strength.ts';
export type { PerformanceEntry } from './strength/types.ts';

export { MIN_COMPARABLE_ROUNDS, pairMatchesFor, SHARED_MATCH_EVIDENCE_VERSION, sharedMode, type PairMatchEvidence } from './shared-match/pairEvidence.ts';
export {
  aggregatePair, computeSharedMatchRatings, MIN_MATCHES as SHARED_MATCH_MIN_MATCHES, NEUTRAL_SIGMA, SHARED_MATCH_RATING_VERSION, SHRINK_K,
  type MemberRating, type PairAggregate, type ScoredUnit, type SharedMatchMemberResult,
} from './shared-match/rating.ts';
export { coverageSummary, pairCoverage, type PairCoverage } from './shared-match/coverage.ts';
export { computeSharedMatch, SHARED_MATCH_EVIDENCE_EVENT_ENGINE, type SharedMatchComputation } from './shared-match/sharedMatch.ts';

export { buildObservations, TEAM_OBSERVATION_VERSION, type MemberObservation } from './team-composition/observations.ts';
export { FIT_SHRINK_K, TEAM_FIT_VERSION } from './team-composition/fit.ts';
export { MIN_RESPONSIBILITY_MATCHES, RESPONSIBILITY_VERSION, type Responsibility } from './team-composition/responsibility.ts';
export {
  recommendTeamComposition, TEAM_COMPOSITION_VERSION, TEAM_FIT_MEANING, TeamCompositionInputError, TeamCompositionModel,
  type Lineup, type MemberAssignment, type TeamCompositionResult,
} from './team-composition/recommend.ts';
export { SITE_REFERENCE_VERSION, SiteReference } from './team-composition/siteReference.ts';
export { memberRounds, SIDE_EVIDENCE_VERSION, type MemberRound } from './team-composition/sideEvidence.ts';
export {
  refineTeamComposition, SideModel, TEAM_COMPOSITION_V2_VERSION, V2_VALIDATION,
  type AttackResponsibility, type DefenseResponsibility, type TeamCompositionV2Result,
} from './team-composition/v2.ts';
export { buildTeamCompositionEngine, sideMatchInput, type TeamCompositionEngine } from './team-composition/teamComposition.ts';

export { buildProductAnalytics, fiveMemberSets, PRODUCT_BUILDER_VERSION, VALIDATED_GENERAL_RESPONSIBILITIES, WITHHELD_RESPONSIBILITY_LABELS, type ProductBuildOptions } from './product/buildProduct.ts';
export { TEAM_COMPOSITION_LEGACY_VERSION } from './team-composition/recommend.ts';
export {
  agentSignatureId, assignmentSignature, compareCodePoints, compareDescWithTies, compareEnumeration, compareRecommendation, rankAssignments,
  TEAM_COMPOSITION_TIE_EPSILON, TEAM_COMPOSITION_TIE_SEMANTICS_VERSION, tieEqual, withinComparableBand, type RankableAssignment,
} from './team-composition/tieSemantics.ts';
