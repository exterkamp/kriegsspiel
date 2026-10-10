/**
 * GameActor: the single writer for one game. See docs/architecture.md (Scheduler and event
 * queue, Single writer per game).
 *
 * All changes go through one serial command queue, so the log is a total order and there are
 * no races. The scheduler sleeps until the next engine event is due in wall time and wakes
 * early on any command (rate, pause, mode, order). Quiet stretches cost nothing: a command
 * first advances the world to "now", then applies itself.
 *
 * Orders are parsed (awaited) before they enter the engine, so the courier leaves only once
 * the parse result is known. While a parse is in flight the engine is not advanced, and it
 * catches up afterwards at the same game times it would have fired. The full LLM barrier,
 * with a re-anchoring clock, arrives in Epic #3.
 */
import {
  advanceTo,
  deserialize,
  featureAnchor,
  serialize,
  viewFor,
  type EmittedEvent,
  type EngineState,
  type EventRegistry,
  type GameState,
} from '@kriegsspiel/engine';
import { GameClock, type WallClock } from '../clock.js';
import {
  NOOP_TRACE,
  currentCorrelationId,
  newCorrelationId,
  withCorrelationId,
  type TraceSink,
} from '../debug/trace.js';
import type { OrderParser, ParseContext, ParseResult } from '../orders/index.js';
import { applyLoggedOrder } from './replay.js';
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
  /** Debug trace. Defaults to a no-op sink that stores nothing. */
  trace?: TraceSink;
  timers?: Timers;
  /** Called with events the engine emitted, in firing order. */
  onEmitted?: (events: EmittedEvent[]) => void;
  /** Called when a background tick fails (a command's failure is returned to its caller). */
  onError?: (error: unknown) => void;
  /** Starting value for the input counter when resuming a game. */
  seq?: number;
  /** Take a snapshot after this many logged inputs (default 1: after every input). */
  snapshotEvery?: number;
}

export class GameActor {
  readonly id: string;
  private engine: EngineState<GameState>;
  private readonly registry: EventRegistry<GameState>;
  private readonly clock: GameClock;
  private readonly wallNow: WallClock;
  private readonly parser: OrderParser;
  private readonly store: GameStore;
  private readonly trace: TraceSink;
  private readonly timers: Timers;
  private readonly onEmitted?: (events: EmittedEvent[]) => void;
  private readonly onError?: (error: unknown) => void;
  private seq: number;
  private readonly snapshotEvery: number;
  /** Seq covered by the newest stored snapshot. */
  private snapshotSeq: number;
  /** How many clock history entries the store already has. */
  private historySaved = 0;

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
    this.trace = options.trace ?? NOOP_TRACE;
    this.timers = options.timers ?? realTimers;
    this.onEmitted = options.onEmitted;
    this.onError = options.onError;
    this.seq = options.seq ?? 0;
    this.snapshotSeq = -1;
    this.snapshotEvery = Math.max(1, Math.floor(options.snapshotEvery ?? 1));
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
      await this.persistProgress();
      this.reschedule();
    });
  }

  /** Queue a command. Resolves when it has been applied. */
  submit(command: GameCommand): Promise<CommandResult> {
    if (!this.trace.enabled) return this.enqueue(() => this.apply(command));
    // The id of the request being handled, or a fresh one for a caller outside any request.
    const id = currentCorrelationId() ?? newCorrelationId();
    return this.enqueue(() => withCorrelationId(id, () => this.apply(command)));
  }

  /** Stop the scheduler, finish queued work, and refuse new commands. Safe to call twice. */
  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.clearTimer();
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
    if (res.emitted.length > 0) {
      if (this.trace.enabled) {
        for (const event of res.emitted) this.trace.record(this.id, 'engine', event);
      }
      this.onEmitted?.(res.emitted);
    }
  }

  /** Store a snapshot, with the per-side views as of it. Recovery starts from the newest one. */
  private async persist(): Promise<void> {
    const seq = this.seq;
    await this.store.saveSnapshot(this.id, {
      seq,
      engine: serialize(this.engine),
      clock: { ...this.clock.snapshot(), mode: this.clock.mode },
    });
    this.snapshotSeq = seq;
    const { world, time } = this.engine;
    const views: Record<string, unknown> = {};
    for (const side of world.sides) views[side.id] = viewFor(world, side.id, time);
    await this.store.saveViews(this.id, { seq, gameMs: time, views });
  }

  /**
   * Cheap bookkeeping after anything that moved game time or the clock: how far time has run
   * (so recovery can catch up to it) and any new clock history.
   */
  private async persistProgress(): Promise<void> {
    await this.store.saveProgress(this.id, this.engine.time);
    const history = this.clock.history();
    if (history.length > this.historySaved) {
      await this.store.appendClockHistory(this.id, history.slice(this.historySaved));
      this.historySaved = history.length;
    }
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
      // Round up: waking a fraction early finds the event not yet due and spins at zero delay.
      Math.max(0, Math.ceil(this.clock.wallDueFor(next.time) - this.wallNow())),
    );
    this.timer = this.timers.setTimeout(() => {
      this.timerSet = false;
      this.enqueue(() => this.traced(() => this.tick())).catch((e) => {
        if (this.trace.enabled) this.trace.record(this.id, 'error', { source: 'tick', error: e });
        this.onError?.(e);
      });
    }, delay);
    this.timerSet = true;
  }

  /** Give scheduler work its own correlation id, so the events it fires are grouped. */
  private traced<T>(fn: () => Promise<T>): Promise<T> {
    return this.trace.enabled ? withCorrelationId(newCorrelationId(), fn) : fn();
  }

  private async tick(): Promise<void> {
    if (this.clock.status === 'running' && this.clock.mode === 'fast-forward') {
      // Nothing is waited for: jump to the next event, one instant per tick.
      const next = this.engine.queue[0];
      if (next) {
        this.clock.advanceTo(Math.max(next.time, this.clock.now()));
        this.sync();
      }
    } else {
      this.sync();
    }
    try {
      await this.persistProgress();
    } finally {
      this.reschedule();
    }
  }

  private async apply(command: GameCommand): Promise<CommandResult> {
    const entry: InputLogEntry = { seq: ++this.seq, wallMs: this.wallNow(), gameMs: 0, command };
    let result: CommandResult;
    const tracing = this.trace.enabled;
    if (tracing) this.trace.record(this.id, 'command', { seq: entry.seq, command });
    const before = tracing ? this.clockView() : undefined;
    try {
      this.sync();
      entry.gameMs = this.engine.time;
      result = await this.run(command, entry);
      this.sync();
      entry.endGameMs = this.engine.time;
    } catch (e) {
      entry.error = e instanceof Error ? e.message : String(e);
      result = { ok: false, kind: 'rejection', reason: entry.error };
    }
    if (tracing) {
      if (entry.error)
        this.trace.record(this.id, 'error', { source: 'command', error: entry.error });
      const after = this.clockView();
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        this.trace.record(this.id, 'clock', { seq: entry.seq, before, after });
      }
    }
    // A failing store must not leave the scheduler unarmed after the clock already changed.
    try {
      await this.store.appendInput(this.id, entry);
      this.sync();
      await this.persistProgress();
      if (this.seq - this.snapshotSeq >= this.snapshotEvery) await this.persist();
    } finally {
      this.reschedule();
    }
    return result;
  }

  private clockView() {
    return {
      status: this.clock.status,
      mode: this.clock.mode,
      rate: this.clock.rate,
      gameMs: this.clock.now(),
    };
  }

  private async run(command: GameCommand, entry: InputLogEntry): Promise<CommandResult> {
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
        return this.runOrder(command, entry);
    }
  }

  /** What the parser may read: the issuing side, named places and the side's own units. */
  private parseContext(side: string): ParseContext {
    const { map, units } = this.engine.world;
    return {
      side,
      map: {
        features: map.features.map((f) => ({
          id: f.id,
          kind: f.kind,
          ...(f.name === undefined ? {} : { name: f.name }),
          anchor: featureAnchor(f.geometry),
        })),
      },
      units: units.map((u) => ({ id: u.id, side: u.side, name: u.name, center: u.center })),
    };
  }

  private async runOrder(
    command: Extract<GameCommand, { kind: 'order' }>,
    entry: InputLogEntry,
  ): Promise<CommandResult> {
    // The order is signed now. A paused game stamps it with the paused time and its courier
    // leaves when the clock resumes (it is queued at that time, and the engine only moves on).
    let parsed: ParseResult;
    try {
      parsed = await this.parser.parse(command.text, this.parseContext(command.side));
    } catch (e) {
      const reason = `parser failed: ${e instanceof Error ? e.message : String(e)}`;
      entry.parse = { kind: 'rejection', text: command.text, reason };
      return { ok: false, kind: 'rejection', reason };
    }
    entry.parse = parsed;
    const applied = applyLoggedOrder(this.engine, this.id, entry.seq, command.side, parsed);
    if ('reason' in applied) {
      if (parsed.kind === 'clarification') {
        return {
          ok: false,
          kind: 'clarification',
          question: parsed.question,
          options: parsed.options,
        };
      }
      return { ok: false, kind: 'rejection', reason: applied.reason };
    }
    this.engine = applied.state;
    return { ok: true, orderId: applied.orderId };
  }
}

/** Rebuild engine state from a stored snapshot. */
export function restoreEngine(serialized: string): EngineState<GameState> {
  return deserialize<GameState>(serialized);
}
