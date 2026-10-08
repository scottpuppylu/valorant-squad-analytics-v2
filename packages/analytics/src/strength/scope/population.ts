// Ported excerpt of legacy `src/analytics/scope/resolveScope.ts` (populationFromMatches; body unchanged).
import type { MatchRecord } from '../../event/matchViewTypes.ts';
import type { ScopePopulation } from './types.ts';
import { isAbsoluteStrengthMode } from '../modeEligibility.ts';

/** Population facts derived from the analytics dataset itself (Demo, tests, or before view=analytics arrives). */
export function populationFromMatches(matches: MatchRecord[], complete: ScopePopulation['complete']): ScopePopulation {
  let anchor: string | undefined;
  let floor: string | undefined;
  // mode-eligibility-policy-v1: the adaptive anchor/floor come from absolute-strength (Competitive)
  // evidence only, so Unrated/entertainment activity can never shift a strength window's freshness.
  for (const match of matches) {
    if (!isAbsoluteStrengthMode(match.gameMode)) continue;
    if (!anchor || match.playedAt > anchor) anchor = match.playedAt;
    if (!floor || match.playedAt < floor) floor = match.playedAt;
  }
  const seasonKeys = [...new Set(matches.flatMap((match) => match.seasonKey ? [match.seasonKey] : []))].sort();
  const withSeason = matches.filter((match) => match.seasonKey).length;
  return {
    ...(anchor ? { anchor } : {}), ...(floor ? { floor } : {}), complete, seasonKeys,
    seasonStatus: withSeason === 0 ? 'unavailable' : withSeason === matches.length ? 'available' : 'partial',
    rankStatus: 'unavailable',
  };
}
