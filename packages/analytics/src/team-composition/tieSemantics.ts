import { AGENT_DEFINITIONS } from '../agents/agentCatalog.ts';

/**
 * `team-composition-v1.1` deterministic ranking semantics (V2-TEAM-COMPOSITION-TIE-SEMANTICS-01). The SINGLE place
 * that defines how candidate lineups are compared. team-composition-v1 (legacy, accepted) compared raw floating-point
 * values, so lineups whose score / confidence are mathematically equal were ordered by summation noise (which depends on
 * the order members are iterated). v1.1 keeps every score, weight, confidence formula, evidence selection and threshold
 * of v1 and only adds:
 *
 *  1. Semantic equality: two values are EQUAL when |a − b| <= TEAM_COMPOSITION_TIE_EPSILON (inclusive).
 *  2. Ranking keys (each compared only when the previous ones are equal):
 *       enumeration order : score desc → assignment signature asc
 *       recommendation    : confidence desc → score desc → assignment signature asc
 *     and comparable-band membership: score >= best − band − EPSILON.
 *  3. Assignment signature: `memberId=agentContentId/role` for the five picks in canonical member order (internal V2
 *     member ids sorted by code point), joined by '|'. It uses only V2 stable member identity, the stable public agent
 *     content id and the role — never a provider account id, PUUID, legacy key, database row order or object iteration.
 */
export const TEAM_COMPOSITION_TIE_SEMANTICS_VERSION = 'team-composition-v1.1' as const;
export const TEAM_COMPOSITION_TIE_EPSILON = 1e-9;

/** True when the two values are semantically equal (inclusive epsilon). */
export function tieEqual(a: number, b: number, epsilon = TEAM_COMPOSITION_TIE_EPSILON): boolean {
  return Math.abs(a - b) <= epsilon;
}

/** Descending comparator with semantic equality (returns 0 for equal values). */
export function compareDescWithTies(a: number, b: number, epsilon = TEAM_COMPOSITION_TIE_EPSILON): number {
  return tieEqual(a, b, epsilon) ? 0 : b - a;
}

/** Code-point string comparison (locale-independent, unlike localeCompare). */
export function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const AGENT_ID_BY_NAME = new Map(AGENT_DEFINITIONS.flatMap((d) => [d.displayName, ...d.aliases].map((name) => [name, d.canonicalId] as const)));

/** Stable agent identity for the signature: catalog content id; an unknown name keeps a labelled fallback. */
export function agentSignatureId(agentName: string): string {
  return AGENT_ID_BY_NAME.get(agentName) ?? `unknown:${agentName}`;
}

export interface SignaturePick { memberId: string; agent: string; role: string }

export interface RankableAssignment { score: number; confidence: number; signature: string }

/** Enumeration order: score desc (semantic equality) → signature asc. */
export function compareEnumeration(a: Pick<RankableAssignment, 'score' | 'signature'>, b: Pick<RankableAssignment, 'score' | 'signature'>): number {
  return compareDescWithTies(a.score, b.score) || compareCodePoints(a.signature, b.signature);
}

/** Recommendation order inside the comparable band: confidence desc → score desc → signature asc. */
export function compareRecommendation(a: RankableAssignment, b: RankableAssignment): number {
  return compareDescWithTies(a.confidence, b.confidence) || compareDescWithTies(a.score, b.score) || compareCodePoints(a.signature, b.signature);
}

/** Comparable-band membership (the v1 band, with semantic equality at its edge). */
export function withinComparableBand(score: number, best: number, band: number): boolean {
  return score >= best - band - TEAM_COMPOSITION_TIE_EPSILON;
}

/**
 * v1.1 ranking: the comparable band ordered by `compareRecommendation`, then up to `rest` further assignments in
 * enumeration order. Every assignment appears at most once (keyed by signature), so the recommended lineup can never
 * reappear as an alternative. `scored` may arrive in any order.
 */
export function rankAssignments<T extends RankableAssignment>(scored: readonly T[], band: number, rest = 10): T[] {
  const ordered = [...scored].sort(compareEnumeration);
  const best = ordered[0]?.score;
  if (best === undefined) return [];
  const comparable = ordered.filter((a) => withinComparableBand(a.score, best, band)).sort(compareRecommendation);
  const taken = new Set(comparable.map((a) => a.signature));
  const others = ordered.filter((a) => !taken.has(a.signature)).slice(0, rest);
  const ranked = [...comparable, ...others];
  if (new Set(ranked.map((a) => a.signature)).size !== ranked.length) throw new Error('duplicate assignment in Team Composition ranking');
  return ranked;
}

/** Canonical, provider-neutral assignment signature (member order = sorted internal V2 member ids). */
export function assignmentSignature(picks: readonly SignaturePick[]): string {
  return [...picks].sort((a, b) => compareCodePoints(a.memberId, b.memberId))
    .map((p) => `${p.memberId}=${agentSignatureId(p.agent)}/${p.role}`).join('|');
}
