import { ProviderError } from '../errors.ts';

/** Policy ceilings for every configured provider limiter (validated 2 lanes / 6 RPM; never raised without an experiment). */
export const MAX_CONFIGURED_RPM = 6;
export const MAX_CONCURRENCY = 2;
const WINDOW_MS = 60_000;

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;
export const realSleep: Sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason); return; }
  const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, Math.max(0, ms));
  const onAbort = () => { clearTimeout(timer); reject(signal!.reason); };
  signal?.addEventListener('abort', onAbort, { once: true });
});

export interface RateLimiterOptions {
  requestsPerMinute: number;
  maxConcurrency: number;
  now?: () => number;
  sleep?: Sleep;
}

/**
 * Reusable sliding-window limiter: at most `requestsPerMinute` request STARTS in any 60 s window and at most
 * `maxConcurrency` requests in flight. FIFO: acquirers are served in call order. Configuration above the policy ceilings
 * is rejected (MISCONFIGURED), never clamped silently.
 */
export class RateLimiter {
  readonly requestsPerMinute: number;
  readonly maxConcurrency: number;
  private readonly now: () => number;
  private readonly sleep: Sleep;
  private readonly starts: number[] = [];
  private active = 0;
  private releaseWaiters: (() => void)[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(options: RateLimiterOptions) {
    const { requestsPerMinute: rpm, maxConcurrency: lanes } = options;
    if (!Number.isInteger(rpm) || rpm < 1 || rpm > MAX_CONFIGURED_RPM) {
      throw new ProviderError({ kind: 'MISCONFIGURED', providerId: 'rate-limiter', message: `requestsPerMinute must be an integer in 1..${MAX_CONFIGURED_RPM}` });
    }
    if (!Number.isInteger(lanes) || lanes < 1 || lanes > MAX_CONCURRENCY) {
      throw new ProviderError({ kind: 'MISCONFIGURED', providerId: 'rate-limiter', message: `maxConcurrency must be an integer in 1..${MAX_CONCURRENCY}` });
    }
    this.requestsPerMinute = rpm;
    this.maxConcurrency = lanes;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? realSleep;
  }

  /** Run `task` inside one limiter slot. */
  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      return await task();
    } finally {
      this.active -= 1;
      const waiter = this.releaseWaiters.shift();
      waiter?.();
    }
  }

  /** In-flight count and starts inside the current window (observability / tests). */
  stats(): { active: number; startsInWindow: number } {
    this.prune();
    return { active: this.active, startsInWindow: this.starts.length };
  }

  private prune(): void {
    const cutoff = this.now() - WINDOW_MS;
    while (this.starts.length && this.starts[0]! <= cutoff) this.starts.shift();
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    const turn = this.queue.then(async () => {
      for (;;) {
        signal?.throwIfAborted();
        this.prune();
        if (this.active >= this.maxConcurrency) {
          await new Promise<void>((resolve) => this.releaseWaiters.push(resolve));
          continue;
        }
        if (this.starts.length >= this.requestsPerMinute) {
          await this.sleep(this.starts[0]! + WINDOW_MS - this.now(), signal);
          continue;
        }
        this.starts.push(this.now());
        this.active += 1;
        return;
      }
    });
    // A failed (aborted) turn must not poison the queue for later acquirers.
    this.queue = turn.catch(() => undefined);
    return turn;
  }
}
