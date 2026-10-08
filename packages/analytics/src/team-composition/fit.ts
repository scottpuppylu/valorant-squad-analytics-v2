// Ported from legacy `src/analytics/teamComposition/fit.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged.
import type { PlayerRole } from '../event/matchViewTypes.ts';
import { agentRoles } from '../agents/agentCatalog.ts';
import type { MemberObservation } from './observations.ts';

/**
 * TASK-ANALYTICS-TEAM-COMPOSITION-01 — hierarchical individual fit (`team-fit-hierarchy-v1`).
 *
 * Every level is shrunk toward the level above with the project's pair-evidence convention n/(n+K), K = 8
 * (docs/SYNERGY.md, shared-match-rating-v1): no hard threshold ever switches evidence on or off, and no match is invented.
 *
 *   μ_member        = shrink(member,               → group mean)
 *   μ_role          = shrink(member × role,         → μ_member)
 *   μ_map           = shrink(member × map,          → μ_member)
 *   μ_agent         = shrink(member × agent,        → μ_role)
 *   μ_role×map      = shrink(member × role × map,   → μ_role + (μ_map − μ_member))
 *   μ_agent×map     = shrink(member × agent × map,  → μ_agent + (μ_role×map − μ_role))     ← the fit value
 *
 * Two channels: `performance` (one-match role-aware profile, 0–100) and `win` (team won, 0/1). Unknown-role agents
 * never receive a role-scoped estimate (fail closed). Confidence is separate from the value.
 */
export const TEAM_FIT_VERSION = 'team-fit-hierarchy-v1' as const;
export const FIT_SHRINK_K = 8;
export type FitChannel = 'performance' | 'win';
export type EvidenceLevel = 'agent_map' | 'agent' | 'role_map' | 'role' | 'map' | 'member' | 'group';

interface Cell { n: number; sum: number }
const add = (cells: Map<string, Cell>, key: string, value: number) => {
  const cell = cells.get(key) ?? { n: 0, sum: 0 };
  cell.n += 1; cell.sum += value; cells.set(key, cell);
};
const shrinkBy = (k: number) => (cell: Cell | undefined, prior: number) => (cell ? (cell.sum + k * prior) / (cell.n + k) : prior);
const shrink = shrinkBy(FIT_SHRINK_K);

export interface IndividualFit {
  memberId: string; agent: string; map: string; role: PlayerRole | undefined; channel: FitChannel;
  /** Estimated value on the channel's scale (performance 0–100, or win probability 0–1). null = not estimable. */
  value: number | null;
  /** Additive explanation: value = member + roleFit + agentFit + roleMapFit + agentMapFit (map offset enters via roleMap). */
  components: { member: number; roleFit: number; agentFit: number; mapFit: number; roleMapFit: number; agentMapFit: number } | null;
  samples: Record<Exclude<EvidenceLevel, 'group'>, number>;
  /** Deepest level with direct evidence. */
  evidenceLevel: EvidenceLevel;
  /** 0–100, separate from the value: effective sample with deeper levels counting more. */
  confidence: number;
}

/** Confidence: 100·√min(nEff/20, 1), nEff = n(agent×map) + ½(n(agent) + n(role×map)) + ¼(n(role) + n(map)). */
export function fitConfidence(samples: IndividualFit['samples']): number {
  const effective = samples.agent_map + 0.5 * (samples.agent + samples.role_map) + 0.25 * (samples.role + samples.map);
  return 100 * Math.sqrt(Math.min(effective / 20, 1));
}

export class FitModel {
  private readonly cells = new Map<FitChannel, Map<string, Cell>>([['performance', new Map()], ['win', new Map()]]);
  private readonly groupMean = new Map<FitChannel, number>();
  /** Agents each member has played (Competitive), with counts — the evidence-backed candidate pool source. */
  readonly agentCounts = new Map<string, Map<string, { all: number; byMap: Map<string, number> }>>();

  /** Shrinkage of the map-scoped levels (map, role×map, agent×map); `null` = map evidence disabled (agent-level model). */
  private readonly mapShrink: ((cell: Cell | undefined, prior: number) => number) | null;

  constructor(observations: readonly MemberObservation[], options: { mapK?: number | null } = {}) {
    const mapK = options.mapK === undefined ? FIT_SHRINK_K : options.mapK;
    this.mapShrink = mapK === null ? null : shrinkBy(mapK);
    const totals = new Map<FitChannel, Cell>([['performance', { n: 0, sum: 0 }], ['win', { n: 0, sum: 0 }]]);
    for (const o of observations) {
      const byAgent = this.agentCounts.get(o.memberId) ?? new Map();
      const entry = byAgent.get(o.agent) ?? { all: 0, byMap: new Map<string, number>() };
      entry.all += 1; entry.byMap.set(o.map, (entry.byMap.get(o.map) ?? 0) + 1);
      byAgent.set(o.agent, entry); this.agentCounts.set(o.memberId, byAgent);
      for (const channel of ['performance', 'win'] as const) {
        const value = channel === 'performance' ? o.performance : o.won === null ? null : o.won ? 1 : 0;
        if (value === null) continue;
        const cells = this.cells.get(channel)!; const total = totals.get(channel)!;
        total.n += 1; total.sum += value;
        add(cells, `m|${o.memberId}`, value);
        add(cells, `p|${o.memberId}|${o.map}`, value);
        if (!o.role) continue; // unknown role: role-free member / map evidence only
        add(cells, `r|${o.memberId}|${o.role}`, value);
        add(cells, `a|${o.memberId}|${o.agent}`, value);
        add(cells, `rp|${o.memberId}|${o.role}|${o.map}`, value);
        add(cells, `ap|${o.memberId}|${o.agent}|${o.map}`, value);
      }
    }
    for (const [channel, total] of totals) this.groupMean.set(channel, total.n ? total.sum / total.n : channel === 'win' ? 0.5 : 50);
  }

  fit(memberId: string, agent: string, map: string, channel: FitChannel): IndividualFit {
    const role = agentRoles[agent];
    const cells = this.cells.get(channel)!;
    const get = (key: string) => cells.get(key);
    const samples = { member: get(`m|${memberId}`)?.n ?? 0, map: get(`p|${memberId}|${map}`)?.n ?? 0, role: role ? get(`r|${memberId}|${role}`)?.n ?? 0 : 0,
      agent: role ? get(`a|${memberId}|${agent}`)?.n ?? 0 : 0, role_map: role ? get(`rp|${memberId}|${role}|${map}`)?.n ?? 0 : 0,
      agent_map: role ? get(`ap|${memberId}|${agent}|${map}`)?.n ?? 0 : 0 };
    const base = { memberId, agent, map, role, channel, samples, confidence: role ? fitConfidence(samples) : 0 };
    const group = this.groupMean.get(channel)!;
    const member = shrink(get(`m|${memberId}`), group);
    const mapShrink = this.mapShrink ?? ((_cell: Cell | undefined, prior: number) => prior);
    const mapLevel = mapShrink(get(`p|${memberId}|${map}`), member);
    if (!role) return { ...base, value: null, components: null, evidenceLevel: samples.member ? 'member' : 'group' };
    const roleLevel = shrink(get(`r|${memberId}|${role}`), member);
    const agentLevel = shrink(get(`a|${memberId}|${agent}`), roleLevel);
    const roleMapPrior = roleLevel + (mapLevel - member);
    const roleMap = mapShrink(get(`rp|${memberId}|${role}|${map}`), roleMapPrior);
    const agentMapPrior = agentLevel + (roleMap - roleLevel);
    const value = mapShrink(get(`ap|${memberId}|${agent}|${map}`), agentMapPrior);
    const evidenceLevel: EvidenceLevel = samples.agent_map ? 'agent_map' : samples.agent ? 'agent' : samples.role_map ? 'role_map' : samples.role ? 'role'
      : samples.map ? 'map' : samples.member ? 'member' : 'group';
    return { ...base, value, evidenceLevel,
      components: { member, roleFit: roleLevel - member, agentFit: agentLevel - roleLevel, mapFit: mapLevel - member, roleMapFit: roleMap - roleMapPrior + (mapLevel - member),
        agentMapFit: value - agentMapPrior } };
  }

  /** The member's baseline on a channel (μ_member), used by holdout baselines. */
  memberBaseline(memberId: string, channel: FitChannel): number {
    return shrink(this.cells.get(channel)!.get(`m|${memberId}`), this.groupMean.get(channel)!);
  }
}
