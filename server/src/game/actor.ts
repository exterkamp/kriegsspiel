/**
 * GameActor: the single writer for one game. See docs/architecture.md (Scheduler and event
 * queue, Single writer per game).
 *
 * All changes go through one serial command queue, so the log is a total order and there are
 * no races. The scheduler sleeps until the next engine event is due in wall time and wakes
 * early on any command (rate, pause, mode, order). Quiet stretches cost nothing: a command
 * first advances the world to "now", then applies itself.
 *
 * The LLM barrier (docs/architecture.md): an order is parsed in the background, and the
 * courier leaves only once the result is known. The order's signing time is recorded as a
 * pending dependency, and the clock is held there (`GameClock.setBarrier`) until the result
 * arrives, so game time stalls, never jumps, and the outcome does not depend on LLM latency.
 * Other commands keep being served while the staff work. A parse that fails or times out is
 * retried, then replaced by a conservative fallback (nothing is issued, the player is asked to
 * restate) and logged.
 */
import {
  advanceTo,
  deserialize,
  issueOrder,
  serialize,
  type EmittedEvent,
  type EngineState,
  type EventRegistry,
  type GameState,
  type Order,
  type OrderIntent as EngineIntent,
} from '@kriegsspiel/engine';
import { GameClock, type WallClock } from '../clock.js';
import type { OrderParser, ParseResult } from '../orders/index.js';
import type { GameCommand, GameStore, InputLogEntry } from './store.js';

/** Timer functions, injectable so tests can run on a fake clock. */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

/** Longest single sleep; Node timers overflow beyond 2^31-1 ms. */
const MAX_SLEEP_MS = 2 ** 30;

/** The umpire's state as the client shows it ("staff at work"). */
export interface StaffAtWork {
  working: boolean;
  /** The earliest game time that needs a pending result. */
  needAtMs?: number;
}

/** Defaults for the parse retry policy. */
export const DEFAULT_PARSE_RETRIES = 2;
export const DEFAULT_PARSE_TIMEOUT_MS = 60_000;
export const DEFAULT_PARSE_RETRY_DELAY_MS = 1_000;

export type CommandResult =
  | { ok: true; orderId?: string }
  | { ok: false; kind: 'clarification'; question: string; options?: string[] }
  | { ok: false; kind: 'rejection'; reason: string };

export interface GameActorOptions {
  id: string;
  /** Engine state to start from (a new scenario, or a restored snapshot). */
  state: EngineState<GameState>;
  registry: EventRegistry<GameState>;
  clock: GameClock;
  wallNow: WallClock;
  parser: OrderParser;
  store: GameStore;
  timers?: Timers;
  /** Called with events the engine emitted, in firing order. */
  onEmitted?: (events: EmittedEvent[]) => void;
  /** Called when a background tick fails (a command's failure is returned to its caller). */
  onError?: (error: unknown) => void;
  /** Called when the set of pending LLM dependencies changes. */
  onStaffAtWork?: (state: StaffAtWork) => void;
  /** Extra parse attempts after a failure or timeout, before the fallback. Default 2. */
  parseRetries?: number;
  /** Wall ms to wait for one parse attempt. Default 60,000. */
  parseTimeoutMs?: number;
  /** Wall ms between parse attempts. Default 1,000. */
  parseRetryDelayMs?: number;
  /** Starting value for the input counter when resuming a game. */
  seq?: number;
}

/** Maps a parsed intent to one the engine knows, or the reason it cannot. */
function toEngineIntents(intents: ParseResult & { kind: 'intents' }): EngineIntent[] | string {
  const out: EngineIntent[] = [];
  for (const i of intents.intents) {
    if (i.kind === 'attack') return 'attack orders are not modelled yet';
    out.push(i);
  }
  return out;
}

interface Dependency {
  id: number;
  /** Game time at which the result is needed. */
  neededAt: number;
  settle: (result: CommandResult) => void;
  abandoned: boolean;
}

interface ParseOutcome {
  parsed: ParseResult;
  fallback?: { attempts: number; error: string };
}

export class GameActor {
  readonly id: string;
  private engine: EngineState<GameState>;
  private readonly registry: EventRegistry<GameState>;
  private readonly clock: GameClock;
  private readonly wallNow: WallClock;
  private readonly parser: OrderParser;
  private readonly store: GameStore;
  private readonly timers: Timers;
  private readonly onEmitted?: (events: EmittedEvent[]) => void;
  private readonly onError?: (error: unknown) => void;
  private readonly onStaffAtWork?: (state: StaffAtWork) => void;
  private readonly parseRetries: number;
  private readonly parseTimeoutMs: number;
  private readonly parseRetryDelayMs: number;
  private seq: number;
  /** Pending LLM dependencies: the game time each is needed and how to answer its caller. */
  private readonly dependencies = new Map<number, Dependency>();
  private nextDependency = 1;

  private tail: Promise<unknown> = Promise.resolve();
  private timer: unknown;
  private timerSet = false;
  private closed = false;

  constructor(options: GameActorOptions) {
    this.id = options.id;
    this.engine = options.state;
    this.registry = options.registry;
    this.clock = options.clock;
    this.wallNow = options.wallNow;
    this.parser = options.parser;
    this.store = options.store;
    this.timers = options.timers ?? realTimers;
    this.onEmitted = options.onEmitted;
    this.onError = options.onError;
    this.onStaffAtWork = options.onStaffAtWork;
    this.parseRetries = options.parseRetries ?? DEFAULT_PARSE_RETRIES;
    this.parseTimeoutMs = options.parseTimeoutMs ?? DEFAULT_PARSE_TIMEOUT_MS;
    this.parseRetryDelayMs = options.parseRetryDelayMs ?? DEFAULT_PARSE_RETRY_DELAY_MS;
    this.seq = options.seq ?? 0;
  }

  /** Whether the game is waiting on the umpire. */
  get staffAtWork(): StaffAtWork {
    const needAtMs = this.clock.barrier;
    return needAtMs === undefined ? { working: false } : { working: true, needAtMs };
  }

  /** The current engine state (not advanced to "now"; use a command to do that). */
  get state(): EngineState<GameState> {
    return this.engine;
  }

  get gameClock(): GameClock {
    return this.clock;
  }

  /** Persist the starting snapshot and start the scheduler. */
  async start(): Promise<void> {
    await this.enqueue(async () => {
      await this.persist();
      this.reschedule();
    });
  }

  /** Queue a command. Resolves when it has been applied. */
  submit(command: GameCommand): Promise<CommandResult> {
    if (command.kind === 'order') return this.submitOrder(command);
    return this.enqueue(() => this.apply(command));
  }

  /** Stop the scheduler, finish queued work, and refuse new commands. Safe to call twice. */
  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.clearTimer();
      // Abandon work still with the umpire: its callers are told, and a late result is ignored.
      for (const dep of [...this.dependencies.values()]) {
        dep.abandoned = true;
        this.dependencies.delete(dep.id);
        dep.settle({ ok: false, kind: 'rejection', reason: `game ${this.id} is closed` });
      }
    }
    await this.tail.catch(() => undefined);
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error(`game ${this.id} is closed`));
    const run = this.tail.then(job);
    this.tail = run.catch(() => undefined);
    return run;
  }

  private clearTimer(): void {
    if (this.timerSet) this.timers.clearTimeout(this.timer);
    this.timerSet = false;
  }

  /** Advance the engine to the clock's "now". */
  private sync(): void {
    const target = this.clock.now();
    if (target < this.engine.time) return;
    // Equal is not a no-op: an order signed "now" is queued at the current time and is due.
    this.advanceEngine(target);
  }

  private advanceEngine(target: number): void {
    const res = advanceTo(this.engine, target, this.registry);
    this.engine = res.state;
    if (res.emitted.length > 0) this.onEmitted?.(res.emitted);
  }

  private async persist(): Promise<void> {
    await this.store.saveSnapshot(this.id, {
      engine: serialize(this.engine),
      clock: { ...this.clock.snapshot(), mode: this.clock.mode },
    });
  }

  /**
   * Sleep until the next event is due, or not at all when game time will not move by itself
   * (paused, stopped, manual, empty queue). Called after every change that could move the due time.
   */
  private reschedule(): void {
    this.clearTimer();
    if (this.closed) return;
    const next = this.engine.queue[0];
    if (!next || this.clock.status !== 'running' || this.clock.mode === 'manual') return;
    const delay = Math.min(
      MAX_SLEEP_MS,
      Math.max(0, this.clock.wallDueFor(next.time) - this.wallNow()),
    );
    this.timer = this.timers.setTimeout(() => {
      this.timerSet = false;
      this.enqueue(() => this.tick()).catch((e) => this.onError?.(e));
    }, delay);
    this.timerSet = true;
  }

  private async tick(): Promise<void> {
    if (this.clock.status === 'running' && this.clock.mode === 'fast-forward') {
      // Nothing is waited for: jump to the next event, one instant per tick.
      const next = this.engine.queue[0];
      if (next && next.time <= (this.clock.barrier ?? Infinity)) {
        this.clock.advanceTo(Math.max(next.time, this.clock.now()));
        this.sync();
      }
    } else {
      this.sync();
    }
    try {
      await this.persist();
    } finally {
      this.reschedule();
    }
  }

  private async apply(command: GameCommand): Promise<CommandResult> {
    const entry: InputLogEntry = { seq: ++this.seq, wallMs: this.wallNow(), gameMs: 0, command };
    let result: CommandResult;
    try {
      this.sync();
      entry.gameMs = this.engine.time;
      result = await this.run(command);
    } catch (e) {
      entry.error = e instanceof Error ? e.message : String(e);
      result = { ok: false, kind: 'rejection', reason: entry.error };
    }
    await this.commit(entry);
    return result;
  }

  /** Log an input, bring the world up to date and save. */
  private async commit(entry: InputLogEntry): Promise<void> {
    // A failing store must not leave the scheduler unarmed after the clock already changed.
    try {
      await this.store.appendInput(this.id, entry);
      this.sync();
      await this.persist();
    } finally {
      this.reschedule();
    }
  }

  private async run(command: GameCommand): Promise<CommandResult> {
    switch (command.kind) {
      case 'setRate':
        this.clock.setRate(command.rate);
        return { ok: true };
      case 'pause':
        this.clock.pause();
        return { ok: true };
      case 'resume':
        this.clock.resume();
        return { ok: true };
      case 'setMode':
        this.clock.setMode(command.mode);
        return { ok: true };
      case 'advanceTo':
        this.clock.advanceTo(command.gameMs);
        return { ok: true };
      case 'order':
        throw new Error('orders go through submitOrder');
    }
  }

  /**
   * Sign an order. The parse runs in the background with the signing time recorded as a pending
   * dependency; the returned promise settles when the result has been applied (or refused).
   */
  private submitOrder(command: Extract<GameCommand, { kind: 'order' }>): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve, reject) => {
      this.enqueue(async () => {
        this.sync();
        // The order is signed now. A paused game stamps it with the paused time and its courier
        // leaves when the clock resumes (it is queued at that time, and the engine only moves on).
        const dep: Dependency = {
          id: this.nextDependency++,
          neededAt: this.engine.time,
          settle: resolve,
          abandoned: false,
        };
        const entry: InputLogEntry = {
          seq: ++this.seq,
          wallMs: this.wallNow(),
          gameMs: dep.neededAt,
          command,
        };
        // The parse sees the world as it is at signing time, which the barrier keeps current.
        const context = { ...this.engine.world, side: command.side };
        this.dependencies.set(dep.id, dep);
        this.syncBarrier();
        this.reschedule();
        void this.parseWithRetries(command.text, context).then((outcome) =>
          this.enqueueCompletion(() => this.completeOrder(dep, command, entry, outcome)).catch(
            (e) => {
              this.dependencies.delete(dep.id);
              if (!dep.abandoned) reject(e);
            },
          ),
        );
      }).catch(reject);
    });
  }

  /** Parse with a timeout per attempt, retrying failures, then falling back. Never throws. */
  private async parseWithRetries(
    text: string,
    context: Parameters<OrderParser['parse']>[1],
  ): Promise<ParseOutcome> {
    const attempts = this.parseRetries + 1;
    let error = '';
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) await this.sleep(this.parseRetryDelayMs);
      try {
        return { parsed: await this.withTimeout(this.parser.parse(text, context)) };
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
    // Conservative interpretation: nothing is issued and the unit keeps doing what it was doing.
    return {
      parsed: {
        kind: 'clarification',
        text,
        question:
          'Staff could not make sense of that order in time. It was not sent; please restate it.',
      },
      fallback: { attempts, error },
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => this.timers.setTimeout(r, ms));
  }

  private withTimeout<T>(work: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const handle = this.timers.setTimeout(
        () => reject(new Error(`parse timed out after ${this.parseTimeoutMs} ms`)),
        this.parseTimeoutMs,
      );
      work.then(
        (v) => {
          this.timers.clearTimeout(handle);
          resolve(v);
        },
        (e) => {
          this.timers.clearTimeout(handle);
          reject(e);
        },
      );
    });
  }

  /** Queue the application of a result. Allowed while closing so the dependency is settled. */
  private enqueueCompletion<T>(job: () => Promise<T>): Promise<T> {
    const run = this.tail.then(job);
    this.tail = run.catch(() => undefined);
    return run;
  }

  /** Hold the clock at the earliest pending dependency, or release it. */
  private syncBarrier(): void {
    let earliest: number | undefined;
    for (const d of this.dependencies.values()) {
      if (earliest === undefined || d.neededAt < earliest) earliest = d.neededAt;
    }
    const before = this.clock.barrier;
    this.clock.setBarrier(earliest);
    if (before !== earliest) {
      this.onStaffAtWork?.(
        earliest === undefined ? { working: false } : { working: true, needAtMs: earliest },
      );
    }
  }

  private async completeOrder(
    dep: Dependency,
    command: Extract<GameCommand, { kind: 'order' }>,
    entry: InputLogEntry,
    outcome: ParseOutcome,
  ): Promise<void> {
    if (dep.abandoned) return;
    this.dependencies.delete(dep.id);
    // The clock re-anchors here: game time carries on from the barrier, it does not jump.
    this.syncBarrier();
    const { parsed, fallback } = outcome;
    entry.parse = parsed;
    if (fallback) {
      entry.fallback = fallback;
      entry.error = `parser failed: ${fallback.error}`;
    }
    let result: CommandResult;
    try {
      result = this.applyParsed(dep, command, entry.seq, parsed);
    } catch (e) {
      entry.error = e instanceof Error ? e.message : String(e);
      result = { ok: false, kind: 'rejection', reason: entry.error };
    }
    try {
      await this.commit(entry);
    } catch (e) {
      dep.settle({
        ok: false,
        kind: 'rejection',
        reason: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
    dep.settle(result);
  }

  private applyParsed(
    dep: Dependency,
    command: Extract<GameCommand, { kind: 'order' }>,
    seq: number,
    parsed: ParseResult,
  ): CommandResult {
    if (parsed.kind === 'clarification') {
      return {
        ok: false,
        kind: 'clarification',
        question: parsed.question,
        options: parsed.options,
      };
    }
    if (parsed.kind === 'rejection') return { ok: false, kind: 'rejection', reason: parsed.reason };
    const intents = toEngineIntents(parsed);
    if (typeof intents === 'string') return { ok: false, kind: 'rejection', reason: intents };

    const order: Order = {
      id: `${this.id}-o${seq}`,
      side: command.side as Order['side'],
      to: parsed.unitId,
      issuedAt: dep.neededAt,
      text: parsed.text,
      intents,
    };
    // The barrier held the engine at the signing time, so queueing at it is never in the past.
    this.engine = issueOrder(this.engine, order, dep.neededAt);
    return { ok: true, orderId: order.id };
  }
}

/** Rebuild engine state from a stored snapshot. */
export function restoreEngine(serialized: string): EngineState<GameState> {
  return deserialize<GameState>(serialized);
}
