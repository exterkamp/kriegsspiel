/** Test support: a fake wall clock that also provides timers. Not used by the server. */
import type { Timers } from './actor.js';

type Pending = { id: number; due: number; fn: () => void };

export class FakeTime implements Timers {
  private nowMs: number;
  private nextId = 1;
  private pending: Pending[] = [];

  constructor(start = 1_000_000) {
    this.nowMs = start;
  }

  readonly now = (): number => this.nowMs;

  get pendingTimers(): number {
    return this.pending.length;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const t = { id: this.nextId++, due: this.nowMs + Math.max(0, ms), fn };
    this.pending.push(t);
    return t.id;
  }

  clearTimeout(handle: unknown): void {
    this.pending = this.pending.filter((t) => t.id !== handle);
  }

  /** Let queued promise work finish. */
  async flush(): Promise<void> {
    for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(r));
  }

  /** Move wall time forward, firing timers in order as they come due and letting their work run. */
  async advance(ms: number): Promise<void> {
    const end = this.nowMs + ms;
    await this.flush();
    for (;;) {
      const due = this.pending
        .filter((t) => t.due <= end)
        .sort((a, b) => a.due - b.due || a.id - b.id)[0];
      if (!due) break;
      this.pending = this.pending.filter((t) => t !== due);
      this.nowMs = Math.max(this.nowMs, due.due);
      due.fn();
      await this.flush();
    }
    this.nowMs = end;
    await this.flush();
  }
}
