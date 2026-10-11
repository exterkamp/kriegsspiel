/** Fixed-window rate limiter keyed by string, in memory. */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  /** Counts one hit; false when the key is over its limit for this window. */
  hit(key: string): boolean {
    const t = this.now();
    if (this.windows.size > 10_000) {
      for (const [k, w] of this.windows) if (t - w.start >= this.windowMs) this.windows.delete(k);
    }
    const w = this.windows.get(key);
    if (!w || t - w.start >= this.windowMs) {
      this.windows.set(key, { start: t, count: 1 });
      return true;
    }
    w.count += 1;
    return w.count <= this.limit;
  }
}
