// Ported from legacy `src/analytics/teamComposition/sideEvidence.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged.
import type { PlayerRole } from '../event/matchViewTypes.ts';
import { agentRoles } from '../agents/agentCatalog.ts';
import type { SiteReference } from './siteReference.ts';

/**
 * TASK-ANALYTICS-TEAM-COMPOSITION-02 — `side-evidence-v1`: one observation per (tracked member, round) from
 * position-evidence-v1 rounds. Side comes ONLY from the explicit per-round attacking team (unknown side stays null and
 * is never used in side-specific metrics). Combat facts use opponent kills only (event-metrics-v2 semantics):
 *   first duel   = the round's earliest opponent kill (killer → first kill, victim → first death)
 *   trade        = the member kills an opponent within 5 s after that opponent killed the member's teammate
 *   clutch       = the member is the last certain survivor of the team with ≥ 1 opponent alive (rounds with a revive or a
 *                  recorded-dead killer are excluded); won = team won the round
 *   site context = the member's event-time snapshots classified by site-reference-v1 (never a path)
 */
export const SIDE_EVIDENCE_VERSION = 'side-evidence-v1' as const;
export type Side = 'ATTACK' | 'DEFENSE';
const TRADE_WINDOW_MS = 5_000;

export interface KillInput { t: number; killer: string; victim: string; assistants: readonly string[]; snapshots: readonly { participant: string; x: number; y: number }[] }
export interface RoundInput { number: number; winningTeam?: string; attackingTeamKey?: string; plantSite?: string; plantTimeMs?: number; planter?: string; kills: readonly KillInput[] }
export interface MatchInput {
  matchId: string; playedAt: string; map: string; mode: string;
  /** participant → team key (every participant of the match). */
  teams: ReadonlyMap<string, string>;
  /** tracked participant → member + agent. */
  members: ReadonlyMap<string, { memberId: string; agent: string }>;
  rounds: readonly RoundInput[];
}

export interface MemberRound {
  memberId: string; matchId: string; playedAt: string; map: string; round: number; side: Side | null; role: PlayerRole | undefined; agent: string;
  firstKill: boolean; firstDeath: boolean; tradeKill: boolean; assists: number; died: boolean; teamWon: boolean | null;
  planted: boolean; plantedSite: string | null;
  /** The round's provider plant site (whoever planted), or null. */
  roundPlantSite: string | null;
  clutchAttempt: boolean | null; clutchWin: boolean;
  /** Sites this member was proximal to at ≥ 1 snapshot this round (each site counted once per round). */
  siteProximal: string[];
  /** Post-plant snapshots of the member (attack or defense) proximal to the PLANTED site. */
  postPlantAtSite: boolean;
  snapshots: number; classifiedSnapshots: number; abstainedSnapshots: number;
  /**
   * Site context of the round's first duel when the member took it: the site letter when the member's own snapshot at
   * that kill is site-proximal, OTHER when the snapshot is outside every / inside several envelopes, UNKNOWN when no
   * snapshot of the member exists at that kill (the victim is never in the snapshot, and kill.location is never assumed
   * to be the victim's position). null when the member did not take the first duel.
   */
  firstDuelContext: string | 'OTHER' | 'UNKNOWN' | null;
}

export function memberRounds(match: MatchInput, sites: SiteReference): MemberRound[] {
  const out: MemberRound[] = [];
  const memberIds = [...match.members.keys()].sort();
  for (const round of [...match.rounds].sort((a, b) => a.number - b.number)) {
    const kills = [...round.kills].sort((a, b) => a.t - b.t);
    const opponent = kills.filter((k) => k.killer !== k.victim && match.teams.get(k.killer) !== undefined && match.teams.get(k.killer) !== match.teams.get(k.victim));
    const first = opponent[0];
    // Revive / recorded-dead topology makes alive counts uncertain: exclude the round from clutch evidence.
    const dead = new Set<string>(); let uncertain = false;
    for (const k of kills) { if (dead.has(k.victim) || (k.killer !== k.victim && dead.has(k.killer))) uncertain = true; dead.add(k.victim); }
    const roster = [...match.teams.entries()];
    for (const participant of memberIds) {
      const { memberId, agent } = match.members.get(participant)!;
      const team = match.teams.get(participant);
      const side: Side | null = round.attackingTeamKey && team ? (team === round.attackingTeamKey ? 'ATTACK' : 'DEFENSE') : null;
      const tradeKill = opponent.some((k) => k.killer === participant && opponent.some((prior) => prior.killer === k.victim && match.teams.get(prior.victim) === team
        && prior.victim !== participant && k.t - prior.t >= 0 && k.t - prior.t <= TRADE_WINDOW_MS));
      // Clutch: last certain survivor of the team with ≥ 1 opponent alive.
      let clutchAttempt: boolean | null = null;
      if (!uncertain && team) {
        clutchAttempt = false;
        const alive = new Set(roster.map(([id]) => id));
        for (const k of kills) {
          alive.delete(k.victim);
          const mates = [...alive].filter((id) => match.teams.get(id) === team);
          const foes = [...alive].filter((id) => match.teams.get(id) !== team);
          if (mates.length === 1 && mates[0] === participant && foes.length > 0) { clutchAttempt = true; break; }
        }
      }
      const teamWon = round.winningTeam && team ? round.winningTeam === team : null;
      const sitesSeen = new Set<string>(); let snapshots = 0; let classified = 0; let abstained = 0; let postPlantAtSite = false;
      const tookFirstDuel = first !== undefined && (first.killer === participant || first.victim === participant);
      let firstDuelContext: string | null = tookFirstDuel ? 'UNKNOWN' : null;
      for (const k of kills) for (const s of k.snapshots) {
        if (s.participant !== participant) continue;
        snapshots += 1;
        const c = sites.classify(match.map, s.x, s.y);
        if (tookFirstDuel && k === first) firstDuelContext = c.status === 'proximal' ? c.site : 'OTHER';
        if (c.status === 'proximal') {
          classified += 1; sitesSeen.add(c.site);
          if (round.plantTimeMs !== undefined && k.t > round.plantTimeMs && round.plantSite === c.site) postPlantAtSite = true;
        } else abstained += 1;
      }
      out.push({ memberId, matchId: match.matchId, playedAt: match.playedAt, map: match.map, round: round.number, side, role: agentRoles[agent], agent,
        firstKill: first?.killer === participant, firstDeath: first?.victim === participant, tradeKill,
        assists: opponent.filter((k) => k.assistants.includes(participant)).length, died: kills.some((k) => k.victim === participant), teamWon,
        planted: round.planter === participant, plantedSite: round.planter === participant ? round.plantSite ?? null : null, roundPlantSite: round.plantSite ?? null,
        clutchAttempt, clutchWin: clutchAttempt === true && teamWon === true,
        siteProximal: [...sitesSeen].sort(), postPlantAtSite, snapshots, classifiedSnapshots: classified, abstainedSnapshots: abstained, firstDuelContext });
    }
  }
  return out;
}
