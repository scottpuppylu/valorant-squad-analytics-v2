// Ported from legacy `src/analytics/scope/versions.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged.

/** TASK-DATA-03B.2A versions. Independent of community-score-v2 / duo-synergy-v1 formulas. */
export const ANALYSIS_SCOPE_VERSION = 'analysis-scope-v1' as const;
/**
 * v3 (TASK-DATA-MODE-POLICY-01): queue eligibility only — every strength feature is Competitive-only via
 * mode-eligibility-policy-v1 (matchHistory stays browse-all). All v2 window/baseline bounds unchanged.
 */
export const FEATURE_SCOPE_POLICY_VERSION = 'feature-scope-policy-v3' as const;
export const ADAPTIVE_WINDOW_VERSION = 'adaptive-window-v1' as const;
export const ANALYTICS_CONTEXT_VERSION = 'analytics-context-v1' as const;
