// Ported from legacy `src/analytics/modeEligibility.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged.

/**
 * TASK-DATA-MODE-POLICY-01 — `mode-eligibility-policy-v1`. The ONE place that decides which normalized
 * game modes may contribute evidence to which kind of analysis. Pure data + functions; shared by the
 * server (REAL) and the browser (Demo), so there is no semantic divergence.
 *
 *  ABSOLUTE_STRENGTH   "how good is this person?" (every score, stat, ranking, map/agent/weapon/Act,
 *                      current strength, recent form, progress, current duo-synergy-v1) → Competitive ONLY.
 *  SAME_MATCH_RELATIVE within-match A-vs-B comparison (future TASK-SCORING-SHARED-MATCH-01)
 *                      → Competitive + Unrated. Never aggregated into absolute per-player numbers.
 *  BROWSE_HISTORY      match history browsing → every tracked mode (storage is never filtered).
 *
 * Fail closed: Premier, Custom, Swiftplay, Deathmatch, Team Deathmatch, Spike Rush, Escalation, event
 * queues and ANY unknown/future mode are browse-only. New eligible modes need explicit product authorization.
 */
export const MODE_ELIGIBILITY_POLICY_VERSION = 'mode-eligibility-policy-v1' as const;

export type EligibilityKind = 'ABSOLUTE_STRENGTH' | 'SAME_MATCH_RELATIVE' | 'BROWSE_HISTORY';

const absoluteStrengthModes = ['Competitive'] as const;
const sameMatchRelativeModes = ['Competitive', 'Unrated'] as const;

/** Exact match on the normalized game mode (src/utils/gameMode.ts); no fuzzy "competitive-like" fallback. */
export function isAbsoluteStrengthMode(mode: string): boolean {
  return (absoluteStrengthModes as readonly string[]).includes(mode);
}

export function isSameMatchRelativeMode(mode: string): boolean {
  return (sameMatchRelativeModes as readonly string[]).includes(mode);
}

/** Every tracked match stays browsable, whatever its mode. */
export function isBrowseMode(mode: string): boolean {
  void mode;
  return true;
}

/** 'all' only for browsing; otherwise the explicit allow-list for that kind. */
export function eligibleModesFor(kind: EligibilityKind): 'all' | string[] {
  if (kind === 'BROWSE_HISTORY') return 'all';
  return [...(kind === 'ABSOLUTE_STRENGTH' ? absoluteStrengthModes : sameMatchRelativeModes)];
}

export function isEligibleMode(kind: EligibilityKind, mode: string): boolean {
  return kind === 'ABSOLUTE_STRENGTH' ? isAbsoluteStrengthMode(mode) : kind === 'SAME_MATCH_RELATIVE' ? isSameMatchRelativeMode(mode) : isBrowseMode(mode);
}

/**
 * A user/URL mode request against a kind: 'all' means "every ELIGIBLE mode"; an explicit ineligible
 * mode (e.g. ?mode=Unrated on an absolute page) is excluded — it never silently computes.
 */
export function requestedModeAllowed(kind: EligibilityKind, requested: string): boolean {
  return requested === 'all' || isEligibleMode(kind, requested);
}
