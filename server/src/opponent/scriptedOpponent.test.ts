import {
  EventRegistry,
  createState,
  holdTheBridge,
  loadScenario,
  registerCombat,
  registerMovement,
  registerOrders,
  registerVisibility,
  viewFor,
  type EmittedEvent,
  type EngineSideView,
  type GameState,
} from '@kriegsspiel/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { GameActor, GameHost, MemoryGameStore, replayLog } from '../game/index.js';
import { GameClock } from '../clock.js';
import { FakeTime } from '../game/testing.js';
import type { OrderParser } from '../orders/index.js';
import type { SideAgent } from './index.js';
import {
  AIM_SPREAD_M,
  FORM_UP_MS,
  THINK_INTERVAL_MS,
  ScriptedOpponent,
  assertFogOnly,
  scriptedAgents,
  type ScriptedOpponentConfig,
} from './index.js';

const CONFIG: ScriptedOpponentConfig = {
  side: 'red',
  seed: 1815,
  objective: { x: 2050, y: 1500 },
  fallbackTo: { x: 2050, y: 50 },
};

function view(over: Partial<EngineSideView> = {}): EngineSideView {
  return {
    side: 'red',
    time: FORM_UP_MS,
    mapWidth: 4000,
    mapHeight: 3000,
    orderRoutes: [],
    couriers: [],
    ownUnits: [
      {
        id: 'red-1',
        name: 'Vanguard',
        kind: 'infantry',
        position: { x: 1950, y: 450 },
        facing: Math.PI,
        formation: 'line',
        footprint: { frontage: 100, depth: 30 },
        strength: 650,
        morale: 80,
        fatigue: 0,
        ammo: 100,
      },
    ],
    visibleEnemies: [],
    lastKnownContacts: [],
    reports: [],
    documents: [],
    ...over,
  };
}

const enemy = (x: number, y: number): EngineSideView['visibleEnemies'][number] => ({
  id: 'blue-1',
  position: { x, y },
  facing: 0,
  formation: 'line',
  footprint: { frontage: 100, depth: 30 },
  sizeEstimate: 'about a battalion',
});

describe('fog of war', () => {
  it('takes only a SideView, and refuses master state at runtime', () => {
    const bot = new ScriptedOpponent(CONFIG);
    const world = loadScenario(holdTheBridge);
    // Type level: master state is not a view.
    // @ts-expect-error GameState is not an EngineSideView
    expect(() => bot.think(world)).toThrow(/refused master state/);
    // Runtime: a view with master state smuggled alongside is refused too.
    expect(() => bot.think({ ...view(), units: world.units } as unknown as EngineSideView)).toThrow(
      /refused master state/,
    );
    expect(() => bot.think({ ...view(), spy: 1 } as unknown as EngineSideView)).toThrow(
      /not a side view/,
    );
  });

  it("refuses another side's view", () => {
    expect(() => assertFogOnly(view({ side: 'blue' }), 'red')).toThrow(/not red/);
  });

  it('accepts what viewFor builds from the real world', () => {
    const world = loadScenario(holdTheBridge);
    const bot = new ScriptedOpponent(CONFIG);
    expect(bot.think(viewFor(world, 'red', FORM_UP_MS)).length).toBeGreaterThan(0);
  });
});

describe('behaviour', () => {
  it('advances on the objective, within its spread', () => {
    const [o] = new ScriptedOpponent(CONFIG).think(view());
    expect(o?.intent.kind).toBe('move');
    const to = (o!.intent as { to: { x: number; y: number } }).to;
    expect(Math.abs(to.x - 2_050_000)).toBeLessThanOrEqual(AIM_SPREAD_M * 1000);
    expect(Math.abs(to.y - 1_500_000)).toBeLessThanOrEqual(AIM_SPREAD_M * 1000);
  });

  it('sends a unit that stopped short of the centre one last order onto it, then no more', () => {
    const bot = new ScriptedOpponent(CONFIG);
    const near = (x: number, y: number) => ({
      ownUnits: [{ ...view().ownUnits[0]!, position: { x, y } }],
    });
    // First told to go to a point off the centre, it stopped 40 m short of the 60 m square.
    bot.think(view());
    const [o] = bot.think(view({ time: FORM_UP_MS + 300_000, ...near(2050, 1540) }));
    expect(o?.intent).toEqual({ kind: 'move', to: { x: 2_050_000, y: 1_500_000 } });
    expect(bot.think(view({ time: FORM_UP_MS + 600_000, ...near(2050, 1540) }))).toEqual([]);
  });

  it('words its orders with a place name, not metres, when it can describe one', () => {
    const agent = new ScriptedOpponent({ ...CONFIG, describe: () => 'near the mill' });
    const orders = agent.think(view());
    expect(orders.length).toBeGreaterThan(0);
    for (const o of orders) {
      expect(o.text).toContain('near the mill');
      expect(o.text).not.toMatch(/\(\d+, \d+\)/);
    }
  });

  it('forms up first: no order, and not settled, until FORM_UP_MS has passed', () => {
    const bot = new ScriptedOpponent(CONFIG);
    expect(bot.think(view({ time: 0 }))).toEqual([]);
    expect(bot.settled()).toBe(false);
    expect(bot.think(view({ time: FORM_UP_MS - 1 }))).toEqual([]);
    expect(bot.think(view({ time: FORM_UP_MS }))).toHaveLength(1);
  });

  it('stays on the objective instead of chasing an enemy it sees', () => {
    const bot = new ScriptedOpponent(CONFIG);
    const onObjective = {
      ownUnits: [{ ...view().ownUnits[0]!, position: { x: 2040, y: 1510 } }],
    };
    bot.think(view(onObjective));
    expect(bot.think(view({ ...onObjective, visibleEnemies: [enemy(1960, 1680)] }))).toEqual([]);
  });

  it('does not repeat an order that would change nothing', () => {
    const bot = new ScriptedOpponent(CONFIG);
    expect(bot.think(view())).toHaveLength(1);
    expect(bot.think(view({ time: FORM_UP_MS + 300_000 }))).toHaveLength(0);
  });

  it('attacks an enemy it sees near it', () => {
    const bot = new ScriptedOpponent(CONFIG);
    bot.think(view());
    const [o] = bot.think(view({ time: FORM_UP_MS + 300_000, visibleEnemies: [enemy(1950, 900)] }));
    expect(o?.intent).toEqual({ kind: 'move', to: { x: 1_950_000, y: 900_000 } });
    expect(o?.text).toMatch(/advance on the enemy/);
  });

  it('ignores a distant enemy and a stale contact', () => {
    const bot = new ScriptedOpponent(CONFIG);
    bot.think(view());
    const far = view({
      time: FORM_UP_MS + 300_000,
      visibleEnemies: [enemy(1950, 2400)],
      lastKnownContacts: [
        {
          id: 'blue-2',
          position: { x: 1950, y: 500 },
          facing: 0,
          observedAtGame: 0,
          seenAt: 0,
          ageMs: 3_600_000,
          uncertaintyRadius: 2000,
          sizeEstimate: 'about a battalion',
        } as EngineSideView['lastKnownContacts'][number],
      ],
    });
    expect(bot.think(far)).toHaveLength(0);
  });

  it('withdraws to HQ when morale is low, and stays withdrawn', () => {
    const bot = new ScriptedOpponent(CONFIG);
    bot.think(view());
    const weak = view({ ownUnits: [{ ...view().ownUnits[0]!, morale: 20 }] });
    const [o] = bot.think({
      ...weak,
      time: FORM_UP_MS + 300_000,
      visibleEnemies: [enemy(1950, 900)],
    });
    expect(o?.intent).toEqual({ kind: 'withdraw', toward: { x: 2_050_000, y: 50_000 } });
    expect(
      bot.think({ ...weak, time: FORM_UP_MS + 600_000, visibleEnemies: [enemy(1950, 900)] }),
    ).toHaveLength(0);
  });

  it('withdraws when strength falls below half its peak', () => {
    const bot = new ScriptedOpponent(CONFIG);
    bot.think(view());
    const hurt = view({ ownUnits: [{ ...view().ownUnits[0]!, strength: 300 }] });
    expect(bot.think({ ...hurt, time: FORM_UP_MS + 300_000 })[0]?.intent.kind).toBe('withdraw');
  });

  it('is deterministic for the same seed, view and time, and varies with the seed', () => {
    const a = new ScriptedOpponent(CONFIG).think(view());
    const b = new ScriptedOpponent(CONFIG).think(view());
    expect(a).toEqual(b);
    const seeds = new Set(
      [1, 2, 3, 4, 5, 6].map((seed) =>
        JSON.stringify(new ScriptedOpponent({ ...CONFIG, seed }).think(view())),
      ),
    );
    expect(seeds.size).toBeGreaterThan(1);
  });

  it('reports itself unsettled when a unit sat a decision out on a roll', () => {
    const outcomes = Array.from({ length: 300 }, (_, seed) => {
      const agent = new ScriptedOpponent({ ...CONFIG, seed });
      const orders = agent.think(view());
      return { orders: orders.length, settled: agent.settled() };
    });
    // One unit with no standing order: it either gets an order or hesitates, never both.
    expect(outcomes.some((o) => o.orders === 0 && !o.settled)).toBe(true);
    expect(outcomes.every((o) => (o.orders === 0) === !o.settled)).toBe(true);
    // Once it has been told to advance, a quiet decision is a settled one.
    const agent = new ScriptedOpponent({ ...CONFIG, seed: 1 });
    // (A unit that is marching, so it moves between decisions.)
    const marching = (t: number) => {
      const v = view({ time: FORM_UP_MS + t * THINK_INTERVAL_MS });
      return { ...v, ownUnits: [{ ...v.ownUnits[0]!, position: { x: 1950, y: 450 + t * 100 } }] };
    };
    for (let t = 0; t < 4; t++) agent.think(marching(t));
    expect(agent.think(marching(5))).toEqual([]);
    expect(agent.settled()).toBe(true);
  });

  it('orders a unit again when it has stopped short of the objective without being told to (#315)', () => {
    const agent = new ScriptedOpponent({ ...CONFIG, seed: 1 });
    const at = (t: number) => view({ time: FORM_UP_MS + t * THINK_INTERVAL_MS });
    let first: unknown[] = [];
    for (let t = 0; t < 3 && first.length === 0; t++) first = agent.think(at(t));
    expect(first).toHaveLength(1);
    // It has not moved: the order was lost on the way.
    const later = [at(3), at(4), at(5)].flatMap((v) => agent.think(v));
    expect(later.length).toBeGreaterThan(0);
  });

  it('sends cavalry at an enemy beyond infantry range (#315)', () => {
    const agent = new ScriptedOpponent({ ...CONFIG, seed: 1 });
    const v = view();
    const horse = { ...v.ownUnits[0]!, id: 'red-3', name: 'Hussars', kind: 'cavalry' as const };
    const orders = agent.think({
      ...v,
      ownUnits: [horse],
      visibleEnemies: [
        {
          id: 'blue-1',
          position: { x: 1950, y: 1450 },
          facing: 0,
          footprint: { frontage: 100, depth: 30 },
        },
      ] as never,
    });
    expect(orders[0]?.text).toMatch(/advance on the enemy/);
  });

  it('builds an agent for each scripted side only', () => {
    const agents = scriptedAgents(loadScenario(holdTheBridge));
    expect(agents.map((a) => a.side)).toEqual(['red']);
  });
});

function registry() {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerCombat(r);
  registerOrders(r);
  registerVisibility(r);
  return r;
}

const noParser: OrderParser = {
  async parse() {
    throw new Error('the scripted side must not use the parser');
  },
};

let host: GameHost | undefined;
afterEach(async () => {
  await host?.shutdown();
  host = undefined;
});

describe('headless game', () => {
  it('plays Red to a finished game, through the order path, and replays exactly', async () => {
    const time = new FakeTime();
    const store = new MemoryGameStore();
    const events: EmittedEvent[] = [];
    host = new GameHost({
      store,
      parser: noParser,
      registry: registry(),
      wallNow: time.now,
      timers: time,
      scriptedOpponents: true,
      onEmitted: (_id, e) => events.push(...e),
    });
    // Seed 7: Red wins this firefight (the scenario's own seed 1815 is a Blue win by holding).
    const scenario = loadScenario({ ...holdTheBridge, seed: 7 });
    const game = await host.create('g1', scenario);
    await game.submit({ kind: 'setMode', mode: 'fast-forward' });
    await time.advance(0);

    // Blue never moved, so Red takes the bridge and the game ends.
    const end = events.find((e) => e.type === 'game.end');
    expect(end?.payload).toMatchObject({ winner: 'red', reason: 'objective-taken' });
    expect(game.state.world.outcome?.winner).toBe('red');

    // Red's moves arrived as courier-delayed orders, never before they were issued.
    const issued = events.filter((e) => e.type === 'order_delivered');
    expect(issued.length).toBeGreaterThan(0);
    for (const e of issued) {
      expect(e.time).toBeGreaterThan((e.payload as { issuedAt: number }).issuedAt);
    }

    // The log carries every agent order, so replay needs neither agent nor parser.
    const log = await store.inputLog('g1');
    const agentOrders = log.filter((e) => e.agent);
    expect(agentOrders.length).toBeGreaterThan(0);
    expect(agentOrders.every((e) => e.command.kind === 'order' && e.command.side === 'red')).toBe(
      true,
    );
    const header = (await store.logHeader('g1'))!;
    // Fast-forward ran on after the last input, so replay is asked to run to where the game stands.
    const until = game.state.time;
    const replayed = replayLog(header, scenario, log, registry(), until);
    expect(replayed.state.world).toEqual(game.state.world);
  });

  it('plays the same game twice', async () => {
    const run = async () => {
      const time = new FakeTime();
      const h = new GameHost({
        store: new MemoryGameStore(),
        parser: noParser,
        registry: registry(),
        wallNow: time.now,
        timers: time,
        scriptedOpponents: true,
      });
      const g = await h.create('g1', loadScenario(holdTheBridge));
      await g.submit({ kind: 'setMode', mode: 'fast-forward' });
      await time.advance(0);
      const world = g.state.world;
      await h.shutdown();
      return world;
    };
    expect(await run()).toEqual(await run());
  });

  it('thinks at the same game times at rates 1, 4 and 12', async () => {
    const orderTimes = async (rate: number) => {
      const time = new FakeTime();
      const store = new MemoryGameStore();
      host = new GameHost({
        store,
        parser: noParser,
        registry: registry(),
        wallNow: time.now,
        timers: time,
        scriptedOpponents: true,
      });
      const game = await host.create('g1', loadScenario(holdTheBridge), { rate });
      await time.advance((30 * 60_000) / rate);
      await game.submit({ kind: 'pause' });
      const times = (await store.inputLog('g1')).filter((e) => e.agent).map((e) => e.gameMs);
      await host.shutdown();
      host = undefined;
      return times;
    };
    const base = await orderTimes(1);
    expect(base.length).toBeGreaterThan(0);
    expect(await orderTimes(4)).toEqual(base);
    expect(await orderTimes(12)).toEqual(base);
  });
  it('goes quiet in fast-forward when the agent has nothing to do and nothing is queued', async () => {
    const time = new FakeTime();
    const store = new MemoryGameStore();
    let thoughts = 0;
    const idleAgent: SideAgent = {
      side: 'red',
      intervalMs: THINK_INTERVAL_MS,
      think: () => {
        thoughts++;
        return [];
      },
    };
    const world = loadScenario(holdTheBridge);
    const actor = new GameActor({
      id: 'g1',
      state: createState(world.seed, world, 0),
      registry: registry(),
      clock: new GameClock(time.now, { rate: 1 }),
      wallNow: time.now,
      parser: noParser,
      store,
      timers: time,
      agents: [idleAgent],
    });
    await actor.start();
    await actor.submit({ kind: 'setMode', mode: 'fast-forward' });
    await time.advance(0);
    // It thought, found nothing to do, and the game is not over: no timer keeps the clock running.
    expect(thoughts).toBeGreaterThan(0);
    expect(time.pendingTimers).toBe(0);
    const stoppedAt = actor.state.time;
    const seen = thoughts;
    await time.advance(60 * 60_000);
    expect(actor.state.time).toBe(stoppedAt);
    expect(thoughts).toBe(seen);
    await actor.close();
  });

  it('thinks again once the world changes after it went idle', async () => {
    const time = new FakeTime();
    const world = loadScenario(holdTheBridge);
    let thoughts = 0;
    const agent: SideAgent = {
      side: 'red',
      intervalMs: THINK_INTERVAL_MS,
      think: () => {
        thoughts++;
        return [];
      },
    };
    const parser: OrderParser = {
      async parse(text) {
        return {
          kind: 'intents',
          text,
          unitId: 'blue-1',
          intents: [{ kind: 'move', to: { x: 20, y: 20 } }],
        };
      },
    };
    const actor = new GameActor({
      id: 'g1',
      state: createState(world.seed, world, 0),
      registry: registry(),
      clock: new GameClock(time.now, { rate: 1 }),
      wallNow: time.now,
      parser,
      store: new MemoryGameStore(),
      timers: time,
      agents: [agent],
    });
    await actor.start();
    await actor.submit({ kind: 'setMode', mode: 'fast-forward' });
    await time.advance(0);
    expect(time.pendingTimers).toBe(0);
    const quiet = thoughts;
    // Blue's courier and march are events; Red looks again after they happen, then goes quiet.
    await actor.submit({ kind: 'order', side: 'blue', text: 'blue-1 move to the ridge' });
    await time.advance(0);
    expect(thoughts).toBeGreaterThan(quiet);
    expect(time.pendingTimers).toBe(0);
    await actor.close();
  });

  it('keeps asking an agent that held back on a roll, even with nothing queued', async () => {
    const time = new FakeTime();
    const world = loadScenario(holdTheBridge);
    const store = new MemoryGameStore();
    let thoughts = 0;
    // Holds back at the first decision (like a hesitation roll), then has an order to give.
    const agent: SideAgent = {
      side: 'red',
      intervalMs: THINK_INTERVAL_MS,
      settled: () => thoughts !== 1,
      think: () =>
        ++thoughts !== 2
          ? []
          : [
              {
                text: 'red-1 advance',
                unitId: 'red-1',
                intent: { kind: 'move', to: { x: 2050, y: 1500 } },
              },
            ],
    };
    const actor = new GameActor({
      id: 'g1',
      state: createState(world.seed, world, 0),
      registry: registry(),
      clock: new GameClock(time.now, { rate: 1 }),
      wallNow: time.now,
      parser: noParser,
      store,
      timers: time,
      agents: [agent],
    });
    await actor.start();
    await actor.submit({ kind: 'setMode', mode: 'fast-forward' });
    await time.advance(0);
    // The first decision held back; it was asked again with nothing queued and gave its order.
    expect(thoughts).toBeGreaterThan(1);
    expect((await store.inputLog('g1')).filter((e) => e.agent)).toHaveLength(1);
    await actor.close();
  });

  it('looks again after the last event empties the queue', async () => {
    const time = new FakeTime();
    const world = loadScenario(holdTheBridge);
    const thinkTimes: number[] = [];
    let lastEvent = 0;
    const agent: SideAgent = {
      side: 'red',
      intervalMs: THINK_INTERVAL_MS,
      think: (v) => {
        thinkTimes.push(v.time);
        return [];
      },
    };
    const parser: OrderParser = {
      async parse(text) {
        return {
          kind: 'intents',
          text,
          unitId: 'blue-1',
          intents: [{ kind: 'move', to: { x: 20, y: 20 } }],
        };
      },
    };
    const actor = new GameActor({
      id: 'g1',
      state: createState(world.seed, world, 0),
      registry: registry(),
      clock: new GameClock(time.now, { rate: 1 }),
      wallNow: time.now,
      parser,
      store: new MemoryGameStore(),
      timers: time,
      agents: [agent],
      onEmitted: (events) => {
        for (const e of events) lastEvent = Math.max(lastEvent, e.time);
      },
    });
    await actor.start();
    await actor.submit({ kind: 'setMode', mode: 'fast-forward' });
    await time.advance(0);
    await actor.submit({ kind: 'order', side: 'blue', text: 'blue-1 move to the ridge' });
    await time.advance(0);
    expect(lastEvent).toBeGreaterThan(0);
    // Red saw the world as the final event left it, then went quiet.
    expect(Math.max(...thinkTimes)).toBeGreaterThan(lastEvent);
    expect(time.pendingTimers).toBe(0);
    await actor.close();
  });

  describe('with a human on the other side', () => {
    const blueParser: OrderParser = {
      async parse(text) {
        return {
          kind: 'intents',
          text,
          unitId: 'blue-1',
          intents: [{ kind: 'move', to: { x: 20, y: 20 } }],
        };
      },
    };

    /** Rate 1, so a wall minute is a game minute; Blue orders land at chosen game minutes. */
    async function play(store: MemoryGameStore, stopAndReopenAt?: number) {
      const time = new FakeTime();
      const make = () =>
        new GameHost({
          store,
          parser: blueParser,
          registry: registry(),
          wallNow: time.now,
          timers: time,
          scriptedOpponents: true,
        });
      let h = make();
      host = h;
      let game = await h.create('g1', loadScenario(holdTheBridge), { rate: 1 });
      let elapsed = 0;
      const to = async (minute: number) => {
        await time.advance((minute - elapsed) * 60_000);
        elapsed = minute;
      };
      // Exactly 10 game minutes: the instant Red first thinks, so a command and a decision share it.
      await to(10);
      await game.submit({ kind: 'order', side: 'blue', text: 'blue-1 move to the ridge' });
      await to(14);
      if (stopAndReopenAt !== undefined) {
        await to(stopAndReopenAt);
        await game.submit({ kind: 'pause' });
        await h.shutdown();
        h = make();
        host = h;
        game = await h.open('g1');
        await game.submit({ kind: 'resume' });
      }
      await to(24);
      await game.submit({ kind: 'pause' });
      return { game, time };
    }

    it('replays a command and a decision that share an instant, whatever order they were logged in', async () => {
      const store = new MemoryGameStore();
      const { game } = await play(store);
      const log = await store.inputLog('g1');
      const human = log.find((e) => !e.agent && e.command.kind === 'order');
      expect(human).toBeDefined();
      const agent = log.find((e) => e.agent && e.gameMs === human!.gameMs);
      expect(agent).toBeDefined();
      const header = (await store.logHeader('g1'))!;
      const until = game.state.time;
      const replay = (entries: typeof log) =>
        replayLog(header, loadScenario(holdTheBridge), entries, registry(), until).state;
      expect(replay(log)).toEqual(game.state);
      // Same entries with the human command logged ahead of the decision that preceded it.
      const swapped = log.filter((e) => e !== agent);
      swapped.splice(swapped.indexOf(human!) + 1, 0, agent!);
      expect(replay(swapped)).toEqual(game.state);
    });

    it('stopping and reopening mid-game gives the world an uninterrupted game reaches', async () => {
      const straight = await play(new MemoryGameStore());
      const world = straight.game.state.world;
      await host?.shutdown();
      host = undefined;
      const resumed = await play(new MemoryGameStore(), 21);
      expect(resumed.game.state.time).toBe(straight.game.state.time);
      expect(resumed.game.state.world).toEqual(world);
    });
  });
});
