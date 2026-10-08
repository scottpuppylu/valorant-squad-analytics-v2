import { createHash } from 'node:crypto';
import { CanonicalMatch } from '@vsa/contracts/canonical';
import type { GameMode } from '@vsa/contracts/common';
import { CANONICAL_SCHEMA_VERSION } from '@vsa/contracts/versions';
import type { IdentityResolver } from '../adapter.ts';
import type { FakeMatchPayload } from './payload.ts';

export const FAKE_PROVIDER_ID = 'fake';
export const FAKE_PROVIDER_VERSION = 'fake-provider-v1';
export const FAKE_NORMALIZER_VERSION = 'fake-normalizer-v1';

/** Provider-neutral canonical key: derived from (provider, provider record), so it never IS the provider's id. */
export function canonicalMatchKey(providerId: string, providerRecordRef: string): string {
  return `cm_${createHash('sha256').update(`canonical-match-key-v1:${providerId}:${providerRecordRef}`).digest('hex').slice(0, 24)}`;
}

const MODE: Record<FakeMatchPayload['queue'], GameMode> = { competitive: 'competitive', unrated: 'unrated', deathmatch: 'other' };
const TEAM_KEY = { blue: 'team-1', red: 'team-2' } as const;

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
  const match = {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    matchKey: canonicalMatchKey(FAKE_PROVIDER_ID, payload.fakeMatchId),
    source: { providerId: FAKE_PROVIDER_ID, providerVersion: FAKE_PROVIDER_VERSION, normalizerVersion: FAKE_NORMALIZER_VERSION, providerRecordRef: payload.fakeMatchId, observedAt },
    evidence: { historyCompleteness: 'provider-visible', evidenceQuality: hasDamage ? 'complete' : 'partial', hasRounds: payload.roundResults.length > 0, hasEvents: payload.killLog.length > 0, hasDamage },
    mapId: payload.map.code,
    mapName: payload.map.label,
    mode: MODE[payload.queue],
    startedAt: new Date(payload.startedAtEpochMs).toISOString(),
    durationSeconds: payload.lengthSeconds,
    teams: [
      { teamKey: TEAM_KEY.blue, roundsWon: payload.score.blue, won: blueWon },
      { teamKey: TEAM_KEY.red, roundsWon: payload.score.red, won: blueWon === null ? null : !blueWon },
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
        stats: { kills: p.k, deaths: p.d, assists: p.a, damageDealt: p.dmg, score: null },
      };
    }),
    rounds: payload.roundResults.map((r) => ({ roundNumber: r.n, winningTeamKey: TEAM_KEY[r.winner], attackingTeamKey: TEAM_KEY[r.attacker] })),
    events: payload.killLog.map((k, i) => ({
      eventKey: `e${String(i + 1).padStart(4, '0')}`,
      roundNumber: k.round,
      timeInRoundMs: k.ms,
      type: 'kill' as const,
      actorParticipantKey: keyOf(k.killerPuuid),
      targetParticipantKey: keyOf(k.victimPuuid),
      assistantParticipantKeys: k.assistPuuids.map(keyOf),
      spatial: { locationX: k.victimPos.px, locationY: k.victimPos.py, viewRadians: k.victimPos.facing },
    })),
    rankContextRefs: [],
  };
  return CanonicalMatch.parse(match);
}
