import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeTier, VALORANT_TIERS } from '@vsa/analytics';
import type { CanonicalMatch } from '@vsa/contracts/canonical';
import { findPrivateKeys } from '@vsa/privacy';
import {
  assertConsistent, FakeProviderAdapter, groupLogicalMatches, healthOfKind, LEGACY_CAPABILITY_ALIASES, MAX_CONCURRENCY, MAX_CONFIGURED_RPM, normalizeTierName, parseCapability,
  PROVIDER_CAPABILITIES, ProviderConflictError, ProviderError, ProviderHealthTracker, ProviderMetrics, ProviderRouter, ProviderUnavailableError, provenanceOf,
  publicProvenance, RateLimiter, relateMatches, RequestBudget, requireCapability, safeLogLine, UnsupportedCapabilityError, type DataProviderAdapter, type FetchLike,
  type ProviderCapability, type ProviderErrorKind,
} from '@vsa/source-adapters';
import {
  HENRIK_ADAPTER_VERSION, HENRIK_MAX_LIVE_REQUESTS, HENRIK_NORMALIZER_VERSION, HenrikAdapter, normalizeHenrikV4Match, type HenrikAdapterConfig,
} from '@vsa/source-adapters/henrik';
import { IMPORT_ARCHIVE_FORMAT, ImportFileAdapter } from '@vsa/source-adapters/import';
import { OverwolfAdapter } from '@vsa/source-adapters/overwolf';
import { RIOT_ACCESS_STATUS, RIOT_DOCUMENTED_CAPABILITIES, RiotAdapter } from '@vsa/source-adapters/riot';
import { mid, payload, pu, UNKNOWN_AGENT } from './legacyFixture.ts';
import { IngestService } from '@vsa/collector';
import { freshDatabase, OBSERVED_AT, seedDemoRoster, withTempDir } from './helpers.ts';

// ---------------------------------------------------------------------------------------------------------------
// Offline harness: a scripted fetch (no network), a fake clock and a no-wait sleep.
const KEY = 'unit-test-key-0000-not-a-real-credential';
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
type Handler = (url: URL, headers: Record<string, string>, signal: AbortSignal) => Response | Promise<Response>;
function scripted(handler: Handler) {
  const calls: { url: URL; headers: Record<string, string> }[] = [];
  const fetchImpl: FetchLike = async (u, init) => { const url = new URL(u); calls.push({ url, headers: init.headers }); return handler(url, init.headers, init.signal); };
  return { fetchImpl, calls };
}
function clock() {
  let t = 1_000_000;
  return { now: () => t, sleep: async (ms: number) => { t += Math.max(0, ms); } };
}
const logLines: string[] = [];
function henrik(fetchImpl: FetchLike, extra: Partial<HenrikAdapterConfig> = {}) {
  const c = clock();
  return new HenrikAdapter({ apiKey: KEY, affinity: 'ap', budget: new RequestBudget(HENRIK_MAX_LIVE_REQUESTS), fetchImpl, maxRetries: 0, now: c.now, sleep: c.sleep,
    log: (line) => logLines.push(line), ...extra });
}
const resolver = (ref: string) => (ref === pu(1) ? { memberId: 'mem-alpha', accountId: 'acc-alpha-1' } : ref === pu(3) ? { memberId: 'mem-bravo', accountId: 'acc-bravo-1' } : null);
const withoutSource = (m: CanonicalMatch) => ({ ...m, source: undefined });

/** Documented Henrik envelopes around the audited synthetic v4 match shape (tests/legacyFixture.ts). */
const MATCH = payload(1);
const MMR = {
  status: 200,
  data: {
    account: { name: 'Fixture', tag: 'TAG', puuid: pu(1) },
    current: { tier: { id: 14, name: 'Gold 3' }, rr: 42, last_change: -18, elo: 1142, games_needed_for_rating: 0 },
    peak: { season: { id: '00000000-0000-4000-9000-000000000500', short: 'e9a3' }, tier: { id: 17, name: 'Diamond 1' }, rr: 10 },
    seasonal: [{ season: { short: 'e9a2' }, end_tier: { id: 12, name: 'Gold 1' }, end_rr: 55 }, { season: { short: 'e9a1' }, end_tier: { id: 99, name: 'Mythic 9' }, end_rr: 1 }],
  },
};
const happy: Handler = (url) => {
  const p = url.pathname;
  if (p.startsWith('/valorant/v2/account/')) return json(200, { status: 200, data: { puuid: pu(1), name: 'Fixture', tag: 'TAG', region: 'ap' } });
  if (p.startsWith('/valorant/v4/by-puuid/matches/')) return json(200, { status: 200, data: [payload(1), payload(2)] });
  if (p.startsWith('/valorant/v4/match/')) return json(200, { status: 200, data: payload(Number(decodeURIComponent(p.split('/').pop()!).slice(-4))) });
  if (p.startsWith('/valorant/v3/by-puuid/mmr/')) return json(200, MMR);
  return json(404, { errors: [{ code: 0, message: 'Not found', status: 404 }] });
};

// ---------------------------------------------------------------------------------------------------------------
describe('capability vocabulary', () => {
  it('is exactly the six provider-capabilities-v1 names; FORWARD_EVENTS maps to FORWARD_LIVE', () => {
    expect([...PROVIDER_CAPABILITIES]).toEqual(['IDENTITY', 'MATCH_HISTORY', 'MATCH_DETAIL', 'RANK', 'FORWARD_LIVE', 'STATIC_CONTENT']);
    expect(LEGACY_CAPABILITY_ALIASES).toEqual({ FORWARD_EVENTS: 'FORWARD_LIVE' });
    expect(parseCapability('FORWARD_EVENTS')).toBe('FORWARD_LIVE');
    expect(parseCapability('RANK')).toBe('RANK');
    expect(() => parseCapability('PAGINATION')).toThrow(RangeError);
  });

  it('each adapter declares only what it implements; Riot and Overwolf are contract-only', async () => {
    const h = henrik(scripted(happy).fetchImpl);
    expect([...h.capabilities()].sort()).toEqual(['IDENTITY', 'MATCH_DETAIL', 'MATCH_HISTORY', 'RANK']);
    expect(h.capabilities().has('FORWARD_LIVE')).toBe(false);
    expect(h.capabilities().has('STATIC_CONTENT')).toBe(false);
    const riot = new RiotAdapter();
    expect(riot.capabilities().size).toBe(0);
    expect([...RIOT_DOCUMENTED_CAPABILITIES]).not.toContain('RANK');
    expect(RIOT_ACCESS_STATUS).toEqual({ productionKeyApproved: false, rsoApproved: false, supportTicket: '139243830', supportResponseReceived: false });
    for (const call of [() => riot.resolveAccount(), () => riot.listMatches(), () => riot.getMatch(), () => riot.getRankContext()]) {
      await expect(call()).rejects.toMatchObject({ kind: 'CAPABILITY_NOT_CONFIGURED', providerId: 'riot' });
    }
    expect(() => requireCapability(riot, 'MATCH_DETAIL', 'getMatch')).toThrow(UnsupportedCapabilityError);
    const overwolf = new OverwolfAdapter();
    expect(overwolf.capabilities().size).toBe(0);
    expect([...overwolf.documentedCapabilities]).toEqual(['FORWARD_LIVE']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('HenrikAdapter (recorded-shape fixtures, offline)', () => {
  it('rejects missing / malformed configuration without echoing values', () => {
    expect(() => new HenrikAdapter({ apiKey: '', affinity: 'ap', budget: new RequestBudget(1) })).toThrow(/api key missing/u);
    expect(() => new HenrikAdapter({ apiKey: KEY, affinity: 'xx' as never, budget: new RequestBudget(1) })).toThrow(/affinity/u);
    expect(() => HenrikAdapter.fromEnvironment({}, { budget: new RequestBudget(1) })).toThrow('HENRIK_API_KEY is not set');
    expect(() => new HenrikAdapter({ apiKey: KEY, affinity: 'ap', budget: new RequestBudget(1), requestsPerMinute: 7 })).toThrow(ProviderError);
    try { new HenrikAdapter({ apiKey: KEY, affinity: 'ap', budget: new RequestBudget(1), baseUrl: 'http://example.com' }); } catch (e) { expect(String(e)).not.toContain(KEY); }
  });

  it('IDENTITY / MATCH_HISTORY / MATCH_DETAIL / RANK use the documented endpoints and the Authorization header only', async () => {
    const s = scripted(happy);
    const h = henrik(s.fetchImpl);
    const account = await h.resolveAccount({ handle: 'Fixture#TAG' });
    expect(account).toEqual({ providerAccountRef: pu(1), handle: 'Fixture#TAG' });
    const page = await h.listMatches({ providerAccountRef: account.providerAccountRef, cursor: null, limit: 1000 });
    expect(page.matchRefs).toEqual([mid(1), mid(2)]);
    expect(page.nextCursor).toBeNull(); // 2 < size 20: partial page = end of the provider-visible list
    expect(page.history).toEqual({ completeness: 'provider-visible', lifetimeComplete: false, pageOffset: 0, pageSize: 20, returned: 2, providerReportedTotal: null });
    const match = await h.getMatch({ matchRef: mid(1), resolveIdentity: resolver, observedAt: OBSERVED_AT });
    const rank = await h.getRankContext({ providerAccountRef: pu(1), memberId: 'mem-alpha', accountId: 'acc-alpha-1', observedAt: OBSERVED_AT });
    expect(rank.map((r) => r.kind)).toEqual(['current', 'peak', 'seasonal', 'seasonal']);
    expect(match.source.providerId).toBe('henrik');

    expect(s.calls.map((c) => c.url.pathname)).toEqual([
      '/valorant/v2/account/Fixture/TAG', `/valorant/v4/by-puuid/matches/ap/pc/${pu(1)}`, `/valorant/v4/match/ap/${mid(1)}`, `/valorant/v3/by-puuid/mmr/ap/pc/${pu(1)}`]);
    expect(s.calls[1]!.url.searchParams.get('size')).toBe('20');
    expect(s.calls[1]!.url.searchParams.get('start')).toBe('0');
    for (const c of s.calls) {
      expect(c.url.origin).toBe('https://api.henrikdev.xyz');
      expect(c.url.searchParams.has('api_key')).toBe(false);
      expect(c.headers.Authorization).toBe(KEY);
    }
    expect(h.budget.used).toBe(4);
  });

  it('MATCH_DETAIL = the accepted v4 normalizer; only the provenance differs from a legacy import of the same record', async () => {
    const h = henrik(scripted(happy).fetchImpl);
    const live = await h.getMatch({ matchRef: mid(1), resolveIdentity: resolver, observedAt: OBSERVED_AT });
    const legacy = normalizeHenrikV4Match(MATCH, { resolveIdentity: resolver, observedAt: OBSERVED_AT, acquisitionSource: 'legacy-rebuild-staging:rebuild-staging-v1' }).match;
    expect(live.matchKey).toBe(legacy.matchKey); // SAME_RECORD: one provider record → one canonical key
    expect(withoutSource(live)).toEqual(withoutSource(legacy));
    expect(legacy.source).toMatchObject({ acquisition: 'legacy-import', normalizerVersion: 'legacy-henrik-v4-import-v1' });
    expect(live.source).toEqual({ providerId: 'henrik', providerVersion: 'henrik-v4', normalizerVersion: HENRIK_NORMALIZER_VERSION, providerRecordRef: mid(1),
      observedAt: OBSERVED_AT, acquisition: 'provider-adapter', acquisitionSource: HENRIK_ADAPTER_VERSION });
    expect(relateMatches(live, legacy)).toEqual({ relation: 'SAME_RECORD', conflicts: [] });
  });

  it('missing fields, unknown agent and unknown / missing mode stay explicit (never zero-filled, never guessed)', async () => {
    const bare = payload(7);
    delete (bare as Record<string, unknown>).rounds;
    delete (bare as Record<string, unknown>).kills;
    const odd = payload(8, { queue: ['newmode', 'Brand New Mode'] });
    const none = payload(9, { queue: ['', ''] });
    const docs: Record<string, Record<string, unknown>> = { [mid(7)]: bare, [mid(8)]: odd, [mid(9)]: none };
    const h = henrik(scripted((url) => json(200, { data: docs[decodeURIComponent(url.pathname.split('/').pop()!)] })).fetchImpl);
    const m7 = await h.getMatch({ matchRef: mid(7), resolveIdentity: resolver, observedAt: OBSERVED_AT });
    expect(m7.evidence).toMatchObject({ rounds: 'missing', kills: 'missing', evidenceQuality: 'basic' });
    expect(m7.rounds).toEqual([]);
    expect(m7.participants.find((p) => p.agentId === UNKNOWN_AGENT)?.agentName).toBe('Unknown'); // kept as observed; analytics decides
    expect((await h.getMatch({ matchRef: mid(8), resolveIdentity: resolver, observedAt: OBSERVED_AT })).mode).toBe('other');
    expect((await h.getMatch({ matchRef: mid(9), resolveIdentity: resolver, observedAt: OBSERVED_AT })).mode).toBe('unknown');
  });

  it('RANK: provider semantics, name-normalized tiers, absence = no rows, unknown tier = null', async () => {
    const h = henrik(scripted(happy).fetchImpl);
    const rows = await h.getRankContext({ providerAccountRef: pu(1), memberId: 'mem-alpha', accountId: 'acc-alpha-1', observedAt: OBSERVED_AT });
    const current = rows.find((r) => r.kind === 'current')!;
    expect(current).toMatchObject({ providerTierId: 14, providerTierName: 'Gold 3', rr: 42, rrChange: -18, providerElo: 1142, normalizedTierKey: 'gold_3', tierOrdinal: 12,
      matchKey: null, effectiveAt: OBSERVED_AT, sourceEndpoint: 'henrik:v3:mmr:current', tierModelVersion: 'valorant-tier-order-v1', queue: 'competitive' });
    expect(rows.find((r) => r.kind === 'peak')).toMatchObject({ normalizedTierKey: 'diamond_1', seasonKey: 'e9a3', matchKey: null });
    expect(rows.filter((r) => r.kind === 'seasonal').map((r) => [r.seasonKey, r.normalizedTierKey])).toEqual([['e9a2', 'gold_1'], ['e9a1', null]]);
    expect(rows.every((r) => !JSON.stringify(r).includes(pu(1)))).toBe(true);
    const absent = henrik(scripted(() => json(200, { status: 200, data: { current: null, peak: null, seasonal: [] } })).fetchImpl);
    expect(await absent.getRankContext({ providerAccountRef: pu(1), memberId: 'mem-alpha', accountId: 'acc-alpha-1', observedAt: OBSERVED_AT })).toEqual([]);
  });

  it('adapter tier normalization equals analytics normalizeTier for every tier name', () => {
    for (const name of [...VALORANT_TIERS.map((t) => t.label), 'Unrated', 'Unranked', ' gold  2 ', 'Mythic 9', '']) {
      const a = normalizeTier({ name });
      expect(normalizeTierName(name)).toEqual({ normalizedTierKey: a?.key ?? null, tierOrdinal: a?.tierOrdinal ?? null });
    }
  });

  it('pagination is one bounded page per call (offset cursor); a full page yields the next cursor, no crawl loop', async () => {
    const s = scripted((url) => json(200, { data: Array.from({ length: Number(url.searchParams.get('size')) }, (_, i) => payload(10 + i)) }));
    const h = henrik(s.fetchImpl);
    const page = await h.listMatches({ providerAccountRef: pu(1), cursor: '20', limit: 3 });
    expect(page.matchRefs).toHaveLength(3);
    expect(page.nextCursor).toBe('23');
    expect(s.calls).toHaveLength(1);
    await expect(h.listMatches({ providerAccountRef: pu(1), cursor: '-1', limit: 3 })).rejects.toMatchObject({ kind: 'BAD_REQUEST' });
  });

  it.each<[string, Handler, ProviderErrorKind, number | null]>([
    ['401', () => json(401, { errors: [{ code: 0, message: 'Invalid API key', status: 401 }] }), 'AUTH_FAILED', 401],
    ['403', () => json(403, { errors: [] }), 'AUTH_FAILED', 403],
    ['404', () => json(404, { errors: [{ code: 0, message: 'Account not found', status: 404 }] }), 'NOT_FOUND', 404],
    ['400', () => json(400, { errors: [] }), 'BAD_REQUEST', 400],
    ['429', () => json(429, { errors: [] }, { 'retry-after': '45' }), 'RATE_LIMITED', 429],
    ['500', () => json(500, { errors: [] }), 'PROVIDER_UNAVAILABLE', 500],
    ['503', () => json(503, { errors: [] }), 'PROVIDER_UNAVAILABLE', 503],
    ['non-JSON 200', () => new Response('<html>', { status: 200 }), 'MALFORMED_RESPONSE', 200],
    ['contract-violating 200', () => json(200, { data: { name: 'no puuid' } }), 'MALFORMED_RESPONSE', null],
    ['network', () => { throw new TypeError('fetch failed'); }, 'NETWORK_UNAVAILABLE', null],
  ])('error %s → %s (structured, no request detail in the message)', async (_label, handler, kind, status) => {
    const h = henrik(scripted(handler).fetchImpl);
    const error = await h.resolveAccount({ handle: 'Fixture#TAG' }).catch((e: unknown) => e) as ProviderError;
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.kind).toBe(kind);
    if (status !== null) expect(error.httpStatus).toBe(status);
    if (kind === 'RATE_LIMITED') expect(error.retryAfterSeconds).toBe(45);
    for (const secret of [KEY, 'Fixture', pu(1), 'henrikdev', 'http']) expect(error.message).not.toContain(secret);
  });

  it('timeout → TIMEOUT; caller abort → ABORTED', async () => {
    const hang: Handler = (_u, _h, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    const h = henrik(scripted(hang).fetchImpl, { timeoutMs: 20 });
    await expect(h.resolveAccount({ handle: 'Fixture#TAG' })).rejects.toMatchObject({ kind: 'TIMEOUT' });
    const controller = new AbortController();
    const pending = henrik(scripted(hang).fetchImpl, { timeoutMs: 5_000 }).resolveAccount({ handle: 'Fixture#TAG', signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'ABORTED' });
  });

  it('a different returned match record is rejected', async () => {
    const h = henrik(scripted(() => json(200, { data: payload(2) })).fetchImpl);
    await expect(h.getMatch({ matchRef: mid(1), resolveIdentity: resolver, observedAt: OBSERVED_AT })).rejects.toMatchObject({ kind: 'MALFORMED_RESPONSE' });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('transport bounds: retry, budget, limiter, metrics, safe logging', () => {
  it('5xx / network retries are bounded (maxRetries ≤ 2) and every attempt consumes budget', async () => {
    const s = scripted(() => json(502, {}));
    const h = henrik(s.fetchImpl, { maxRetries: 2 });
    await expect(h.resolveAccount({ handle: 'Fixture#TAG' })).rejects.toMatchObject({ kind: 'PROVIDER_UNAVAILABLE' });
    expect(s.calls).toHaveLength(3);
    expect(h.budget.used).toBe(3);
    expect(h.metrics.totals()).toMatchObject({ requests: 3, status5xx: 3, retries: 2 });
    expect(() => henrik(s.fetchImpl, { maxRetries: 3 })).toThrow(/maxRetries/u);
  });

  it('429 is retried only with a short documented wait; a long or missing wait fails immediately; 4xx never retries', async () => {
    let n = 0;
    const short = scripted(() => (n++ === 0 ? json(429, {}, { 'retry-after': '2' }) : json(200, { data: { puuid: pu(1) } })));
    const h1 = henrik(short.fetchImpl, { maxRetries: 1 });
    expect((await h1.resolveAccount({ handle: 'Fixture#TAG' })).providerAccountRef).toBe(pu(1));
    expect(h1.metrics.totals()).toMatchObject({ requests: 2, status429: 1, status2xx: 1, retries: 1 });
    const long = scripted(() => json(429, {}, { 'retry-after': '600' }));
    await expect(henrik(long.fetchImpl, { maxRetries: 2 }).resolveAccount({ handle: 'Fixture#TAG' })).rejects.toMatchObject({ kind: 'RATE_LIMITED' });
    expect(long.calls).toHaveLength(1);
    const missing = scripted(() => json(429, {}));
    await expect(henrik(missing.fetchImpl, { maxRetries: 2 }).resolveAccount({ handle: 'Fixture#TAG' })).rejects.toMatchObject({ kind: 'RATE_LIMITED', retryAfterSeconds: null });
    expect(missing.calls).toHaveLength(1);
    const auth = scripted(() => json(401, {}));
    await expect(henrik(auth.fetchImpl, { maxRetries: 2 }).resolveAccount({ handle: 'Fixture#TAG' })).rejects.toMatchObject({ kind: 'AUTH_FAILED' });
    expect(auth.calls).toHaveLength(1);
  });

  it('the request budget fails closed BEFORE sending (HENRIK_MAX_LIVE_REQUESTS = 6)', async () => {
    expect(HENRIK_MAX_LIVE_REQUESTS).toBe(6);
    const s = scripted(happy);
    const h = henrik(s.fetchImpl, { budget: new RequestBudget(2) });
    await h.resolveAccount({ handle: 'Fixture#TAG' });
    await h.resolveAccount({ handle: 'Fixture#TAG' });
    await expect(h.resolveAccount({ handle: 'Fixture#TAG' })).rejects.toMatchObject({ kind: 'REQUEST_BUDGET_EXHAUSTED' });
    expect(s.calls).toHaveLength(2);
  });

  it('limiter: rejects configuration above 6 RPM / 2 lanes; enforces the window and the lane count', async () => {
    expect(MAX_CONFIGURED_RPM).toBe(6);
    expect(MAX_CONCURRENCY).toBe(2);
    expect(() => new RateLimiter({ requestsPerMinute: 7, maxConcurrency: 1 })).toThrow(ProviderError);
    expect(() => new RateLimiter({ requestsPerMinute: 6, maxConcurrency: 3 })).toThrow(ProviderError);
    expect(() => new RateLimiter({ requestsPerMinute: 0, maxConcurrency: 1 })).toThrow(ProviderError);
    const c = clock();
    const limiter = new RateLimiter({ requestsPerMinute: 6, maxConcurrency: 2, now: c.now, sleep: c.sleep });
    const startedAt: number[] = [];
    let inFlight = 0; let maxInFlight = 0;
    await Promise.all(Array.from({ length: 13 }, () => limiter.run(async () => {
      startedAt.push(c.now()); inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve(); inFlight -= 1;
    })));
    expect(maxInFlight).toBeLessThanOrEqual(2);
    for (let i = 0; i < startedAt.length; i += 1) expect(startedAt.filter((t) => t > startedAt[i]! - 60_000 && t <= startedAt[i]!).length).toBeLessThanOrEqual(6);
    expect(startedAt[12]! - startedAt[0]!).toBeGreaterThanOrEqual(120_000);
  });

  it('logs and metrics carry no key, account ref, match id, handle or URL', async () => {
    logLines.length = 0;
    const h = henrik(scripted(happy).fetchImpl);
    await h.resolveAccount({ handle: 'Fixture#TAG' });
    await h.listMatches({ providerAccountRef: pu(1), cursor: null, limit: 2 });
    await h.getMatch({ matchRef: mid(1), resolveIdentity: resolver, observedAt: OBSERVED_AT });
    const text = logLines.join('\n') + JSON.stringify(h.metrics.snapshot());
    expect(logLines.length).toBeGreaterThanOrEqual(3);
    for (const banned of [KEY, pu(1), mid(1), 'Fixture', '#TAG', 'http', 'henrikdev', 'Authorization']) expect(text).not.toContain(banned);
    expect(JSON.parse(logLines[0]!)).toMatchObject({ event: 'provider_request', provider: 'henrik', capability: 'IDENTITY', status: 200, statusClass: '2xx' });
    expect(safeLogLine('x', { provider: 'https://a.b/c', capability: pu(1), kind: 'Name#Tag', other: 'dropped', latencyMs: 5 }))
      .toBe('{"event":"x","provider":"[redacted]","capability":"[redacted]","kind":"[redacted]","latencyMs":5}');
  });

  it('metrics count 2xx / 4xx / 5xx / 429 per provider and capability', () => {
    const m = new ProviderMetrics();
    for (const status of [200, 204, 404, 429, 500]) m.recordAttempt('henrik', 'MATCH_DETAIL', { status, kind: 'http', latencyMs: 10, retry: false });
    m.recordAttempt('henrik', 'RANK', { status: null, kind: 'timeout', latencyMs: 30, retry: true });
    expect(m.snapshot()).toEqual([
      { providerId: 'henrik', capability: 'MATCH_DETAIL', requests: 5, status2xx: 2, status4xx: 2, status5xx: 1, status429: 1, networkErrors: 0, timeouts: 0, retries: 0, latencyMsTotal: 50, latencyMsMax: 10 },
      { providerId: 'henrik', capability: 'RANK', requests: 1, status2xx: 0, status4xx: 0, status5xx: 0, status429: 0, networkErrors: 0, timeouts: 1, retries: 1, latencyMsTotal: 30, latencyMsMax: 30 },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('ProviderRouter (provider-router-v1)', () => {
  const stub = (providerId: string, capabilities: ProviderCapability[], behaviour: () => Promise<CanonicalMatch>, recordNamespace?: string): DataProviderAdapter => ({
    providerId, providerVersion: `${providerId}-test`, recordNamespace, capabilities: () => new Set(capabilities), getMatch: behaviour,
  });
  const err = (kind: ProviderErrorKind) => async (): Promise<CanonicalMatch> => { throw new ProviderError({ kind, providerId: 'x' }); };
  const input = { matchRef: mid(1), resolveIdentity: resolver, observedAt: OBSERVED_AT };
  const archive = () => ImportFileAdapter.fromDocument({ format: IMPORT_ARCHIVE_FORMAT, payloadFormat: 'henrik-v4-match', exportedAt: OBSERVED_AT, records: [{ payload: MATCH }] });

  it.each<ProviderErrorKind>(['NETWORK_UNAVAILABLE', 'TIMEOUT', 'PROVIDER_UNAVAILABLE', 'CAPABILITY_UNSUPPORTED', 'CAPABILITY_NOT_CONFIGURED'])('falls back on %s (same namespace)', async (kind) => {
    const router = new ProviderRouter([stub('henrik-live', ['MATCH_DETAIL'], err(kind), 'henrik'), archive()]);
    const routed = await router.getMatch(input);
    expect(routed.servedBy).toBe('import-file');
    expect(routed.attempts).toEqual([{ providerId: 'henrik-live', outcome: kind }, { providerId: 'import-file', outcome: 'served' }]);
  });

  it.each<ProviderErrorKind>(['RATE_LIMITED', 'AUTH_FAILED', 'NOT_FOUND', 'BAD_REQUEST', 'MALFORMED_RESPONSE', 'REQUEST_BUDGET_EXHAUSTED', 'PROVIDER_CONFLICT', 'MISCONFIGURED'])(
    'never falls back on %s', async (kind) => {
      const router = new ProviderRouter([stub('henrik-live', ['MATCH_DETAIL'], err(kind), 'henrik'), archive()]);
      await expect(router.getMatch(input)).rejects.toMatchObject({ kind });
    });

  it('never falls back across record namespaces (a henrik match ref means nothing to another provider)', async () => {
    const router = new ProviderRouter([stub('henrik-live', ['MATCH_DETAIL'], err('PROVIDER_UNAVAILABLE'), 'henrik'), new FakeProviderAdapter()]);
    await expect(router.getMatch(input)).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect((await router.getMatch({ ...input, matchRef: 'fake-match-ref-0001' }, { recordNamespace: 'fake' })).servedBy).toBe('fake');
  });

  it('explicit routes are deterministic; pinning a provider disables fallback; misconfiguration is rejected', async () => {
    const a = stub('a', ['MATCH_DETAIL'], err('PROVIDER_UNAVAILABLE'), 'ns');
    const b = stub('b', ['MATCH_DETAIL'], async () => archive().getMatch(input), 'ns');
    const router = new ProviderRouter([a, b], { routes: { MATCH_DETAIL: ['b', 'a'] } });
    expect(router.candidates('MATCH_DETAIL').map((x) => x.providerId)).toEqual(['b', 'a']);
    expect((await router.getMatch(input)).attempts).toEqual([{ providerId: 'b', outcome: 'served' }]);
    await expect(router.getMatch(input, { providerId: 'a' })).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(() => new ProviderRouter([a, a])).toThrow(/duplicate/u);
    expect(() => new ProviderRouter([a], { routes: { MATCH_DETAIL: ['zzz'] } })).toThrow(/unknown/u);
    await expect(new ProviderRouter([new RiotAdapter(), new OverwolfAdapter()]).getMatch(input)).rejects.toBeInstanceOf(UnsupportedCapabilityError);
  });

  it('returns exactly one provider result (never merged) and records provider health', async () => {
    const health = new ProviderHealthTracker(() => OBSERVED_AT);
    const router = new ProviderRouter([stub('henrik-live', ['MATCH_DETAIL'], err('RATE_LIMITED'), 'henrik'), archive()], { health });
    await expect(router.getMatch(input)).rejects.toMatchObject({ kind: 'RATE_LIMITED' });
    expect(health.get('henrik-live')?.state).toBe('RATE_LIMITED');
    const ok = new ProviderRouter([archive()], { health });
    expect((await ok.getMatch(input)).match).toEqual(await archive().getMatch(input));
    expect(health.get('import-file')?.state).toBe('AVAILABLE');
    expect(['RATE_LIMITED', 'AUTH_FAILED', 'PROVIDER_UNAVAILABLE', 'CAPABILITY_NOT_CONFIGURED', 'MISCONFIGURED', 'NOT_FOUND'].map((k) => healthOfKind(k as ProviderErrorKind)))
      .toEqual(['RATE_LIMITED', 'AUTH_FAILED', 'TEMPORARY_ERROR', 'CAPABILITY_UNAVAILABLE', 'MISCONFIGURED', null]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('ImportFileAdapter (vsa-match-archive-v1)', () => {
  const doc = (extra: Record<string, unknown> = {}) => ({ format: IMPORT_ARCHIVE_FORMAT, payloadFormat: 'henrik-v4-match', exportedAt: OBSERVED_AT, records: [{ payload: payload(1) }, { payload: payload(2) }], ...extra });

  it('reads a JSON archive inside the root and normalizes provider-neutrally with its own provenance', async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, 'in'));
      await writeFile(join(root, 'in', 'a.json'), JSON.stringify(doc()));
      const adapter = await ImportFileAdapter.open({ rootDir: root, relativePath: 'in/a.json' });
      expect(adapter.recordCount).toBe(2);
      expect(adapter.recordNamespace).toBe('henrik');
      expect([...adapter.capabilities()].sort()).toEqual(['MATCH_DETAIL', 'MATCH_HISTORY']);
      const page = await adapter.listMatches({ providerAccountRef: pu(1), cursor: null, limit: 1 });
      expect(page).toMatchObject({ matchRefs: [mid(1)], nextCursor: '1', history: { lifetimeComplete: false } });
      const match = await adapter.getMatch({ matchRef: mid(1), resolveIdentity: resolver, observedAt: OBSERVED_AT });
      expect(match.source).toMatchObject({ providerId: 'henrik', acquisition: 'provider-adapter', acquisitionSource: 'import-file-adapter-v1:henrik-v4-match' });
      expect(withoutSource(match)).toEqual(withoutSource(normalizeHenrikV4Match(payload(1), { resolveIdentity: resolver, observedAt: OBSERVED_AT, acquisitionSource: 'x' }).match));
      await expect(adapter.getMatch({ ...{ matchRef: 'missing', resolveIdentity: resolver, observedAt: OBSERVED_AT } })).rejects.toMatchObject({ kind: 'NOT_FOUND' });
    });
  });

  it.each(['../a.json', '/etc/a.json', 'C:/x/a.json', 'in/../../a.json', 'a.js', 'a.json\u0000.txt', ''])('rejects the path %j', async (relativePath) => {
    await withTempDir(async (root) => {
      await expect(ImportFileAdapter.open({ rootDir: root, relativePath })).rejects.toMatchObject({ kind: 'MALFORMED_RESPONSE' });
    });
  });

  it('rejects symlinks, oversize files, invalid JSON, envelopes, unknown formats and duplicate records', async () => {
    await withTempDir(async (root) => {
      const write = (name: string, text: string) => writeFile(join(root, name), text);
      await write('big.json', JSON.stringify(doc()));
      await expect(ImportFileAdapter.open({ rootDir: root, relativePath: 'big.json', maxBytes: 100 })).rejects.toThrow(/size limit/u);
      await write('bad.json', '{not json');
      await expect(ImportFileAdapter.open({ rootDir: root, relativePath: 'bad.json' })).rejects.toThrow(/not valid JSON/u);
      const linked = await symlink(join(root, 'big.json'), join(root, 'link.json')).then(() => true, () => false);
      if (linked) await expect(ImportFileAdapter.open({ rootDir: root, relativePath: 'link.json' })).rejects.toThrow(/regular file/u);
      expect(await readFile(join(root, 'big.json'), 'utf8')).toContain(IMPORT_ARCHIVE_FORMAT);
    });
    expect(() => ImportFileAdapter.fromDocument({ ...doc(), extra: 1 })).toThrow(/envelope/u);
    expect(() => ImportFileAdapter.fromDocument(doc({ payloadFormat: 'tracker-scrape' }))).toThrow(/unsupported payload format/u);
    expect(() => ImportFileAdapter.fromDocument(doc({ records: [{ payload: payload(1) }, { payload: payload(1) }] }))).toThrow(/duplicate/u);
    expect(() => ImportFileAdapter.fromDocument(doc({ records: [{ payload: { metadata: {} } }] }))).toThrow(/record reference/u);
    // JSON only: a "__proto__" key is plain data, rejected by the strict envelope, and pollutes nothing.
    expect(() => ImportFileAdapter.fromDocument(JSON.parse(JSON.stringify(doc()).replace('{"format"', '{"__proto__":{"polluted":true},"format"')) as unknown)).toThrow(/envelope/u);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('logical-match identity, conflicts and provenance', () => {
  const live = normalizeHenrikV4Match(MATCH, { resolveIdentity: resolver, observedAt: OBSERVED_AT, acquisitionSource: HENRIK_ADAPTER_VERSION,
    provenance: { acquisition: 'provider-adapter', normalizerVersion: HENRIK_NORMALIZER_VERSION } }).match;
  const legacy = normalizeHenrikV4Match(MATCH, { resolveIdentity: resolver, observedAt: OBSERVED_AT, acquisitionSource: 'legacy' }).match;
  /** A different provider's record of the same game: its own key, same facts. */
  const other = { ...live, matchKey: 'cm_aaaaaaaaaaaaaaaaaaaaaaaa', source: { ...live.source, providerId: 'riot', providerRecordRef: 'riot-record-1' } } as CanonicalMatch;

  it('same provider record → SAME_RECORD; a disagreeing copy → PROVIDER_CONFLICT (field names only, no merge)', () => {
    expect(assertConsistent(live, legacy)).toBe('SAME_RECORD');
    const changed = { ...legacy, teams: legacy.teams.map((t, i) => (i === 0 ? { ...t, roundsWon: 13 } : t)), mode: 'unrated' } as CanonicalMatch;
    const error = (() => { try { assertConsistent(live, changed); return null; } catch (e) { return e as ProviderConflictError; } })();
    expect(error).toBeInstanceOf(ProviderConflictError);
    expect(error!.kind).toBe('PROVIDER_CONFLICT');
    expect(error!.fields).toEqual(['mode', 'teams']);
    expect(error!.message).not.toContain(mid(1));
  });

  it('cross-provider records are never assumed identical: map + time similarity is only a CANDIDATE and is never grouped', () => {
    expect(relateMatches(live, other).relation).toBe('CANDIDATE');
    const grouping = groupLogicalMatches([live, other]);
    expect(grouping.groups).toEqual([[other.matchKey], [live.matchKey]].sort((a, b) => (a[0]! < b[0]! ? -1 : 1)));
    expect(grouping.candidates).toHaveLength(1);
    const shifted = { ...other, startedAt: new Date(Date.parse(live.startedAt) + 121_000).toISOString() } as CanonicalMatch;
    expect(relateMatches(live, shifted).relation).toBe('DISTINCT');
  });

  it('only an explicit recorded link groups records of different providers; a conflicting link is reported, not grouped', () => {
    const link = { left: { providerId: 'henrik', providerRecordRef: mid(1) }, right: { providerId: 'riot', providerRecordRef: 'riot-record-1' }, evidence: 'operator-verified' as const };
    expect(groupLogicalMatches([live, other], [link]).groups).toEqual([[other.matchKey, live.matchKey].sort()]);
    const disagree = { ...other, mapId: 'map-uuid-bind' } as CanonicalMatch;
    const grouping = groupLogicalMatches([live, disagree], [link]);
    expect(grouping.groups).toHaveLength(2);
    expect(grouping.conflicts).toEqual([{ matchKeys: expect.any(Array), fields: ['mapId'] }]);
  });

  it('provenance on every path; public provenance carries no provider record ref', () => {
    expect(provenanceOf(live)).toEqual({ providerId: 'henrik', providerVersion: 'henrik-v4', adapterVersion: HENRIK_ADAPTER_VERSION, normalizerVersion: HENRIK_NORMALIZER_VERSION,
      observedAt: OBSERVED_AT, acquisition: 'provider-adapter', providerEvidenceRef: mid(1) });
    const pub = publicProvenance(live);
    expect(JSON.stringify(pub)).not.toContain(mid(1));
    expect(Object.keys(pub).sort()).toEqual(['acquisition', 'adapterVersion', 'normalizerVersion', 'observedAt', 'providerId', 'providerVersion']);
    expect(findPrivateKeys({ providerAccountRef: 'x', puuid: 'y' }).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('ingestion into a temporary canonical store (offline)', () => {
  it('Henrik → canonical store; the henrik-v4 archive shares the namespace and never duplicates a record', async () => {
    const { sql, repository } = await freshDatabase();
    try {
      await seedDemoRoster(repository);
      await repository.upsertSourceAccount({ accountId: 'account-nova-henrik', memberId: 'member-nova', providerId: 'henrik', providerAccountRef: pu(1), isPrimary: false, linkedAt: OBSERVED_AT });
      const h = henrik(scripted(happy).fetchImpl);
      const summary = await new IngestService(repository, h, () => OBSERVED_AT).ingestGroup('group-demo', { maxMatchesPerAccount: 2 });
      expect(summary).toMatchObject({ providerId: 'henrik', accountsConsidered: 1, matchesListed: 2, matchesStored: 2, rankContexts: 4 });
      expect(h.budget.used).toBe(4); // 1 list + 2 detail + 1 rank, no pagination crawl
      expect(await repository.hasMatch('henrik', mid(1))).toBe(true);
      const archive = ImportFileAdapter.fromDocument({ format: IMPORT_ARCHIVE_FORMAT, payloadFormat: 'henrik-v4-match', exportedAt: OBSERVED_AT, records: [{ payload: payload(1) }, { payload: payload(2) }] });
      const again = await new IngestService(repository, archive, () => OBSERVED_AT).ingestGroup('group-demo', { maxMatchesPerAccount: 2 });
      expect(again).toMatchObject({ matchesListed: 2, matchesStored: 0, matchesAlreadyStored: 2 });
      const stored = (await repository.listMatchesForMembers(['member-nova'])).filter((m) => m.source.providerId === 'henrik');
      expect(stored).toHaveLength(2);
      expect(stored.every((m) => m.source.acquisitionSource === HENRIK_ADAPTER_VERSION && m.evidence.historyCompleteness === 'provider-visible')).toBe(true);
    } finally {
      await sql.close();
    }
  });
});
