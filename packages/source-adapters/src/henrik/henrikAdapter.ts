import { createHash } from 'node:crypto';
import type { CanonicalMatch, RankContext } from '@vsa/contracts/canonical';
import {
  MAX_MATCH_PAGE_SIZE, type DataProviderAdapter, type GetMatchInput, type ListMatchesInput, type ListMatchesResult, type ProviderCapability, type RankContextInput,
  type ResolveAccountInput, type ResolvedAccount,
} from '../adapter.ts';
import { ProviderError } from '../errors.ts';
import { ADAPTER_TIER_MODEL_VERSION, normalizeTierName } from '../rankTier.ts';
import { ProviderHttpClient, type FetchLike } from '../transport/httpClient.ts';
import type { ProviderLogSink, ProviderMetrics, RequestBudget } from '../transport/observability.ts';
import { MAX_CONFIGURED_RPM, RateLimiter, type Sleep } from '../transport/rateLimiter.ts';
import { HenrikAccountResponse, HenrikMatchListResponse, HenrikMatchResponse, HenrikMmrResponse } from './dto.ts';
import { HENRIK_PROVIDER_ID, NormalizationError, normalizeHenrikV4Match, type NormalizeDiagnostics } from './normalizeV4.ts';

export const HENRIK_ADAPTER_VERSION = 'henrik-adapter-v1';
export const HENRIK_NORMALIZER_VERSION = 'henrik-v4-normalizer-v1';
export const HENRIK_BASE_URL = 'https://api.henrikdev.xyz';
/** V2-PROVIDER-WAVE-01 live ceiling for the whole task (all attempts, retries included). */
export const HENRIK_MAX_LIVE_REQUESTS = 6;
/** Documented capabilities only (account, v4 match list / detail, v3 MMR). */
export const HENRIK_CAPABILITIES: ReadonlySet<ProviderCapability> = new Set<ProviderCapability>(['IDENTITY', 'MATCH_HISTORY', 'MATCH_DETAIL', 'RANK']);

export const HENRIK_AFFINITIES = ['eu', 'na', 'latam', 'br', 'ap', 'kr'] as const;
export type HenrikAffinity = (typeof HENRIK_AFFINITIES)[number];
export type HenrikPlatform = 'pc' | 'console';

export interface HenrikAdapterConfig {
  /** Server-side key from configuration / environment only. Sent as the documented `Authorization` header. */
  apiKey: string;
  affinity: HenrikAffinity;
  platform?: HenrikPlatform;
  /** Hard ceiling on actual requests for this adapter instance (no unbounded default). */
  budget: RequestBudget;
  baseUrl?: string;
  requestsPerMinute?: number;
  maxConcurrency?: number;
  timeoutMs?: number;
  maxRetries?: number;
  metrics?: ProviderMetrics;
  log?: ProviderLogSink;
  fetchImpl?: FetchLike;
  sleep?: Sleep;
  now?: () => number;
}

const KEY_SHAPE = /^[A-Za-z0-9_-]{8,200}$/u;
const HANDLE = /^([^#\p{Cc}]{1,32})#([^#\p{Cc}]{1,8})$/u;
const enc = encodeURIComponent;

/**
 * Henrik (unofficial third-party VALORANT API) → canonical contracts. Henrik DTOs never leave this module: every method
 * returns ResolvedAccount refs, match refs, CanonicalMatch or RankContext. Account refs are the provider's account id
 * (PRIVATE: stored only in source_accounts); match refs are provider match ids (PRIVATE: `source.providerRecordRef`).
 */
export class HenrikAdapter implements DataProviderAdapter {
  readonly providerId = HENRIK_PROVIDER_ID;
  readonly providerVersion = HENRIK_ADAPTER_VERSION;
  readonly recordNamespace = HENRIK_PROVIDER_ID;
  private readonly http: ProviderHttpClient;
  private readonly affinity: HenrikAffinity;
  private readonly platform: HenrikPlatform;

  constructor(config: HenrikAdapterConfig) {
    if (typeof config.apiKey !== 'string' || !KEY_SHAPE.test(config.apiKey)) {
      throw new ProviderError({ kind: 'MISCONFIGURED', providerId: HENRIK_PROVIDER_ID, message: 'henrik api key missing or malformed' });
    }
    if (!(HENRIK_AFFINITIES as readonly string[]).includes(config.affinity)) throw new ProviderError({ kind: 'MISCONFIGURED', providerId: HENRIK_PROVIDER_ID, message: 'henrik affinity not supported' });
    this.affinity = config.affinity;
    this.platform = config.platform ?? 'pc';
    if (this.platform !== 'pc' && this.platform !== 'console') throw new ProviderError({ kind: 'MISCONFIGURED', providerId: HENRIK_PROVIDER_ID, message: 'henrik platform not supported' });
    this.http = new ProviderHttpClient({
      providerId: HENRIK_PROVIDER_ID, baseUrl: config.baseUrl ?? HENRIK_BASE_URL, headers: { Authorization: config.apiKey, Accept: 'application/json' },
      limiter: new RateLimiter({ requestsPerMinute: config.requestsPerMinute ?? MAX_CONFIGURED_RPM, maxConcurrency: config.maxConcurrency ?? 1, now: config.now, sleep: config.sleep }),
      budget: config.budget, metrics: config.metrics, log: config.log, timeoutMs: config.timeoutMs, maxRetries: config.maxRetries, fetchImpl: config.fetchImpl,
      sleep: config.sleep, now: config.now,
    });
  }

  /**
   * Configuration from the environment: HENRIK_API_KEY (required), HENRIK_AFFINITY (required), HENRIK_PLATFORM
   * (default pc). Errors never echo values.
   */
  static fromEnvironment(env: Readonly<Record<string, string | undefined>>, options: Omit<HenrikAdapterConfig, 'apiKey' | 'affinity' | 'platform'>): HenrikAdapter {
    const apiKey = env.HENRIK_API_KEY?.trim();
    if (!apiKey) throw new ProviderError({ kind: 'MISCONFIGURED', providerId: HENRIK_PROVIDER_ID, message: 'HENRIK_API_KEY is not set' });
    return new HenrikAdapter({ ...options, apiKey, affinity: (env.HENRIK_AFFINITY?.trim() ?? '') as HenrikAffinity, platform: (env.HENRIK_PLATFORM?.trim() || 'pc') as HenrikPlatform });
  }

  get metrics(): ProviderMetrics { return this.http.metrics; }
  get budget(): RequestBudget { return this.http.budget; }

  capabilities(): ReadonlySet<ProviderCapability> {
    return HENRIK_CAPABILITIES;
  }

  async resolveAccount(input: ResolveAccountInput): Promise<ResolvedAccount> {
    const m = HANDLE.exec(input.handle.trim());
    if (!m) throw new ProviderError({ kind: 'BAD_REQUEST', providerId: this.providerId, capability: 'IDENTITY', message: 'handle must be Name#Tag' });
    const body = this.parse(HenrikAccountResponse, await this.http.getJson(`/valorant/v2/account/${enc(m[1]!.trim())}/${enc(m[2]!.trim())}`, { capability: 'IDENTITY', signal: input.signal }), 'IDENTITY');
    const { name, tag } = body.data;
    return { providerAccountRef: body.data.puuid, handle: name && tag ? `${name}#${tag}` : input.handle.trim() };
  }

  /** One bounded page (offset cursor). History is the provider-visible subset, never a career. */
  async listMatches(input: ListMatchesInput): Promise<ListMatchesResult> {
    const size = Math.max(1, Math.min(MAX_MATCH_PAGE_SIZE, Math.trunc(input.limit)));
    const start = input.cursor === null ? 0 : Number(input.cursor);
    if (!Number.isSafeInteger(start) || start < 0) throw new ProviderError({ kind: 'BAD_REQUEST', providerId: this.providerId, capability: 'MATCH_HISTORY', message: 'invalid cursor' });
    const body = this.parse(HenrikMatchListResponse, await this.http.getJson(
      `/valorant/v4/by-puuid/matches/${this.affinity}/${this.platform}/${enc(input.providerAccountRef)}`, { capability: 'MATCH_HISTORY', query: { size, start }, signal: input.signal }), 'MATCH_HISTORY');
    const refs = [...new Set(body.data.map((m) => m.metadata.match_id))];
    return {
      matchRefs: refs,
      nextCursor: body.data.length >= size ? String(start + body.data.length) : null,
      history: { completeness: 'provider-visible', lifetimeComplete: false, pageOffset: start, pageSize: size, returned: body.data.length, providerReportedTotal: null },
    };
  }

  async getMatch(input: GetMatchInput): Promise<CanonicalMatch> {
    return (await this.getMatchWithDiagnostics(input)).match;
  }

  /** Same as getMatch, plus normalization diagnostics (counts only). */
  async getMatchWithDiagnostics(input: GetMatchInput): Promise<{ match: CanonicalMatch; diagnostics: NormalizeDiagnostics }> {
    const body = this.parse(HenrikMatchResponse, await this.http.getJson(`/valorant/v4/match/${this.affinity}/${enc(input.matchRef)}`, { capability: 'MATCH_DETAIL', signal: input.signal }), 'MATCH_DETAIL');
    if (body.data.metadata.match_id !== input.matchRef) {
      throw new ProviderError({ kind: 'MALFORMED_RESPONSE', providerId: this.providerId, capability: 'MATCH_DETAIL', message: 'provider returned a different match record' });
    }
    try {
      return normalizeHenrikV4Match(body.data, { resolveIdentity: input.resolveIdentity, observedAt: input.observedAt, acquisitionSource: HENRIK_ADAPTER_VERSION,
        provenance: { acquisition: 'provider-adapter', normalizerVersion: HENRIK_NORMALIZER_VERSION } });
    } catch (error) {
      const detail = error instanceof NormalizationError ? error.message : 'normalization failed';
      throw new ProviderError({ kind: 'MALFORMED_RESPONSE', providerId: this.providerId, capability: 'MATCH_DETAIL', message: `henrik match rejected: ${detail}` });
    }
  }

  /**
   * v3 MMR → current / peak / seasonal context rows (provider semantics; `elo` is the provider's value, never MMR).
   * Absent blocks produce no rows: rank absence is "unknown", never a guessed tier. Peak and seasonal rows carry the
   * observation time and are never match-time context.
   */
  async getRankContext(input: RankContextInput): Promise<RankContext[]> {
    const body = this.parse(HenrikMmrResponse, await this.http.getJson(`/valorant/v3/by-puuid/mmr/${this.affinity}/${this.platform}/${enc(input.providerAccountRef)}`, { capability: 'RANK', signal: input.signal }), 'RANK');
    const rows: RankContext[] = [];
    const season = (s: { short?: string } | null | undefined) => {
      const short = s?.short?.trim().toLowerCase();
      return short && /^[a-z0-9][a-z0-9:_-]{0,15}$/u.test(short) ? short : null;
    };
    const row = (kind: RankContext['kind'], tier: { id?: number; name?: string } | null | undefined, extra: { rr?: number | null; rrChange?: number | null; elo?: number | null; seasonKey: string | null }) => {
      if (!tier || (tier.id === undefined && tier.name === undefined)) return;
      const id = `rk_${createHash('sha256').update(`henrik-rank-v1|${input.accountId}|${kind}|${extra.seasonKey ?? ''}|${input.observedAt}`, 'utf8').digest('hex').slice(0, 24)}`;
      rows.push({ rankContextId: id, memberId: input.memberId, accountId: input.accountId, kind, effectiveAt: input.observedAt, matchKey: null, providerId: this.providerId,
        sourceEndpoint: `henrik:v3:mmr:${kind}`, providerTierId: tier.id ?? null, providerTierName: tier.name ?? null, rr: extra.rr ?? null, rrChange: extra.rrChange ?? null,
        providerElo: extra.elo ?? null, seasonKey: extra.seasonKey, queue: 'competitive', ...normalizeTierName(tier.name), tierModelVersion: ADAPTER_TIER_MODEL_VERSION });
    };
    const d = body.data;
    if (d.current) row('current', d.current.tier, { rr: d.current.rr, rrChange: d.current.last_change, elo: d.current.elo, seasonKey: null });
    if (d.peak) row('peak', d.peak.tier, { rr: d.peak.rr, seasonKey: season(d.peak.season) });
    const seenSeasons = new Set<string>();
    for (const s of d.seasonal ?? []) {
      const key = season(s.season);
      if (key === null || seenSeasons.has(key)) continue; // seasonal rows without a valid season key cannot be placed
      seenSeasons.add(key);
      row('seasonal', s.end_tier, { rr: s.end_rr, seasonKey: key });
    }
    return rows;
  }

  private parse<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }, value: unknown, capability: ProviderCapability): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new ProviderError({ kind: 'MALFORMED_RESPONSE', providerId: this.providerId, capability, message: `henrik ${capability} response violates the documented shape` });
    return parsed.data;
  }
}
