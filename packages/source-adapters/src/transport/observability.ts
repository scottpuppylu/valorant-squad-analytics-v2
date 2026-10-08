import type { ProviderCapability } from '../adapter.ts';
import { ProviderError } from '../errors.ts';

/**
 * Request budget: a hard ceiling on ACTUAL requests (every attempt, retries included). Consumed before a request is
 * sent; at the ceiling it fails closed (REQUEST_BUDGET_EXHAUSTED) and nothing is sent.
 */
export class RequestBudget {
  readonly max: number;
  private consumed = 0;
  constructor(max: number) {
    if (!Number.isInteger(max) || max < 0) throw new ProviderError({ kind: 'MISCONFIGURED', providerId: 'request-budget', message: 'budget must be a non-negative integer' });
    this.max = max;
  }
  consume(providerId: string, capability: ProviderCapability | null): void {
    if (this.consumed >= this.max) throw new ProviderError({ kind: 'REQUEST_BUDGET_EXHAUSTED', providerId, capability, message: `provider ${providerId} request budget exhausted (${this.max})` });
    this.consumed += 1;
  }
  get used(): number { return this.consumed; }
  get remaining(): number { return this.max - this.consumed; }
}

export interface ProviderMetricRow {
  providerId: string;
  capability: string;
  requests: number;
  status2xx: number;
  status4xx: number;
  status5xx: number;
  status429: number;
  networkErrors: number;
  timeouts: number;
  retries: number;
  latencyMsTotal: number;
  latencyMsMax: number;
}

/** Counters per (provider, capability). Contains no identifiers, URLs, payloads or secrets — only counts and latency. */
export class ProviderMetrics {
  private readonly rows = new Map<string, ProviderMetricRow>();

  private row(providerId: string, capability: ProviderCapability | null): ProviderMetricRow {
    const key = `${providerId}|${capability ?? 'none'}`;
    let row = this.rows.get(key);
    if (!row) {
      row = { providerId, capability: capability ?? 'none', requests: 0, status2xx: 0, status4xx: 0, status5xx: 0, status429: 0, networkErrors: 0, timeouts: 0, retries: 0,
        latencyMsTotal: 0, latencyMsMax: 0 };
      this.rows.set(key, row);
    }
    return row;
  }

  recordAttempt(providerId: string, capability: ProviderCapability | null, outcome: { status: number | null; kind: 'http' | 'network' | 'timeout' | 'aborted'; latencyMs: number; retry: boolean }): void {
    const row = this.row(providerId, capability);
    row.requests += 1;
    if (outcome.retry) row.retries += 1;
    if (outcome.kind === 'network') row.networkErrors += 1;
    if (outcome.kind === 'timeout') row.timeouts += 1;
    const s = outcome.status;
    if (s !== null) {
      if (s >= 200 && s < 300) row.status2xx += 1;
      else if (s === 429) { row.status429 += 1; row.status4xx += 1; }
      else if (s >= 400 && s < 500) row.status4xx += 1;
      else if (s >= 500) row.status5xx += 1;
    }
    const latency = Math.max(0, Math.round(outcome.latencyMs));
    row.latencyMsTotal += latency;
    row.latencyMsMax = Math.max(row.latencyMsMax, latency);
  }

  snapshot(): ProviderMetricRow[] {
    return [...this.rows.values()].map((r) => ({ ...r })).sort((a, b) => (a.providerId + a.capability < b.providerId + b.capability ? -1 : 1));
  }

  totals(): Omit<ProviderMetricRow, 'providerId' | 'capability'> {
    const t = { requests: 0, status2xx: 0, status4xx: 0, status5xx: 0, status429: 0, networkErrors: 0, timeouts: 0, retries: 0, latencyMsTotal: 0, latencyMsMax: 0 };
    for (const r of this.rows.values()) {
      for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] = k === 'latencyMsMax' ? Math.max(t[k], r[k]) : t[k] + r[k];
    }
    return t;
  }
}

/**
 * Provider log line: a fixed event name plus allowlisted fields whose values are finite numbers, booleans, null or short
 * code labels. Anything else becomes "[redacted]" — URLs, handles, ids and header values can never be logged.
 */
export type ProviderLogSink = (line: string) => void;
const LOG_FIELDS = new Set(['provider', 'capability', 'attempt', 'status', 'statusClass', 'kind', 'latencyMs', 'retry', 'retryInMs', 'budgetRemaining']);
const LABEL = /^[A-Za-z0-9_.:-]{1,40}$/u;
const UNSAFE_LABEL = /:\/\/|[0-9a-f]{8}-[0-9a-f]{4}|[A-Za-z0-9_-]{30,}|#|@/iu;

export function safeLogLine(event: string, fields: Record<string, unknown>): string {
  const out: Record<string, number | boolean | null | string> = { event: LABEL.test(event) && !UNSAFE_LABEL.test(event) ? event : '[redacted]' };
  for (const [key, value] of Object.entries(fields)) {
    if (!LOG_FIELDS.has(key)) continue;
    if (value === null || typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'number') out[key] = Number.isFinite(value) ? value : null;
    else if (typeof value === 'string' && LABEL.test(value) && !UNSAFE_LABEL.test(value)) out[key] = value;
    else out[key] = '[redacted]';
  }
  return JSON.stringify(out);
}
