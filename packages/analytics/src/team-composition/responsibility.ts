// Ported from legacy `src/analytics/teamComposition/responsibility.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged.
import type { PlayerRole } from '../event/matchViewTypes.ts';
import type { MemberObservation } from './observations.ts';

/**
 * TASK-ANALYTICS-TEAM-COMPOSITION-01 — `team-responsibility-v1`: broad responsibilities from HISTORICAL BEHAVIOUR on the
 * role the member is assigned (Competitive; no position / site evidence is used or claimed).
 *
 * Behaviour rates per member × role are shrunk (K = 8 matches) toward the GROUP mean of the same rate, then compared
 * with the group median over all member × role cells (group-scoped, any group size). A responsibility is assigned only
 * with ≥ MIN_RESPONSIBILITY_MATCHES matches on that role (the shared-match minimum-evidence convention) and a rate above
 * the group median; otherwise the member gets no responsibility label (never a guess). Agent class alone never decides:
 * PRIMARY_ENTRY needs first-contact behaviour, whatever the role. LURK is not offered (needs position evidence).
 */
export const RESPONSIBILITY_VERSION = 'team-responsibility-v1' as const;
export const MIN_RESPONSIBILITY_MATCHES = 5;
const K = 8;
export type Responsibility = 'PRIMARY_ENTRY' | 'SECOND_ENTRY_TRADE' | 'INFO_INITIATION' | 'UTILITY_SUPPORT' | 'SPACE_SMOKE_CONTROL' | 'ANCHOR_CLUTCH' | 'FLEX';

export interface BehaviourProfile {
  matches: number; rounds: number;
  /** (first kills + first deaths) / round: how often the member takes the first duel. */
  firstContactRate: number | null;
  /** first kills / (first kills + first deaths). */
  openingWinShare: number | null;
  /** (trade kills + trade assists) / round. */
  tradeRate: number | null;
  assistsPerRound: number;
  kast: number | null;
  /** (clutch wins + 1) / (attempts + 5): the existing community-score-v2 clutch prior. */
  clutchConversion: number | null; clutchAttempts: number;
  survivalRate: number;
}

type Rates = 'firstContactRate' | 'openingWinShare' | 'tradeRate' | 'assistsPerRound' | 'kast' | 'clutchConversion' | 'survivalRate';
const RATES: readonly Rates[] = ['firstContactRate', 'openingWinShare', 'tradeRate', 'assistsPerRound', 'kast', 'clutchConversion', 'survivalRate'];

function rawProfile(list: readonly MemberObservation[]): BehaviourProfile {
  let rounds = 0; let fk = 0; let fd = 0; let openRounds = 0; let trades = 0; let tradeRounds = 0; let assists = 0; let deaths = 0;
  let kastSum = 0; let kastRounds = 0; let attempts = 0; let wins = 0; let clutchMatches = 0;
  for (const o of list) {
    const b = o.behaviour; rounds += o.rounds; assists += b.assists; deaths += b.deaths;
    if (b.firstKills !== null && b.firstDeaths !== null) { fk += b.firstKills; fd += b.firstDeaths; openRounds += o.rounds; }
    if (b.tradeKills !== null && b.tradeAssists !== null) { trades += b.tradeKills + b.tradeAssists; tradeRounds += o.rounds; }
    if (b.kastRate !== null) { kastSum += b.kastRate * o.rounds; kastRounds += o.rounds; }
    if (b.clutchAttempts !== null && b.clutchWins !== null) { attempts += b.clutchAttempts; wins += b.clutchWins; clutchMatches += 1; }
  }
  return { matches: list.length, rounds, firstContactRate: openRounds ? (fk + fd) / openRounds : null, openingWinShare: fk + fd ? fk / (fk + fd) : null,
    tradeRate: tradeRounds ? trades / tradeRounds : null, assistsPerRound: rounds ? assists / rounds : 0, kast: kastRounds ? kastSum / kastRounds : null,
    clutchConversion: clutchMatches ? (wins + 1) / (attempts + 5) : null, clutchAttempts: attempts, survivalRate: rounds ? Math.max(0, 1 - deaths / rounds) : 0 };
}

const median = (values: number[]) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export class BehaviourModel {
  private readonly byMemberRole = new Map<string, BehaviourProfile>();
  private readonly groupMean = new Map<Rates, number>();
  private readonly groupMedian = new Map<Rates, number>();
  private readonly roleCounts = new Map<string, Map<PlayerRole, number>>();

  constructor(observations: readonly MemberObservation[]) {
    const cells = new Map<string, MemberObservation[]>();
    for (const o of observations) {
      if (!o.role) continue;
      cells.set(`${o.memberId}|${o.role}`, [...(cells.get(`${o.memberId}|${o.role}`) ?? []), o]);
      const counts = this.roleCounts.get(o.memberId) ?? new Map<PlayerRole, number>();
      counts.set(o.role, (counts.get(o.role) ?? 0) + 1); this.roleCounts.set(o.memberId, counts);
    }
    const raw = new Map([...cells].map(([key, list]) => [key, rawProfile(list)]));
    const all = rawProfile(observations.filter((o) => o.role));
    for (const rate of RATES) { const value = all[rate]; this.groupMean.set(rate, typeof value === 'number' ? value : 0); }
    for (const [key, profile] of raw) {
      const shrunk = { ...profile } as BehaviourProfile;
      for (const rate of RATES) {
        const value = profile[rate];
        (shrunk as unknown as Record<Rates, number | null>)[rate] = value === null ? null : (profile.matches * value + K * this.groupMean.get(rate)!) / (profile.matches + K);
      }
      this.byMemberRole.set(key, shrunk);
    }
    for (const rate of RATES) {
      const values = [...this.byMemberRole.values()].flatMap((p) => (typeof p[rate] === 'number' ? [p[rate] as number] : []));
      this.groupMedian.set(rate, median(values) ?? this.groupMean.get(rate)!);
    }
  }

  profile(memberId: string, role: PlayerRole): BehaviourProfile | undefined { return this.byMemberRole.get(`${memberId}|${role}`); }
  median(rate: Rates): number { return this.groupMedian.get(rate)!; }
  rolesWithEvidence(memberId: string): PlayerRole[] {
    return [...(this.roleCounts.get(memberId) ?? new Map<PlayerRole, number>())].filter(([, n]) => n >= MIN_RESPONSIBILITY_MATCHES).map(([role]) => role).sort();
  }
}

export interface ResponsibilityResult { memberId: string; responsibility: Responsibility | null; evidence: string[] }

/**
 * Deterministic lineup assignment: PRIMARY_ENTRY (unique) → SECOND_ENTRY_TRADE (unique) → per member the first
 * supported of SPACE_SMOKE_CONTROL, INFO_INITIATION, ANCHOR_CLUTCH, UTILITY_SUPPORT, FLEX. `flexRoles` = roles whose fit
 * is within reach of the member's best (decided by the recommender's fit model).
 */
export function assignResponsibilities(model: BehaviourModel, slots: readonly { memberId: string; role: PlayerRole }[],
  flexRoles: ReadonlyMap<string, readonly PlayerRole[]> = new Map()): ResponsibilityResult[] {
  const ordered = [...slots].sort((a, b) => (a.memberId < b.memberId ? -1 : 1));
  const evidenced = (slot: { memberId: string; role: PlayerRole }) => {
    const p = model.profile(slot.memberId, slot.role);
    return p && p.matches >= MIN_RESPONSIBILITY_MATCHES ? p : undefined;
  };
  const result = new Map<string, ResponsibilityResult>(ordered.map((s) => [s.memberId, { memberId: s.memberId, responsibility: null, evidence: [] }]));
  const pct = (v: number) => `${(100 * v).toFixed(1)}%`;
  const pickTop = (rate: 'firstContactRate' | 'tradeRate', label: Responsibility, describe: (p: BehaviourProfile) => string) => {
    const candidates = ordered.filter((s) => result.get(s.memberId)!.responsibility === null)
      .flatMap((s) => { const p = evidenced(s); const v = p?.[rate]; return p && typeof v === 'number' && v > model.median(rate) ? [{ s, p, v }] : []; })
      .sort((a, b) => b.v - a.v || (a.s.memberId < b.s.memberId ? -1 : 1));
    const top = candidates[0];
    if (top) result.set(top.s.memberId, { memberId: top.s.memberId, responsibility: label, evidence: [describe(top.p)] });
  };
  pickTop('firstContactRate', 'PRIMARY_ENTRY', (p) => `first duel in ${pct(p.firstContactRate!)} of rounds on this role (group median ${pct(model.median('firstContactRate'))}); wins ${pct(p.openingWinShare ?? 0)} of them`);
  pickTop('tradeRate', 'SECOND_ENTRY_TRADE', (p) => `trade involvement ${pct(p.tradeRate!)} of rounds (group median ${pct(model.median('tradeRate'))})`);
  for (const slot of ordered) {
    const current = result.get(slot.memberId)!;
    if (current.responsibility) continue;
    const p = evidenced(slot);
    if (!p) { current.evidence.push(`fewer than ${MIN_RESPONSIBILITY_MATCHES} Competitive matches on ${slot.role}: no responsibility claimed`); continue; }
    const above = (rate: Rates) => typeof p[rate] === 'number' && (p[rate] as number) > model.median(rate);
    if (slot.role === 'Controller' && (above('kast') || above('survivalRate'))) {
      current.responsibility = 'SPACE_SMOKE_CONTROL'; current.evidence.push(`${p.matches} Controller matches; KAST ${pct(p.kast ?? 0)} / survival ${pct(p.survivalRate)} vs group medians`);
    } else if (slot.role === 'Initiator' && above('assistsPerRound')) {
      current.responsibility = 'INFO_INITIATION'; current.evidence.push(`${p.assistsPerRound.toFixed(2)} assists per round on Initiators (group median ${model.median('assistsPerRound').toFixed(2)})`);
    } else if (p.clutchAttempts >= MIN_RESPONSIBILITY_MATCHES && above('clutchConversion') && (slot.role === 'Sentinel' || above('survivalRate'))) {
      current.responsibility = 'ANCHOR_CLUTCH'; current.evidence.push(`clutch conversion ${pct(p.clutchConversion!)} over ${p.clutchAttempts} attempts (group median ${pct(model.median('clutchConversion'))})`);
    } else if (above('assistsPerRound') || above('kast')) {
      current.responsibility = 'UTILITY_SUPPORT'; current.evidence.push(`assists ${p.assistsPerRound.toFixed(2)}/round, KAST ${pct(p.kast ?? 0)} above group medians`);
    } else if ((flexRoles.get(slot.memberId) ?? []).length >= 2) {
      current.responsibility = 'FLEX'; current.evidence.push(`comparable historical fit on ${(flexRoles.get(slot.memberId) ?? []).join(', ')}`);
    } else {
      current.evidence.push('no behaviour rate above the group median on this role: no responsibility claimed');
    }
  }
  return ordered.map((s) => result.get(s.memberId)!);
}
