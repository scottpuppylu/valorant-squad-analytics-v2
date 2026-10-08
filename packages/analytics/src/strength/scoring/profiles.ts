// Ported from legacy `src/scoring/profiles.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged.
import { dimensions, OVERALL_PROFILE_VERSION } from './versions.ts';
import type { ScoringProfile } from './types.ts';

export const defaultProfile: ScoringProfile = {
  version: OVERALL_PROFILE_VERSION,
  weights: { firepower: .18, roundImpact: .16, entry: .12, teamplay: .16, clutch: .10, economy: .10, consistency: .10, roleValue: .08 },
};
export function validateProfile(profile: ScoringProfile): ScoringProfile {
  if (!profile.version || Object.keys(profile.weights).length !== dimensions.length
    || dimensions.some((key) => !Number.isFinite(profile.weights[key]) || profile.weights[key] < 0)) throw new Error('Invalid scoring profile');
  const total = dimensions.reduce((sum, key) => sum + profile.weights[key], 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error('Invalid profile total');
  return { version: profile.version, weights: Object.fromEntries(dimensions.map((key) => [key, profile.weights[key] / total])) as ScoringProfile['weights'] };
}
