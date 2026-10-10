/** GameHost: many games in one process, one `GameActor` each. */
import {
  advanceTo,
  createState,
  deserialize,
  type EmittedEvent,
  type EventRegistry,
  type GameState,
} from '@kriegsspiel/engine';
import { GameClock, type WallClock } from '../clock.js';
import type { OrderParser } from '../orders/index.js';
import { GameActor, type GameActorOptions, type StaffAtWork, type Timers } from './actor.js';
import type { TraceSink } from '../debug/trace.js';
import { replayFrom } from './replay.js';
import type { GameStore } from './store.js';

export interface GameHostOptions {
  store: GameStore;
  parser: OrderParser;
  registry: EventRegistry<GameState>;
  wallNow: WallClock;
  timers?: Timers;
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
  parseRetryDelayMs?: number;
}

export class GameHost {
  private readonly games = new Map<string, GameActor>();
  /** In-flight `create` / `open` calls, registered synchronously so a game never gets two actors. */
  private readonly pending = new Map<string, Promise<GameActor>>();

  constructor(private readonly options: GameHostOptions) {}

  get(id: string): GameActor | undefined {
    return this.games.get(id);
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
      parser: o.parser,
      store: o.store,
      timers: o.timers,
      trace: o.trace,
      snapshotEvery: o.snapshotEvery,
      onError: (e) => o.onError?.(id, e),
      onEmitted: (events) => o.onEmitted?.(id, events),
      onStaffAtWork: (state) => o.onStaffAtWork?.(id, state),
      parseRetries: o.parseRetries,
      parseTimeoutMs: o.parseTimeoutMs,
      parseRetryDelayMs: o.parseRetryDelayMs,
    };
  }

  /** Start a new game from a loaded scenario. The clock starts running at game time 0. */
  create(id: string, world: GameState, clock: { rate?: number } = {}): Promise<GameActor> {
    if (this.games.has(id) || this.pending.has(id)) {
      return Promise.reject(new Error(`game already exists: ${id}`));
    }
    return this.register(id, () => this.doCreate(id, world, clock));
  }

  /** Run `build` as the one in-flight start for `id`; the id is claimed before the first await. */
  private register(id: string, build: () => Promise<GameActor>): Promise<GameActor> {
    const promise = build().finally(() => this.pending.delete(id));
    this.pending.set(id, promise);
    return promise;
  }

  private async doCreate(
    id: string,
    world: GameState,
    clock: { rate?: number },
  ): Promise<GameActor> {
    if (await this.options.store.loadSnapshot(id)) {
      throw new Error(`game already exists: ${id}`);
    }
    const state = createState(world.seed, world, 0);
    await this.options.store.saveLogHeader({
      gameId: id,
      scenarioId: world.scenarioId,
      seed: world.seed,
    });
    const actor = new GameActor({
      ...this.actorOptions(id),
      state,
      clock: new GameClock(this.options.wallNow, { rate: clock.rate }),
    });
    this.games.set(id, actor);
    await actor.start();
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
    // Recovery: the latest snapshot, then the inputs logged after it, then the game time the
    // scheduler had reached since the last input. Replay is the same code the live game ran,
    // and chunking `advanceTo` never changes a result, so the state equals the one before the stop.
    const tail = await store.inputLog(id, snap.seq);
    let state = deserialize<GameState>(snap.engine);
    state = replayFrom(state, id, tail, this.options.registry).state;
    const progress = await store.loadProgress(id);
    if (progress !== undefined && progress > state.time) {
      state = advanceTo(state, progress, this.options.registry).state;
    }
    // Rate and mode may have changed in the replayed inputs.
    let { rate, mode } = snap.clock;
    for (const e of tail) {
      if (e.error) continue;
      if (e.command.kind === 'setRate') rate = e.command.rate;
      else if (e.command.kind === 'setMode') mode = e.command.mode;
    }
    const clock = new GameClock(this.options.wallNow, {
      gameMs: state.time,
      rate,
      mode,
      status: snap.clock.status === 'stopped' ? 'stopped' : 'paused',
    });
    const actor = new GameActor({
      ...this.actorOptions(id),
      state,
      clock,
      seq: tail.at(-1)?.seq ?? snap.seq,
    });
    this.games.set(id, actor);
    await actor.start();
    return actor;
  }

  async close(id: string): Promise<void> {
    const actor = this.games.get(id);
    this.games.delete(id);
    await actor?.close();
  }

  /** Close every game: no timers are left running. */
  async shutdown(): Promise<void> {
    const all = [...this.games.keys()];
    await Promise.all(all.map((id) => this.close(id)));
  }
}
