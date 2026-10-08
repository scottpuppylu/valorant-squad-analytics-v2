import { CanonicalMatch } from '@vsa/contracts/canonical';
import type { GameMode } from '@vsa/contracts/common';
import { CANONICAL_SCHEMA_VERSION } from '@vsa/contracts/versions';
import type { IdentityResolver } from '../adapter.ts';
import { canonicalMatchKey } from '../keys.ts';
import type { FakeMatchPayload, FakePos } from './payload.ts';

export { canonicalMatchKey } from '../keys.ts';
export const FAKE_PROVIDER_ID = 'fake';
export const FAKE_PROVIDER_VERSION = 'fake-provider-v2';
export const FAKE_NORMALIZER_VERSION = 'fake-normalizer-v3';

const MODE: Record<FakeMatchPayload['queue'], GameMode> = { competitive: 'competitive', unrated: 'unrated', swiftplay: 'swiftplay' };
const TEAM_KEY = { blue: 'team-1', red: 'team-2' } as const;
const point = (p: FakePos) => ({ x: p.px, y: p.py });

/** Fake payload → CanonicalMatch. The only place fake provider field names are interpreted. */
export function normalizeFakeMatch(payload: FakeMatchPayload, resolveIdentity: IdentityResolver, observedAt: string): CanonicalMatch {
  const participantKey = new Map(payload.players.map((p, i) => [p.fakePuuid, `p${String(i + 1).padStart(2, '0')}`]));
  const keyOf = (puuid: string) => {
    const key = participantKey.get(puuid);
    if (!key) throw new Error('fake payload references an unknown participant');
    return key;
  };
  const blueWon = payload.score.blue > payload.score.red ? true : payload.score.blue < payload.score.red ? false : null;
  const hasDamage = payload.players.every((p) => p.dmg !== null);
  const sequenceInRound = new Map<number, number>();
  const match = {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    matchKey: canonicalMatchKey(FAKE_PROVIDER_ID, payload.fakeMatchId),
    source: { providerId: FAKE_PROVIDER_ID, providerVersion: FAKE_PROVIDER_VERSION, normalizerVersion: FAKE_NORMALIZER_VERSION, providerRecordRef: payload.fakeMatchId,
      observedAt, acquisition: 'provider-adapter', acquisitionSource: 'fake-provider' },
    evidence: { historyCompleteness: 'provider-visible', evidenceQuality: hasDamage ? 'complete' : 'partial', rounds: 'observed', kills: 'observed', hasDamage, hasPositions: true },
    mapId: payload.map.code,
    mapName: payload.map.label,
    mode: MODE[payload.queue],
    queue: { id: payload.queue, name: payload.queue },
    season: { key: payload.act, ref: null },
    startedAt: new Date(payload.startedAtEpochMs).toISOString(),
    durationMs: payload.lengthSeconds * 1000,
    teams: [
      { teamKey: TEAM_KEY.blue, roundsWon: payload.score.blue, roundsLost: payload.score.red, won: blueWon },
      { teamKey: TEAM_KEY.red, roundsWon: payload.score.red, roundsLost: payload.score.blue, won: blueWon === null ? null : !blueWon },
    ],
    participants: payload.players.map((p) => {
      const identity = resolveIdentity(p.fakePuuid);
      return {
        participantKey: keyOf(p.fakePuuid),
        teamKey: TEAM_KEY[p.side],
        memberId: identity?.memberId ?? null,
        accountId: identity?.accountId ?? null,
        agentId: p.agent.code,
        agentName: p.agent.label,
        stats: { status: 'observed', kills: p.k, deaths: p.d, assists: p.a, score: p.pts, damageDealt: p.dmg, damageReceived: null, headshots: p.head, bodyshots: p.body, legshots: p.leg },
        abilityCasts: { status: 'observed', ability1: p.casts.q, ability2: p.casts.e, grenade: p.casts.c, ultimate: p.casts.x },
        economy: { status: 'observed', loadoutValueTotal: p.econ.buyTotal, loadoutValueAverage: p.econ.buyAvg, spentTotal: p.econ.spentTotal, spentAverage: p.econ.spentAvg },
      };
    }),
    rounds: payload.rounds.map((r) => ({
      roundNumber: r.n, winningTeamKey: TEAM_KEY[r.winner], result: r.how, winningTeamRole: r.winner === r.attacker ? 'attacker' : 'defender',
      attackingTeamKey: TEAM_KEY[r.attacker], sideSource: 'winning_team_role',
      plant: r.plant ? { status: 'present', participantKey: keyOf(r.plant.puuid), timeInRoundMs: r.plant.ms, site: r.plant.site, location: point(r.plant.pos) }
        : { status: 'absent', participantKey: null, timeInRoundMs: null, site: null, location: null },
      defuse: r.defuse ? { status: 'present', participantKey: keyOf(r.defuse.puuid), timeInRoundMs: r.defuse.ms, location: point(r.defuse.pos) }
        : { status: 'absent', participantKey: null, timeInRoundMs: null, location: null },
      participantsStatus: 'observed',
      participants: r.lines.map((l) => ({
        participantKey: keyOf(l.puuid),
        stats: { status: 'observed', kills: l.k, score: l.pts },
        economy: { status: 'observed', loadoutValue: l.buy, remainingCredits: l.bank },
        weapon: { status: 'observed', id: l.gun.code, name: l.gun.label },
        armor: { status: 'missing', id: null, name: null },
      })),
    })),
    events: payload.killLog.map((k, i) => {
      const sequence = sequenceInRound.get(k.round) ?? 0;
      sequenceInRound.set(k.round, sequence + 1);
      return {
        eventKey: `r${k.round}e${sequence}`, roundNumber: k.round, sequence, timeInRoundMs: k.ms, timeInMatchMs: (k.round - 1) * 100_000 + k.ms + i, type: 'kill' as const,
        actorParticipantKey: keyOf(k.killerPuuid), targetParticipantKey: keyOf(k.victimPuuid), assistantParticipantKeys: k.assistPuuids.map(keyOf),
        weapon: null,
        location: point(k.victimPos),
        playerSnapshots: k.seen.map((s) => ({ participantKey: keyOf(s.puuid), location: point(s.pos), viewRadians: s.pos.facing })),
      };
    }),
  };
  return CanonicalMatch.parse(match);
}
