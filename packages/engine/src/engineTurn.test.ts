import { describe, expect, it } from 'vitest';
import {
  EventRegistry,
  MS_PER_MINUTE,
  advanceTo,
  courierPass,
  createState,
  engineTurnStart,
  loadScenario,
  pointMm,
  registerCombat,
  registerMovement,
  registerOrders,
  registerVisibility,
  type EmittedEvent,
  type EngineState,
  type GameState,
  type Order,
  type TurnCourier,
} from './index.js';
import { holdTheBridgeFarStart } from './scenario.testkit.js';

function registry() {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerCombat(r);
  registerOrders(r);
  registerVisibility(r);
  return r;
}
const reg = registry();

const ORDER: Order = {
  id: 'o1',
  side: 'blue',
  to: 'blue-1',
  issuedAt: 0,
  text: 'Advance to the crossroads at once.',
  intents: [{ kind: 'move', to: pointMm(2050, 2050) }],
};

/** Red's hussars sit on blue's courier route to blue-1, so some rides are taken. */
function start(seed: number): EngineState<GameState> {
  const g = loadScenario(holdTheBridgeFarStart);
  const world: GameState = {
    ...g,
    seed,
    units: g.units.map((u) => (u.id === 'red-3' ? { ...u, center: pointMm(1950, 2700) } : u)),
  };
  return createState(seed, world, 0);
}

/** Fog quadruples every ride's hazard, so some of these short rides are lost or garbled. */
function foggy(seed: number): EngineState<GameState> {
  return createState(seed, { ...loadScenario(holdTheBridgeFarStart), seed, sightFactor: 0.25 }, 0);
}

/** What the ordinary handlers did with each ride, read from what they emitted. */
function rides(emitted: EmittedEvent[]): Map<string, Partial<TurnCourier>> {
  const out = new Map<string, Partial<TurnCourier>>();
  for (const e of emitted) {
    const p = e.payload as { orderId?: string; reason?: string; by?: string };
    if (!p?.orderId || out.has(p.orderId)) continue;
    if (e.type === 'order_delivered') out.set(p.orderId, { outcome: 'delivered', atMs: e.time });
    if (e.type === 'courier_intercepted') {
      out.set(p.orderId, { outcome: 'intercepted', atMs: e.time, by: p.by! });
    }
    if (e.type === 'order_failed' && p.reason === 'courier lost') {
      out.set(p.orderId, { outcome: 'lost', atMs: e.time });
    }
  }
  return out;
}

const garbledIds = (emitted: EmittedEvent[]) =>
  emitted
    .filter((e) => e.type === 'order_garbled')
    .map((e) => (e.payload as { orderId: string }).orderId);

describe('the courier pass and forced rides (D39, 11.4)', () => {
  it('rolls each ride once; the engine turn then rides it to the same outcome with no roll', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const s0 = start(seed);
      const before = JSON.stringify(s0);
      const turn = { n: 1, startMs: 0, endMs: 30 * MS_PER_MINUTE };
      const pass = courierPass(s0, [ORDER], turn, reg);
      expect(JSON.stringify(s0)).toBe(before);
      // Deterministic: the same state gives the same pass.
      expect(courierPass(s0, [ORDER], turn, reg)).toEqual(pass);

      const run = advanceTo(engineTurnStart(s0, [ORDER], pass, turn), turn.endMs, reg);
      const c = pass.couriers[0]!;
      seen.add(c.outcome);
      const got = rides(run.emitted).get('o1');
      if (c.outcome === 'riding') expect(got).toBeUndefined();
      else
        expect({ outcome: c.outcome, atMs: c.atMs, by: c.by }).toEqual({ by: undefined, ...got });
      expect(garbledIds(run.emitted).includes('o1')).toBe(
        c.outcome === 'delivered' && c.garbled === true,
      );
      // The captor's document is filed as the pass had it.
      if (c.outcome === 'intercepted') {
        expect(run.state.world.intel.red.documents.map((d) => d.capturedAt)).toEqual([c.atMs]);
      }
    }
    // The hussars on the road take some rides and let others through.
    expect(seen.has('intercepted')).toBe(true);
    expect(seen.has('delivered')).toBe(true);
  });

  it('replays a ride the pass lost or garbled: lost at the same minute, garbled the same way', () => {
    const fast: Order = { ...ORDER, courier: 'fast' };
    const turn = { n: 1, startMs: 0, endMs: 60 * MS_PER_MINUTE };
    let lost = 0;
    let garbled = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const s0 = foggy(seed);
      const pass = courierPass(s0, [fast], turn, reg);
      const run = advanceTo(engineTurnStart(s0, [fast], pass, turn), turn.endMs, reg);
      const c = pass.couriers[0]!;
      const got = rides(run.emitted).get('o1');
      if (c.outcome === 'riding') expect(got).toBeUndefined();
      else
        expect({ outcome: c.outcome, atMs: c.atMs, by: c.by }).toEqual({ by: undefined, ...got });
      if (c.outcome === 'lost') lost++;
      if (c.outcome !== 'delivered' || !c.garbled) continue;
      garbled++;
      expect(garbledIds(run.emitted)).toEqual(['o1']);
      // The courier carries the order as the pass garbled it, not as it was sent.
      const intents = pass.forced.o1!.garbled!;
      expect(intents).not.toEqual(ORDER.intents);
      const riding = advanceTo(engineTurnStart(s0, [fast], pass, turn), c.atMs! - 1, reg).state;
      expect(riding.world.couriers.map((x) => x.garbled)).toEqual([intents]);
    }
    expect(lost).toBeGreaterThan(0);
    expect(garbled).toBeGreaterThan(0);
  });

  it('keeps a loss the pass drew past the turn end: the ride is lost at that minute next turn', () => {
    const fast: Order = { ...ORDER, courier: 'fast' };
    let found = 0;
    for (let seed = 1; seed <= 200; seed++) {
      let s = foggy(seed);
      // The ride is under a minute, so the first turn ends a few seconds in.
      const t1 = { n: 1, startMs: 0, endMs: 5_000 };
      const p1 = courierPass(s, [fast], t1, reg);
      const lostAt = p1.forced.o1?.lostAt;
      if (lostAt === undefined || lostAt <= t1.endMs) continue;
      expect(p1.couriers[0]!.outcome).toBe('riding');
      s = advanceTo(engineTurnStart(s, [fast], p1, t1), t1.endMs, reg).state;

      const t2 = { n: 2, startMs: t1.endMs, endMs: 60 * MS_PER_MINUTE };
      const p2 = courierPass(s, [], t2, reg);
      const c = p2.couriers[0]!;
      const run = advanceTo(engineTurnStart(s, [], p2, t2), t2.endMs, reg);
      expect({ outcome: c.outcome, atMs: c.atMs, by: c.by }).toEqual({
        by: undefined,
        ...rides(run.emitted).get('o1'),
      });
      expect(c).toMatchObject({ outcome: 'lost', atMs: lostAt });
      found++;
    }
    expect(found).toBeGreaterThan(0);
  });

  it('lets a forced capture go when the captor is destroyed before it: the ride goes on', () => {
    const turn = { n: 1, startMs: 0, endMs: 30 * MS_PER_MINUTE };
    let checked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s0 = start(seed);
      const pass = courierPass(s0, [ORDER], turn, reg);
      const c = pass.couriers[0]!;
      if (c.outcome !== 'intercepted') continue;
      // The pass held the units; in the turn itself the captor fell before the courier reached it.
      const gone: EngineState<GameState> = {
        ...s0,
        world: {
          ...s0.world,
          units: s0.world.units.map((u) =>
            u.id === c.by ? { ...u, strength: 0, status: 'destroyed' as const } : u,
          ),
        },
      };
      const run = advanceTo(engineTurnStart(gone, [ORDER], pass, turn), turn.endMs, reg);
      expect(rides(run.emitted).get('o1')?.outcome).toBe('delivered');
      expect(run.state.world.intel.red.documents).toEqual([]);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('fixes a ride decided at T0 (a courier with no road to ride) like any other', () => {
    const g = loadScenario(holdTheBridgeFarStart);
    const hq = g.sides.find((x) => x.id === 'blue')!.hq;
    const world: GameState = {
      ...g,
      seed: 5,
      units: g.units.map((u) => (u.id === 'blue-1' ? { ...u, center: hq } : u)),
    };
    const s0 = createState(5, world, 0);
    const turn = { n: 1, startMs: 0, endMs: 10 * MS_PER_MINUTE };
    const pass = courierPass(s0, [ORDER], turn, reg);
    expect(pass.couriers[0]).toMatchObject({ outcome: 'delivered', atMs: 0 });
    // Forced like any ride, so the engine's turn rolls nothing for it on the pass's RNG.
    expect(pass.forced.o1).toEqual({ untilMs: turn.endMs });
    const run = advanceTo(engineTurnStart(s0, [ORDER], pass, turn), turn.endMs, reg);
    expect(rides(run.emitted).get('o1')).toEqual({ outcome: 'delivered', atMs: 0 });
  });

  it('continues a ride still on the road at the turn end into the next turn', () => {
    let checked = 0;
    const outcomes = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      let s = start(seed);
      const t1 = { n: 1, startMs: 0, endMs: 30_000 };
      const p1 = courierPass(s, [ORDER], t1, reg);
      if (p1.couriers[0]!.outcome !== 'riding') continue;
      expect(p1.couriers[0]!.dueMs).toBeGreaterThan(t1.endMs);
      s = advanceTo(engineTurnStart(s, [ORDER], p1, t1), t1.endMs, reg).state;
      expect(s.world.couriers.map((c) => c.forced)).toEqual([{ untilMs: t1.endMs }]);

      const t2 = { n: 2, startMs: t1.endMs, endMs: 40 * MS_PER_MINUTE };
      const p2 = courierPass(s, [], t2, reg);
      expect(p2.couriers.map((c) => c.orderId)).toEqual(['o1']);
      const run = advanceTo(engineTurnStart(s, [], p2, t2), t2.endMs, reg);
      const c = p2.couriers[0]!;
      const got = rides(run.emitted).get('o1');
      expect({ outcome: c.outcome, atMs: c.atMs, by: c.by }).toEqual({ by: undefined, ...got });
      outcomes.add(c.outcome);
      checked++;
    }
    expect(checked).toBe(20);
    // Taken and delivered in the second turn alike: its checks were rolled by that turn's pass.
    expect([...outcomes].sort()).toEqual(['delivered', 'intercepted']);
  });

  it('sends an order the rules could not read: it rides and is delivered, and the unit carries on', () => {
    const s0 = start(3);
    const order: Order = { ...ORDER, id: 'o2', intents: [], textOnly: true };
    const turn = { n: 1, startMs: 0, endMs: 40 * MS_PER_MINUTE };
    const g = loadScenario(holdTheBridgeFarStart);
    const world: GameState = { ...g, seed: 3 };
    const quiet = createState(3, world, 0);
    const pass = courierPass(quiet, [order], turn, reg);
    expect(pass.couriers[0]).toMatchObject({ orderId: 'o2', outcome: 'delivered' });
    const run = advanceTo(engineTurnStart(quiet, [order], pass, turn), turn.endMs, reg);
    expect(run.emitted.map((e) => e.type)).toContain('order_delivered');
    const unit = (s: EngineState<GameState>) => s.world.units.find((u) => u.id === 'blue-1')!;
    expect(unit(run.state).intent).toEqual(unit(quiet).intent);

    // Nothing fires on its receipt either: a standing order "on the next order, march" is kept.
    const standing = {
      id: 's#1',
      orderId: 's',
      trigger: { kind: 'orderReceived' as const, from: 'hq' },
      then: [{ kind: 'move' as const, to: pointMm(2050, 2050) }],
    };
    const waiting = createState(3, {
      ...world,
      units: world.units.map((u) => (u.id === 'blue-1' ? { ...u, standing: [standing] } : u)),
    });
    const p2 = courierPass(waiting, [order], turn, reg);
    const run2 = advanceTo(engineTurnStart(waiting, [order], p2, turn), turn.endMs, reg);
    expect(run2.emitted.map((e) => e.type)).toContain('order_delivered');
    expect(unit(run2.state).intent).toEqual(unit(waiting).intent);
    expect(unit(run2.state).standing).toEqual([standing]);
    // Without the flag an order with no intents is refused, as in real time.
    const refused = courierPass(s0, [{ ...ORDER, id: 'o3', intents: [] }], turn, reg);
    expect(refused.couriers[0]).toMatchObject({
      outcome: 'failed',
      reason: 'order has no intents',
    });
  });
});
