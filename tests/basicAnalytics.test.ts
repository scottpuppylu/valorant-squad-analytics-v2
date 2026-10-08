import { describe, expect, it } from 'vitest';
import { BASIC_PLAYER_STATS_ALGORITHM, computeBasicPlayerStats } from '@vsa/analytics';
import { AnalysisResult } from '@vsa/contracts/analysis';
import type { CanonicalMatch } from '@vsa/contracts/canonical';
import type { GameMode } from '@vsa/contracts/common';
import { FAKE_MATCHES, normalizeFakeMatch } from '@vsa/source-adapters/fake';
import { demoResolver, OBSERVED_AT } from './helpers.ts';

let seq = 0;
function mk(opts: { mode?: GameMode; won?: boolean | null; rounds?: [number, number]; players: { memberId: string | null; team?: 1 | 2; k: number; d: number; a: number; dmg: number | null }[] }): CanonicalMatch {
  seq += 1;
  const [r1, r2] = opts.rounds ?? [13, 7];
  const won = opts.won === undefined ? r1 > r2 : opts.won;
  return {
    schemaVersion: 'canonical-schema-v1', matchKey: `cm_${seq.toString(16).padStart(24, '0')}`,
    source: { providerId: 'test', providerVersion: 'test-v1', normalizerVersion: 'test-n1', providerRecordRef: `r${seq}`, observedAt: OBSERVED_AT },
    evidence: { historyCompleteness: 'provider-visible', evidenceQuality: 'basic', hasRounds: false, hasEvents: false, hasDamage: opts.players.every((p) => p.dmg !== null) },
    mapId: 'map-a', mapName: 'A', mode: opts.mode ?? 'competitive', startedAt: new Date(Date.UTC(2026, 0, 1) + seq * 3_600_000).toISOString(), durationSeconds: null,
    teams: [{ teamKey: 'team-1', roundsWon: r1, won }, { teamKey: 'team-2', roundsWon: r2, won: won === null ? null : !won }],
    participants: opts.players.map((p, i) => ({ participantKey: `p${i}`, teamKey: `team-${p.team ?? 1}`, memberId: p.memberId, accountId: null, agentId: null, agentName: null,
      stats: { kills: p.k, deaths: p.d, assists: p.a, damageDealt: p.dmg, score: null } })),
    rounds: [], events: [], rankContextRefs: [],
  };
}

const other = { memberId: null, team: 2 as const, k: 1, d: 1, a: 0, dmg: 100 };

describe('basic-player-stats-v1', () => {
  it('K/D is kills/deaths and null (never 0 or ∞) without deaths', () => {
    const result = computeBasicPlayerStats([mk({ players: [{ memberId: 'member-a', k: 10, d: 0, a: 2, dmg: 1500 }, other] })], ['member-a']);
    expect(result.players[0]!.metrics.kd).toBeNull();
    expect(result.players[0]!.explanation.join(' ')).toContain('no deaths');
  });

  it('ADR is round-weighted over matches WITH damage evidence only', () => {
    const matches = [
      mk({ rounds: [13, 7], players: [{ memberId: 'member-a', k: 10, d: 10, a: 0, dmg: 3000 }, other] }), // 20 rounds
      mk({ rounds: [13, 11], players: [{ memberId: 'member-a', k: 5, d: 10, a: 0, dmg: 2400 }, other] }), // 24 rounds
      mk({ rounds: [13, 0], players: [{ memberId: 'member-a', k: 9, d: 1, a: 0, dmg: null }, other] }), // excluded from ADR
    ];
    const m = computeBasicPlayerStats(matches, ['member-a']).players[0]!.metrics;
    expect(m.adr).toBeCloseTo((3000 + 2400) / (20 + 24), 12);
    expect(m.kd).toBeCloseTo(24 / 21, 12);
    expect(computeBasicPlayerStats([matches[2]!], ['member-a']).players[0]!.metrics.adr).toBeNull();
  });

  it('is Competitive-only, counts wins/losses from the member team and draws as neither', () => {
    const matches = [
      mk({ won: true, players: [{ memberId: 'member-a', k: 1, d: 1, a: 1, dmg: 100 }, other] }),
      mk({ won: false, rounds: [7, 13], players: [{ memberId: 'member-a', k: 1, d: 1, a: 1, dmg: 100 }, other] }),
      mk({ won: null, rounds: [12, 12], players: [{ memberId: 'member-a', k: 1, d: 1, a: 1, dmg: 100 }, other] }),
      mk({ mode: 'unrated', players: [{ memberId: 'member-a', k: 50, d: 1, a: 1, dmg: 9999 }, other] }),
    ];
    const r = computeBasicPlayerStats(matches, ['member-a']);
    expect(r.matchesConsidered).toBe(3);
    expect(r.players[0]!.metrics).toMatchObject({ matchesPlayed: 3, wins: 1, losses: 1, kills: 3 });
  });

  it('withholds a match where one member appears twice instead of summing', () => {
    const r = computeBasicPlayerStats([mk({ players: [{ memberId: 'member-a', k: 5, d: 1, a: 0, dmg: 1 }, { memberId: 'member-a', k: 5, d: 1, a: 0, dmg: 1 }, other] })], ['member-a']);
    expect(r.players[0]!.metrics.matchesPlayed).toBe(0);
    expect(r.players[0]!.eligibility).toEqual({ eligible: false, reasons: expect.arrayContaining([expect.stringContaining('withheld')]) });
  });

  it('reports sample size and eligibility; output validates against the analytics contract', () => {
    const r = computeBasicPlayerStats([mk({ players: [{ memberId: 'member-a', k: 3, d: 2, a: 1, dmg: 500 }, other] })], ['member-b', 'member-a']);
    expect(AnalysisResult.parse(r)).toEqual(r);
    expect(r.players.map((p) => p.memberId)).toEqual(['member-a', 'member-b']); // deterministic order
    expect(r.players[0]).toMatchObject({ algorithmId: BASIC_PLAYER_STATS_ALGORITHM, sampleSize: { matches: 1, rounds: 20 }, eligibility: { eligible: true } });
    expect(r.players[1]!.eligibility).toEqual({ eligible: false, reasons: ['no competitive matches'] });
  });

  it('matches an independent oracle computed straight from the fixture payloads', () => {
    const canonical = FAKE_MATCHES.map((p) => normalizeFakeMatch(p, demoResolver, OBSERVED_AT));
    const r = computeBasicPlayerStats(canonical, ['member-nova']).players[0]!.metrics;
    const mine = FAKE_MATCHES.filter((m) => m.queue === 'competitive').flatMap((m) => m.players.filter((p) => p.fakePuuid === 'fake-puuid-0001-nova').map((p) => ({ m, p })));
    const kills = mine.reduce((s, x) => s + x.p.k, 0); const deaths = mine.reduce((s, x) => s + x.p.d, 0);
    const dmgRows = mine.filter((x) => x.p.dmg !== null);
    expect(r.matchesPlayed).toBe(mine.length);
    expect(r.kd).toBeCloseTo(kills / deaths, 12);
    expect(r.adr).toBeCloseTo(dmgRows.reduce((s, x) => s + x.p.dmg!, 0) / dmgRows.reduce((s, x) => s + x.m.score.red + x.m.score.blue, 0), 12);
    expect(r.wins).toBe(mine.filter((x) => x.m.score[x.p.side] > x.m.score[x.p.side === 'blue' ? 'red' : 'blue']).length);
  });
});
