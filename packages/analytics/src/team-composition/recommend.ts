// Ported from legacy `src/analytics/teamComposition/recommend.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged except the documented TIE_EPSILON order-invariance adaptation; parameter properties expanded (erasableSyntaxOnly); PairSynergySource moved to pairSynergySource.ts.
import type { PlayerRole } from '../event/matchViewTypes.ts';
import { AGENT_DEFINITIONS, agentRoles, resolveAgent } from '../agents/agentCatalog.ts';
import { NEUTRAL_SIGMA } from '../shared-match/rating.ts';
import { FitModel, fitConfidence, type IndividualFit } from './fit.ts';
import { shrunkMapSynergy, type PairSynergySource } from './pairSynergySource.ts';
import type { MemberObservation } from './observations.ts';
import { assignResponsibilities, BehaviourModel, MIN_RESPONSIBILITY_MATCHES, type Responsibility } from './responsibility.ts';

/**
 * TASK-ANALYTICS-TEAM-COMPOSITION-01 — `team-composition-v1` (OUTCOME_B: data-supported lineup ranking; NOT a proven
 * best composition, NOT a win probability, NO position / site / route claims, no live opponent scouting).
 *
 * Score of an assignment = mean individual fit of the five (member × agent → member × role → member, K = 8;
 * `team-fit-hierarchy-v1`, performance channel). Map evidence is CONTEXT by default (`mapEvidence: 'context'`): the
 * chronological holdout showed map-scoped levels add no out-of-sample signal beyond the agent level at any tested
 * shrinkage, so they are reported (samples, explanations) but not scored; `'scored'` keeps the full map hierarchy for
 * research. Pair synergy (duo-synergy-v1, map-shrunk) and the role distribution are reported, never scored (no
 * consistent holdout signal).
 *
 * Ranking (conservative): assignments whose score is within NEUTRAL_SIGMA·σ of the best (σ = pooled within-member SD of
 * one-match performance; the shared-match-rating-v1 neutral convention) are statistically comparable; among them the
 * highest-confidence assignment is recommended. The rest follow by score.
 *
 * TEAM_FIT (0–100) = relative historical fit: mean over the five of the assigned agent's percentile among that member's
 * own evidence-backed agents (100 = everyone on their personally best-fitting agent). Not a win probability.
 * Confidence (0–100, separate): mean member confidence; member confidence = 100·√min(n(member × agent)/20, 1) in context
 * mode (direct agent evidence only; the full-hierarchy confidence in 'scored' mode). Experimental agents are capped at 25.
 */
export const TEAM_COMPOSITION_VERSION = 'team-composition-v1' as const;
export const TEAM_FIT_MEANING = "mean percentile of each member's assigned agent among their own evidence-backed agents (100 = everyone on their best historical fit; not a win probability)";
export const DEFAULT_POOL_SIZE = 6;
const EXPERIMENTAL_PER_MEMBER = 3;

export class TeamCompositionInputError extends Error {}

export class TeamCompositionModel {
  readonly fit: FitModel;
  readonly behaviour: BehaviourModel;
  readonly mapEvidence: 'context' | 'scored';
  /** Pooled within-member SD of one-match performance (the noise scale of the comparable band). */
  readonly performanceSigma: number;

  readonly observations: readonly MemberObservation[];
  readonly synergy?: PairSynergySource;

  constructor(observations: readonly MemberObservation[], synergy?: PairSynergySource, options: { mapEvidence?: 'context' | 'scored' } = {}) {
    this.observations = observations;
    this.synergy = synergy;
    this.mapEvidence = options.mapEvidence ?? 'context';
    this.fit = new FitModel(observations, { mapK: this.mapEvidence === 'scored' ? undefined : null });
    this.behaviour = new BehaviourModel(observations);
    const byMember = new Map<string, number[]>();
    for (const o of observations) if (o.performance !== null) byMember.set(o.memberId, [...(byMember.get(o.memberId) ?? []), o.performance]);
    let squares = 0; let degrees = 0;
    for (const [, values] of [...byMember.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (values.length < 2) continue;
      const m = values.reduce((s, v) => s + v, 0) / values.length;
      squares += values.reduce((s, v) => s + (v - m) ** 2, 0); degrees += values.length - 1;
    }
    this.performanceSigma = degrees ? Math.sqrt(squares / degrees) : 0;
  }

  memberConfidence(fit: IndividualFit): number {
    return this.mapEvidence === 'scored' ? fitConfidence(fit.samples) : 100 * Math.sqrt(Math.min(fit.samples.agent / 20, 1));
  }
}

export interface MemberAssignment {
  memberId: string; agent: string; role: PlayerRole; fit: number; confidence: number; experimental: boolean;
  evidenceLevel: IndividualFit['evidenceLevel']; samples: IndividualFit['samples']; components: NonNullable<IndividualFit['components']>;
  responsibility: Responsibility | null; reasons: string[];
}
export interface Lineup {
  label: 'RECOMMENDED_HISTORICAL_FIT' | 'ALTERNATIVE';
  members: MemberAssignment[];
  roleDistribution: Record<PlayerRole, number>;
  /** Mean individual fit (one-match role-aware profile scale, 0–100). */
  fitScore: number;
  teamFit: number;
  confidence: number;
  /** Within the comparable band of the best-scoring assignment (differences there are below match noise). */
  comparableToBest: boolean;
  pairSynergy: { pairs: number; withEvidence: number; meanShrunkMapSynergy: number | null };
  tradeoff: string | null;
}
export interface TeamCompositionResult {
  version: typeof TEAM_COMPOSITION_VERSION; map: string; status: 'ok' | 'insufficient_evidence';
  teamFitMeaning: string; mapEvidence: 'context' | 'scored'; feasibleAssignments: number; experimentalUsed: boolean;
  /** Score band treated as statistically comparable (profile points). */
  comparableBand: number | null;
  lineups: Lineup[]; reason?: string;
  boundary: { positionClaims: false; siteClaims: false; causalClaim: false; liveOpponentScouting: false };
}

interface Candidate { agent: string; role: PlayerRole; fit: IndividualFit; experimental: boolean }

/** Every evidence-backed agent of the member (Competitive history, known role only), best fit first. */
function evidencedAgents(model: TeamCompositionModel, memberId: string, map: string) {
  const played = model.fit.agentCounts.get(memberId) ?? new Map<string, { all: number; byMap: Map<string, number> }>();
  return [...played.entries()]
    .filter(([agent]) => resolveAgent({ name: agent }).status === 'known' && agentRoles[agent] !== undefined)
    .map(([agent, counts]) => ({ agent, role: agentRoles[agent]!, fit: model.fit.fit(memberId, agent, map, 'performance'), experimental: false,
      onMap: counts.byMap.get(map) ?? 0, all: counts.all }))
    .filter((c) => c.fit.value !== null)
    .sort((a, b) => b.fit.value! - a.fit.value! || b.onMap - a.onMap || b.all - a.all || a.agent.localeCompare(b.agent));
}

/** Pruned pool: the best `poolSize` by fit plus the three most-played (on this map, then overall) — deterministic. */
function candidatePool(model: TeamCompositionModel, memberId: string, map: string, poolSize: number): Candidate[] {
  const all = evidencedAgents(model, memberId, map);
  const mostPlayed = [...all].sort((a, b) => b.onMap - a.onMap || b.all - a.all || a.agent.localeCompare(b.agent)).slice(0, 3);
  const keep = new Set([...all.slice(0, poolSize), ...mostPlayed].map((c) => c.agent));
  return all.filter((c) => keep.has(c.agent)).map(({ agent, role, fit, experimental }) => ({ agent, role, fit, experimental }));
}

function experimentalPool(model: TeamCompositionModel, memberId: string, map: string, exclude: Set<string>): Candidate[] {
  const roles = new Set(model.behaviour.rolesWithEvidence(memberId));
  return AGENT_DEFINITIONS.filter((agent) => roles.has(agent.role) && !exclude.has(agent.displayName))
    .map((agent) => ({ agent: agent.displayName, role: agent.role, fit: model.fit.fit(memberId, agent.displayName, map, 'performance'), experimental: true }))
    .filter((c) => c.fit.value !== null)
    .sort((a, b) => b.fit.value! - a.fit.value! || a.agent.localeCompare(b.agent)).slice(0, EXPERIMENTAL_PER_MEMBER);
}

const keyOf = (picks: readonly Candidate[]) => picks.map((p) => p.agent).join(',');
/**
 * V2 ADAPTATION (order invariance, V2-PRODUCT-UI-WAVE-01): sums over the five picks run in member-id order, and V2 member
 * ids sort differently from the legacy public ids, so mathematically EQUAL scores / confidences can differ in the last
 * floating-point bits. Values within TIE_EPSILON are treated as equal so the accepted tie-break (confidence → score →
 * agent key) decides, exactly as it does when the values are bit-identical. No accepted value or threshold changes.
 */
const TIE_EPSILON = 1e-9;
const desc = (x: number, y: number) => (Math.abs(x - y) <= TIE_EPSILON ? 0 : y - x);

/** Every assignment of distinct agents over the pools, best score first (deterministic tie-break by agent names). */
function enumerate(pools: readonly Candidate[][]): { picks: Candidate[]; score: number }[] {
  const out: { picks: Candidate[]; score: number }[] = [];
  const walk = (index: number, picks: Candidate[], used: Set<string>) => {
    if (index === pools.length) { out.push({ picks: [...picks], score: picks.reduce((s, c) => s + c.fit.value!, 0) / picks.length }); return; }
    for (const candidate of pools[index]!) {
      if (used.has(candidate.agent)) continue;
      used.add(candidate.agent); picks.push(candidate);
      walk(index + 1, picks, used);
      picks.pop(); used.delete(candidate.agent);
    }
  };
  walk(0, [], new Set());
  return out.sort((a, b) => desc(a.score, b.score) || keyOf(a.picks).localeCompare(keyOf(b.picks)));
}

export function recommendTeamComposition(input: { memberIds: readonly string[]; map: string }, model: TeamCompositionModel,
  options: { alternatives?: number; poolSize?: number } = {}): TeamCompositionResult {
  const ids = [...input.memberIds];
  if (ids.length !== 5) throw new TeamCompositionInputError('Team Composition V1 needs exactly five members.');
  if (new Set(ids).size !== 5) throw new TeamCompositionInputError('The five members must be distinct.');
  if (!input.map) throw new TeamCompositionInputError('A map is required.');
  const memberIds = [...ids].sort();
  const map = input.map;
  const base = { version: TEAM_COMPOSITION_VERSION, map, teamFitMeaning: TEAM_FIT_MEANING, mapEvidence: model.mapEvidence,
    boundary: { positionClaims: false, siteClaims: false, causalClaim: false, liveOpponentScouting: false } } as const;
  const poolSize = options.poolSize ?? DEFAULT_POOL_SIZE;
  let pools = memberIds.map((id) => candidatePool(model, id, map, poolSize));
  if (pools.some((pool) => pool.length === 0)) {
    return { ...base, status: 'insufficient_evidence', feasibleAssignments: 0, experimentalUsed: false, comparableBand: null, lineups: [],
      reason: 'A selected member has no Competitive agent evidence in this group.' };
  }
  let assignments = enumerate(pools);
  let experimentalUsed = false;
  if (assignments.length === 0) {
    // Only when no evidence-backed composition exists: unseen agents of roles the member has evidence on, labelled.
    experimentalUsed = true;
    pools = pools.map((pool, i) => [...pool, ...experimentalPool(model, memberIds[i]!, map, new Set(pool.map((c) => c.agent)))]);
    assignments = enumerate(pools);
  }
  if (assignments.length === 0) {
    return { ...base, status: 'insufficient_evidence', feasibleAssignments: 0, experimentalUsed, comparableBand: null, lineups: [], reason: 'No five distinct agents can be assigned.' };
  }
  const confidenceOf = (picks: readonly Candidate[]) => picks.reduce((s, p) => s + (p.experimental ? Math.min(model.memberConfidence(p.fit), 25) : model.memberConfidence(p.fit)), 0) / picks.length;
  const band = NEUTRAL_SIGMA * model.performanceSigma;
  const best = assignments[0]!.score;
  const comparable = assignments.filter((a) => a.score >= best - band - TIE_EPSILON).map((a) => ({ ...a, confidence: confidenceOf(a.picks) }))
    .sort((a, b) => desc(a.confidence, b.confidence) || desc(a.score, b.score) || keyOf(a.picks).localeCompare(keyOf(b.picks)));
  const ranked = [...comparable, ...assignments.slice(comparable.length, comparable.length + 10).map((a) => ({ ...a, confidence: confidenceOf(a.picks) }))];
  const personal = memberIds.map((id) => {
    const values = evidencedAgents(model, id, map).map((c) => c.fit.value!);
    return (fit: number) => (values.length <= 1 ? 100 : (100 * values.filter((v) => v < fit).length) / (values.length - 1));
  });
  const pairs: [string, string][] = [];
  for (let i = 0; i < memberIds.length; i += 1) for (let j = i + 1; j < memberIds.length; j += 1) pairs.push([memberIds[i]!, memberIds[j]!]);
  const synergyValues = model.synergy ? pairs.flatMap(([a, b]) => { const s = shrunkMapSynergy(model.synergy!, a, b, map); return s === null ? [] : [s]; }) : [];
  const pairSynergy = { pairs: pairs.length, withEvidence: synergyValues.length,
    meanShrunkMapSynergy: synergyValues.length ? synergyValues.reduce((s, v) => s + v, 0) / synergyValues.length : null };
  // FLEX evidence: roles with ≥ MIN matches on which the member performs at or above their own baseline.
  const flexRoles = new Map(memberIds.map((id) => [id, model.behaviour.rolesWithEvidence(id).filter((role) => {
    const f = model.fit.fit(id, AGENT_DEFINITIONS.find((a) => a.role === role)!.displayName, map, 'performance');
    return f.components !== null && f.components.roleFit >= 0;
  })]));
  const sign = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
  const lineups = ranked.slice(0, 1 + (options.alternatives ?? 2)).map((assignment, rank): Lineup => {
    const responsibilities = assignResponsibilities(model.behaviour, assignment.picks.map((p, i) => ({ memberId: memberIds[i]!, role: p.role })), flexRoles);
    const members = assignment.picks.map((pick, i): MemberAssignment => {
      const memberId = memberIds[i]!; const f = pick.fit; const c = f.components!;
      const reasons = [
        f.samples.agent > 0 ? `${pick.agent}: ${f.samples.agent} Competitive matches; agent fit ${sign(c.agentFit)} vs this member's ${pick.role} level`
          : `${pick.agent}: no direct agent history; estimate falls back to the ${pick.role} role level`,
        `${pick.role}: ${f.samples.role} matches; role fit ${sign(c.roleFit)} vs own baseline`,
        f.samples.agent_map > 0 ? `${f.samples.agent_map} matches on ${pick.agent} on ${map}${model.mapEvidence === 'context' ? ' (context only: map evidence did not validate as predictive)' : ''}`
          : `limited direct Agent×Map sample on ${map}; recommendation uses the agent / role level`,
        ...(pick.experimental ? ['EXPERIMENTAL / LOW CONFIDENCE: agent never played by this member'] : []),
        ...responsibilities[i]!.evidence,
      ];
      const memberConfidence = model.memberConfidence(f);
      return { memberId, agent: pick.agent, role: pick.role, fit: f.value!, confidence: pick.experimental ? Math.min(memberConfidence, 25) : memberConfidence,
        experimental: pick.experimental, evidenceLevel: f.evidenceLevel, samples: f.samples, components: c, responsibility: responsibilities[i]!.responsibility, reasons };
    });
    const roleDistribution = { Duelist: 0, Initiator: 0, Controller: 0, Sentinel: 0 } as Record<PlayerRole, number>;
    for (const m of members) roleDistribution[m.role] += 1;
    return { label: rank === 0 ? 'RECOMMENDED_HISTORICAL_FIT' : 'ALTERNATIVE', members, roleDistribution, fitScore: assignment.score,
      teamFit: members.reduce((s, m, i) => s + personal[i]!(m.fit), 0) / members.length, confidence: assignment.confidence,
      comparableToBest: assignment.score >= best - band - TIE_EPSILON, pairSynergy, tradeoff: null };
  });
  const top = lineups[0]!;
  for (const alt of lineups.slice(1)) {
    const changed = alt.members.filter((m, i) => m.agent !== top.members[i]!.agent).map((m) => `${m.agent} instead of ${top.members.find((t) => t.memberId === m.memberId)!.agent}`);
    const dc = alt.confidence - top.confidence;
    alt.tradeoff = `${changed.join('; ')}: fit ${sign(alt.fitScore - top.fitScore)} vs recommendation, confidence ${dc >= 0 ? '+' : ''}${dc.toFixed(0)}`
      + (alt.comparableToBest ? ' (fit difference below match noise)' : '');
  }
  return { ...base, status: 'ok', feasibleAssignments: assignments.length, experimentalUsed, comparableBand: band, lineups };
}

/** Minimum Competitive matches on a role before a responsibility is claimed. */
export const minimumEvidenceMatches = MIN_RESPONSIBILITY_MATCHES;
