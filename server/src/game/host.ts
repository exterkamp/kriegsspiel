/** GameHost: many games in one process, one `GameActor` each. */
import {
  createState,
  deserialize,
  type EmittedEvent,
  type EngineState,
  type EventRegistry,
  type GameState,
} from '@kriegsspiel/engine';
import { GameClock, type WallClock } from '../clock.js';
import type { OrderParser } from '../orders/index.js';
import { GameActor, type GameActorOptions, type Timers } from './actor.js';
import type { GameStore } from './store.js';

export interface GameHostOptions {
  store: GameStore;
  parser: OrderParser;
  registry: EventRegistry<GameState>;
  wallNow: WallClock;
  timers?: Timers;
  /** Called after each tick or command of a game, once its state is saved. */
  onUpdate?: (gameId: string) => void;
  /** Applied to a new game's state before it starts, e.g. to queue its first scheduled events. */
  init?: (state: EngineState<GameState>) => EngineState<GameState>;
  onError?: (gameId: string, error: unknown) => void;
  /** Events the engine emitted for a game, in firing order. */
  onEmitted?: (gameId: string, events: EmittedEvent[]) => void;
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
      onUpdate: () => o.onUpdate?.(id),
      onError: (e) => o.onError?.(id, e),
      onEmitted: (events) => o.onEmitted?.(id, events),
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
    const state0 = createState(world.seed, world, 0);
    const state = this.options.init?.(state0) ?? state0;
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
    const snap = await this.options.store.loadSnapshot(id);
    if (!snap) throw new Error(`no such game: ${id}`);
    const state = deserialize<GameState>(snap.engine);
    const log = await this.options.store.inputLog(id);
    const clock = new GameClock(this.options.wallNow, {
      gameMs: state.time,
      rate: snap.clock.rate,
      mode: snap.clock.mode,
      status: snap.clock.status === 'stopped' ? 'stopped' : 'paused',
    });
    const actor = new GameActor({
      ...this.actorOptions(id),
      state,
      clock,
      seq: log.at(-1)?.seq ?? 0,
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
