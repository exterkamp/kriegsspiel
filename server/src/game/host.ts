import {
  assertSnapshotHeader,
  assertHistoricalWorld,
  snapshotBinding,
} from './snapshot-binding.js';
/** GameHost: many games in one process, one `GameActor` each. */
import {
  advanceTo,
  createState,
  deserialize,
  type EmittedEvent,
  type EngineState,
  type EventRegistry,
  type GameState,
  type Seat,
} from '@kriegsspiel/engine';
import { GameClock, type WallClock } from '../clock.js';
import { scriptedAgents, type SideAgent } from '../opponent/index.js';
import type { PauseConfig } from '../pause.js';
import type { OrderParser } from '../orders/index.js';
import { GameActor, type GameActorOptions, type StaffAtWork, type Timers } from './actor.js';
import type { UmpireClient } from '../umpire/index.js';
import type { TraceSink } from '../debug/trace.js';
import { replayFrom } from './replay.js';
import type {
  DeputyAccount,
  DeputySettings,
  Dissent,
  StaffExchange,
  UmpireSettings,
} from '@kriegsspiel/protocol';
import { turnSettingsOf } from '@kriegsspiel/protocol';
import type { GameStore, InputLogEntry } from './store.js';
import { EngineTurnResolver } from './engineTurn.js';
import { openTurnFromLog, sentTurnIdsFromLog, type TurnResolver } from './turns.js';
import { assertPinnedWorld, detachedInputHeader } from './pinned-header.js';
import {
  decodeNativeScenarioPin,
  nativeCanonicalJson,
  type NativeScenarioPinV1,
} from './native-scenario-pin.js';
import { assertBattlefieldBudget } from '@kriegsspiel/protocol';

/** Server-owned creation data; native pins never arrive as a client-provided world. */
export interface GameCreationOptions {
  rate?: number;
  settings?: UmpireSettings;
  pin?: NativeScenarioPinV1;
  creationReceiptId?: string;
}

/** Each side's deputy settings (the last set) and the account of its turns, from a game's whole input log (D6f). */
export function deputiesFromLog(
  log: readonly InputLogEntry[],
): Map<string, { settings: DeputySettings; seat?: Seat; account: DeputyAccount[] }> {
  const out = new Map<
    string,
    { settings: DeputySettings; seat?: Seat; account: DeputyAccount[] }
  >();
  for (const e of log) {
    const c = e.command;
    if (c.kind === 'deputySet') {
      const had = out.get(c.side);
      out.set(c.side, {
        settings: c.settings,
        ...(c.seat ? { seat: c.seat } : {}),
        account: had?.account ?? [],
      });
    } else if (c.kind === 'deputyTurn') {
      const had = out.get(c.side);
      if (had) had.account.push(c.account);
    }
  }
  return out;
}

export interface GameHostOptions {
  store: GameStore;
  /** One parser for every game, or a parser per game (for example one with the game's own LLM budget). */
  parser: OrderParser | ((gameId: string) => OrderParser);
  registry: EventRegistry<GameState>;
  wallNow: WallClock;
  timers?: Timers;
  /** Called after each tick or command of a game, once its state is saved. */
  onUpdate?: (gameId: string) => void;
  /** Called when a game is closed (evicted or shut down), after its actor has stopped. */
  onClose?: (gameId: string) => void;
  /** Applied to a new game's state before it starts, e.g. to queue its first scheduled events. */
  init?: (state: EngineState<GameState>) => EngineState<GameState>;
  trace?: TraceSink;
  /** Take a snapshot after this many logged inputs (default 1). */
  snapshotEvery?: number;
  onError?: (gameId: string, error: unknown) => void;
  /** Events the engine emitted for a game, in firing order. */
  onEmitted?: (gameId: string, events: EmittedEvent[]) => void;
  /** The umpire started or finished work that game time is waiting on. */
  onStaffAtWork?: (gameId: string, state: StaffAtWork) => void;
  parseRetries?: number;
  parseTimeoutMs?: number;
  narrateTimeoutMs?: number;
  parseRetryDelayMs?: number;
  /** Play every side the scenario marks `scripted` with the built-in opponent: always, never, or per game. Default off. */
  scriptedOpponents?: boolean | ((gameId: string) => boolean);
  /** Swap the agents a game gets for another set, such as LLM commanders wrapping the scripted ones. Called only for games that have scripted agents. */
  aiAgents?: (gameId: string, world: GameState, scripted: SideAgent[]) => SideAgent[];
  /** The umpire client that narrates a game's dispatches (one per game, so caps are per game). Unset: players see the engine's template text. */
  narrator?: (gameId: string) => UmpireClient | undefined;
  /** Whether the player who appointed a side's deputy is away from the table now (D6f). Unset: always. */
  deputyAway?: (gameId: string, side: string, seat: Seat | undefined) => boolean;
  /** Pause voting for a game: who votes and the host's rules. Unset: players cannot vote to pause. Never used in turn mode. */
  pause?: (id: string, world: GameState) => PauseConfig | undefined;
  /** Resolves a turn-mode game's turns (D39). Unset, or undefined for a game: the engine (`EngineTurnResolver`). */
  turnResolver?: (gameId: string, settings: UmpireSettings) => TurnResolver | undefined;
}

export class GameHost {
  private readonly games = new Map<string, GameActor>();
  /** In-flight `create` / `open` calls, registered synchronously so a game never gets two actors. */
  private readonly pending = new Map<string, Promise<GameActor>>();

  constructor(private readonly options: GameHostOptions) {}

  get(id: string): GameActor | undefined {
    return this.games.get(id);
  }

  /** Ids of the games that are open now. */
  ids(): string[] {
    return [...this.games.keys()];
  }

  get size(): number {
    return this.games.size;
  }

  private actorOptions(id: string): Omit<GameActorOptions, 'state' | 'clock'> {
    const o = this.options;
    return {
      id,
      registry: o.registry,
      wallNow: o.wallNow,
      parser: typeof o.parser === 'function' ? o.parser(id) : o.parser,
      store: o.store,
      timers: o.timers,
      onUpdate: () => o.onUpdate?.(id),
      trace: o.trace,
      snapshotEvery: o.snapshotEvery,
      onError: (e) => o.onError?.(id, e),
      onEmitted: (events) => o.onEmitted?.(id, events),
      onStaffAtWork: (state) => o.onStaffAtWork?.(id, state),
      umpire: o.narrator?.(id),
      deputyAway: o.deputyAway ? (side, seat) => o.deputyAway!(id, side, seat) : undefined,
      parseRetries: o.parseRetries,
      parseTimeoutMs: o.parseTimeoutMs,
      narrateTimeoutMs: o.narrateTimeoutMs,
      parseRetryDelayMs: o.parseRetryDelayMs,
    };
  }

  /** The actor's turn options for a turn-mode game; undefined for a real-time one. */
  private turnsFor(id: string, settings: UmpireSettings | undefined) {
    const turn = turnSettingsOf(settings);
    if (!turn || !settings) return undefined;
    const resolver =
      this.options.turnResolver?.(id, settings) ?? new EngineTurnResolver(this.options.registry);
    return {
      turnMs: turn.turnMinutes * 60_000,
      ...(turn.turnDeadlineHours === undefined ? {} : { deadlineHours: turn.turnDeadlineHours }),
      resolver,
    };
  }

  private agentsFor(id: string, world: GameState) {
    const on = this.options.scriptedOpponents;
    if (!(typeof on === 'function' ? on(id) : on)) return [];
    const scripted = scriptedAgents(world);
    return scripted.length > 0 && this.options.aiAgents
      ? this.options.aiAgents(id, world, scripted)
      : scripted;
  }

  /** Start a new game from a loaded scenario. The clock starts running at game time 0. */
  create(id: string, world: GameState, clock: GameCreationOptions = {}): Promise<GameActor> {
    if (this.games.has(id) || this.pending.has(id)) {
      return Promise.reject(new Error(`game already exists: ${id}`));
    }
    return this.register(id, () => this.doCreate(id, world, clock));
  }

  /** Run `build` as the one in-flight start for `id`; the id is claimed before the first await. */
  private register(id: string, build: () => Promise<GameActor>): Promise<GameActor> {
    const promise = build()
      .catch((error: unknown) => {
        try {
          this.options.onClose?.(id);
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], 'Game resource cleanup failed');
        }
        throw error;
      })
      .finally(() => this.pending.delete(id));
    this.pending.set(id, promise);
    return promise;
  }

  private async doCreate(
    id: string,
    scenario: GameState,
    clock: GameCreationOptions,
  ): Promise<GameActor> {
    const pin = clock.pin !== undefined ? decodeNativeScenarioPin(clock.pin) : undefined;
    if (pin) {
      assertBattlefieldBudget(scenario, 1024 * 1024);
      if (nativeCanonicalJson(scenario) !== nativeCanonicalJson(pin.initialWorld))
        throw new Error('Creation world contradicts native pin');
      scenario = structuredClone(pin.initialWorld);
    }
    const settings = clock.settings ? structuredClone(clock.settings) : undefined;
    const rate = clock.rate;
    const header = detachedInputHeader({
      gameId: id,
      scenarioId: scenario.scenarioId,
      seed: scenario.seed,
      ...(settings ? { settings } : {}),
      ...(pin ? { battlefieldFormat: 1 as const, battlefieldPin: pin } : {}),
      ...(clock.creationReceiptId !== undefined
        ? { creationReceiptId: clock.creationReceiptId }
        : {}),
    });
    if (await this.options.store.loadSnapshot(id)) throw new Error(`game already exists: ${id}`);
    // A crash after header acceptance but before the first snapshot may resume
    // only the same native allocation, with no prior inputs to overwrite.
    const previous = await this.options.store.logHeader(id);
    if (previous) {
      if (
        !pin ||
        nativeCanonicalJson(previous) !== nativeCanonicalJson(header) ||
        (await this.options.store.inputLog(id)).length !== 0
      )
        throw new Error('Existing input header conflicts with native allocation');
    } else await this.options.store.saveLogHeader(header);
    // Dial/settings are runtime choices applied after the retained initial pin.
    const world: GameState = settings ? { ...scenario, dial: settings.dial } : scenario;
    const state0 = createState(world.seed, world, 0);
    const state = this.options.init?.(state0) ?? state0;
    // Turn mode (D39): the clock is manual for the game's whole life, there is no pause vote, and
    // the rate is ignored.
    const turns = this.turnsFor(id, settings);
    const battlefield = header ? snapshotBinding(header) : undefined;
    const actor = new GameActor({
      ...this.actorOptions(id),
      ...(battlefield ? { battlefield } : {}),
      state,
      agents: this.agentsFor(id, world),
      ...(turns ? { turns } : { pause: this.options.pause?.(id, world) }),
      persona: settings?.persona,
      clock: new GameClock(this.options.wallNow, turns ? { mode: 'manual' } : { rate }),
    });
    try {
      await actor.start();
    } catch (error) {
      try {
        await actor.close();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Game activation cleanup failed');
      }
      throw error;
    }
    // Only fully activated actors are visible to callers or duplicate opens.
    this.games.set(id, actor);
    return actor;
  }

  /**
   * Load a game from the store. Per the pause design, a game that was running when the server
   * went down comes back paused, so game time never silently skips.
   */
  open(id: string): Promise<GameActor> {
    const existing = this.games.get(id);
    if (existing) return Promise.resolve(existing);
    return this.pending.get(id) ?? this.register(id, () => this.doOpen(id));
  }

  private async doOpen(id: string): Promise<GameActor> {
    const { store } = this.options;
    const snap = await store.loadSnapshot(id);
    if (!snap) throw new Error(`no such game: ${id}`);
    const header = await store.logHeader(id);
    assertSnapshotHeader(snap, header, id);
    // Recovery: the latest snapshot, then the inputs logged after it, then the game time the
    // scheduler had reached since the last input. Replay is the same code the live game ran,
    // and chunking `advanceTo` never changes a result, so the state equals the one before the stop.
    const tail = await store.inputLog(id, snap.seq);
    let state = deserialize<GameState>(snap.engine);
    if (header && header.battlefieldFormat === 1) assertPinnedWorld(header, state.world, id);
    else assertHistoricalWorld(header, state.world, id);
    state = replayFrom(state, id, tail, this.options.registry).state;
    const progress = await store.loadProgress(id);
    const lastAlive = await store.loadHeartbeat(id);
    const downMs = lastAlive === undefined ? 0 : Math.max(0, this.options.wallNow() - lastAlive);
    if (progress !== undefined && progress > state.time) {
      state = advanceTo(state, progress, this.options.registry).state;
    }
    // Rate and mode may have changed in the replayed inputs.
    let { rate, mode } = snap.clock;
    for (const e of tail) {
      if (e.error) continue;
      if (e.command.kind === 'setRate') rate = e.command.rate;
      else if (e.command.kind === 'setMode') mode = e.command.mode;
      for (const t of e.ratio ?? []) if (t.outcome === 'passed') rate = t.rate;
    }
    if (header && header.battlefieldFormat === 1) assertPinnedWorld(header, state.world, id);
    else assertHistoricalWorld(header, state.world, id);
    const settings = header?.settings;
    const turnOptions = this.turnsFor(id, settings);
    // A turn-mode game has nothing to pause: game time does not run while it is down.
    const clock = new GameClock(this.options.wallNow, {
      gameMs: state.time,
      rate,
      mode: turnOptions ? 'manual' : mode,
      status: snap.clock.status === 'stopped' ? 'stopped' : turnOptions ? 'running' : 'paused',
    });
    // The conference is not in a snapshot, so it comes from the whole log.
    const log = await store.inputLog(id);
    const staffHistory = new Map<string, StaffExchange[]>();
    const dissents = new Map<string, Dissent[]>();
    // Holds already called stay used: a restart does not refund them.
    const holdsUsed: Record<string, number> = {};
    for (const e of log) {
      if (!e.error && e.command.kind === 'proposeHold') {
        holdsUsed[e.command.by] = (holdsUsed[e.command.by] ?? 0) + 1;
      }
      const c = e.command;
      if (c.kind === 'dissent') dissents.set(c.side, [...(dissents.get(c.side) ?? []), c.dissent]);
      if (c.kind !== 'staffAnswer' || !c.exchange) continue;
      // A question is logged when asked and again when answered (#418): the answer replaces it in place.
      const x = c.exchange;
      const list = staffHistory.get(c.side) ?? [];
      staffHistory.set(
        c.side,
        list.some((y) => y.questionId === x.questionId)
          ? list.map((y) => (y.questionId === x.questionId ? x : y))
          : [...list, x],
      );
    }
    const deputies = deputiesFromLog(log);
    // The narration breaker as the last window left it (#419).
    const narrateBreaker = [...log]
      .reverse()
      .find((e) => e.command.kind === 'narrate' && e.narrateBreaker)?.narrateBreaker;
    const open = turnOptions ? openTurnFromLog(log) : undefined;
    const turns = turnOptions && {
      ...turnOptions,
      ...(open ? { open } : {}),
      sentIds: sentTurnIdsFromLog(log),
    };
    const battlefield = header ? snapshotBinding(header) : undefined;
    const actor = new GameActor({
      ...this.actorOptions(id),
      ...(battlefield ? { battlefield } : {}),
      state,
      staffHistory,
      deputies,
      dissents,
      holdsUsed,
      clock,
      agents: this.agentsFor(id, state.world),
      ...(turns ? { turns } : { pause: this.options.pause?.(id, state.world) }),
      restart: { downMs },
      persona: settings?.persona,
      ...(narrateBreaker ? { narrateBreaker } : {}),
      // The log is in insertion order, which is not always seq order (see D14b).
      seq: tail.reduce((max, e) => Math.max(max, e.seq), snap.seq),
    });
    try {
      await actor.start();
    } catch (error) {
      try {
        await actor.close();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Game activation cleanup failed');
      }
      throw error;
    }
    // Only fully activated actors are visible to callers or duplicate opens.
    this.games.set(id, actor);
    return actor;
  }

  async close(id: string): Promise<void> {
    // A concurrent account removal/shutdown must also retire an activation in flight.
    await this.pending.get(id)?.catch(() => undefined);
    const actor = this.games.get(id);
    this.games.delete(id);
    await actor?.close();
    this.options.onClose?.(id);
  }

  /** Close every game: no timers are left running. */
  async shutdown(): Promise<void> {
    const all = [...new Set([...this.games.keys(), ...this.pending.keys()])];
    await Promise.all(all.map((id) => this.close(id)));
  }
}
