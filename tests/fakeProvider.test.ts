import { describe, expect, it } from 'vitest';
import { FakeProviderAdapter } from '@vsa/source-adapters';
import { FAKE_ACCOUNTS, FAKE_MATCHES } from '@vsa/source-adapters/fake';
import { demoResolver, OBSERVED_AT } from './helpers.ts';

describe('FakeProviderAdapter fixtures', () => {
  it('are synthetic and shaped as specified: 6 accounts, 10 matches, 8 competitive, 4 maps', () => {
    expect(FAKE_ACCOUNTS).toHaveLength(6);
    expect(FAKE_MATCHES).toHaveLength(10);
    expect(FAKE_MATCHES.filter((m) => m.queue === 'competitive')).toHaveLength(8);
    expect(new Set(FAKE_MATCHES.map((m) => m.map.code)).size).toBe(4);
    for (const a of FAKE_ACCOUNTS) expect(a.handle).toMatch(/#DEMO$/u);
  });

  it('are internally consistent: round wins sum to the score; stats equal the kill log', () => {
    for (const m of FAKE_MATCHES) {
      expect(m.roundResults.filter((r) => r.winner === 'blue')).toHaveLength(m.score.blue);
      expect(m.roundResults.filter((r) => r.winner === 'red')).toHaveLength(m.score.red);
      expect(m.roundResults).toHaveLength(m.score.blue + m.score.red);
      for (const p of m.players) {
        expect(p.k).toBe(m.killLog.filter((k) => k.killerPuuid === p.fakePuuid).length);
        expect(p.d).toBe(m.killLog.filter((k) => k.victimPuuid === p.fakePuuid).length);
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

  it('serves rank context as context with provenance (never a score)', async () => {
    const ctx = await new FakeProviderAdapter().getRankContext({ providerAccountRef: FAKE_ACCOUNTS[0]!.fakePuuid, memberId: 'member-nova', accountId: 'account-nova', observedAt: OBSERVED_AT });
    expect(ctx).toEqual([expect.objectContaining({ kind: 'current', providerId: 'fake', memberId: 'member-nova' })]);
  });
});
