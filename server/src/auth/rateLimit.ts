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

  /** When the key's current window ends (ms), or undefined if it has none open. */
  resetAt(key: string): number | undefined {
    const w = this.windows.get(key);
    return w && this.now() - w.start < this.windowMs ? w.start + this.windowMs : undefined;
  }
}
