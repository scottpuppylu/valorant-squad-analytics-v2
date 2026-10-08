import { describe, expect, it } from 'vitest';
import { CanonicalMatch } from '@vsa/contracts/canonical';
import { CANONICAL_SCHEMA_VERSION } from '@vsa/contracts/versions';
import { canonicalMatchKey, FAKE_MATCHES, normalizeFakeMatch } from '@vsa/source-adapters/fake';
import { demoResolver, OBSERVED_AT } from './helpers.ts';

const keysOf = (value: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { out.add(k); keysOf(v, out); }
  return out;
};

describe('fake payload → canonical normalization', () => {
  const payload = FAKE_MATCHES[0]!;
  const match = normalizeFakeMatch(payload, demoResolver, OBSERVED_AT);

  it('produces a valid canonical match with explicit versions and provenance', () => {
    expect(CanonicalMatch.parse(match)).toEqual(match);
    expect(match.schemaVersion).toBe(CANONICAL_SCHEMA_VERSION);
    expect(match.source).toEqual({ providerId: 'fake', providerVersion: 'fake-provider-v1', normalizerVersion: 'fake-normalizer-v2', providerRecordRef: payload.fakeMatchId, observedAt: OBSERVED_AT,
      acquisition: 'provider-adapter', acquisitionSource: 'fake-provider' });
    expect(match.evidence.historyCompleteness).toBe('provider-visible');
  });

  it('uses a derived provider-neutral key and no provider field names', () => {
    expect(match.matchKey).toBe(canonicalMatchKey('fake', payload.fakeMatchId));
    expect(match.matchKey).not.toContain(payload.fakeMatchId);
    const keys = keysOf(match);
    for (const providerField of ['fakePuuid', 'fakeMatchId', 'killLog', 'roundResults', 'victimPos', 'px', 'py', 'facing', 'dmg', 'side']) expect(keys.has(providerField)).toBe(false);
    expect(match.teams.map((t) => t.teamKey)).toEqual(['team-1', 'team-2']);
  });

  it('maps tracked participants to internal ids and never carries provider account ids', () => {
    const tracked = match.participants.filter((p) => p.memberId !== null);
    expect(tracked).toHaveLength(4);
    for (const p of tracked) expect(p.accountId).toMatch(/^account-/u);
    expect(match.participants.filter((p) => p.memberId === null)).toHaveLength(6);
    expect(JSON.stringify(match)).not.toContain('fake-puuid-');
  });

  it('keeps raw spatial evidence only in the private canonical event', () => {
    expect(match.events.length).toBeGreaterThan(0);
    expect(match.events.every((e) => e.location !== null && Number.isFinite(e.location.x) && e.playerSnapshots.length === 1)).toBe(true);
  });

  it('maps modes and preserves damage-evidence completeness', () => {
    expect(normalizeFakeMatch(FAKE_MATCHES[4]!, demoResolver, OBSERVED_AT).mode).toBe('unrated');
    const noDamage = normalizeFakeMatch(FAKE_MATCHES[9]!, demoResolver, OBSERVED_AT);
    expect(noDamage.evidence).toMatchObject({ hasDamage: false, evidenceQuality: 'partial', rounds: 'observed', kills: 'observed' });
    expect(noDamage.participants.every((p) => p.stats.damageDealt === null)).toBe(true);
  });

  it('treats unknown accounts as untracked (no identity is invented)', () => {
    const none = normalizeFakeMatch(payload, () => null, OBSERVED_AT);
    expect(none.participants.every((p) => p.memberId === null && p.accountId === null)).toBe(true);
  });
});
