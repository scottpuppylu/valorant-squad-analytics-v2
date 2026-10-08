// Ported from legacy `src/analytics/sharedMatch/candidates.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged; only the accepted signal accessor and pooled within-member SD are ported (candidate audit stays research-only).
import type { MemberMatchSignals, PairMatchEvidence } from './pairEvidence.ts';

/**
 * Phase A candidate evaluation (descriptive, no tuning to member order). For each per-match signal:
 *   availability   share of valid pair units where both members have the signal;
 *   withinSd       pooled within-member SD of the signal (match-to-match noise);
 *   roleBias       mean (Duelist − non-Duelist) margin over pairs with exactly one Duelist, in withinSd units
 *                  (≈ 0 means the signal does not structurally favour Duelists);
 *   stability      share of well-evidenced pairs (≥ 8 units) whose mean-margin sign agrees between the
 *                  chronologically first and second halves.
 */
export type CandidateKey = 'engineOverall' | 'matchProfile' | 'roundImpact' | 'firepower' | 'teamplay' | 'entry' | 'roleValue' | 'firepowerRoundImpact' | 'acs' | 'killDiffPerRound' | 'kast';

export function signalValue(signals: MemberMatchSignals, key: CandidateKey): number | null {
  if (key === 'engineOverall') return signals.engineOverall;
  if (key === 'matchProfile') return signals.matchProfile;
  if (key === 'roundImpact' || key === 'firepower' || key === 'teamplay' || key === 'entry' || key === 'roleValue') return signals.dimensions[key] ?? null;
  if (key === 'firepowerRoundImpact') {
    // Equal-weight mean of two existing role-aware dimensions, only when BOTH exist (no new weights, no zero fill).
    const fire = signals.dimensions.firepower; const impact = signals.dimensions.roundImpact;
    return fire !== undefined && impact !== undefined ? (fire + impact) / 2 : null;
  }
  if (key === 'kast') return signals.kast;
  return signals[key];
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

export function pooledWithinMemberSd(pairs: readonly PairMatchEvidence[], key: CandidateKey): number | null {
  const byMember = new Map<string, Map<string, number>>();
  for (const pair of pairs) for (const side of [pair.a, pair.b]) {
    const value = signalValue(side, key);
    if (value === null || !pair.valid.stats) continue;
    const values = byMember.get(side.memberId) ?? new Map<string, number>();
    values.set(pair.matchRef, value);
    byMember.set(side.memberId, values);
  }
  let squares = 0; let degrees = 0;
  for (const values of byMember.values()) {
    const list = [...values.values()];
    if (list.length < 2) continue;
    const average = mean(list);
    squares += list.reduce((sum, value) => sum + (value - average) ** 2, 0);
    degrees += list.length - 1;
  }
  return degrees > 0 ? Math.sqrt(squares / degrees) : null;
}
