import { describe, expect, it } from 'vitest';
import { FakeProviderAdapter } from '@vsa/source-adapters';
import { FAKE_ACCOUNTS, FAKE_MATCHES } from '@vsa/source-adapters/fake';
import { demoResolver, OBSERVED_AT } from './helpers.ts';

describe('FakeProviderAdapter fixtures', () => {
  it('are synthetic and shaped as specified: 7 accounts, 72 matches over two acts, 5 maps, 3 modes', () => {
    expect(FAKE_ACCOUNTS).toHaveLength(7);
    expect(FAKE_MATCHES).toHaveLength(72);
    expect(new Set(FAKE_MATCHES.map((m) => m.queue))).toEqual(new Set(['competitive', 'unrated', 'swiftplay']));
    expect(new Set(FAKE_MATCHES.map((m) => m.map.code)).size).toBe(5);
    expect(new Set(FAKE_MATCHES.map((m) => m.act))).toEqual(new Set(['v26a4', 'v26a5']));
    for (const a of FAKE_ACCOUNTS) expect(a.handle).toMatch(/#DEMO$/u);
  });

  it('are internally consistent: round wins sum to the score; stats equal the kill log; eliminations kill all five', () => {
    for (const m of FAKE_MATCHES) {
      expect(m.rounds.filter((r) => r.winner === 'blue')).toHaveLength(m.score.blue);
      expect(m.rounds.filter((r) => r.winner === 'red')).toHaveLength(m.score.red);
      for (const p of m.players) {
        expect(p.k).toBe(m.killLog.filter((k) => k.killerPuuid === p.fakePuuid && k.victimPuuid !== p.fakePuuid).length);
        expect(p.d).toBe(m.killLog.filter((k) => k.victimPuuid === p.fakePuuid).length);
      }
      for (const r of m.rounds) {
        const loser = r.winner === 'blue' ? 'red' : 'blue';
        const loserDeaths = m.killLog.filter((k) => k.round === r.n && m.players.find((p) => p.fakePuuid === k.victimPuuid)!.side === loser).length;
        if (r.how === 'Elimination') expect(loserDeaths).toBe(5);
        if (r.how === 'Bomb defused') expect(r.plant && r.defuse).toBeTruthy();
        if (r.plant) expect(m.players.find((p) => p.fakePuuid === r.plant!.puuid)!.side).toBe(r.attacker);
        for (const k of m.killLog.filter((x) => x.round === r.n)) expect(k.seen.every((s) => s.puuid !== k.victimPuuid)).toBe(true);
      }
    }
  });

  it('is deterministic: two adapter instances produce identical canonical matches', async () => {
    const [a, b] = [new FakeProviderAdapter(), new FakeProviderAdapter()];
    for (const m of FAKE_MATCHES) {
      const input = { matchRef: m.fakeMatchId, resolveIdentity: demoResolver, observedAt: OBSERVED_AT };
      expect(JSON.stringify(await a.getMatch(input))).toBe(JSON.stringify(await b.getMatch(input)));
    }
  });

  it('serves rank context as context with provenance (never a score): match-time snapshots plus a current row', async () => {
    const ctx = await new FakeProviderAdapter().getRankContext({ providerAccountRef: FAKE_ACCOUNTS[0]!.fakePuuid, memberId: 'member-nova', accountId: 'account-nova', observedAt: OBSERVED_AT });
    expect(ctx.filter((c) => c.kind === 'current')).toEqual([expect.objectContaining({ kind: 'current', providerId: 'fake', memberId: 'member-nova', matchKey: null })]);
    const snaps = ctx.filter((c) => c.kind === 'match-snapshot');
    expect(snaps.length).toBeGreaterThan(30);
    for (const s of snaps) expect(s.matchKey).toMatch(/^cm_/u);
    expect(ctx.every((c) => c.providerElo === null)).toBe(true);
    // an account without a tier has no rank evidence at all (the product shows "unknown", never a guess)
    expect(await new FakeProviderAdapter().getRankContext({ providerAccountRef: FAKE_ACCOUNTS[4]!.fakePuuid, memberId: 'member-juno', accountId: 'account-juno', observedAt: OBSERVED_AT })).toEqual([]);
  });
});
