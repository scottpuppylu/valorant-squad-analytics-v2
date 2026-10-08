// Ported from legacy `src/analytics/teamComposition/v2.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged.
import type { PlayerRole } from '../event/matchViewTypes.ts';
import type { TeamCompositionResult } from './recommend.ts';
import type { MemberRound, Side } from './sideEvidence.ts';

/**
 * TASK-ANALYTICS-TEAM-COMPOSITION-02 — `team-composition-v2`: an EXPLANATION / RESPONSIBILITY layer on top of the
 * frozen team-composition-v1 output. It never changes the agent assignment, Team Fit or V1 confidence.
 *
 * Evidence: side-evidence-v1 member rounds (Competitive only, explicit side only) and site-reference-v1 site context.
 * Rates per member × side, refined to member × role × side, are shrunk toward the group mean with the project's
 * n/(n+8) convention (n = distinct matches), compared with group medians, and claimed only with ≥ 5 distinct matches.
 * Site affinity per member × map × side: each MATCH contributes one vote (its majority site), so repeated snapshots in
 * one match cannot inflate evidence; an affinity is claimed only when a one-sided exact binomial test against the
 * GROUP's own base rate for that map × side gives p ≤ 0.05 with ≥ 5 voting matches. No callout, route, path or exact
 * position is ever produced; outputs carry site letters only (A / B / C).
 *
 * Validation gate (OUTCOME_B, docs/TEAM_COMPOSITION_V2.md): a responsibility label is emitted only when the rate that
 * decides it reproduced in the chronological 70/30 holdout (member-level Spearman >= 0.6, n = 9). Site tendencies did not
 * reproduce (1 of 6 train affinities held in test), so every site claim is withheld by default.
 */
export const TEAM_COMPOSITION_V2_VERSION = 'team-composition-v2' as const;
export const MIN_SIDE_MATCHES = 5;
const K = 8;
const AFFINITY_ALPHA = 0.05;

export type AttackResponsibility = 'ATTACK_PRIMARY_ENTRY' | 'ATTACK_SECOND_ENTRY_TRADE' | 'ATTACK_INFO_SETUP' | 'ATTACK_UTILITY_SUPPORT' | 'ATTACK_SPACE_CONTROL'
  | 'ATTACK_PLANT_SUPPORT' | 'ATTACK_POST_PLANT';
export type DefenseResponsibility = 'DEFENSE_FIRST_CONTACT' | 'DEFENSE_SITE_HOLD' | 'DEFENSE_INFO_SUPPORT' | 'DEFENSE_CLUTCH' | 'DEFENSE_FLEX';
export type Rate = 'firstContact' | 'trade' | 'assists' | 'survival' | 'plant' | 'postPlant' | 'sitePresence' | 'clutch';
const RATES: readonly Rate[] = ['firstContact', 'trade', 'assists', 'survival', 'plant', 'postPlant', 'sitePresence', 'clutch'];

export interface SideProfile { matches: number; rounds: number; rates: Partial<Record<Rate, number>>; clutchAttempts: number; scope: 'role' | 'all_roles' }

function rawRates(list: readonly MemberRound[]): { matches: number; rounds: number; rates: Partial<Record<Rate, number>>; clutchAttempts: number } {
  const rounds = list.length; const matches = new Set(list.map((r) => r.matchId)).size;
  if (!rounds) return { matches: 0, rounds: 0, rates: {}, clutchAttempts: 0 };
  const count = (f: (r: MemberRound) => boolean) => list.filter(f).length;
  const attempts = count((r) => r.clutchAttempt === true); const wins = count((r) => r.clutchWin);
  const withSnapshots = count((r) => r.snapshots > 0);
  return { matches, rounds, clutchAttempts: attempts, rates: {
    firstContact: count((r) => r.firstKill || r.firstDeath) / rounds, trade: count((r) => r.tradeKill) / rounds,
    assists: list.reduce((s, r) => s + r.assists, 0) / rounds, survival: count((r) => !r.died) / rounds, plant: count((r) => r.planted) / rounds,
    postPlant: count((r) => r.postPlantAtSite) / rounds,
    ...(withSnapshots ? { sitePresence: count((r) => r.siteProximal.length > 0) / withSnapshots } : {}),
    ...(list.some((r) => r.clutchAttempt !== null) ? { clutch: (wins + 1) / (attempts + 5) } : {}),
  } };
}

const median = (values: number[]) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Exact one-sided binomial tail P(X ≥ k | n, p). */
export function binomialTail(k: number, n: number, p: number): number {
  if (k <= 0) return 1;
  let total = 0;
  for (let i = k; i <= n; i += 1) {
    let c = 1; for (let j = 0; j < i; j += 1) c = (c * (n - j)) / (j + 1);
    total += c * p ** i * (1 - p) ** (n - i);
  }
  return Math.min(1, total);
}

export interface SiteAffinity { site: string | null; votingMatches: number; matchesForSite: number; baseRate: number | null; pValue: number | null; confidence: number; reason: string }

export class SideModel {
  private readonly bySide = new Map<string, MemberRound[]>();
  private readonly byRoleSide = new Map<string, MemberRound[]>();
  private readonly groupMean = new Map<string, number>();
  private readonly groupMedian = new Map<string, number>();
  /** member|map|side → per-match majority site votes (site-presence evidence). */
  private readonly votes = new Map<string, Map<string, string>>();

  constructor(rounds: readonly MemberRound[]) {
    const sided = rounds.filter((r) => r.side !== null);
    for (const r of sided) {
      this.bySide.set(`${r.memberId}|${r.side}`, [...(this.bySide.get(`${r.memberId}|${r.side}`) ?? []), r]);
      if (r.role) this.byRoleSide.set(`${r.memberId}|${r.role}|${r.side}`, [...(this.byRoleSide.get(`${r.memberId}|${r.role}|${r.side}`) ?? []), r]);
    }
    for (const side of ['ATTACK', 'DEFENSE'] as const) {
      const all = rawRates(sided.filter((r) => r.side === side));
      for (const rate of RATES) this.groupMean.set(`${side}|${rate}`, all.rates[rate] ?? 0);
      const cells = [...this.bySide.entries()].filter(([key]) => key.endsWith(`|${side}`)).map(([, list]) => this.shrunk(list, side, undefined));
      for (const rate of RATES) {
        const values = cells.filter((c) => c.matches >= MIN_SIDE_MATCHES).flatMap((c) => (typeof c.rates[rate] === 'number' ? [c.rates[rate]!] : []));
        this.groupMedian.set(`${side}|${rate}`, median(values) ?? this.groupMean.get(`${side}|${rate}`)!);
      }
    }
    // Per-match votes: the site where the member was proximal in the most rounds of that match (ties → no vote).
    const perMatch = new Map<string, Map<string, number>>();
    for (const r of sided) {
      // Attack: the planted site when the member planted or was proximal to it post-plant; Defense: site-proximal presence.
      const sitesThisRound = r.side === 'ATTACK' ? ((r.planted || r.postPlantAtSite) && r.roundPlantSite ? [r.roundPlantSite] : []) : r.siteProximal;
      const key = `${r.memberId}|${r.map}|${r.side}|${r.matchId}`;
      const counts = perMatch.get(key) ?? new Map<string, number>();
      for (const site of sitesThisRound) counts.set(site, (counts.get(site) ?? 0) + 1);
      perMatch.set(key, counts);
    }
    for (const key of [...perMatch.keys()].sort()) {
      const counts = [...perMatch.get(key)!.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      if (!counts.length || (counts[1] && counts[1][1] === counts[0]![1])) continue;
      const [memberId, map, side, matchId] = key.split('|') as [string, string, string, string];
      const cell = `${memberId}|${map}|${side}`;
      this.votes.set(cell, (this.votes.get(cell) ?? new Map()).set(matchId, counts[0]![0]));
    }
  }

  private shrunk(list: readonly MemberRound[], side: Side, parent: Partial<Record<Rate, number>> | undefined): SideProfile & { matches: number } {
    const raw = rawRates(list);
    const rates: Partial<Record<Rate, number>> = {};
    for (const rate of RATES) {
      const value = raw.rates[rate];
      // Every scope shrinks toward the GROUP mean, so a role-scoped cell is never less shrunk than the all-roles cells the
      // group median is computed from; the member × side parent only fills a rate the role scope lacks.
      const prior = this.groupMean.get(`${side}|${rate}`) ?? 0;
      if (value === undefined) { if (parent?.[rate] !== undefined) rates[rate] = parent[rate]; continue; }
      rates[rate] = (raw.matches * value + K * prior) / (raw.matches + K);
    }
    return { matches: raw.matches, rounds: raw.rounds, rates, clutchAttempts: raw.clutchAttempts, scope: parent ? 'role' : 'all_roles' };
  }

  /** member × side profile, refined to the assigned role when that role has side evidence. */
  profile(memberId: string, side: Side, role?: PlayerRole): SideProfile | undefined {
    const all = this.bySide.get(`${memberId}|${side}`);
    if (!all) return undefined;
    const base = this.shrunk(all, side, undefined);
    const byRole = role ? this.byRoleSide.get(`${memberId}|${role}|${side}`) : undefined;
    return byRole && new Set(byRole.map((r) => r.matchId)).size >= MIN_SIDE_MATCHES ? this.shrunk(byRole, side, base.rates) : base;
  }
  median(side: Side, rate: Rate): number { return this.groupMedian.get(`${side}|${rate}`)!; }

  siteAffinity(memberId: string, map: string, side: Side): SiteAffinity {
    const mine = this.votes.get(`${memberId}|${map}|${side}`) ?? new Map<string, string>();
    const n = mine.size;
    if (n < MIN_SIDE_MATCHES) return { site: null, votingMatches: n, matchesForSite: 0, baseRate: null, pValue: null, confidence: 0, reason: `fewer than ${MIN_SIDE_MATCHES} matches with site-proximal ${side.toLowerCase()} evidence on this map` };
    const counts = new Map<string, number>();
    for (const site of mine.values()) counts.set(site, (counts.get(site) ?? 0) + 1);
    const [site, k] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]!;
    // Group base rate: the share of all members' votes on this map × side that went to this site.
    let groupVotes = 0; let groupSite = 0;
    for (const [cell, votes] of this.votes) if (cell.endsWith(`|${map}|${side}`)) for (const v of votes.values()) { groupVotes += 1; if (v === site) groupSite += 1; }
    const baseRate = groupVotes ? groupSite / groupVotes : null;
    if (baseRate === null || baseRate >= 1) return { site: null, votingMatches: n, matchesForSite: k, baseRate, pValue: null, confidence: 0, reason: 'no group base rate' };
    const pValue = binomialTail(k, n, baseRate);
    const confidence = 100 * Math.sqrt(Math.min(n / 20, 1));
    return pValue <= AFFINITY_ALPHA
      ? { site, votingMatches: n, matchesForSite: k, baseRate, pValue, confidence, reason: `${k} of ${n} matches lean to ${site} (group ${(100 * baseRate).toFixed(0)}%)` }
      : { site: null, votingMatches: n, matchesForSite: k, baseRate, pValue, confidence, reason: `no tendency beyond the group's own ${map} ${side.toLowerCase()} site mix` };
  }
}

export interface V2Validation { ATTACK: readonly Rate[]; DEFENSE: readonly Rate[]; siteTendency: boolean }
/**
 * Holdout-validated evidence (TASK-ANALYTICS-TEAM-COMPOSITION-02 chronological holdout, Spearman >= 0.6), gate version
 * `team-composition-v2`. This gate represents evidence from the current time-ordered validation dataset (private
 * staging, 345 Competitive matches as of 2026-10-08) and MUST be revalidated when materially new history is added.
 */
export const V2_VALIDATION: V2Validation = Object.freeze({
  ATTACK: Object.freeze(['firstContact', 'trade', 'plant', 'postPlant'] as Rate[]),
  DEFENSE: Object.freeze(['firstContact', 'assists'] as Rate[]),
  siteTendency: false,
});
const WITHHELD_SITE: SiteAffinity = { site: null, votingMatches: 0, matchesForSite: 0, baseRate: null, pValue: null, confidence: 0,
  reason: 'site-level tendency withheld: it did not reproduce in the chronological holdout' };

export interface SideGuidance<R extends string> { responsibility: R | null; siteTendency: SiteAffinity; confidence: number; evidence: string[] }
export interface MemberGuidanceV2 { memberId: string; agent: string; role: PlayerRole; attack: SideGuidance<AttackResponsibility>; defense: SideGuidance<DefenseResponsibility> }
export interface TeamCompositionV2Result {
  version: typeof TEAM_COMPOSITION_V2_VERSION; v1: TeamCompositionResult; map: string;
  /** Always the V1 recommended assignment (V2 never changes agents). */
  assignment: { memberId: string; agent: string; role: PlayerRole }[];
  members: MemberGuidanceV2[];
  /** Labels this version can emit under the validation gate (the rest are NOT_VALIDATED and never shown). */
  emittable: { attack: AttackResponsibility[]; defense: DefenseResponsibility[]; siteTendency: boolean };
  boundary: { namedCallouts: false; exactPositions: false; paths: false; realTime: false };
}

const pct = (v: number) => `${(100 * v).toFixed(0)}%`;

const ATTACK_RATE: Record<AttackResponsibility, Rate> = { ATTACK_PRIMARY_ENTRY: 'firstContact', ATTACK_SECOND_ENTRY_TRADE: 'trade', ATTACK_INFO_SETUP: 'assists',
  ATTACK_SPACE_CONTROL: 'survival', ATTACK_PLANT_SUPPORT: 'plant', ATTACK_POST_PLANT: 'postPlant', ATTACK_UTILITY_SUPPORT: 'assists' };
const DEFENSE_RATE: Record<DefenseResponsibility, Rate> = { DEFENSE_FIRST_CONTACT: 'firstContact', DEFENSE_SITE_HOLD: 'sitePresence', DEFENSE_CLUTCH: 'clutch',
  DEFENSE_INFO_SUPPORT: 'assists', DEFENSE_FLEX: 'sitePresence' };

export function refineTeamComposition(v1: TeamCompositionResult, model: SideModel, validation: V2Validation = V2_VALIDATION): TeamCompositionV2Result | null {
  const lineup = v1.lineups[0];
  if (v1.status !== 'ok' || !lineup) return null;
  const slots = lineup.members.map((m) => ({ memberId: m.memberId, agent: m.agent, role: m.role }));
  const evidenced = (memberId: string, side: Side, role: PlayerRole) => {
    const p = model.profile(memberId, side, role);
    return p && p.matches >= MIN_SIDE_MATCHES ? p : undefined;
  };
  const okAttack = (label: AttackResponsibility) => validation.ATTACK.includes(ATTACK_RATE[label]);
  // SITE_HOLD and FLEX are site statements: they also need validated site tendencies.
  const okDefense = (label: DefenseResponsibility) => validation.DEFENSE.includes(DEFENSE_RATE[label])
    && (validation.siteTendency || (label !== 'DEFENSE_SITE_HOLD' && label !== 'DEFENSE_FLEX'));
  const above = (p: SideProfile, side: Side, rate: Rate) => typeof p.rates[rate] === 'number' && p.rates[rate]! > model.median(side, rate);
  const unique = <R extends string>(side: Side, rate: Rate, label: R, taken: Map<string, R>, ok: boolean) => {
    if (!ok) return;
    const best = slots.filter((s) => !taken.has(s.memberId)).flatMap((s) => { const p = evidenced(s.memberId, side, s.role); return p && above(p, side, rate) ? [{ s, v: p.rates[rate]! }] : []; })
      .sort((a, b) => b.v - a.v || (a.s.memberId < b.s.memberId ? -1 : 1))[0];
    if (best) taken.set(best.s.memberId, label);
  };
  const attack = new Map<string, AttackResponsibility>(); const defense = new Map<string, DefenseResponsibility>();
  unique('ATTACK', 'firstContact', 'ATTACK_PRIMARY_ENTRY', attack, okAttack('ATTACK_PRIMARY_ENTRY'));
  unique('ATTACK', 'trade', 'ATTACK_SECOND_ENTRY_TRADE', attack, okAttack('ATTACK_SECOND_ENTRY_TRADE'));
  unique('DEFENSE', 'firstContact', 'DEFENSE_FIRST_CONTACT', defense, okDefense('DEFENSE_FIRST_CONTACT'));
  const members = slots.map((slot): MemberGuidanceV2 => {
    const a = evidenced(slot.memberId, 'ATTACK', slot.role); const d = evidenced(slot.memberId, 'DEFENSE', slot.role);
    const attackSite = validation.siteTendency ? model.siteAffinity(slot.memberId, v1.map, 'ATTACK') : WITHHELD_SITE;
    const defenseSite = validation.siteTendency ? model.siteAffinity(slot.memberId, v1.map, 'DEFENSE') : WITHHELD_SITE;
    if (a && !attack.has(slot.memberId)) {
      const candidates: [AttackResponsibility, boolean][] = [
        ['ATTACK_INFO_SETUP', slot.role === 'Initiator' && above(a, 'ATTACK', 'assists')],
        ['ATTACK_SPACE_CONTROL', slot.role === 'Controller' && above(a, 'ATTACK', 'survival')],
        ['ATTACK_PLANT_SUPPORT', above(a, 'ATTACK', 'plant')], ['ATTACK_POST_PLANT', above(a, 'ATTACK', 'postPlant')],
        ['ATTACK_UTILITY_SUPPORT', above(a, 'ATTACK', 'assists')]];
      const pick = candidates.find(([label, hit]) => hit && okAttack(label))?.[0] ?? null;
      if (pick) attack.set(slot.memberId, pick);
    }
    if (d && !defense.has(slot.memberId)) {
      const candidates: [DefenseResponsibility, boolean][] = [
        ['DEFENSE_SITE_HOLD', defenseSite.site !== null && above(d, 'DEFENSE', 'sitePresence')],
        ['DEFENSE_CLUTCH', d.clutchAttempts >= MIN_SIDE_MATCHES && above(d, 'DEFENSE', 'clutch')],
        ['DEFENSE_INFO_SUPPORT', slot.role === 'Initiator' && above(d, 'DEFENSE', 'assists')],
        ['DEFENSE_FLEX', defenseSite.site === null && defenseSite.votingMatches >= 2 * MIN_SIDE_MATCHES]];
      const pick = candidates.find(([label, hit]) => hit && okDefense(label))?.[0] ?? null;
      if (pick) defense.set(slot.memberId, pick);
    }
    const describe = (p: SideProfile | undefined, side: Side) => (p ? [`${p.matches} Competitive matches / ${p.rounds} ${side.toLowerCase()} rounds${p.scope === 'role' ? ` as ${slot.role}` : ' (all roles)'}`,
      `first duel ${pct(p.rates.firstContact ?? 0)} (group median ${pct(model.median(side, 'firstContact'))}), trade ${pct(p.rates.trade ?? 0)}, survival ${pct(p.rates.survival ?? 0)}`]
      : [`fewer than ${MIN_SIDE_MATCHES} matches with explicit ${side.toLowerCase()} side: no ${side.toLowerCase()} responsibility claimed`]);
    const conf = (p: SideProfile | undefined) => (p ? 100 * Math.sqrt(Math.min(p.matches / 20, 1)) : 0);
    return { memberId: slot.memberId, agent: slot.agent, role: slot.role,
      attack: { responsibility: attack.get(slot.memberId) ?? null, siteTendency: attackSite, confidence: conf(a), evidence: [...describe(a, 'ATTACK'), attackSite.reason] },
      defense: { responsibility: defense.get(slot.memberId) ?? null, siteTendency: defenseSite, confidence: conf(d), evidence: [...describe(d, 'DEFENSE'), defenseSite.reason] } };
  });
  const emittable = { attack: (Object.keys(ATTACK_RATE) as AttackResponsibility[]).filter(okAttack).sort(),
    defense: (Object.keys(DEFENSE_RATE) as DefenseResponsibility[]).filter(okDefense).sort(), siteTendency: validation.siteTendency };
  return { version: TEAM_COMPOSITION_V2_VERSION, v1, map: v1.map, assignment: slots, members, emittable,
    boundary: { namedCallouts: false, exactPositions: false, paths: false, realTime: false } };
}
