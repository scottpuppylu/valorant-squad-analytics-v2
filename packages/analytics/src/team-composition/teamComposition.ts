import type { CanonicalMatch } from '@vsa/contracts/canonical';
import { EventMetricEngine } from '../event/eventMetricEngine.ts';
import { projectMatchView } from '../event/matchView.ts';
import type { MatchRecord } from '../event/matchViewTypes.ts';
import { isAbsoluteStrengthMode } from '../strength/modeEligibility.ts';
import { buildObservations } from './observations.ts';
import { recommendTeamComposition, TeamCompositionModel, type TeamCompositionResult } from './recommend.ts';
import { memberRounds, type MatchInput } from './sideEvidence.ts';
import { SiteReference, type PlantPoint } from './siteReference.ts';
import { refineTeamComposition, SideModel, type TeamCompositionV2Result } from './v2.ts';

/**
 * team-composition-v1 (assignment, Team Fit, confidence, alternatives) and the team-composition-v2 responsibility layer
 * over canonical matches — the accepted pipeline of the legacy `npm run team-composition` (demo / v2):
 *  - observations: Competitive matches projected with the canonical engine (event-metrics-v2) — team-observation-v1;
 *  - V1 model: map evidence as CONTEXT; pair synergy (duo-synergy-v1) is NOT ported in this wave → reported as no
 *    evidence (it is never scored, so assignment / Team Fit / confidence are unaffected);
 *  - V2: site-reference-v1 from every projected match's provider-labelled plants (PRIVATE raw space), side-evidence-v1
 *    member rounds over Competitive matches, V2_VALIDATION gate (site tendencies withheld).
 * Positions are read here, privately, and never leave as anything but validated labels.
 */
export interface TeamCompositionEngine {
  model: TeamCompositionModel;
  sideModel: SideModel;
  maps: string[];
  recommend(memberIds: readonly string[], map: string): { v1: TeamCompositionResult; v2: TeamCompositionV2Result | null };
}

/** Canonical match + its projected view → side-evidence-v1 input (undefined stays undefined, never 0 or ''). */
export function sideMatchInput(canonical: CanonicalMatch, view: MatchRecord): MatchInput {
  const agentOf = new Map(view.performances.map((p) => [p.playerId, p.agent]));
  return {
    matchId: view.id, playedAt: view.playedAt, map: view.map, mode: view.gameMode,
    teams: new Map(canonical.participants.map((p) => [p.participantKey, p.teamKey])),
    members: new Map(canonical.participants.filter((p) => p.memberId !== null).map((p) => [p.participantKey, { memberId: p.memberId!, agent: agentOf.get(p.memberId!) ?? 'Unknown' }])),
    rounds: canonical.rounds.map((r) => ({
      number: r.roundNumber,
      ...(r.winningTeamKey ? { winningTeam: r.winningTeamKey } : {}),
      ...(r.attackingTeamKey ? { attackingTeamKey: r.attackingTeamKey } : {}),
      ...(r.plant.site ? { plantSite: r.plant.site } : {}),
      ...(r.plant.timeInRoundMs !== null ? { plantTimeMs: r.plant.timeInRoundMs } : {}),
      ...(r.plant.participantKey ? { planter: r.plant.participantKey } : {}),
      kills: canonical.events.filter((e) => e.roundNumber === r.roundNumber && e.type === 'kill').map((e) => ({
        t: e.timeInRoundMs, killer: e.actorParticipantKey, victim: e.targetParticipantKey, assistants: e.assistantParticipantKeys,
        snapshots: e.playerSnapshots.map((s) => ({ participant: s.participantKey, x: s.location.x, y: s.location.y })),
      })),
    })),
  };
}

export function buildTeamCompositionEngine(matches: readonly CanonicalMatch[]): TeamCompositionEngine {
  const engine = new EventMetricEngine();
  const projected = matches.flatMap((canonical) => { const r = projectMatchView(canonical, engine); return r.kind === 'projected' ? [{ canonical, view: r.match }] : []; })
    .sort((a, b) => a.view.playedAt.localeCompare(b.view.playedAt) || (a.view.id < b.view.id ? -1 : 1));
  const views = projected.map((x) => x.view);
  const observations = buildObservations(views);
  const model = new TeamCompositionModel(observations);
  const plants: PlantPoint[] = projected.flatMap(({ canonical, view }) => canonical.rounds.flatMap((r) => (r.plant.site && r.plant.location
    ? [{ map: view.map, site: r.plant.site, x: r.plant.location.x, y: r.plant.location.y }] : [])));
  const sites = new SiteReference(plants, 'p95');
  const rounds = projected.filter(({ view }) => isAbsoluteStrengthMode(view.gameMode)).flatMap(({ canonical, view }) => memberRounds(sideMatchInput(canonical, view), sites));
  const sideModel = new SideModel(rounds);
  const maps = [...new Set(observations.map((o) => o.map))].sort();
  return {
    model, sideModel, maps,
    recommend(memberIds, map) {
      const v1 = recommendTeamComposition({ memberIds, map }, model);
      return { v1, v2: refineTeamComposition(v1, sideModel) };
    },
  };
}
