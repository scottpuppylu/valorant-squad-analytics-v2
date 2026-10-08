import { describe, expect, it } from 'vitest';
import type { CanonicalMatch } from '@vsa/contracts/canonical';
import { CANONICAL_SCHEMA_VERSION } from '@vsa/contracts/versions';
import {
  FakeProviderAdapter, HenrikAdapter, MAX_MATCH_PAGE_SIZE, OverwolfAdapter, ProviderRouter, ProviderUnavailableError, requireCapability, RiotAdapter,
  UnsupportedCapabilityError, type DataProviderAdapter, type ProviderCapability,
} from '@vsa/source-adapters';
import { demoResolver, OBSERVED_AT } from './helpers.ts';

describe('DataProviderAdapter contract', () => {
  it('the fake provider declares exactly what it implements', () => {
    const fake = new FakeProviderAdapter();
    expect([...fake.capabilities()].sort()).toEqual(['IDENTITY', 'MATCH_DETAIL', 'MATCH_HISTORY', 'RANK']);
    expect(() => requireCapability(fake, 'FORWARD_EVENTS', 'getMatch')).toThrow(UnsupportedCapabilityError);
  });

  it('skeleton adapters declare no capabilities and expose no operations (no network, no keys)', () => {
    for (const adapter of [new HenrikAdapter(), new RiotAdapter(), new OverwolfAdapter()]) {
      expect(adapter.capabilities().size).toBe(0);
      for (const [cap, method] of [['IDENTITY', 'resolveAccount'], ['MATCH_HISTORY', 'listMatches'], ['MATCH_DETAIL', 'getMatch'], ['RANK', 'getRankContext']] as const) {
        expect(() => requireCapability(adapter, cap as ProviderCapability, method)).toThrow(UnsupportedCapabilityError);
      }
    }
  });

  it('adapter versions are independent of the canonical schema version', () => {
    for (const adapter of [new FakeProviderAdapter(), new HenrikAdapter(), new RiotAdapter(), new OverwolfAdapter()]) {
      expect(adapter.providerVersion).not.toBe(CANONICAL_SCHEMA_VERSION);
      expect(adapter.providerVersion).toMatch(new RegExp(`^${adapter.providerId}-`, 'u'));
    }
  });

  it('match history pages are bounded and the cursor walks every match exactly once', async () => {
    const fake = new FakeProviderAdapter();
    const ref = (await fake.resolveAccount({ handle: 'Nova#DEMO' })).providerAccountRef;
    expect((await fake.listMatches({ providerAccountRef: ref, cursor: null, limit: 1000 })).matchRefs.length).toBeLessThanOrEqual(MAX_MATCH_PAGE_SIZE);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await fake.listMatches({ providerAccountRef: ref, cursor, limit: 2 });
      seen.push(...page.matchRefs);
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThan(2);
  });
});

describe('ProviderRouter', () => {
  const fail = (providerId: string, error: Error): DataProviderAdapter => ({
    providerId, providerVersion: `${providerId}-test`, capabilities: () => new Set<ProviderCapability>(['MATCH_DETAIL']),
    getMatch: async () => { throw error; },
  });
  const input = { matchRef: 'fake-match-ref-0001', resolveIdentity: demoResolver, observedAt: OBSERVED_AT };

  it('falls back only on ProviderUnavailableError and reports which provider served the evidence', async () => {
    const router = new ProviderRouter([fail('primary', new ProviderUnavailableError('primary', 'down')), new FakeProviderAdapter()]);
    const { match, servedBy } = await router.getMatch(input);
    expect(servedBy).toBe('fake');
    expect(match.source.providerId).toBe('fake');
  });

  it('propagates non-transient errors instead of silently switching sources', async () => {
    const router = new ProviderRouter([fail('primary', new Error('malformed payload')), new FakeProviderAdapter()]);
    await expect(router.getMatch(input)).rejects.toThrow('malformed payload');
  });

  it('never merges: the result is exactly one provider’s canonical match', async () => {
    const router = new ProviderRouter([new FakeProviderAdapter(), new FakeProviderAdapter()]);
    const direct: CanonicalMatch = await new FakeProviderAdapter().getMatch(input);
    expect((await router.getMatch(input)).match).toEqual(direct);
  });
});
