import { describe, expect, it } from 'vitest';
import { BASIC_PLAYER_STATS_ALGORITHM, computeBasicPlayerStats, summarizeObservations } from '@vsa/analytics';
import { DEMO_CONSENTS, DEMO_GROUP, DEMO_MEMBERS } from '@vsa/collector';
import { buildPublicSnapshot, deriveSnapshotId, ExportPopulationError, publicMemberId, type ExportInput } from '@vsa/exporter';
import { PrivacyViolation } from '@vsa/privacy';
import { FAKE_MATCHES, normalizeFakeMatch, PRIVATE_FIXTURE_MARKERS } from '@vsa/source-adapters/fake';
import { demoProduct, demoResolver, OBSERVED_AT } from './helpers.ts';

function demoInput(overrides: Partial<ExportInput> = {}): ExportInput {
  const matches = FAKE_MATCHES.map((p) => normalizeFakeMatch(p, demoResolver, OBSERVED_AT));
  const ids = DEMO_MEMBERS.map((m) => m.memberId);
  return {
    group: DEMO_GROUP, members: DEMO_MEMBERS, consents: DEMO_CONSENTS, analysis: computeBasicPlayerStats(matches, ids),
    algorithms: [{ algorithmId: BASIC_PLAYER_STATS_ALGORITHM, description: 'basic' }], observations: summarizeObservations(matches, ids),
    provenanceSummary: 'test provenance', product: demoProduct(overrides.consents ?? DEMO_CONSENTS), ...overrides,
  };
}
const doc = (snapshot: ReturnType<typeof buildPublicSnapshot>, kind: string) => JSON.parse(snapshot.files.find((f) => f.kind === kind)!.content);

describe('public exporter', () => {
  it('publishes only members with BOTH group-visibility and public-derived-analytics consent', () => {
    const consents = DEMO_CONSENTS.map((c) => (c.memberId === 'member-rook' ? { ...c, groupVisibilityAllowed: false } : c));
    const snap = buildPublicSnapshot(demoInput({ consents }));
    const names = doc(snap, 'group').members.map((m: { displayName: string }) => m.displayName);
    expect(names.sort()).toEqual(['Juno', 'Kite', 'Nova', 'Sol', 'Vex']); // Pike: no public consent; Rook: no visibility
    for (const kind of ['analytics', 'players']) expect(doc(snap, kind).players).toHaveLength(5);
    expect(doc(snap, 'profiles').profiles).toHaveLength(5);
    const pid = (m: string) => publicMemberId('group-demo', m);
    const text = snap.files.map((f) => f.content).join(String.fromCharCode(10));
    for (const hidden of ['member-rook', 'member-pike']) expect(text).not.toContain(pid(hidden));
  });

  it('emits no internal or provider identifiers, refs or coordinates', () => {
    const text = buildPublicSnapshot(demoInput()).files.map((f) => f.content).join('\n');
    for (const marker of [...PRIVATE_FIXTURE_MARKERS, 'member-', 'account-', 'group-demo', 'cm_', 'locationX', 'viewRadians', 'providerRecordRef']) expect(text).not.toContain(marker);
    expect(text).toContain(publicMemberId('group-demo', 'member-nova'));
    expect(doc(buildPublicSnapshot(demoInput()), 'group').provenance).toEqual({ historyCompleteness: 'provider-visible', lifetimeComplete: false, summary: 'test provenance' });
  });

  it('is deterministic and content-addressed (no wall clock in the identity)', () => {
    const a = buildPublicSnapshot(demoInput()); const b = buildPublicSnapshot(demoInput());
    expect(a).toEqual(b);
    expect(a.snapshotId).toBe(deriveSnapshotId(a.files));
    expect(a.snapshotId).toMatch(/^ps1-[0-9a-f]{16}$/u);
    const changed = buildPublicSnapshot(demoInput({ provenanceSummary: 'different' }));
    expect(changed.snapshotId).not.toBe(a.snapshotId);
  });

  it('rejects private fields accidentally attached to internal analysis objects', () => {
    for (const leak of ['puuid', 'locationX', 'viewRadians', 'matchIdRaw', 'accessToken']) {
      const input = demoInput();
      const p = input.analysis.players[0]!;
      const tampered = { ...input, analysis: { ...input.analysis, players: [{ ...p, metrics: { ...p.metrics, [leak]: 'x' } }, ...input.analysis.players.slice(1)] } };
      expect(() => buildPublicSnapshot(tampered as ExportInput)).toThrow(PrivacyViolation);
    }
    const input = demoInput(); const p = input.analysis.players[0]!;
    expect(() => buildPublicSnapshot({ ...input, analysis: { ...input.analysis, players: [{ ...p, sampleSize: { ...p.sampleSize, refreshToken: 't' } as never }] } })).toThrow(PrivacyViolation);
  });

  it('refuses product analytics computed over a population that includes a withheld member', () => {
    const everyone = demoProduct(DEMO_CONSENTS.map((c) => ({ ...c, publicDerivedAnalyticsAllowed: true })));
    expect(() => buildPublicSnapshot(demoInput({ product: everyone }))).toThrow(ExportPopulationError);
  });

  it('dataAsOf is the latest observed match start of a published member (data-derived)', () => {
    const snap = buildPublicSnapshot(demoInput());
    const latest = demoInput().observations.filter((o) => o.memberId !== 'member-pike').map((o) => o.lastObservedAt!).sort().at(-1);
    expect(doc(snap, 'group').dataAsOf).toBe(latest);
  });
});
