// Ported from legacy `src/scoring/versions.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged.

export const SCORING_RULE_VERSION = 'community-score-v2';
export const BENCHMARK_VERSION = 'community-benchmarks-v1';
export const OVERALL_PROFILE_VERSION = 'overall-profile-v1';
export const dimensions = ['firepower', 'roundImpact', 'entry', 'teamplay', 'clutch', 'economy', 'consistency', 'roleValue'] as const;
export type Dimension = typeof dimensions[number];
