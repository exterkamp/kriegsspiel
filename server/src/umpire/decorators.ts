import { addUsage, ZERO_USAGE } from './pricing.js';
import { UmpireError } from './umpireClient.js';
import type { TokenUsage, UmpireClient, UmpireRequest, UmpireResponse } from './umpireClient.js';

/**
 * Cross-cutting limits as decorators over `UmpireClient`. They know nothing about providers, so
 * they behave the same for every adapter, and they wrap the playback client too. Retry, backoff
 * and the timeout live in `ProviderUmpireClient`, next to schema validation, because the repair
 * loop shares those attempts.
 */

export interface RateLimitOptions {
  /** Calls in flight at once. */
  maxConcurrent?: number;
  /** Minimum gap between call starts. */
  minIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class RateLimitedUmpireClient implements UmpireClient {
  private active = 0;
  private readonly waiters: (() => void)[] = [];
  private nextStart = 0;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(
    private readonly inner: UmpireClient,
    private readonly opts: RateLimitOptions,
  ) {
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
  }

  async call<T>(request: UmpireRequest): Promise<UmpireResponse<T>> {
    const max = this.opts.maxConcurrent ?? Infinity;
    if (this.active >= max) await new Promise<void>((resolve) => this.waiters.push(resolve));
    else this.active++;
    try {
      const gap = this.opts.minIntervalMs ?? 0;
      if (gap > 0) {
        const now = this.now();
        const start = Math.max(now, this.nextStart);
        this.nextStart = start + gap;
        if (start > now) await this.sleep(start - now);
      }
      return await this.inner.call<T>(request);
    } finally {
      // Hand the slot straight to the next waiter, or free it.
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    }
  }
}

export interface BudgetOptions {
  maxCostUsd?: number;
  maxTotalTokens?: number;
}

/**
 * Stops calling once spend reaches a cap. Spend includes failed attempts (read from
 * `UmpireError`). Calls already in flight when the cap is crossed still finish, so the cap can
 * be overshot by at most the in-flight calls. Unpriced models add tokens but no dollars.
 */
export class BudgetedUmpireClient implements UmpireClient {
  private costUsd = 0;
  private usage: TokenUsage = ZERO_USAGE;

  constructor(
    private readonly inner: UmpireClient,
    private readonly budget: BudgetOptions,
  ) {}

  get spent(): { costUsd: number; totalTokens: number } {
    return { costUsd: this.costUsd, totalTokens: this.usage.inputTokens + this.usage.outputTokens };
  }

  async call<T>(request: UmpireRequest): Promise<UmpireResponse<T>> {
    const { costUsd, totalTokens } = this.spent;
    const { maxCostUsd, maxTotalTokens } = this.budget;
    if (maxCostUsd !== undefined && costUsd >= maxCostUsd) {
      throw new UmpireError(`budget of $${maxCostUsd} spent`, 'budget', 0);
    }
    if (maxTotalTokens !== undefined && totalTokens >= maxTotalTokens) {
      throw new UmpireError(`budget of ${maxTotalTokens} tokens spent`, 'budget', 0);
    }
    try {
      const res = await this.inner.call<T>(request);
      this.add(res.record.usage, res.record.costUsd);
      return res;
    } catch (err) {
      if (err instanceof UmpireError && err.usage) this.add(err.usage, err.costUsd ?? null);
      throw err;
    }
  }

  private add(usage: TokenUsage, cost: number | null): void {
    this.usage = addUsage(this.usage, usage);
    this.costUsd += cost ?? 0;
  }
}
