import {
  EventRegistry,
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
import { GameHost, MemoryGameStore, replayLog } from '../game/index.js';
import { FakeTime } from '../game/testing.js';
import type { OrderParser } from '../orders/index.js';
import {
  AIM_SPREAD_M,
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
    time: 0,
    mapWidth: 4000,
    mapHeight: 3000,
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
      },
    ],
    visibleEnemies: [],
    lastKnownContacts: [],
    reports: [],
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
    expect(bot.think(viewFor(world, 'red')).length).toBeGreaterThan(0);
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

  it('does not repeat an order that would change nothing', () => {
    const bot = new ScriptedOpponent(CONFIG);
    expect(bot.think(view())).toHaveLength(1);
    expect(bot.think(view({ time: 300_000 }))).toHaveLength(0);
  });

  it('attacks an enemy it sees near it', () => {
    const bot = new ScriptedOpponent(CONFIG);
    bot.think(view());
    const [o] = bot.think(view({ time: 300_000, visibleEnemies: [enemy(1950, 900)] }));
    expect(o?.intent).toEqual({ kind: 'move', to: { x: 1_950_000, y: 900_000 } });
    expect(o?.text).toMatch(/advance on the enemy/);
  });

  it('ignores a distant enemy and a stale contact', () => {
    const bot = new ScriptedOpponent(CONFIG);
    bot.think(view());
    const far = view({
      time: 300_000,
      visibleEnemies: [enemy(1950, 2400)],
      lastKnownContacts: [
        {
          id: 'blue-2',
          position: { x: 1950, y: 500 },
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
    const [o] = bot.think({ ...weak, time: 300_000, visibleEnemies: [enemy(1950, 900)] });
    expect(o?.intent).toEqual({ kind: 'withdraw', toward: { x: 2_050_000, y: 50_000 } });
    expect(bot.think({ ...weak, time: 600_000, visibleEnemies: [enemy(1950, 900)] })).toHaveLength(
      0,
    );
  });

  it('withdraws when strength falls below half its peak', () => {
    const bot = new ScriptedOpponent(CONFIG);
    bot.think(view());
    const hurt = view({ ownUnits: [{ ...view().ownUnits[0]!, strength: 300 }] });
    expect(bot.think({ ...hurt, time: 300_000 })[0]?.intent.kind).toBe('withdraw');
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
    const game = await host.create('g1', loadScenario(holdTheBridge));
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
    const replayed = replayLog(header, loadScenario(holdTheBridge), log, registry(), until);
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
});
