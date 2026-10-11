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
  deserialize,
  featureAnchor,
  serialize,
  viewFor,
  type EmittedEvent,
  type EngineState,
  type EventRegistry,
  type GameState,
  type SideId,
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
import type { AgentOrder, SideAgent } from '../opponent/index.js';
import { PauseVoting, type PauseConfig, type PauseTransition } from '../pause.js';
import { RatioVoting, type RatioTransition } from '../ratioVote.js';
import { advanceUntilOver, applyLoggedOrder } from './replay.js';
import {
  narrateReports,
  narrateWindowMs,
  reportsDueForNarration,
  type UmpireCallRecord,
  type UmpireRequest,
  type UmpireClient,
} from '../umpire/index.js';
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
  /** Debug trace. Defaults to a no-op sink that stores nothing. */
  trace?: TraceSink;
  timers?: Timers;
  /** Called with events the engine emitted, in firing order. */
  onEmitted?: (events: EmittedEvent[]) => void;
  /**
   * Called after every tick and every command has been applied and saved, whether or not the
   * world changed. Listeners read `state` and `gameClock`; they must not throw.
   */
  onUpdate?: () => void;
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
  /** Take a snapshot after this many logged inputs (default 1: after every input). */
  snapshotEvery?: number;
  /**
   * The umpire client for the narrate stage. Set: once per side per window the side's due reports
   * are narrated (holding game time, like an order parse) and the text replaces the template text
   * in its view. Unset: players see the template text.
   */
  umpire?: UmpireClient;
  /** Server-side agents that play scripted sides (see `opponent/`). */
  agents?: SideAgent[];
  /** Pause voting: who votes and the host's rules. Unset: the vote commands are refused. */
  pause?: PauseConfig;
  /** Set when the game was reopened after the server went down: wall ms it was down (estimated). */
  restart?: { downMs: number };
}

interface AgentSlot {
  agent: SideAgent;
  /** Game time of its next decision. */
  nextAt: number;
  /**
   * Its last decision changed nothing and nothing has happened in the world since. With an empty
   * event queue the world cannot change by itself, so thinking again would only spin the clock.
   */
  idle: boolean;
  /** An async decision is in flight (the LLM barrier holds game time meanwhile). */
  pending: boolean;
}

interface Dependency {
  id: number;
  /** Game time at which the result is needed. */
  neededAt: number;
  settle: (result: CommandResult) => void;
  abandoned: boolean;
}

/** Narrated text by report id for one side; `null` marks a report folded into another's dispatch. */
type SideNarration = Map<string, string | null>;

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
  private readonly trace: TraceSink;
  private readonly timers: Timers;
  private readonly parseTimers = new Set<unknown>();
  private readonly onEmitted?: (events: EmittedEvent[]) => void;
  private readonly onUpdate?: () => void;
  private readonly onError?: (error: unknown) => void;
  private readonly onStaffAtWork?: (state: StaffAtWork) => void;
  private readonly parseRetries: number;
  private readonly parseTimeoutMs: number;
  private readonly parseRetryDelayMs: number;
  private seq: number;
  private readonly agents: AgentSlot[];
  /** Agent orders issued since the last flush, to be appended to the input log in order. */
  private agentLog: InputLogEntry[] = [];
  private readonly snapshotEvery: number;
  /** Seq covered by the newest stored snapshot. */
  private snapshotSeq: number;
  /** How many clock history entries the store already has. */
  private historySaved = 0;
  /** Pending LLM dependencies: the game time each is needed and how to answer its caller. */
  private readonly dependencies = new Map<number, Dependency>();
  private nextDependency = 1;
  private readonly umpire: UmpireClient | undefined;
  /** Game time up to which each side's reports have been handed to the narrate stage. */
  private readonly narratedUntil = new Map<string, number>();
  private readonly narrations = new Map<string, SideNarration>();
  private readonly narrating = new Set<string>();

  /** The pause state machine; absent when the game has no voters configured. */
  private readonly pauseVoting: PauseVoting | undefined;
  /** The ratio vote; present when the game has voters. */
  private readonly ratioVoting: RatioVoting | undefined;
  private readonly pauseLog: { n: number; step: PauseTransition }[] = [];
  private pauseStepCount = 0;
  private pauseTimer: unknown;
  private pauseTimerSet = false;
  private readonly restartInfo: { downMs: number } | undefined;

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
    this.onUpdate = options.onUpdate;
    this.onError = options.onError;
    this.onStaffAtWork = options.onStaffAtWork;
    this.parseRetries = options.parseRetries ?? DEFAULT_PARSE_RETRIES;
    this.parseTimeoutMs = options.parseTimeoutMs ?? DEFAULT_PARSE_TIMEOUT_MS;
    this.parseRetryDelayMs = options.parseRetryDelayMs ?? DEFAULT_PARSE_RETRY_DELAY_MS;
    this.seq = options.seq ?? 0;
    this.umpire = options.umpire;
    // Reports from before this actor started (a reopened game) keep their template text.
    for (const side of this.engine.world.sides) this.narratedUntil.set(side.id, this.engine.time);
    this.restartInfo = options.restart;
    // Decisions fall on multiples of the interval; a resumed game picks up at the next one.
    const t = this.engine.time;
    this.agents = (options.agents ?? []).map((agent) => ({
      agent,
      nextAt: t === 0 ? 0 : (Math.floor(t / agent.intervalMs) + 1) * agent.intervalMs,
      idle: false,
      pending: false,
    }));
    if (options.pause) {
      this.pauseVoting = new PauseVoting(options.pause, {
        phase: this.clock.status === 'running' ? 'running' : 'paused',
        nowMs: this.wallNow(),
      });
      this.ratioVoting = new RatioVoting(options.pause);
    }
    this.snapshotSeq = -1;
    this.snapshotEvery = Math.max(1, Math.floor(options.snapshotEvery ?? 1));
  }

  /** What `side` is shown in place of template text: pass to `sideViewOf`. */
  narrationFor(side: string): ReadonlyMap<string, string | null> | undefined {
    return this.narrations.get(side);
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

  /** The pause vote: its phase and the open proposal, for the views. Undefined without voters. */
  get pauseState():
    | { phase: PauseVoting['phase']; proposal: PauseVoting['open']; voters: number; nowMs: number }
    | undefined {
    return (
      this.pauseVoting && {
        phase: this.pauseVoting.phase,
        proposal: this.pauseVoting.open,
        voters: this.pauseVoting.voterCount,
        nowMs: this.wallNow(),
      }
    );
  }

  /**
   * The newest pause transitions since this actor started, numbered from 1 and capped, so a
   * connection can tell the players what was settled since it last looked.
   */
  get pauseSteps(): readonly { n: number; step: PauseTransition }[] {
    return this.pauseLog;
  }

  /** Set when this game was reopened after downtime: the players are told it came back paused. */
  get restart(): { downMs: number } | undefined {
    return this.restartInfo;
  }

  /** The open ratio vote, for the views. Undefined without voters. */
  get ratioState(): { proposal: RatioVoting['open'] } | undefined {
    return this.ratioVoting && { proposal: this.ratioVoting.open };
  }

  /** Persist the starting snapshot and start the scheduler. */
  async start(): Promise<void> {
    await this.enqueue(async () => {
      // Journal the downtime first, so the log shows the gap before anything else happens.
      if (this.restartInfo) await this.apply({ kind: 'restart', downMs: this.restartInfo.downMs });
      await this.persist();
      await this.persistProgress();
      this.reschedule();
    });
  }

  /** Queue a command. Resolves when it has been applied. */
  submit(command: GameCommand): Promise<CommandResult> {
    // The id of the request being handled, or a fresh one for a caller outside any request.
    const id = this.trace.enabled ? (currentCorrelationId() ?? newCorrelationId()) : undefined;
    if (command.kind === 'order') return this.submitOrder(command, id);
    if (id === undefined) return this.enqueue(() => this.apply(command));
    return this.enqueue(() => withCorrelationId(id, () => this.apply(command)));
  }

  /** Stop the scheduler, finish queued work, and refuse new commands. Safe to call twice. */
  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.clearTimer();
      this.clearPauseTimer();
      for (const handle of [...this.parseTimers]) this.clearParseTimer(handle);
      // Abandon work still with the umpire: its callers are told, and a late result is ignored.
      this.narrating.clear();
      for (const dep of [...this.dependencies.values()]) {
        dep.abandoned = true;
        this.dependencies.delete(dep.id);
        dep.settle({ ok: false, kind: 'rejection', reason: `game ${this.id} is closed` });
      }
    }
    await this.tail.catch(() => undefined);
    // A clean stop: the next start measures downtime from here, not from the last tick.
    await this.store.saveHeartbeat(this.id, this.wallNow()).catch(() => undefined);
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
    this.beginNarrations();
  }

  /**
   * Start the narrate stage for each side whose window has closed with reports due. Like a parse,
   * it holds game time at this instant until it settles (the LLM barrier), so the text a player
   * sees does not depend on how fast the model answered.
   */
  private beginNarrations(): void {
    const umpire = this.umpire;
    if (!umpire || this.closed || this.engine.world.outcome) return;
    const now = this.engine.time;
    for (const side of this.engine.world.sides) {
      if (this.narrating.has(side.id)) continue;
      const since = this.narratedUntil.get(side.id) ?? now;
      if (now < since + narrateWindowMs(this.clock.rate)) continue;
      // The window is closed: reports delivered later belong to the next one, whether or not any are due.
      this.narratedUntil.set(side.id, now);
      const due = reportsDueForNarration(
        viewFor(this.engine.world, side.id, now).reports,
        since,
        now,
        this.clock.rate,
      );
      if (due.length === 0) continue;
      this.narrating.add(side.id);
      const before = this.clock.barrier;
      const dep: Dependency = {
        id: this.nextDependency++,
        neededAt: this.clock.holdAtNow(),
        settle: () => undefined,
        abandoned: false,
      };
      this.dependencies.set(dep.id, dep);
      this.refreshBarrier();
      this.announceStaff(before);
      const calls: UmpireCallRecord[] = [];
      // Every call the stage makes is kept for the log, whatever the wrapped client is.
      const client: UmpireClient = {
        call: async <T>(request: UmpireRequest) => {
          const res = await umpire.call<T>(request);
          calls.push(res.record);
          return res;
        },
      };
      const work = this.withTimeout(narrateReports(client, side.id as SideId, due)).then(
        (result) => result,
        (e) => {
          if (this.trace.enabled) {
            this.trace.record(this.id, 'error', { source: 'narrate', error: e });
          }
          return undefined;
        },
      );
      void work
        .then((result) =>
          this.enqueueCompletion(() => this.completeNarration(side.id, dep, now, result, calls)),
        )
        .catch((e) => {
          this.dependencies.delete(dep.id);
          this.narrating.delete(side.id);
          if (!dep.abandoned) this.onError?.(e);
        });
    }
  }

  private async completeNarration(
    side: string,
    dep: Dependency,
    windowEndMs: number,
    result: Awaited<ReturnType<typeof narrateReports>> | undefined,
    calls: UmpireCallRecord[],
  ): Promise<void> {
    if (dep.abandoned) return;
    this.dependencies.delete(dep.id);
    this.narrating.delete(side);
    this.syncBarrier();
    try {
      // A failed or timed-out stage leaves the template text, which is what the view shows already.
      if (result && !result.fellBack) {
        const text = this.narrations.get(side) ?? new Map<string, string | null>();
        for (const d of result.dispatches) {
          d.reportIds.forEach((id, i) => text.set(id, i === 0 ? d.text : null));
        }
        this.narrations.set(side, text);
      }
      this.sync();
      const entry: InputLogEntry = {
        seq: ++this.seq,
        wallMs: this.wallNow(),
        gameMs: this.engine.time,
        endGameMs: this.engine.time,
        command: { kind: 'narrate', side, windowEndMs },
        calls,
        ...(result?.fellBack ? { error: 'narration fell back to template text' } : {}),
        ...(result === undefined ? { error: 'narration failed' } : {}),
      };
      if (this.trace.enabled) this.trace.record(this.id, 'command', entry);
      await this.commit(entry);
    } finally {
      this.reschedule();
      this.notify();
    }
  }

  /**
   * Advance to `target`, stopping at each time a scripted agent is due to think. An agent sees
   * the world as `viewFor` shows its side at that instant, and its orders are issued then, so the
   * outcome does not depend on how often the scheduler wakes.
   */
  private advanceEngine(target: number): void {
    const emitted: EmittedEvent[] = [];
    const step = (to: number) => {
      const res = advanceUntilOver(this.engine, to, this.registry);
      this.engine = res.state;
      emitted.push(...res.emitted);
      // Something happened, so an agent that found nothing to do may now have something.
      if (res.emitted.length > 0) for (const a of this.agents) a.idle = false;
    };
    try {
      for (;;) {
        const due = this.nextAgent();
        if (!due || due.nextAt > target || this.engine.world.outcome) break;
        step(due.nextAt);
        due.nextAt += due.agent.intervalMs;
        if (this.engine.world.outcome) continue;
        if (due.agent.decide) this.beginDecision(due);
        else due.idle = !this.think(due.agent) && (due.agent.settled?.() ?? true);
      }
      step(target);
    } finally {
      // A finished game does not run on.
      if (this.engine.world.outcome && this.clock.status !== 'stopped') this.clock.stop();
      if (emitted.length > 0) {
        if (this.trace.enabled) {
          for (const event of emitted) this.trace.record(this.id, 'engine', event);
        }
        this.onEmitted?.(emitted);
      }
    }
  }

  /** Game time the soonest narration window closes, when the narrate stage is on. */
  private nextNarrationAt(): number | undefined {
    if (!this.umpire || this.engine.world.outcome) return undefined;
    let next: number | undefined;
    for (const side of this.engine.world.sides) {
      if (this.narrating.has(side.id)) continue;
      const at =
        (this.narratedUntil.get(side.id) ?? this.engine.time) + narrateWindowMs(this.clock.rate);
      if (next === undefined || at < next) next = at;
    }
    return next;
  }

  /** The agent due to think soonest, leaving out idle ones when no event is queued to wake them. */
  private nextAgent(): AgentSlot | undefined {
    const waiting = this.engine.queue.length > 0;
    return this.agents.reduce<AgentSlot | undefined>(
      (best, a) =>
        a.pending || (a.idle && !waiting) || (best && best.nextAt <= a.nextAt) ? best : a,
      undefined,
    );
  }

  /** Run one decision: the same order path as a human's, logged so replay needs no agent. */
  private think(agent: SideAgent): boolean {
    const view = viewFor(this.engine.world, agent.side as SideId, this.engine.time);
    return this.issueAgentOrders(agent, agent.think(view));
  }

  /**
   * Start an async decision (an LLM commander). Like an order being parsed, it holds game time at
   * the moment it began until it settles (the LLM barrier), so the model never falls behind the
   * game and the result is applied at a time replay reproduces from the log. A decision that fails
   * or times out is handed to the agent's synchronous `think`, which must always be able to play.
   */
  private beginDecision(slot: AgentSlot): void {
    const agent = slot.agent;
    const view = viewFor(this.engine.world, agent.side as SideId, this.engine.time);
    const before = this.clock.barrier;
    const dep: Dependency = {
      id: this.nextDependency++,
      neededAt: this.clock.holdAtNow(),
      settle: () => undefined,
      abandoned: false,
    };
    slot.pending = true;
    this.dependencies.set(dep.id, dep);
    this.refreshBarrier();
    this.announceStaff(before);
    const decided = (async (): Promise<AgentOrder[] | undefined> => {
      try {
        return await this.withTimeout(agent.decide!(view));
      } catch (e) {
        if (this.trace.enabled) this.trace.record(this.id, 'error', { source: 'agent', error: e });
        return undefined;
      }
    })();
    void decided
      .then((orders) => this.enqueueCompletion(() => this.completeDecision(slot, dep, orders)))
      .catch((e) => {
        this.dependencies.delete(dep.id);
        slot.pending = false;
        if (!dep.abandoned) this.onError?.(e);
      });
  }

  private async completeDecision(
    slot: AgentSlot,
    dep: Dependency,
    decided: AgentOrder[] | undefined,
  ): Promise<void> {
    if (dep.abandoned) return;
    this.dependencies.delete(dep.id);
    slot.pending = false;
    // The clock carries on from the barrier; the world catches up to it before the orders go in.
    this.syncBarrier();
    try {
      this.sync();
      if (!this.engine.world.outcome) {
        const agent = slot.agent;
        const orders =
          decided ??
          agent.think(viewFor(this.engine.world, agent.side as SideId, this.engine.time));
        const changed = this.issueAgentOrders(agent, orders);
        slot.idle = !changed && (agent.settled?.() ?? true);
      }
      await this.persistProgress();
    } finally {
      this.reschedule();
      this.notify();
    }
  }

  /** Issue an agent's orders through the human order path, logging each for replay. */
  private issueAgentOrders(agent: SideAgent, orders: AgentOrder[]): boolean {
    let changed = false;
    for (const o of orders) {
      const parsed: ParseResult = {
        kind: 'intents',
        text: o.text,
        unitId: o.unitId,
        intents: o.intents ?? [o.intent],
      };
      const entry: InputLogEntry = {
        seq: ++this.seq,
        wallMs: this.wallNow(),
        gameMs: this.engine.time,
        endGameMs: this.engine.time,
        command: { kind: 'order', side: agent.side, text: o.text },
        parse: parsed,
        agent: true,
      };
      const applied = applyLoggedOrder(this.engine, this.id, entry.seq, agent.side, parsed);
      if ('reason' in applied) entry.error = applied.reason;
      else {
        this.engine = applied.state;
        changed = true;
      }
      if (this.trace.enabled) this.trace.record(this.id, 'command', entry);
      this.agentLog.push(entry);
    }
    return changed;
  }

  /** Append the agent orders issued so far, before anything logged after them. */
  private async flushAgentLog(): Promise<void> {
    while (this.agentLog.length > 0) {
      const entry = this.agentLog.shift()!;
      await this.store.appendInput(this.id, entry);
    }
  }

  /** Store a snapshot, with the per-side views as of it. Recovery starts from the newest one. */
  private async persist(): Promise<void> {
    await this.flushAgentLog();
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
    // Agents think on ticks with no command to carry their orders into the log.
    await this.flushAgentLog();
    await this.store.saveProgress(this.id, this.engine.time);
    await this.store.saveHeartbeat(this.id, this.wallNow());
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
    this.reschedulePause();
    if (this.closed) return;
    const nextEvent = this.engine.queue[0];
    const nextThink = this.engine.world.outcome ? undefined : this.nextAgent()?.nextAt;
    const woken = [nextEvent?.time, nextThink, this.nextNarrationAt()].filter(
      (t) => t !== undefined,
    );
    const nextTime = woken.length > 0 ? Math.min(...woken) : undefined;
    if (nextTime === undefined || this.clock.status !== 'running' || this.clock.mode === 'manual') {
      return;
    }
    const delay = Math.min(
      MAX_SLEEP_MS,
      // Round up: waking a fraction early finds the event not yet due and spins at zero delay.
      Math.max(0, Math.ceil(this.clock.wallDueFor(nextTime) - this.wallNow())),
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

  private clearPauseTimer(): void {
    if (this.pauseTimerSet) this.timers.clearTimeout(this.pauseTimer);
    this.pauseTimerSet = false;
  }

  /** Wake at the next vote or pause deadline (wall time), which no game event accounts for. */
  private reschedulePause(): void {
    this.clearPauseTimer();
    const deadlines = [this.pauseVoting?.deadlineMs, this.ratioVoting?.deadlineMs].filter(
      (d) => d !== undefined,
    );
    if (this.closed || deadlines.length === 0) return;
    const deadline = Math.min(...deadlines);
    const delay = Math.min(MAX_SLEEP_MS, Math.max(0, deadline - this.wallNow()));
    this.pauseTimer = this.timers.setTimeout(() => {
      this.pauseTimerSet = false;
      // Checked when the job runs, so a vote that settled meanwhile logs nothing.
      this.enqueue(async () => {
        if (this.pauseVoting?.isDue(this.wallNow())) await this.apply({ kind: 'pauseExpire' });
        if (this.ratioVoting?.isDue(this.wallNow())) await this.apply({ kind: 'rateExpire' });
      }).catch((e) => {
        if (this.trace.enabled) this.trace.record(this.id, 'error', { source: 'pause', error: e });
        this.onError?.(e);
      });
    }, delay);
    this.pauseTimerSet = true;
  }

  /** Give scheduler work its own correlation id, so the events it fires are grouped. */
  private traced<T>(fn: () => Promise<T>): Promise<T> {
    return this.trace.enabled ? withCorrelationId(newCorrelationId(), fn) : fn();
  }

  private async tick(): Promise<void> {
    if (this.clock.status === 'running' && this.clock.mode === 'fast-forward') {
      // Nothing is waited for: jump to the next event, one instant per tick.
      const nextEvent = this.engine.queue[0];
      const nextThink = this.engine.world.outcome ? undefined : this.nextAgent()?.nextAt;
      const next =
        nextEvent && nextThink !== undefined
          ? Math.min(nextEvent.time, nextThink)
          : (nextEvent?.time ?? nextThink);
      if (next !== undefined && next <= (this.clock.barrier ?? Infinity)) {
        this.clock.advanceTo(Math.max(next, this.clock.now()));
        this.sync();
      }
    } else {
      this.sync();
    }
    try {
      await this.persistProgress();
    } finally {
      this.reschedule();
      this.notify();
    }
  }

  private notify(): void {
    try {
      this.onUpdate?.();
    } catch (e) {
      this.onError?.(e);
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
    await this.commit(entry);
    return result;
  }

  /** Log an input, bring the world up to date and save. */
  private async commit(entry: InputLogEntry): Promise<void> {
    // A failing store must not leave the scheduler unarmed after the clock already changed.
    try {
      await this.flushAgentLog();
      await this.store.appendInput(this.id, entry);
      this.sync();
      await this.persistProgress();
      // Not while an order is mid-parse: its seq is taken at signing but it is logged when the
      // parse completes, so a snapshot now would claim a seq whose entry is not in it or the log.
      if (this.dependencies.size === 0 && this.seq - this.snapshotSeq >= this.snapshotEvery) {
        await this.persist();
      }
    } finally {
      this.reschedule();
      this.notify();
    }
  }

  private clockView() {
    return {
      status: this.clock.status,
      mode: this.clock.mode,
      rate: this.clock.rate,
      gameMs: this.clock.now(),
    };
  }

  /** Apply what the pause machine decided to the game clock, and note it in the journal entry. */
  private applyPause(entry: InputLogEntry, steps: (PauseTransition | undefined)[]): void {
    for (const t of steps) {
      if (!t) continue;
      (entry.pause ??= []).push(t);
      this.pauseLog.push({ n: ++this.pauseStepCount, step: t });
      if (this.pauseLog.length > 20) this.pauseLog.shift();
      if (t.to === 'paused' && t.from !== 'resume_proposed') this.clock.pause();
      else if (t.to === 'running' && t.from !== 'pause_proposed') this.clock.resume();
    }
  }

  /** Apply what the ratio vote decided: a passed ratio re-anchors the clock, so time never jumps. */
  private applyRatio(entry: InputLogEntry, steps: RatioTransition[]): void {
    for (const t of steps) {
      (entry.ratio ??= []).push(t);
      if (t.outcome === 'passed') this.clock.setRate(t.rate);
    }
  }

  private requireRatioVoting(): RatioVoting {
    if (!this.ratioVoting) throw new Error('voting is not set up for this game');
    if (this.clock.status === 'stopped') throw new Error('clock is stopped');
    return this.ratioVoting;
  }

  private requirePauseVoting(): PauseVoting {
    if (!this.pauseVoting) throw new Error('pause voting is not set up for this game');
    if (this.clock.status === 'stopped') throw new Error('clock is stopped');
    return this.pauseVoting;
  }

  private async run(command: GameCommand, entry: InputLogEntry): Promise<CommandResult> {
    switch (command.kind) {
      case 'proposePause':
      case 'proposeResume': {
        const pv = this.requirePauseVoting();
        const want = command.kind === 'proposePause' ? 'running' : 'paused';
        if (pv.phase !== want) throw new Error(`cannot ${command.kind} while ${pv.phase}`);
        const reason = command.kind === 'proposePause' ? command.reason : undefined;
        this.applyPause(entry, [pv.propose(`p${entry.seq}`, command.by, this.wallNow(), reason)]);
        return { ok: true };
      }
      case 'vote': {
        const pv = this.requirePauseVoting();
        this.applyPause(entry, pv.vote(command.by, command.proposal, command.yes, this.wallNow()));
        return { ok: true };
      }
      case 'pauseExpire': {
        this.applyPause(entry, [this.pauseVoting?.expire(this.wallNow())]);
        return { ok: true };
      }
      case 'restart':
        return { ok: true };
      case 'proposeRate': {
        const rv = this.requireRatioVoting();
        const step = rv.propose(
          `r${entry.seq}`,
          command.by,
          command.rate,
          this.clock.rate,
          this.wallNow(),
        );
        this.applyRatio(entry, [step]);
        return { ok: true };
      }
      case 'rateVote': {
        const rv = this.requireRatioVoting();
        this.applyRatio(entry, rv.vote(command.by, command.proposal, command.yes, this.wallNow()));
        return { ok: true };
      }
      case 'rateExpire': {
        const step = this.ratioVoting?.expire(this.wallNow());
        this.applyRatio(entry, step ? [step] : []);
        return { ok: true };
      }
      case 'setRate':
        this.clock.setRate(command.rate);
        return { ok: true };
      case 'pause':
        this.clock.pause();
        this.pauseVoting?.force('paused', this.wallNow());
        return { ok: true };
      case 'resume':
        this.clock.resume();
        this.pauseVoting?.force('running', this.wallNow());
        return { ok: true };
      case 'setMode':
        this.clock.setMode(command.mode);
        return { ok: true };
      case 'advanceTo':
        this.clock.advanceTo(command.gameMs);
        return { ok: true };
      case 'order':
        throw new Error('orders go through submitOrder');
      case 'narrate':
        throw new Error('narration is logged by the scheduler');
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

  /**
   * Sign an order. The parse runs in the background with the signing time recorded as a pending
   * dependency; the returned promise settles when the result has been applied (or refused).
   */
  private submitOrder(
    command: Extract<GameCommand, { kind: 'order' }>,
    correlationId: string | undefined,
  ): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve, reject) => {
      const job = async () => {
        // The order is signed now. Hold game time at this instant in one step, so a wall clock
        // that moves meanwhile cannot leave the barrier behind the clock. A paused game stamps
        // the order with the paused time and its courier leaves when the clock resumes (it is
        // queued at that time, and the engine only moves on).
        const before = this.clock.barrier;
        const dep: Dependency = {
          id: this.nextDependency++,
          neededAt: this.clock.holdAtNow(),
          settle: resolve,
          abandoned: false,
        };
        this.dependencies.set(dep.id, dep);
        try {
          this.sync();
        } catch (e) {
          // Leave nothing held for a parse that will never start.
          this.dependencies.delete(dep.id);
          this.refreshBarrier();
          this.announceStaff(before);
          throw e;
        }
        const entry: InputLogEntry = {
          seq: ++this.seq,
          wallMs: this.wallNow(),
          gameMs: dep.neededAt,
          command,
        };
        // The parse sees the world as it is at signing time, which the barrier keeps current.
        const context = this.parseContext(command.side);
        if (this.trace.enabled) this.trace.record(this.id, 'command', { seq: entry.seq, command });
        this.refreshBarrier();
        this.announceStaff(before);
        this.reschedule();
        void this.parseWithRetries(dep, command.text, context).then((outcome) =>
          this.enqueueCompletion(() => this.completeOrder(dep, command, entry, outcome)).catch(
            (e) => {
              this.dependencies.delete(dep.id);
              if (!dep.abandoned) reject(e);
            },
          ),
        );
      };
      // The background parse and its completion inherit the request's correlation id.
      const run = correlationId === undefined ? job : () => withCorrelationId(correlationId, job);
      this.enqueue(run).catch(reject);
    });
  }

  /** Parse with a timeout per attempt, retrying failures, then falling back. Never throws. */
  private async parseWithRetries(
    dep: Dependency,
    text: string,
    context: Parameters<OrderParser['parse']>[1],
  ): Promise<ParseOutcome> {
    const attempts = this.parseRetries + 1;
    let error = '';
    for (let attempt = 1; attempt <= attempts; attempt++) {
      // A closed game's abandoned parse stops here: no more paid calls and no new timers.
      if (dep.abandoned) break;
      if (attempt > 1) {
        await this.sleep(this.parseRetryDelayMs);
        if (dep.abandoned) break;
      }
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

  /** A timer for the background parse, tracked so `close` can clear it. */
  private parseTimer(fn: () => void, ms: number): unknown {
    const handle = this.timers.setTimeout(() => {
      this.parseTimers.delete(handle);
      fn();
    }, ms);
    this.parseTimers.add(handle);
    return handle;
  }

  private clearParseTimer(handle: unknown): void {
    this.parseTimers.delete(handle);
    this.timers.clearTimeout(handle);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => this.parseTimer(r, ms));
  }

  private withTimeout<T>(work: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const handle = this.parseTimer(
        () => reject(new Error(`parse timed out after ${this.parseTimeoutMs} ms`)),
        this.parseTimeoutMs,
      );
      work.then(
        (v) => {
          this.clearParseTimer(handle);
          resolve(v);
        },
        (e) => {
          this.clearParseTimer(handle);
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
    const before = this.clock.barrier;
    this.refreshBarrier();
    this.announceStaff(before);
  }

  /** Move the clock's barrier to the earliest pending dependency, without announcing it. */
  private refreshBarrier(): void {
    let earliest: number | undefined;
    for (const d of this.dependencies.values()) {
      if (earliest === undefined || d.neededAt < earliest) earliest = d.neededAt;
    }
    this.clock.setBarrier(earliest);
  }

  /** Tell the listener when the barrier moved from `before`. */
  private announceStaff(before: number | undefined): void {
    const earliest = this.clock.barrier;
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
      result = this.applyParsed(command, entry.seq, parsed);
      this.sync();
      entry.endGameMs = this.engine.time;
    } catch (e) {
      entry.error = e instanceof Error ? e.message : String(e);
      result = { ok: false, kind: 'rejection', reason: entry.error };
    }
    if (entry.error && this.trace.enabled) {
      this.trace.record(this.id, 'error', { source: 'command', error: entry.error });
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
    command: Extract<GameCommand, { kind: 'order' }>,
    seq: number,
    parsed: ParseResult,
  ): CommandResult {
    // The barrier held the engine at the signing time, so the order is queued at it, never in the
    // past, exactly as replay builds it.
    const applied = applyLoggedOrder(
      this.engine,
      this.id,
      seq,
      command.side,
      parsed,
      command.courier,
    );
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
