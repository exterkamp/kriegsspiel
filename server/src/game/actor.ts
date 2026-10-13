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
  heldTurn,
  mayDraft,
  maySign,
  pursuitEndsAt,
  serialize,
  viewFor,
  type EmittedEvent,
  type EngineState,
  type EventRegistry,
  type GameState,
  type Seat,
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
import {
  checkDraftWithStaff,
  type EarlierOrder,
  type StaffCheckReport,
} from '../orders/staffCheck.js';
import type { AgentOrder, SideAgent } from '../opponent/index.js';
import { PauseVoting, type PauseConfig, type PauseTransition } from '../pause.js';
import { RatioVoting, type RatioTransition } from '../ratioVote.js';
import { advanceUntilOver, applyLoggedOrder } from './replay.js';
import { parseContextOf } from './parseContext.js';
import { hiddenTerms } from '../umpire/leakGuard.js';
import {
  breakerAllows,
  breakerAt,
  breakerCooldownMs,
  breakerSummary,
  closedBreaker,
  narrateReports,
  recordNarrateCall,
  type NarrateBreakerState,
  STAFF_OVERLOADED_NOTICE,
  narrateWindowMs,
  reportsDueForNarration,
  staffOfficerFor,
  writeStaffAnswer,
  type UmpireCallRecord,
  type UmpireRequest,
  type UmpireClient,
} from '../umpire/index.js';
import type {
  DeputyAccount,
  DeputySettings,
  Dissent,
  StaffExchange,
  TurnCause,
  TurnOrder,
  UmpirePersona,
} from '@kriegsspiel/protocol';
import { DeputyAgent } from '../deputy/deputy.js';
import type { GameCommand, GameStore, InputLogEntry } from './store.js';
import {
  NO_ADJUDICATOR,
  NO_ORDERS_RESOLVER,
  applyTurn,
  holdOrder,
  humanSides,
  sentOrdersOf,
  turnBounds,
  withdrawOrder,
  type OpenTurn,
  type TurnAgent,
  type TurnInput,
  type TurnResolution,
  type TurnResolver,
} from './turns.js';

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

/** The fixed refusal for clock and vote commands in a turn-mode game (D39). */
export const TURN_MODE_REFUSAL =
  'this is a turn-based game: game time moves only when a turn is resolved, so there is nothing to pause or speed up';

/** Where the open turn stands, as one side is shown it (`turnState`). */
export interface TurnStateView {
  turn: number;
  startsAt: number;
  endsAt: number;
  sent: string[];
  deadline?: number;
  resolving: boolean;
  /** The side's own held (or sent) orders. */
  held: TurnOrder[];
  /** The battle has been ruled (D13): the turn is its pursuit, and the game closes by this time. */
  pursuitUntil?: number;
}

/** Defaults for the parse retry policy. */
export const DEFAULT_PARSE_RETRIES = 2;
export const DEFAULT_PARSE_TIMEOUT_MS = 60_000;
/**
 * How long the narrate stage may hold game time. Longer than a parse: narration covers a whole window
 * and a local model takes 55 to 107 s under load, so the parse timeout threw good replies away and
 * left the template text (#342).
 */
export const DEFAULT_NARRATE_TIMEOUT_MS = 150_000;
export const DEFAULT_PARSE_RETRY_DELAY_MS = 1_000;

export type CommandResult =
  /** `stalledAt`: an admin step the LLM barrier held short of its target, and where it stopped. */
  | { ok: true; orderId?: string; stalledAt?: number }
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
  /** The conference records of a reopened game, from its input log (D6b). */
  staffHistory?: ReadonlyMap<string, readonly StaffExchange[]>;
  /** Each side's deputy settings and account for a reopened game, from its input log (D6f). */
  deputies?: ReadonlyMap<
    string,
    { settings: DeputySettings; seat?: Seat; account: readonly DeputyAccount[] }
  >;
  /** Whether the player who set a side's deputy has no connection open now. Unset: always away. */
  deputyAway?: (side: string, seat: Seat | undefined) => boolean;
  /** The dissents on record for a reopened game, from its input log (D6e). */
  dissents?: ReadonlyMap<string, readonly Dissent[]>;
  /** Extra parse attempts after a failure or timeout, before the fallback. Default 2. */
  parseRetries?: number;
  /** Wall ms to wait for one parse attempt. Default 60,000. */
  parseTimeoutMs?: number;
  /** How long the narrate stage may hold game time before the template text stays. Default `DEFAULT_NARRATE_TIMEOUT_MS`. */
  narrateTimeoutMs?: number;
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
  /** The umpire's voice for narration (3.11); tone only. Default the dry staff officer. */
  persona?: UmpirePersona;
  /** The narration circuit breaker of a reopened game, from its input log (#419). Default closed. */
  narrateBreaker?: NarrateBreakerState;
  /** Server-side agents that play scripted sides (see `opponent/`). */
  agents?: SideAgent[];
  /** Pause voting: who votes and the host's rules. Unset: the vote commands are refused. */
  pause?: PauseConfig;
  /** Emergency holds each voter has already called, from the input log of a reopened game. */
  holdsUsed?: Readonly<Record<string, number>>;
  /** Set when the game was reopened after the server went down: wall ms it was down (estimated). */
  restart?: { downMs: number };
  /**
   * Turn mode (D39): the clock must be in manual mode, and moves only when a turn is resolved. `open`
   * is the open turn of a reopened game (`openTurnFromLog`). Unset: a real-time game.
   */
  turns?: {
    turnMs: number;
    deadlineHours?: number;
    /** Resolves a closed turn. Default `NO_ORDERS_RESOLVER` (`GameHost` passes the engine's). */
    resolver?: TurnResolver;
    open?: OpenTurn;
    /** The order ids each side sent in earlier turns of a reopened game (`sentTurnIdsFromLog`). */
    sentIds?: ReadonlyMap<string, ReadonlySet<string>>;
  };
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
  /** The deputy was replaced or switched off; a decision still in flight is dropped. */
  retired?: boolean;
}

interface Dependency {
  id: number;
  /** Game time at which the result is needed. */
  neededAt: number;
  settle: (result: CommandResult) => void;
  abandoned: boolean;
}

/** Why a narration used the template text, for the log; one line per report that kept it. */
function narrationFallbackReason(result: Awaited<ReturnType<typeof narrateReports>>): string {
  if (result.overloaded) return 'umpire budget or rate limit';
  if (result.fallbacks.length === 0) return 'the model call failed';
  return result.fallbacks.map((f) => `${f.reportId}: ${f.reason}`).join('; ');
}

/** Narrated text by report id for one side; `null` marks a report folded into another's dispatch. */
type SideNarration = Map<string, string | null>;

/** Question ids are unique per side only. */
const staffKey = (side: string, questionId: string): string => `${side}\u0000${questionId}`;

/** An agent's order as the order path takes it: understood, with the agent's own intents. */
const agentParse = (o: AgentOrder): ParseResult => ({
  kind: 'intents',
  text: o.text,
  unitId: o.unitId,
  intents: o.intents ?? [o.intent],
});

/** A question put to a staff officer, waiting for its due time; `settle` hands the written exchange to the asker. */
interface PendingStaff {
  side: string;
  exchange: StaffExchange;
  settle: (exchange: StaffExchange | undefined) => void;
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
  private readonly trace: TraceSink;
  private readonly timers: Timers;
  private readonly parseTimers = new Set<unknown>();
  private readonly onEmitted?: (events: EmittedEvent[]) => void;
  private readonly onUpdate?: () => void;
  private readonly onError?: (error: unknown) => void;
  private readonly onStaffAtWork?: (state: StaffAtWork) => void;
  private readonly parseRetries: number;
  private readonly parseTimeoutMs: number;
  private readonly narrateTimeoutMs: number;
  private readonly parseRetryDelayMs: number;
  private seq: number;
  private agents: AgentSlot[];
  private readonly deputyAway: ((side: string, seat: Seat | undefined) => boolean) | undefined;
  /** Each side's deputy settings, as last set (D6f), and the account of what it has done. */
  private readonly deputySettings = new Map<string, { settings: DeputySettings; seat?: Seat }>();
  private readonly deputyAccounts = new Map<string, DeputyAccount[]>();
  /** Agent orders issued since the last flush, to be appended to the input log in order. */
  private agentLog: InputLogEntry[] = [];
  private readonly snapshotEvery: number;
  /** Seq covered by the newest stored snapshot. */
  private snapshotSeq: number;
  /** How many clock history entries the store already has. */
  private historySaved = 0;
  /** The outcome is written once; later persists skip it. */
  private outcomeSaved = false;
  /** Pending LLM dependencies: the game time each is needed and how to answer its caller. */
  private readonly dependencies = new Map<number, Dependency>();
  private nextDependency = 1;
  private readonly umpire: UmpireClient | undefined;
  private readonly persona: UmpirePersona | undefined;
  /** Game time up to which each side's reports have been handed to the narrate stage. */
  private readonly narratedUntil = new Map<string, number>();
  private readonly narrations = new Map<string, SideNarration>();
  private readonly narrating = new Set<string>();
  /** Sides a server-side agent plays (`options.agents`): nobody reads their dispatches, so they are never narrated (#419). */
  private readonly scriptedSides: ReadonlySet<string>;
  /** The narrate stage's circuit breaker, shared by the game's sides (#419). */
  private narrateBreaker: NarrateBreakerState;
  /** Sides whose latest narration was refused by the game's budget or rate limit. */
  private readonly overloaded = new Set<string>();
  /** Each side's questions to its staff officers and their answers (D6b), oldest first. */
  private readonly staffHistory = new Map<string, StaffExchange[]>();
  /** Questions not yet due, by `staffKey`: each is answered once, from the view at its due time (#418). */
  private readonly pendingStaff = new Map<string, PendingStaff>();
  /** Every question id used, by `staffKey`, taken the moment a question is asked so a resend is refused. */
  private readonly staffAsked = new Set<string>();
  private readonly dissents = new Map<string, Dissent[]>();

  /** The pause state machine; absent when the game has no voters configured. */
  private readonly pauseVoting: PauseVoting | undefined;
  /** The ratio vote; present when the game has voters. */
  private readonly ratioVoting: RatioVoting | undefined;
  private readonly pauseLog: { n: number; step: PauseTransition }[] = [];
  private pauseStepCount = 0;
  private pauseTimer: unknown;
  private pauseTimerSet = false;
  private readonly restartInfo: { downMs: number } | undefined;

  /** Turn mode: the settings, the resolver, the open turn and its deadline timer. */
  private readonly turns:
    | { turnMs: number; deadlineHours?: number; resolver: TurnResolver; humans: string[] }
    | undefined;
  private openTurn: OpenTurn | undefined;
  /** Order ids each side has sent in any turn; an id is not reused across turns. */
  private readonly turnSentIds = new Map<string, Set<string>>();
  private turnTimer: unknown;
  private turnTimerSet = false;

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
    this.narrateTimeoutMs = options.narrateTimeoutMs ?? DEFAULT_NARRATE_TIMEOUT_MS;
    this.parseRetryDelayMs = options.parseRetryDelayMs ?? DEFAULT_PARSE_RETRY_DELAY_MS;
    this.seq = options.seq ?? 0;
    this.umpire = options.umpire;
    this.persona = options.persona;
    this.narrateBreaker = options.narrateBreaker ?? closedBreaker();
    for (const [side, list] of options.staffHistory ?? []) {
      this.staffHistory.set(side, [...list]);
      // Asked before a stop and not yet answered: answered when due, as if the game had not stopped.
      for (const exchange of list) {
        this.staffAsked.add(staffKey(side, exchange.questionId));
        if (exchange.text !== undefined || exchange.textless) continue;
        this.pendingStaff.set(staffKey(side, exchange.questionId), {
          side,
          exchange,
          settle: () => undefined,
        });
      }
    }
    for (const [side, list] of options.dissents ?? []) this.dissents.set(side, [...list]);
    // Reports from before this actor started (a reopened game) keep their template text.
    for (const side of this.engine.world.sides) this.narratedUntil.set(side.id, this.engine.time);
    this.restartInfo = options.restart;
    this.deputyAway = options.deputyAway;
    for (const [side, d] of options.deputies ?? []) {
      this.deputySettings.set(side, { settings: d.settings, ...(d.seat ? { seat: d.seat } : {}) });
      this.deputyAccounts.set(side, [...d.account]);
    }
    // Decisions fall on multiples of the interval; a resumed game picks up at the next one.
    const t = this.engine.time;
    this.scriptedSides = new Set((options.agents ?? []).map((a) => a.side));
    this.agents = (options.agents ?? []).map((agent) => ({
      agent,
      // A turn open at minute 0 in a reopened game: its agents thought as it opened (logged), so
      // they do not think at minute 0 again.
      nextAt:
        t === 0 && !options.turns?.open
          ? 0
          : (Math.floor(t / agent.intervalMs) + 1) * agent.intervalMs,
      idle: false,
      pending: false,
    }));
    for (const [side, d] of this.deputySettings) this.installDeputy(side, d.settings, d.seat);
    if (options.pause) {
      this.pauseVoting = new PauseVoting(options.pause, {
        phase: this.clock.status === 'running' ? 'running' : 'paused',
        nowMs: this.wallNow(),
        ...(options.holdsUsed ? { holdsUsed: options.holdsUsed } : {}),
      });
      this.ratioVoting = new RatioVoting(options.pause);
    }
    this.snapshotSeq = -1;
    this.snapshotEvery = Math.max(1, Math.floor(options.snapshotEvery ?? 1));
    if (options.turns) {
      if (this.clock.mode !== 'manual') throw new Error('a turn-mode game runs on a manual clock');
      const agentSides = new Set(this.agents.map((a) => a.agent.side as string));
      this.turns = {
        turnMs: options.turns.turnMs,
        ...(options.turns.deadlineHours === undefined
          ? {}
          : { deadlineHours: options.turns.deadlineHours }),
        resolver: options.turns.resolver ?? NO_ORDERS_RESOLVER,
        humans: humanSides(this.engine.world.sides, agentSides),
      };
      this.openTurn = options.turns.open;
      for (const [side, ids] of options.turns.sentIds ?? [])
        this.turnSentIds.set(side, new Set(ids));
    }
  }

  /** Whether this is a turn-mode game (D39). */
  get turnMode(): boolean {
    return this.turns !== undefined;
  }

  /** The open turn as `side` is shown it; undefined in a real-time game or once the game is over. */
  turnStateFor(side: string): TurnStateView | undefined {
    const t = this.openTurn;
    if (!t || this.engine.world.outcome) return undefined;
    // The time limit cuts the pursuit short (D13), so the banner never names a later minute.
    const close = pursuitEndsAt(this.engine.world);
    const pursuit =
      close === undefined ? undefined : Math.min(close, this.engine.world.victory.holdMs);
    return {
      turn: t.n,
      startsAt: t.startMs,
      endsAt: t.endMs,
      sent: [...t.sent.keys()],
      ...(t.deadlineWallMs === undefined ? {} : { deadline: t.deadlineWallMs }),
      resolving: t.resolving,
      held: structuredClone(t.held.get(side) ?? []),
      ...(pursuit === undefined ? {} : { pursuitUntil: pursuit }),
    };
  }

  /** What `side` is shown in place of template text: pass to `sideViewOf`. */
  narrationFor(side: string): ReadonlyMap<string, string | null> | undefined {
    return this.narrations.get(side);
  }

  /** The narrate stage's circuit breaker now (#419). */
  get narrationBreaker(): Readonly<NarrateBreakerState> {
    return this.narrateBreaker;
  }

  /** The in-fiction notice for a side whose latest narration the umpire's cap refused. */
  overloadedFor(side: string): string | undefined {
    return this.overloaded.has(side) ? STAFF_OVERLOADED_NOTICE : undefined;
  }

  /** `side`'s deputy, for `sideViewOf` (D6f). Undefined when none was ever set. */
  deputyFor(
    side: string,
  ): { settings: DeputySettings; account: readonly DeputyAccount[] } | undefined {
    const d = this.deputySettings.get(side);
    return d ? { settings: d.settings, account: this.deputyAccounts.get(side) ?? [] } : undefined;
  }

  /** `side`'s conference with its staff officers, for `sideViewOf`. */
  staffHistoryFor(side: string): readonly StaffExchange[] {
    return this.staffHistory.get(side) ?? [];
  }

  /** True when this side has used `questionId` before, including for a question not yet logged. */
  staffQuestionUsed(side: string, questionId: string): boolean {
    return this.staffAsked.has(staffKey(side, questionId));
  }

  /** The players who may vote changed (D6e). Without voting set up, nothing happens. */
  setVoters(voters: readonly string[]): void {
    this.pauseVoting?.setVoters(voters);
    this.ratioVoting?.setVoters(voters);
  }

  /** The dissents `side` has put on record, oldest first. */
  dissentsFor(side: string): readonly Dissent[] {
    return this.dissents.get(side) ?? [];
  }

  /** Whether the game is waiting on the umpire. */
  get staffAtWork(): StaffAtWork {
    // In turn mode the umpire holds no clock: it is at work while a turn is being resolved.
    if (this.openTurn?.resolving) return { working: true, needAtMs: this.openTurn.startMs };
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

  /** Game time of the next queued event, for the admin "step to next event" control. */
  get nextEventAt(): number | undefined {
    return this.engine.queue[0]?.time;
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

  /** Emergency holds `player` may still call; zero without voters. */
  holdsLeftFor(player: string): number {
    return this.pauseVoting?.holdsLeft(player) ?? 0;
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
      if (this.turns && !this.openTurn) await this.openNextTurn();
      // A question that fell due while the game was down is answered from the view at its due time.
      this.takeDueStaff();
      this.reschedule();
      // A reopened game whose sides had all sent before the stop resolves that turn now.
      if (this.turnReady())
        void this.enqueue(() => this.closeTurn('all-sent')).catch((e) => this.onError?.(e));
    });
  }

  /** Queue a command. Resolves when it has been applied. */
  submit(command: GameCommand, options: { admin?: boolean } = {}): Promise<CommandResult> {
    const admin = options.admin === true;
    // The id of the request being handled, or a fresh one for a caller outside any request.
    const id = this.trace.enabled ? (currentCorrelationId() ?? newCorrelationId()) : undefined;
    if (command.kind === 'order') {
      if (this.turns) {
        return Promise.resolve({
          ok: false,
          kind: 'rejection',
          reason: 'in a turn-based game orders are held for the turn and sent with it',
        });
      }
      return this.submitOrder(command, id);
    }
    if (id === undefined) return this.enqueue(() => this.apply(command, admin));
    return this.enqueue(() => withCorrelationId(id, () => this.apply(command, admin)));
  }

  /** Stop the scheduler, finish queued work, and refuse new commands. Safe to call twice. */
  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.clearTimer();
      this.clearPauseTimer();
      this.clearTurnTimer();
      for (const handle of [...this.parseTimers]) this.clearParseTimer(handle);
      // Abandon work still with the umpire: its callers are told, and a late result is ignored.
      this.narrating.clear();
      // Still logged as asked, so a reopened game answers them.
      for (const p of this.pendingStaff.values()) p.settle(undefined);
      this.pendingStaff.clear();
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
    // Turn mode has no narrate stage: each turn's reports come from its resolution (D39, 11.9).
    if (!umpire || this.turns || this.closed || this.engine.world.outcome) return;
    const now = this.engine.time;
    for (const side of this.engine.world.sides) {
      if (this.narrating.has(side.id) || this.scriptedSides.has(side.id)) continue;
      const since = this.narratedUntil.get(side.id) ?? now;
      if (now < since + narrateWindowMs(this.clock.rate)) continue;
      // The window is closed: reports delivered later belong to the next one, whether or not any are due.
      this.narratedUntil.set(side.id, now);
      const view = viewFor(this.engine.world, side.id, now);
      const due = reportsDueForNarration(view.reports, since, now, this.clock.rate);
      if (due.length === 0) continue;
      this.narrateBreaker = breakerAt(this.narrateBreaker, now);
      if (!breakerAllows(this.narrateBreaker, now)) {
        // The model has been failing: the reports keep their template text and no call is made.
        const breaker = this.narrateBreaker;
        void this.enqueueCompletion(() => this.logPausedNarration(side.id, now, breaker)).catch(
          (e) => this.onError?.(e),
        );
        continue;
      }
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
      // At the deadline the reports already narrated are kept and the rest fall back to template text.
      const abort = new AbortController();
      const deadline = this.parseTimer(() => abort.abort(), this.narrateTimeoutMs);
      const cooldownMs = breakerCooldownMs(narrateWindowMs(this.clock.rate));
      const work = narrateReports(client, side.id as SideId, due, {
        hidden: hiddenTerms(this.engine.world, side.id as SideId),
        signal: abort.signal,
        persona: this.persona,
        ownUnits: view.ownUnits,
        // Game time stands at `now` while the stage works (the barrier), so the breaker's clock is `now`.
        breaker: {
          allows: () => breakerAllows(this.narrateBreaker, now),
          reason: () => breakerSummary(this.narrateBreaker),
          record: (ok) => {
            const wasOpen = !breakerAllows(this.narrateBreaker, now);
            this.narrateBreaker = recordNarrateCall(this.narrateBreaker, ok, now, cooldownMs);
            if (!wasOpen && !breakerAllows(this.narrateBreaker, now)) {
              this.traceBreaker(this.narrateBreaker, 'opened');
            }
          },
        },
      }).then(
        (result) => {
          this.clearParseTimer(deadline);
          return result;
        },
        (e) => {
          this.clearParseTimer(deadline);
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
      if (result?.overloaded) this.overloaded.add(side);
      else if (result) this.overloaded.delete(side);
      // A failed or timed-out stage leaves the template text, which is what the view shows already.
      // Reports that fell back carry their template text, which is what the view shows already.
      if (result) {
        const text = this.narrations.get(side) ?? new Map<string, string | null>();
        for (const d of result.dispatches) {
          d.reportIds.forEach((id, i) => text.set(id, i === 0 ? d.text : null));
        }
        this.narrations.set(side, text);
      }
      // As this window left it: `sync` may begin another side's window, which can move the breaker on.
      const narrateBreaker = this.narrateBreaker;
      this.sync();
      if (this.trace.enabled) {
        // One admin LLM row per report that kept its template text, with the reason (#359).
        for (const f of result?.fallbacks ?? []) {
          this.trace.record(this.id, 'llm', {
            mode: 'fallback',
            stage: 'narrate',
            provider: 'narration checks',
            ok: false,
            errorKind: 'template text used',
            error: `${f.reportId}: ${f.reason}`,
            fallbackFor: { reason: f.reason },
          });
        }
      }
      const entry: InputLogEntry = {
        seq: ++this.seq,
        wallMs: this.wallNow(),
        gameMs: this.engine.time,
        endGameMs: this.engine.time,
        command: { kind: 'narrate', side, windowEndMs },
        calls,
        narrateBreaker,
        ...(result?.fellBack
          ? {
              error: `narration fell back to template text: ${narrationFallbackReason(result)}`,
            }
          : {}),
        ...(result === undefined ? { error: 'narration failed or timed out' } : {}),
      };
      if (this.trace.enabled) this.trace.record(this.id, 'command', entry);
      await this.commit(entry);
    } finally {
      this.reschedule();
      this.notify();
    }
  }

  /** Journal a window the open breaker skipped: its reports keep their template text (#419). */
  private async logPausedNarration(
    side: string,
    windowEndMs: number,
    breaker: NarrateBreakerState,
  ): Promise<void> {
    if (this.closed) return;
    this.traceBreaker(breaker, `${side} window skipped`);
    const entry: InputLogEntry = {
      seq: ++this.seq,
      wallMs: this.wallNow(),
      gameMs: this.engine.time,
      endGameMs: this.engine.time,
      command: { kind: 'narrate', side, windowEndMs },
      calls: [],
      narrateBreaker: breaker,
      error: `narration fell back to template text: ${breakerSummary(breaker)}`,
    };
    if (this.trace.enabled) this.trace.record(this.id, 'command', entry);
    await this.commit(entry);
  }

  /** One admin LLM row for the breaker: "model narration paused: 5 of 6 failed" and until when. */
  private traceBreaker(breaker: NarrateBreakerState, what: string): void {
    if (!this.trace.enabled) return;
    const until =
      breaker.pausedUntil === undefined
        ? ''
        : `, until game minute ${Math.round(breaker.pausedUntil / 60_000)}`;
    const reason = `${breakerSummary(breaker)}${until}`;
    this.trace.record(this.id, 'llm', {
      mode: 'fallback',
      stage: 'narrate',
      provider: 'narration breaker',
      ok: false,
      errorKind: 'model narration paused',
      error: `${reason} (${what})`,
      fallbackFor: { reason },
    });
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
        if (this.engine.world.outcome) break;
        // In a turn the engine resolves, agents think at their interval as in real time (#430); the
        // resolver ran copies of them through the same turn, so it still ends as projected (D39). A
        // held turn (the umpire's) moves nothing: there they think only as it opens (`openNextTurn`).
        // Staff answers only read the world, so they are still written at their due time.
        const due = heldTurn(this.engine.world, this.engine.time) ? undefined : this.nextAgent();
        // A staff answer is written at its due time, from the world as it stood then (#418).
        const staffAt = this.nextStaffDue();
        if (staffAt <= target && (!due || staffAt <= due.nextAt)) {
          step(Math.max(staffAt, this.engine.time));
          this.takeDueStaff();
          continue;
        }
        if (!due || due.nextAt > target) break;
        step(due.nextAt);
        due.nextAt += due.agent.intervalMs;
        if (this.engine.world.outcome) continue;
        if (due.agent.dormant?.()) {
          // The player is back: nothing to decide until an event wakes it, so a quiet field spins no clock.
          due.idle = true;
          continue;
        }
        // Nothing may hold a turn's clock, so in turn mode an LLM commander plays by its script.
        if (due.agent.decide && !this.turns) this.beginDecision(due);
        else due.idle = !this.think(due.agent) && (due.agent.settled?.() ?? true);
      }
      step(target);
      this.takeDueStaff();
    } finally {
      // A finished game does not run on. Freeze the clock at the outcome's own time, not at
      // this tick's later reading, so the stopped clock agrees with the end panel.
      const outcome = this.engine.world.outcome;
      if (outcome && this.clock.status !== 'stopped') this.clock.stop(outcome.time);
      if (emitted.length > 0) {
        if (this.trace.enabled) {
          for (const event of emitted) this.trace.record(this.id, 'engine', event);
        }
        this.onEmitted?.(emitted);
      }
    }
  }

  /**
   * A player put a question to a staff officer (D6b). The question is logged now (journal only), so a
   * restart keeps it, and the answer is written once, when game time reaches `answerAtGame`: from the
   * officer's view at that time, on the `staff` stage or, with no umpire or no usable reply, in the
   * officer's canned voice (#418). The written exchange is stored, logged and never recomputed.
   * Resolves with it once written; undefined when the game is over or closes first. Game time never
   * waits for it.
   */
  async answerStaff(
    side: SideId,
    role: string,
    question: string,
    asked: { questionId: string; askedAtGame: number; answerAtGame: number; askedBy?: string },
  ): Promise<StaffExchange | undefined> {
    if (this.closed || this.engine.world.outcome) return undefined;
    const key = staffKey(side, asked.questionId);
    if (this.staffAsked.has(key)) return undefined;
    this.staffAsked.add(key);
    const officer = staffOfficerFor(this.engine.world.seed, side, role);
    const exchange: StaffExchange = {
      ...asked,
      role: role as StaffExchange['role'],
      question,
      officer: { name: officer.name, traits: officer.traits },
    };
    let settle!: (x: StaffExchange | undefined) => void;
    const written = new Promise<StaffExchange | undefined>((r) => (settle = r));
    await this.enqueueCompletion(async () => {
      if (this.closed) return settle(undefined);
      await this.logStaff(side, exchange, []);
      this.staffHistory.set(side, [...(this.staffHistory.get(side) ?? []), exchange]);
      this.pendingStaff.set(key, { side, exchange, settle });
      this.takeDueStaff();
      // Wake at its due time, so the answer is written then even on a quiet field.
      this.reschedule();
      this.notify();
    });
    return written;
  }

  /** When the actor must wake to write a staff answer, if any (none once the game is over). */
  private nextStaffWake(): number | undefined {
    const at = this.nextStaffDue();
    return this.engine.world.outcome || !Number.isFinite(at) ? undefined : at;
  }

  /** The earliest due time of a question still waiting, or Infinity. */
  private nextStaffDue(): number {
    let at = Number.POSITIVE_INFINITY;
    for (const p of this.pendingStaff.values()) at = Math.min(at, p.exchange.answerAtGame);
    return at;
  }

  /**
   * Write the answer of every question now due, from the world as it is now. Once the game is over all
   * of them are written; one not yet due then is never shown (the clock stops before it), so it is
   * answered in the canned voice without calling the model.
   */
  private takeDueStaff(): void {
    const now = this.engine.time;
    const over = Boolean(this.engine.world.outcome);
    for (const [key, p] of [...this.pendingStaff]) {
      if (!over && p.exchange.answerAtGame > now) continue;
      this.pendingStaff.delete(key);
      const at = Math.min(p.exchange.answerAtGame, now);
      const umpire = p.exchange.answerAtGame > now ? undefined : this.umpire;
      void this.writeStaff(p, this.engine.world, at, umpire).catch((e) => {
        p.settle(undefined);
        this.onError?.(e);
      });
    }
  }

  /** Write one answer from `world` as seen at `at`, then log and store it. Not on the clock's critical path. */
  private async writeStaff(
    p: PendingStaff,
    world: GameState,
    at: number,
    umpire: UmpireClient | undefined,
  ): Promise<void> {
    const { side, exchange } = p;
    const answer = await writeStaffAnswer(
      umpire,
      world,
      side as SideId,
      exchange.role,
      exchange.question,
      at,
    );
    if (this.closed) return p.settle(undefined);
    const done: StaffExchange = {
      ...exchange,
      text: answer.text,
      basedOnGame: answer.basedOnGame,
      officer: { name: answer.officer.name, traits: answer.officer.traits },
    };
    await this.enqueueCompletion(async () => {
      if (this.closed) return p.settle(undefined);
      // Logged first: if the commit fails, nothing shows words that a restart would write again.
      await this.logStaff(side, done, answer.records, answer.failure);
      this.staffHistory.set(
        side,
        (this.staffHistory.get(side) ?? []).map((x) =>
          x.questionId === done.questionId ? done : x,
        ),
      );
      this.notify();
      p.settle(done);
    });
  }

  /** Log a staff exchange as a journal-only entry: once when asked, once when answered. A restart keeps the latest. */
  private async logStaff(
    side: string,
    exchange: StaffExchange,
    calls: UmpireCallRecord[],
    failure?: string,
  ): Promise<void> {
    const entry: InputLogEntry = {
      seq: ++this.seq,
      wallMs: this.wallNow(),
      gameMs: this.engine.time,
      endGameMs: this.engine.time,
      command: {
        kind: 'staffAnswer',
        side,
        role: exchange.role,
        question: exchange.question,
        exchange,
      },
      calls,
      // The canned answer stands; the log says why the model's did not.
      ...(failure === undefined ? {} : { error: failure }),
    };
    if (this.trace.enabled) this.trace.record(this.id, 'command', entry);
    await this.commit(entry);
  }

  /**
   * Puts a dissent on record: kept for the side and logged as a journal-only entry, so a restart
   * and a replay have it. It never touches the engine. The caller has checked the order exists.
   */
  async recordDissent(
    side: SideId,
    dissent: Omit<Dissent, 'atGame'>,
  ): Promise<Dissent | undefined> {
    const filed: Dissent = { ...dissent, atGame: this.engine.time };
    let duplicate = false;
    await this.enqueueCompletion(async () => {
      // Two filings with one id can both pass the caller's check before either lands.
      duplicate = (this.dissents.get(side) ?? []).some((d) => d.id === filed.id);
      if (duplicate) return;
      this.dissents.set(side, [...(this.dissents.get(side) ?? []), filed]);
      const entry: InputLogEntry = {
        seq: ++this.seq,
        wallMs: this.wallNow(),
        gameMs: this.engine.time,
        endGameMs: this.engine.time,
        command: { kind: 'dissent', side, by: filed.seat, dissent: filed },
      };
      if (this.trace.enabled) this.trace.record(this.id, 'command', entry);
      await this.commit(entry);
      this.notify();
    });
    return duplicate ? undefined : filed;
  }

  /**
   * The chief of staff reads a shared draft on the `staff` stage (the staff check, D6d). Like a
   * conference answer it is off the clock's critical path: game time does not wait for it, and the
   * hub holds the result until the officer's cost has elapsed. It sees the side's own units, the
   * named places and the orders the side already sent, never master state. Logged as a
   * journal-only entry with its model calls, so replay needs no model. Undefined when there is no
   * umpire or the stage gave nothing usable.
   */
  async checkDraft(
    side: SideId,
    check: { checkId: string; draft: string; rev: number; text: string },
    earlier: readonly EarlierOrder[],
  ): Promise<StaffCheckReport | undefined> {
    const umpire = this.umpire;
    if (!umpire || this.closed || this.engine.world.outcome) return undefined;
    let report: StaffCheckReport | undefined;
    let failure: string | undefined;
    try {
      report = await checkDraftWithStaff(
        umpire,
        this.parseContext(side),
        this.engine.world.seed,
        side,
        check.text,
        earlier,
        this.engine.time,
      );
    } catch (e) {
      failure = e instanceof Error ? e.message : 'staff check failed';
    }
    if (this.closed) return undefined;
    await this.enqueueCompletion(async () => {
      const entry: InputLogEntry = {
        seq: ++this.seq,
        wallMs: this.wallNow(),
        gameMs: this.engine.time,
        endGameMs: this.engine.time,
        command: {
          kind: 'draftCheck',
          side,
          checkId: check.checkId,
          draft: check.draft,
          rev: check.rev,
          text: check.text,
          earlier: earlier.map((o) => ({ id: o.id, text: o.text, sentAtGame: o.sentAtGame })),
        },
        calls: report?.records ?? [],
        ...(report === undefined ? { error: failure ?? 'staff check unusable' } : {}),
      };
      if (this.trace.enabled) this.trace.record(this.id, 'command', entry);
      await this.commit(entry);
      this.notify();
    });
    return report;
  }

  /** Game time the soonest narration window closes, when the narrate stage is on. */
  private nextNarrationAt(): number | undefined {
    if (!this.umpire || this.turns || this.engine.world.outcome) return undefined;
    let next: number | undefined;
    for (const side of this.engine.world.sides) {
      if (this.narrating.has(side.id) || this.scriptedSides.has(side.id)) continue;
      const at =
        (this.narratedUntil.get(side.id) ?? this.engine.time) + narrateWindowMs(this.clock.rate);
      if (next === undefined || at < next) next = at;
    }
    return next;
  }

  /**
   * The agent due to think soonest, leaving out idle ones when no event is queued to wake them.
   * A turn's projection runs the same rule (`runEngineTurn` in `engineTurn.ts`): change both, or a
   * rigid turn no longer ends as projected.
   */
  private nextAgent(): AgentSlot | undefined {
    const waiting = this.engine.queue.length > 0;
    return this.agents.reduce<AgentSlot | undefined>(
      (best, a) =>
        a.pending || a.retired || (a.idle && !waiting) || (best && best.nextAt <= a.nextAt)
          ? best
          : a,
      undefined,
    );
  }

  /**
   * Copies of the scripted sides as they stand, for a turn's projection (#430): each thinks from its
   * side's view of the world it is given and issues its orders as `issueAgentOrders` does, with ids
   * of its own (the live orders take theirs from the log). Agents that cannot be copied are left out.
   */
  private turnAgents(n: number): TurnAgent[] {
    // One counter for all the copies, as the log's `seq` is one: two copies' orders never share an
    // id, so neither do their couriers (`courier-<order id>`).
    let k = 0;
    return this.agents.flatMap((slot) => {
      if (slot.pending || slot.retired || slot.agent.dormant?.()) return [];
      const copy = slot.agent.fork?.();
      if (!copy) return [];
      const think = (state: EngineState<GameState>) => {
        const view = viewFor(state.world, copy.side as SideId, state.time);
        let changed = false;
        for (const o of copy.think(view)) {
          const applied = applyLoggedOrder(
            state,
            `${this.id}-t${n}`,
            ++k,
            copy.side,
            agentParse(o),
          );
          if ('state' in applied) {
            state = applied.state;
            changed = true;
          }
        }
        return { state, idle: !changed && (copy.settled?.() ?? true) };
      };
      return [{ intervalMs: copy.intervalMs, nextAt: slot.nextAt, idle: slot.idle, think }];
    });
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
        if (slot.retired) {
          // The player changed or switched off the deputy while it was thinking: its answer is dropped.
        } else {
          const orders =
            decided ??
            agent.think(viewFor(this.engine.world, agent.side as SideId, this.engine.time));
          const issued: DeputyAccount['issued'] = [];
          const changed = this.issueAgentOrders(agent, orders, issued);
          slot.idle = !changed && (agent.settled?.() ?? true);
          if (agent instanceof DeputyAgent) this.fileDeputyTurn(agent, issued);
        }
        if (slot.retired) this.agents = this.agents.filter((s) => s !== slot);
      }
      await this.persistProgress();
    } finally {
      this.reschedule();
      this.notify();
    }
  }

  /** Issue an agent's orders through the human order path, logging each for replay. */
  private issueAgentOrders(
    agent: SideAgent,
    orders: AgentOrder[],
    issued?: DeputyAccount['issued'],
  ): boolean {
    let changed = false;
    for (const o of orders) {
      const parsed = agentParse(o);
      const entry: InputLogEntry = {
        seq: ++this.seq,
        wallMs: this.wallNow(),
        gameMs: this.engine.time,
        endGameMs: this.engine.time,
        command: { kind: 'order', side: agent.side, text: o.text },
        parse: parsed,
        agent: true,
        ...(agent instanceof DeputyAgent ? { deputy: { discretion: agent.discretion } } : {}),
      };
      const applied = applyLoggedOrder(
        this.engine,
        this.id,
        entry.seq,
        agent.side,
        parsed,
        undefined,
        agent instanceof DeputyAgent,
      );
      if ('reason' in applied) entry.error = applied.reason;
      else {
        this.engine = applied.state;
        changed = true;
        const unit = this.engine.world.units.find((u) => u.id === o.unitId);
        issued?.push({ unitId: o.unitId, unit: unit?.name ?? o.unitId, text: o.text });
      }
      if (this.trace.enabled) this.trace.record(this.id, 'command', entry);
      this.agentLog.push(entry);
    }
    return changed;
  }

  /**
   * Set what a side's deputy may do (D6f), or switch it off. Logged as a journal entry so a
   * reopened game has it; the deputy's orders are logged as they are issued. Refused when the
   * game has no umpire to run it on.
   */
  async setDeputy(
    side: SideId,
    seat: Seat | undefined,
    settings: DeputySettings,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (this.closed || this.engine.world.outcome) return { ok: false, reason: 'the game is over' };
    if (settings.enabled && !this.umpire) {
      return { ok: false, reason: 'this game has no staff to appoint a deputy from' };
    }
    if (settings.enabled && this.turns) {
      return { ok: false, reason: 'a deputy does not act in a turn-based game yet' };
    }
    await this.enqueueCompletion(async () => {
      this.deputySettings.set(side, { settings, ...(seat ? { seat } : {}) });
      this.installDeputy(side, settings, seat);
      const entry: InputLogEntry = {
        seq: ++this.seq,
        wallMs: this.wallNow(),
        gameMs: this.engine.time,
        endGameMs: this.engine.time,
        command: { kind: 'deputySet', side, settings, ...(seat ? { seat } : {}) },
      };
      if (this.trace.enabled) this.trace.record(this.id, 'command', entry);
      await this.commit(entry);
    });
    return { ok: true };
  }

  /** A player came or went: a deputy that stood down because the table was occupied may have work to do now. */
  noteDeputyPresence(): void {
    if (this.closed) return;
    let woke = false;
    for (const s of this.agents) {
      if (s.agent.dormant && s.idle) {
        s.idle = false;
        woke = true;
      }
    }
    if (woke) this.reschedule();
  }

  /** Retire the side's deputy, and start a new one when the settings switch it on. */
  private installDeputy(side: string, settings: DeputySettings, seat: Seat | undefined): void {
    for (const s of this.agents) {
      if (s.agent instanceof DeputyAgent && s.agent.side === side) s.retired = true;
    }
    this.agents = this.agents.filter((s) => !s.retired || s.pending);
    if (!settings.enabled || !this.umpire) return;
    const principal: Seat = seat ?? { role: 'commander' };
    const agent = new DeputyAgent({
      side: side as SideId,
      seat: principal,
      discretion: settings.discretion,
      intent: settings.intent,
      client: this.umpire,
      parser: this.parser,
      world: () => this.engine.world,
      away: () => this.deputyAway?.(side, seat) ?? true,
      hidden: (view) => {
        const world = this.engine.world;
        const seen = new Set([
          ...view.visibleEnemies.map((e) => e.id),
          ...view.lastKnownContacts.map((c) => c.id),
        ]);
        return [
          ...hiddenTerms(world, side as SideId),
          ...world.units.filter((u) => u.side !== side && !seen.has(u.id)).map((u) => u.id),
        ];
      },
    });
    const t = this.engine.time;
    this.agents.push({
      agent,
      nextAt: (Math.floor(t / agent.intervalMs) + 1) * agent.intervalMs,
      idle: false,
      pending: false,
    });
  }

  /** File the deputy's turn in the side's account, and journal it so a reopened game has it. */
  private fileDeputyTurn(agent: DeputyAgent, issued: DeputyAccount['issued']): void {
    const turn = agent.takeTurn();
    if (!turn || (issued.length === 0 && turn.refused.length === 0 && turn.report === '')) return;
    const seq = ++this.seq;
    const account: DeputyAccount = {
      id: `deputy-${this.id}-${seq}`,
      atGame: this.engine.time,
      discretion: agent.discretion,
      issued,
      refused: turn.refused,
      report: turn.report,
    };
    this.deputyAccounts.set(agent.side, [...(this.deputyAccounts.get(agent.side) ?? []), account]);
    const entry: InputLogEntry = {
      seq,
      wallMs: this.wallNow(),
      gameMs: this.engine.time,
      endGameMs: this.engine.time,
      command: { kind: 'deputyTurn', side: agent.side, account },
      calls: turn.records,
    };
    if (this.trace.enabled) this.trace.record(this.id, 'command', entry);
    this.agentLog.push(entry);
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
    const outcome = this.engine.world.outcome;
    if (outcome && !this.outcomeSaved) {
      await this.store.saveOutcome(this.id, outcome.winner);
      this.outcomeSaved = true;
    }
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
    this.rescheduleTurnDeadline();
    if (this.closed) return;
    const nextEvent = this.engine.queue[0];
    const nextThink = this.engine.world.outcome ? undefined : this.nextAgent()?.nextAt;
    const woken = [nextEvent?.time, nextThink, this.nextNarrationAt(), this.nextStaffWake()].filter(
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
      const woken = [nextEvent?.time, nextThink, this.nextStaffWake()].filter(
        (t) => t !== undefined,
      );
      const next = woken.length > 0 ? Math.min(...woken) : undefined;
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

  private async apply(command: GameCommand, admin = false): Promise<CommandResult> {
    const entry: InputLogEntry = {
      seq: ++this.seq,
      wallMs: this.wallNow(),
      gameMs: 0,
      command,
      ...(admin ? { admin } : {}),
    };
    let result: CommandResult;
    const tracing = this.trace.enabled;
    if (tracing)
      this.trace.record(this.id, 'command', {
        seq: entry.seq,
        command,
        ...(admin ? { admin } : {}),
      });
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
      // A hold stops the clock when it is called and starts it again if it lapses or is refused.
      if (t.hold && t.to === 'pause_proposed') this.clock.pause();
      else if (t.to === 'paused' && t.from !== 'resume_proposed') this.clock.pause();
      else if (t.to === 'running' && (t.from !== 'pause_proposed' || t.hold)) this.clock.resume();
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
    if (this.turns && TURN_REFUSED.has(command.kind)) throw new Error(TURN_MODE_REFUSAL);
    switch (command.kind) {
      case 'turnOrder': {
        const t = this.writableTurn(command.side);
        const unit = this.engine.world.units.find((u) => u.id === command.order.to);
        if (!unit || unit.side !== command.side) throw new Error('that is not one of your units');
        // A held order is as good as drafted: a seat holds only for units it may draft for (D6a).
        if (
          command.by &&
          !mayDraft(this.engine.world, command.side as SideId, command.by, unit.id)
        ) {
          throw new Error(`You may not write orders to ${unit.name}.`);
        }
        if (this.turnSentIds.get(command.side)?.has(command.order.orderId)) {
          throw new Error('that order id was already sent in an earlier turn');
        }
        entry.command = { ...command, turn: t.n };
        holdOrder(t, command.side, structuredClone(command.order));
        return { ok: true, orderId: command.order.orderId };
      }
      case 'withdrawTurnOrder': {
        const t = this.writableTurn(command.side);
        entry.command = { ...command, turn: t.n };
        const held = t.held.get(command.side)?.find((o) => o.orderId === command.orderId);
        if (
          held &&
          command.by &&
          !mayDraft(this.engine.world, command.side as SideId, command.by, held.to)
        ) {
          const unit = this.engine.world.units.find((u) => u.id === held.to);
          throw new Error(`You may not write orders to ${unit?.name ?? held.to}.`);
        }
        if (!withdrawOrder(t, command.side, command.orderId)) {
          throw new Error('no such order is held for this turn');
        }
        return { ok: true };
      }
      case 'sendTurn': {
        const t = this.writableTurn(command.side);
        const orders = structuredClone(t.held.get(command.side) ?? []);
        // Role permissions apply at sending, as for a real-time order (D6a, D39).
        const { signer } = command;
        if (signer) {
          for (const o of orders) {
            if (maySign(this.engine.world, command.side as SideId, signer, o.to)) continue;
            const unit = this.engine.world.units.find((u) => u.id === o.to);
            throw new Error(`You may not sign orders to ${unit?.name ?? o.to}.`);
          }
        }
        t.sent.set(command.side, { orders, ...(signer ? { signer } : {}) });
        const ids = this.turnSentIds.get(command.side) ?? new Set<string>();
        for (const o of orders) ids.add(o.orderId);
        this.turnSentIds.set(command.side, ids);
        entry.command = { ...command, turn: t.n, orders };
        // Closed after this send is logged, in its own job.
        if (this.turnReady()) {
          void this.enqueue(() => this.closeTurn('all-sent')).catch((e) => this.onError?.(e));
        }
        return { ok: true };
      }
      case 'openTurn':
      case 'resolveTurn':
        throw new Error('turns are opened and resolved by the game itself');
      case 'proposePause':
      case 'proposeResume': {
        const pv = this.requirePauseVoting();
        const want = command.kind === 'proposePause' ? 'running' : 'paused';
        if (pv.phase !== want) throw new Error(`cannot ${command.kind} while ${pv.phase}`);
        const reason = command.kind === 'proposePause' ? command.reason : undefined;
        this.applyPause(entry, [pv.propose(`p${entry.seq}`, command.by, this.wallNow(), reason)]);
        return { ok: true };
      }
      case 'proposeHold': {
        const pv = this.requirePauseVoting();
        if (pv.phase !== 'running') throw new Error(`cannot proposeHold while ${pv.phase}`);
        const id = `p${entry.seq}`;
        this.applyPause(entry, [pv.callHold(id, command.by, this.wallNow(), command.reason)]);
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
      case 'step': {
        // Resolve the target here, under the queue, so it is never behind the clock however long
        // the command waited. Log it so the audit trail shows where the step was aimed.
        const from = this.clock.now();
        const next = this.nextEventAt;
        if (command.ms === undefined && next === undefined) throw new Error('no event is queued');
        const target = command.ms === undefined ? Math.max(next!, from) : from + command.ms;
        entry.command = {
          kind: 'step',
          ...(command.ms === undefined ? {} : { ms: command.ms }),
          gameMs: target,
        };
        this.clock.skipTo(target);
        const reached = this.clock.now();
        return reached < target ? { ok: true, stalledAt: reached } : { ok: true };
      }
      case 'order':
        throw new Error('orders go through submitOrder');
      case 'narrate':
        throw new Error('narration is logged by the scheduler');
      case 'staffAnswer':
        throw new Error('staff answers are logged by answerStaff');
      case 'critique':
        throw new Error('the critique is logged by the critique route');
      case 'deputySet':
      case 'deputyTurn':
        throw new Error('deputy entries are logged by setDeputy and the deputy itself');
      case 'dissent':
        throw new Error('dissents are logged by recordDissent');
      case 'draftCheck':
        throw new Error('staff checks are logged by checkDraft');
    }
  }

  /** The open turn, if `side` may still change its orders for it; otherwise a player-facing refusal. */
  private writableTurn(side: string): OpenTurn {
    const t = this.openTurn;
    if (!this.turns) throw new Error('this game is not turn-based');
    if (this.engine.world.outcome) throw new Error('the game is over');
    if (!t || t.resolving) throw new Error('the turn is being resolved; wait for the next one');
    if (t.sent.has(side)) throw new Error('your side has sent its orders for this turn');
    return t;
  }

  /** Every human side has sent for the open turn, which is not yet resolving. */
  private turnReady(): boolean {
    const t = this.openTurn;
    const humans = this.turns?.humans ?? [];
    return (
      t !== undefined && !t.resolving && humans.length > 0 && humans.every((h) => t.sent.has(h))
    );
  }

  /**
   * Open the next turn at the current game time and journal it. It ends `turnMs` later, or at the
   * scenario's time limit when that comes first (D39, "Clock").
   */
  private async openNextTurn(previous?: number): Promise<void> {
    const turns = this.turns;
    if (!turns || this.closed || this.engine.world.outcome) return;
    const startMs = this.engine.time;
    const n = previous === undefined ? Math.floor(startMs / turns.turnMs) + 1 : previous + 1;
    const { endMs } = turnBounds(startMs, turns.turnMs, this.engine.world);
    const deadlineWallMs =
      turns.deadlineHours === undefined
        ? undefined
        : this.wallNow() + Math.round(turns.deadlineHours * 3_600_000);
    this.openTurn = {
      n,
      startMs,
      endMs,
      ...(deadlineWallMs === undefined ? {} : { deadlineWallMs }),
      held: new Map(),
      sent: new Map(),
      resolving: false,
    };
    const entry: InputLogEntry = {
      seq: ++this.seq,
      wallMs: this.wallNow(),
      gameMs: startMs,
      endGameMs: startMs,
      command: {
        kind: 'openTurn',
        turn: n,
        startMs,
        endMs,
        ...(deadlineWallMs === undefined ? {} : { deadlineWallMs }),
      },
    };
    if (this.trace.enabled) this.trace.record(this.id, 'command', entry);
    // Scripted sides think on their interval as in real time (#430): one due now thinks here, on
    // the world caught up to the turn's start, and its orders are issued then and logged as in real
    // time. In a turn the engine resolves it thinks again inside the turn (`advanceEngine`); in a
    // held turn this is its one decision. No LLM commander plays turn mode yet (nothing may hold
    // the turn's clock), so it plays by its script.
    // `advanceEngine` has already run every due agent but those it skips: idle ones (as real time
    // does, so they are skipped here too) and all of them in a held turn.
    this.advanceEngine(startMs);
    const waiting = this.engine.queue.length > 0;
    for (const slot of this.agents) {
      if (slot.pending || slot.retired || slot.nextAt > startMs || (slot.idle && !waiting))
        continue;
      slot.nextAt = (Math.floor(startMs / slot.agent.intervalMs) + 1) * slot.agent.intervalMs;
      if (slot.agent.dormant?.()) slot.idle = true;
      else slot.idle = !this.think(slot.agent) && (slot.agent.settled?.() ?? true);
    }
    await this.commit(entry);
  }

  /**
   * Close the open turn and start its resolution outside the queue, like a parse: the resolver may
   * take minutes, and game time cannot move meanwhile (the clock is manual and every clock command is
   * refused), so the state it was given is still the state its output is applied to.
   */
  private async closeTurn(cause: TurnCause): Promise<void> {
    const t = this.openTurn;
    const turns = this.turns;
    if (!t || !turns || t.resolving || this.closed || this.engine.world.outcome) return;
    if (cause === 'all-sent' && !this.turnReady()) return;
    this.sync();
    t.resolving = true;
    const input: TurnInput = {
      gameId: this.id,
      n: t.n,
      startMs: t.startMs,
      endMs: t.endMs,
      cause,
      orders: sentOrdersOf(t),
      sent: [...t.sent.keys()],
    };
    const state = this.engine;
    this.onStaffAtWork?.({ working: true, needAtMs: t.startMs });
    this.reschedule();
    this.notify();
    const resolved = (async (): Promise<TurnResolution> => {
      try {
        return await turns.resolver.resolve(state, input, {
          agents: () => this.turnAgents(t.n),
        });
      } catch (e) {
        // A resolver must always answer; one that throws leaves the units on their last orders.
        if (this.trace.enabled) this.trace.record(this.id, 'error', { source: 'turn', error: e });
        const error = e instanceof Error ? e.message : String(e);
        return { adjudicator: NO_ADJUDICATOR, fallback: { error, attempts: 1 } };
      }
    })();
    void resolved
      .then((res) => this.enqueueCompletion(() => this.completeTurn(t, input, res)))
      .catch((e) => this.onError?.(e));
  }

  /**
   * Apply a resolved turn at its start with the adjudicator it names (the same call replay makes),
   * advance the clock to its end, log it and open the next turn.
   */
  private async completeTurn(t: OpenTurn, input: TurnInput, res: TurnResolution): Promise<void> {
    if (this.closed || this.openTurn !== t) return;
    const entry: InputLogEntry = {
      seq: ++this.seq,
      wallMs: this.wallNow(),
      gameMs: this.engine.time,
      command: { kind: 'resolveTurn', turn: t.n, cause: input.cause },
      turn: {
        n: t.n,
        startMs: t.startMs,
        endMs: t.endMs,
        cause: input.cause,
        orders: [...input.orders],
        sent: [...input.sent],
        adjudicator: res.adjudicator,
        ...(res.output === undefined ? {} : { output: res.output }),
        ...(res.fallback ? { fallback: res.fallback } : {}),
      },
      ...(res.calls ? { calls: res.calls } : {}),
    };
    try {
      this.sync();
      entry.gameMs = this.engine.time;
      try {
        this.engine = applyTurn(this.engine, entry.turn!, {
          gameId: this.id,
          registry: this.registry,
        });
      } catch (e) {
        // Replay skips a failed turn's output but still runs on to its end, as here.
        entry.error = e instanceof Error ? e.message : String(e);
        if (this.trace.enabled) this.trace.record(this.id, 'error', { source: 'turn', error: e });
      }
      if (this.clock.status !== 'stopped') this.clock.skipTo(t.endMs);
      this.sync();
      entry.endGameMs = this.engine.time;
    } finally {
      this.openTurn = undefined;
      this.onStaffAtWork?.({ working: false });
    }
    if (this.trace.enabled) this.trace.record(this.id, 'command', entry);
    try {
      await this.commit(entry);
    } finally {
      // The turn is resolved in memory whether or not the store took it; a failed commit must not
      // leave the live game with no turn open (a restart would re-resolve it from the log).
      await this.openNextTurn(t.n);
    }
  }

  private clearTurnTimer(): void {
    if (this.turnTimerSet) this.timers.clearTimeout(this.turnTimer);
    this.turnTimerSet = false;
  }

  /** Wake at the open turn's wall-clock deadline, which no game event accounts for. */
  private rescheduleTurnDeadline(): void {
    this.clearTurnTimer();
    const t = this.openTurn;
    const deadline = t?.deadlineWallMs;
    if (this.closed || !t || t.resolving || deadline === undefined) return;
    const delay = Math.min(MAX_SLEEP_MS, Math.max(0, deadline - this.wallNow()));
    this.turnTimer = this.timers.setTimeout(() => {
      this.turnTimerSet = false;
      this.enqueue(async () => {
        // Checked when the job runs: the turn may have closed meanwhile, or a long sleep woke early.
        if (this.openTurn !== t || t.resolving) return;
        if (this.wallNow() >= deadline) await this.closeTurn('deadline');
        else this.rescheduleTurnDeadline();
      }).catch((e) => {
        if (this.trace.enabled) this.trace.record(this.id, 'error', { source: 'turn', error: e });
        this.onError?.(e);
      });
    }, delay);
    this.turnTimerSet = true;
  }

  /** What the parser would read for an order `side` signs now. Read-only; the admin playground prefills from it (#395). */
  orderContext(side: string): ParseContext {
    return this.parseContext(side);
  }

  /** What the parser may read: the issuing side, named places and the side's own units. */
  private parseContext(side: string): ParseContext {
    return parseContextOf(this.engine.world, side);
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

  private withTimeout<T>(
    work: Promise<T>,
    timeoutMs = this.parseTimeoutMs,
    what = 'parse',
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const handle = this.parseTimer(
        () => reject(new Error(`${what} timed out after ${timeoutMs} ms`)),
        timeoutMs,
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
    const { fallback } = outcome;
    const parsed = this.checkSigner(command, outcome.parsed);
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

  /**
   * A signer who may not sign for the addressee gets a refusal in place of the parse, so the log
   * (and replay) holds the refusal, not an order that was never sent. The parse only names the
   * addressee here, so this is the first place the check can be made.
   */
  private checkSigner(
    command: Extract<GameCommand, { kind: 'order' }>,
    parsed: ParseResult,
  ): ParseResult {
    if (!command.signer || parsed.kind !== 'intents') return parsed;
    if (maySign(this.engine.world, command.side as SideId, command.signer, parsed.unitId))
      return parsed;
    const unit = this.engine.world.units.find((u) => u.id === parsed.unitId);
    return {
      kind: 'rejection',
      text: parsed.text,
      reason: `You may not sign orders to ${unit?.name ?? parsed.unitId}.`,
    };
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
      undefined,
      command.orderId,
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

/** Clock and vote commands a turn-mode game refuses (D39): only resolving a turn moves its clock. */
const TURN_REFUSED: ReadonlySet<GameCommand['kind']> = new Set<GameCommand['kind']>([
  'setRate',
  'pause',
  'resume',
  'setMode',
  'advanceTo',
  'step',
  'proposePause',
  'proposeResume',
  'proposeHold',
  'vote',
  'proposeRate',
  'rateVote',
]);

/** Rebuild engine state from a stored snapshot. */
export function restoreEngine(serialized: string): EngineState<GameState> {
  return deserialize<GameState>(serialized);
}
