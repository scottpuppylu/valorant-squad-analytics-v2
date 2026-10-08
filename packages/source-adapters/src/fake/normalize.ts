import { CanonicalMatch } from '@vsa/contracts/canonical';
import type { GameMode } from '@vsa/contracts/common';
import { CANONICAL_SCHEMA_VERSION } from '@vsa/contracts/versions';
import type { IdentityResolver } from '../adapter.ts';
import { canonicalMatchKey } from '../keys.ts';
import type { FakeMatchPayload } from './payload.ts';

export { canonicalMatchKey } from '../keys.ts';
export const FAKE_PROVIDER_ID = 'fake';
export const FAKE_PROVIDER_VERSION = 'fake-provider-v1';
export const FAKE_NORMALIZER_VERSION = 'fake-normalizer-v2';

const MODE: Record<FakeMatchPayload['queue'], GameMode> = { competitive: 'competitive', unrated: 'unrated', deathmatch: 'deathmatch' };
const TEAM_KEY = { blue: 'team-1', red: 'team-2' } as const;
const none = { status: 'missing' as const, ability1: null, ability2: null, grenade: null, ultimate: null };
const noEconomy = { status: 'missing' as const, loadoutValueTotal: null, loadoutValueAverage: null, spentTotal: null, spentAverage: null };

/** Fake payload → CanonicalMatch. The only place fake provider field names are interpreted. */
export function normalizeFakeMatch(payload: FakeMatchPayload, resolveIdentity: IdentityResolver, observedAt: string): CanonicalMatch {
  const participantKey = new Map(payload.players.map((p, i) => [p.fakePuuid, `p${String(i + 1).padStart(2, '0')}`]));
  const keyOf = (puuid: string) => {
    const key = participantKey.get(puuid);
    if (!key) throw new Error('kill log references an unknown participant');
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
    season: { key: null, ref: null },
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
        stats: { status: 'observed', kills: p.k, deaths: p.d, assists: p.a, score: null, damageDealt: p.dmg, damageReceived: null, headshots: null, bodyshots: null, legshots: null },
        abilityCasts: none,
        economy: noEconomy,
      };
    }),
    rounds: payload.roundResults.map((r) => ({
      roundNumber: r.n, winningTeamKey: TEAM_KEY[r.winner], result: null, winningTeamRole: r.winner === r.attacker ? 'attacker' : 'defender',
      attackingTeamKey: TEAM_KEY[r.attacker], sideSource: 'winning_team_role',
      plant: { status: 'missing', participantKey: null, timeInRoundMs: null, site: null, location: null },
      defuse: { status: 'missing', participantKey: null, timeInRoundMs: null, location: null },
      participantsStatus: 'missing', participants: [],
    })),
    events: payload.killLog.map((k, i) => {
      const sequence = sequenceInRound.get(k.round) ?? 0;
      sequenceInRound.set(k.round, sequence + 1);
      return {
        eventKey: `e${String(i + 1).padStart(4, '0')}`, roundNumber: k.round, sequence, timeInRoundMs: k.ms, timeInMatchMs: null, type: 'kill' as const,
        actorParticipantKey: keyOf(k.killerPuuid), targetParticipantKey: keyOf(k.victimPuuid), assistantParticipantKeys: k.assistPuuids.map(keyOf),
        weapon: null,
        location: { x: k.victimPos.px, y: k.victimPos.py },
        playerSnapshots: [{ participantKey: keyOf(k.victimPuuid), location: { x: k.victimPos.px, y: k.victimPos.py }, viewRadians: k.victimPos.facing }],
      };
    }),
  };
  return CanonicalMatch.parse(match);
}
