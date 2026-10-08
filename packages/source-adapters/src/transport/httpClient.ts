import type { ProviderCapability } from '../adapter.ts';
import { ProviderError, type ProviderErrorKind } from '../errors.ts';
import { ProviderMetrics, safeLogLine, type ProviderLogSink, type RequestBudget } from './observability.ts';
import { realSleep, type RateLimiter, type Sleep } from './rateLimiter.ts';

export const MAX_TIMEOUT_MS = 30_000;
export const MAX_RETRIES = 2;
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export type FetchLike = (url: string, init: { method: 'GET'; headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

export interface ProviderHttpClientOptions {
  providerId: string;
  /** https only (http only for loopback test servers). */
  baseUrl: string;
  /** Request headers, credentials included. Never logged, never part of an error. */
  headers: Readonly<Record<string, string>>;
  limiter: RateLimiter;
  budget: RequestBudget;
  metrics?: ProviderMetrics;
  log?: ProviderLogSink;
  timeoutMs?: number;
  /** Retries after the first attempt (≤ MAX_RETRIES). Each retry consumes budget like any request. */
  maxRetries?: number;
  retryBaseDelayMs?: number;
  /** A 429 is retried only when the documented wait is known and at most this long. */
  maxRetryAfterSeconds?: number;
  fetchImpl?: FetchLike;
  sleep?: Sleep;
  now?: () => number;
}

export interface GetJsonOptions {
  capability: ProviderCapability;
  query?: Readonly<Record<string, string | number | undefined>>;
  signal?: AbortSignal;
}

/** Seconds from a documented `Retry-After` (seconds or HTTP date) or `X-RateLimit-Reset` (seconds) header; else null. */
export function retryAfterSeconds(headers: Headers, nowMs: number): number | null {
  const retryAfter = headers.get('retry-after');
  if (retryAfter !== null) {
    if (/^\d{1,6}$/u.test(retryAfter.trim())) return Number(retryAfter.trim());
    const at = Date.parse(retryAfter);
    if (!Number.isNaN(at)) return Math.max(0, Math.ceil((at - nowMs) / 1000));
  }
  const reset = headers.get('x-ratelimit-reset');
  if (reset !== null && /^\d{1,4}$/u.test(reset.trim())) return Number(reset.trim());
  return null;
}

const statusKind = (status: number): ProviderErrorKind => (status === 429 ? 'RATE_LIMITED' : status === 401 || status === 403 ? 'AUTH_FAILED' : status === 404 ? 'NOT_FOUND'
  : status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'BAD_REQUEST');

/**
 * Bounded provider transport: one GET → parsed JSON. Owns timeouts (AbortSignal), bounded retry (network / timeout /
 * 5xx; 429 only with a documented short wait), structured classification, request budget, limiter slots, metrics and
 * safe logging. It has NO analytics or crawl semantics: it never paginates and never loops over accounts.
 */
export class ProviderHttpClient {
  private readonly o: Required<Omit<ProviderHttpClientOptions, 'log' | 'metrics'>> & { metrics: ProviderMetrics; log: ProviderLogSink | null };

  constructor(options: ProviderHttpClientOptions) {
    const url = new URL(options.baseUrl);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
      throw new ProviderError({ kind: 'MISCONFIGURED', providerId: options.providerId, message: 'provider base URL must use https' });
    }
    const timeoutMs = options.timeoutMs ?? 10_000;
    const maxRetries = options.maxRetries ?? 1;
    if (!(timeoutMs > 0 && timeoutMs <= MAX_TIMEOUT_MS)) throw new ProviderError({ kind: 'MISCONFIGURED', providerId: options.providerId, message: `timeoutMs must be in 1..${MAX_TIMEOUT_MS}` });
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > MAX_RETRIES) {
      throw new ProviderError({ kind: 'MISCONFIGURED', providerId: options.providerId, message: `maxRetries must be in 0..${MAX_RETRIES}` });
    }
    this.o = {
      providerId: options.providerId, baseUrl: url.toString().replace(/\/$/u, ''), headers: { ...options.headers }, limiter: options.limiter, budget: options.budget,
      metrics: options.metrics ?? new ProviderMetrics(), log: options.log ?? null, timeoutMs, maxRetries, retryBaseDelayMs: options.retryBaseDelayMs ?? 1_000,
      maxRetryAfterSeconds: options.maxRetryAfterSeconds ?? 30, fetchImpl: options.fetchImpl ?? ((u, init) => fetch(u, init)), sleep: options.sleep ?? realSleep,
      now: options.now ?? Date.now,
    };
  }

  get metrics(): ProviderMetrics { return this.o.metrics; }
  get budget(): RequestBudget { return this.o.budget; }

  /** `path` segments must already be encoded by the adapter (encodeURIComponent). */
  async getJson(path: string, options: GetJsonOptions): Promise<unknown> {
    const { providerId } = this.o;
    const url = new URL(`${this.o.baseUrl}${path}`);
    for (const [k, v] of Object.entries(options.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    for (let attempt = 0; ; attempt += 1) {
      options.signal?.throwIfAborted();
      this.o.budget.consume(providerId, options.capability);
      const started = this.o.now();
      const timeout = AbortSignal.timeout(this.o.timeoutMs);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      let failure: ProviderError;
      let waitMs: number;
      try {
        const response = await this.o.limiter.run(() => this.o.fetchImpl(url.toString(), { method: 'GET', headers: this.o.headers, signal }), options.signal);
        const latencyMs = this.o.now() - started;
        if (response.ok) {
          this.record(options.capability, attempt, { status: response.status, kind: 'http', latencyMs, retry: attempt > 0 });
          return await readBounded(response, providerId, options.capability);
        }
        await response.body?.cancel().catch(() => undefined);
        const kind = statusKind(response.status);
        const after = kind === 'RATE_LIMITED' ? retryAfterSeconds(response.headers, this.o.now()) : null;
        failure = new ProviderError({ kind, providerId, capability: options.capability, httpStatus: response.status, retryAfterSeconds: after });
        this.record(options.capability, attempt, { status: response.status, kind: 'http', latencyMs, retry: attempt > 0 });
        const retryable = kind === 'PROVIDER_UNAVAILABLE' || (kind === 'RATE_LIMITED' && after !== null && after <= this.o.maxRetryAfterSeconds);
        if (!retryable || attempt >= this.o.maxRetries) throw failure;
        waitMs = kind === 'RATE_LIMITED' ? after! * 1000 : this.o.retryBaseDelayMs * 2 ** attempt;
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        const latencyMs = this.o.now() - started;
        if (options.signal?.aborted) {
          this.record(options.capability, attempt, { status: null, kind: 'aborted', latencyMs, retry: attempt > 0 });
          throw new ProviderError({ kind: 'ABORTED', providerId, capability: options.capability });
        }
        const timedOut = timeout.aborted;
        this.record(options.capability, attempt, { status: null, kind: timedOut ? 'timeout' : 'network', latencyMs, retry: attempt > 0 });
        failure = new ProviderError({ kind: timedOut ? 'TIMEOUT' : 'NETWORK_UNAVAILABLE', providerId, capability: options.capability });
        if (attempt >= this.o.maxRetries) throw failure;
        waitMs = this.o.retryBaseDelayMs * 2 ** attempt;
      }
      this.emit('provider_retry', { provider: providerId, capability: options.capability, attempt, kind: failure.kind, retryInMs: waitMs, budgetRemaining: this.o.budget.remaining });
      await this.o.sleep(waitMs, options.signal);
    }
  }

  private record(capability: ProviderCapability, attempt: number, outcome: { status: number | null; kind: 'http' | 'network' | 'timeout' | 'aborted'; latencyMs: number; retry: boolean }): void {
    this.o.metrics.recordAttempt(this.o.providerId, capability, outcome);
    const statusClass = outcome.status === null ? outcome.kind : outcome.status === 429 ? '429' : `${Math.floor(outcome.status / 100)}xx`;
    this.emit('provider_request', { provider: this.o.providerId, capability, attempt, status: outcome.status, statusClass, latencyMs: Math.round(outcome.latencyMs),
      budgetRemaining: this.o.budget.remaining });
  }

  private emit(event: string, fields: Record<string, unknown>): void {
    this.o.log?.(safeLogLine(event, fields));
  }
}

async function readBounded(response: Response, providerId: string, capability: ProviderCapability): Promise<unknown> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new ProviderError({ kind: 'MALFORMED_RESPONSE', providerId, capability, httpStatus: response.status, message: `provider ${providerId} response too large` });
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new ProviderError({ kind: 'MALFORMED_RESPONSE', providerId, capability, httpStatus: response.status, message: `provider ${providerId} response too large` });
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderError({ kind: 'MALFORMED_RESPONSE', providerId, capability, httpStatus: response.status, message: `provider ${providerId} returned non-JSON` });
  }
}
