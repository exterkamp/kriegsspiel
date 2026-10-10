import { describe, expect, it } from 'vitest';
import {
  COURIER_MS_PER_METRE,
  EventRegistry,
  MS_PER_METRE,
  MS_PER_MINUTE,
  advanceTo,
  createState,
  findPath,
  holdTheBridge,
  issueOrder,
  loadScenario,
  pointMm,
  registerMovement,
  registerOrders,
  type EngineState,
  type GameState,
  type Order,
  type OrderIntent,
  type Point,
} from './index.js';

const P = (x: number, y: number): Point => pointMm(x, y);

function registry() {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerOrders(r);
  return r;
}

function game(): EngineState<GameState> {
  const g = loadScenario(holdTheBridge);
  return createState(g.seed, g, 0);
}

function order(to: string, intent: OrderIntent, id = 'o1', side: 'blue' | 'red' = 'blue'): Order {
  return { id, side, to, issuedAt: 0, text: 'do it', intents: [intent] };
}

const unit = (s: EngineState<GameState>, id: string) => s.world.units.find((u) => u.id === id)!;

/** Courier ride from a side's HQ to a unit's centre, by the cheapest route. */
function ride(s: EngineState<GameState>, id: string) {
  const u = unit(s, id);
  const hq = s.world.sides.find((x) => x.id === u.side)!.hq;
  const route = findPath(s.world.map, hq, u.center)!;
  return { route, ms: Math.round((route.cost / 1000) * COURIER_MS_PER_METRE) };
}

const DELIVERY_MS = ride(game(), 'blue-1').ms;

describe('courier delivery', () => {
  // Blue HQ (2050, 2950) to blue-1 (1850, 2450): up the road, then across open ground.
  const DELIVERY = DELIVERY_MS;

  it('takes the computed game time to take effect', () => {
    const s0 = issueOrder(game(), order('blue-1', { kind: 'move', to: P(2050, 2050) }));
    const { route } = ride(s0, 'blue-1');
    // The road halves the cost where the courier rides it, so it beats the straight line.
    const straight = Math.hypot(200_000, 500_000);
    expect(route.cost).toBeLessThan(straight);
    expect(route.cost).toBeGreaterThan(straight / 2);
    expect(DELIVERY).toBeGreaterThan(0);
    expect(DELIVERY).toBeLessThan(Math.round((straight / 1000) * COURIER_MS_PER_METRE));

    const before = advanceTo(s0, DELIVERY - 1, registry());
    expect(unit(before.state, 'blue-1').intent).toEqual({ kind: 'idle' });
    expect(before.emitted).toEqual([]);

    const after = advanceTo(before.state, DELIVERY, registry());
    expect(unit(after.state, 'blue-1').intent).toEqual({
      kind: 'move',
      to: P(2050, 2050),
      startedAt: DELIVERY,
    });
    expect(after.emitted).toEqual([
      {
        time: DELIVERY,
        type: 'order_delivered',
        payload: { orderId: 'o1', unitId: 'blue-1', issuedAt: 0 },
      },
    ]);
  });

  it('starts the courier at the issue time, and the march from delivery', () => {
    const t = 5 * MS_PER_MINUTE;
    const s0 = issueOrder(game(), order('blue-1', { kind: 'move', to: P(1750, 2450) }), t);
    const end = advanceTo(s0, t + DELIVERY + 100 * MS_PER_METRE.infantry, registry()).state;
    expect(unit(end, 'blue-1').center).toEqual(P(1750, 2450));
    expect(unit(end, 'blue-1').intent).toEqual({ kind: 'idle' });
  });

  it('gives the same result however advanceTo is chunked', () => {
    const s0 = issueOrder(game(), order('blue-1', { kind: 'withdraw', toward: P(2050, 2950) }));
    const whole = advanceTo(s0, 30 * MS_PER_MINUTE, registry());
    let s = s0;
    const emitted = [];
    for (let t = 7 * MS_PER_MINUTE; t <= 28 * MS_PER_MINUTE; t += 7 * MS_PER_MINUTE) {
      const r = advanceTo(s, t, registry());
      s = r.state;
      emitted.push(...r.emitted);
    }
    const last = advanceTo(s, 30 * MS_PER_MINUTE, registry());
    expect(last.state).toEqual(whole.state);
    expect([...emitted, ...last.emitted]).toEqual(whole.emitted);
  });
});

describe('unreachable orders', () => {
  /** The bridge is down: blue-1 is cut off from its HQ side of the river... */
  function cutOff(unitAt?: Point): EngineState<GameState> {
    const g = game();
    const world = {
      ...g.world,
      map: {
        ...g.world.map,
        features: g.world.map.features.filter((f) => f.kind !== 'bridge'),
      },
      units: g.world.units.map((u) => (u.id === 'blue-1' && unitAt ? { ...u, center: unitAt } : u)),
    };
    return { ...g, world };
  }

  it('fails with no route for courier when the unit is cut off from HQ', () => {
    const s = issueOrder(
      cutOff(P(1850, 550)),
      order('blue-1', { kind: 'hold', at: P(1850, 550) }),
      3 * MS_PER_MINUTE,
    );
    const r = advanceTo(s, 60 * MS_PER_MINUTE, registry());
    expect(r.emitted).toEqual([
      {
        time: 3 * MS_PER_MINUTE,
        type: 'order_failed',
        payload: { orderId: 'o1', unitId: 'blue-1', reason: 'no route for courier' },
      },
    ]);
    expect(unit(r.state, 'blue-1').intent).toEqual({ kind: 'idle' });
    expect(unit(r.state, 'blue-1').center).toEqual(P(1850, 550));
  });

  it('a delivered move to an unreachable point reports moveBlocked and keeps the standing march', () => {
    let s = issueOrder(cutOff(), order('blue-1', { kind: 'move', to: P(1850, 2650) }, 'a'));
    s = issueOrder(s, order('blue-1', { kind: 'move', to: P(1850, 550) }, 'b'), 1000);
    const r = advanceTo(s, 120 * MS_PER_MINUTE, registry());
    const types = r.emitted.map((e) => e.type);
    expect(types).toContain('unit.moveBlocked');
    expect(r.emitted.filter((e) => e.type === 'order_delivered')).toHaveLength(2);
    expect(r.emitted.some((e) => e.type === 'order_failed')).toBe(false);
    // Order b was blocked, so the march from order a is untouched.
    expect(unit(r.state, 'blue-1').center).toEqual(P(1850, 2650));
  });

  it('stamps issuedAt from the issue time, not the caller', () => {
    const t = 5 * MS_PER_MINUTE;
    const s = issueOrder(game(), order('blue-1', { kind: 'hold', at: P(1850, 2450) }), t);
    const r = advanceTo(s, t + DELIVERY_MS, registry());
    expect(r.emitted[0]!.payload).toMatchObject({ orderId: 'o1', issuedAt: t });
  });
});

describe('standing intents', () => {
  it('keeps marching when no new order arrives', () => {
    let s = game();
    s = issueOrder(s, order('blue-1', { kind: 'move', to: P(1850, 2050) }, 'a'), 0);
    // A later order to a different unit must not disturb blue-1.
    s = issueOrder(
      s,
      order('blue-2', { kind: 'hold', at: P(2250, 2550) }, 'b'),
      10 * MS_PER_MINUTE,
    );
    const end = advanceTo(s, 60 * MS_PER_MINUTE, registry()).state;
    expect(unit(end, 'blue-1').center).toEqual(P(1850, 2050));
    expect(unit(end, 'blue-2').intent).toEqual({ kind: 'hold', at: P(2250, 2550) });
  });

  it('keeps a hold until a newer order is delivered', () => {
    let s = issueOrder(game(), order('blue-1', { kind: 'hold', at: P(1850, 2450) }));
    const held = advanceTo(s, 60 * MS_PER_MINUTE, registry()).state;
    expect(unit(held, 'blue-1').intent).toEqual({ kind: 'hold', at: P(1850, 2450) });
    s = issueOrder(held, order('blue-1', { kind: 'move', to: P(1850, 2250) }, 'o2'));
    const moved = advanceTo(s, 120 * MS_PER_MINUTE, registry()).state;
    expect(unit(moved, 'blue-1').center).toEqual(P(1850, 2250));
  });

  it('a later order replaces an earlier one that was still on its way', () => {
    let s = issueOrder(game(), order('blue-1', { kind: 'move', to: P(1850, 2050) }, 'a'));
    s = issueOrder(s, order('blue-1', { kind: 'hold', at: P(1850, 2450) }, 'b'), 1000);
    const end = advanceTo(s, 120 * MS_PER_MINUTE, registry()).state;
    // The first order lands first, then the second overrides it.
    expect(unit(end, 'blue-1').center).toEqual(P(1850, 2450));
    expect(unit(end, 'blue-1').intent).toEqual({ kind: 'hold', at: P(1850, 2450) });
  });
});

describe('intents', () => {
  it('a hold elsewhere marches there, then holds', () => {
    const s = issueOrder(game(), order('blue-1', { kind: 'hold', at: P(1850, 2250) }));
    const end = advanceTo(s, 120 * MS_PER_MINUTE, registry());
    expect(unit(end.state, 'blue-1').center).toEqual(P(1850, 2250));
    expect(unit(end.state, 'blue-1').intent).toEqual({ kind: 'hold', at: P(1850, 2250) });
  });

  it('a withdrawal marches to its destination and goes idle', () => {
    const s = issueOrder(game(), order('blue-1', { kind: 'withdraw', toward: P(1850, 2650) }));
    const mid = advanceTo(s, DELIVERY_MS, registry()).state;
    expect(unit(mid, 'blue-1').intent.kind).toBe('withdraw');
    const end = advanceTo(mid, 120 * MS_PER_MINUTE, registry()).state;
    expect(unit(end, 'blue-1').center).toEqual(P(1850, 2650));
    expect(unit(end, 'blue-1').intent).toEqual({ kind: 'idle' });
  });
});

describe('failed orders', () => {
  const failures = (s: EngineState<GameState>, until = 60 * MS_PER_MINUTE) =>
    advanceTo(s, until, registry());

  it('fails for a unit that does not exist, leaving state alone', () => {
    const s = issueOrder(game(), order('ghost', { kind: 'hold', at: P(150, 150) }));
    const r = failures(s);
    expect(r.emitted).toEqual([
      {
        time: 0,
        type: 'order_failed',
        payload: { orderId: 'o1', unitId: 'ghost', reason: 'unit does not exist' },
      },
    ]);
    expect(r.state.world.units).toEqual(s.world.units);
  });

  it('fails for a unit that is already destroyed', () => {
    const s0 = game();
    const s = issueOrder(
      {
        ...s0,
        world: {
          ...s0.world,
          units: s0.world.units.map((u) => (u.id === 'blue-1' ? { ...u, strength: 0 } : u)),
        },
      },
      order('blue-1', { kind: 'hold', at: P(150, 150) }),
    );
    expect(failures(s).emitted.map((e) => [e.type, e.payload])).toEqual([
      ['order_failed', { orderId: 'o1', unitId: 'blue-1', reason: 'unit destroyed' }],
    ]);
  });

  it('fails if the unit is destroyed while the courier rides', () => {
    const s = issueOrder(game(), order('blue-1', { kind: 'hold', at: P(1850, 2250) }));
    const mid = advanceTo(s, 1000, registry()).state;
    const killed = {
      ...mid,
      world: {
        ...mid.world,
        units: mid.world.units.map((u) => (u.id === 'blue-1' ? { ...u, strength: 0 } : u)),
      },
    };
    const r = advanceTo(killed, 10 * MS_PER_MINUTE, registry());
    expect(r.emitted).toEqual([
      {
        time: DELIVERY_MS,
        type: 'order_failed',
        payload: { orderId: 'o1', unitId: 'blue-1', reason: 'unit destroyed' },
      },
    ]);
    expect(unit(r.state, 'blue-1').intent).toEqual({ kind: 'idle' });
  });

  it('refuses to order the other side’s units', () => {
    const s = issueOrder(game(), order('red-1', { kind: 'hold', at: P(150, 150) }));
    expect(failures(s).emitted[0]!.payload).toMatchObject({
      reason: 'unit belongs to another side',
    });
  });

  it('fails an order with no intents', () => {
    const o: Order = { ...order('blue-1', { kind: 'hold', at: P(150, 150) }), intents: [] };
    expect(failures(issueOrder(game(), o)).emitted[0]!.payload).toMatchObject({
      reason: 'order has no intents',
    });
  });

  it('does not touch a march already under way when an order fails', () => {
    let s = issueOrder(game(), order('blue-1', { kind: 'move', to: P(1850, 2050) }, 'a'));
    s = issueOrder(s, order('ghost', { kind: 'hold', at: P(150, 150) }, 'b'), 100_000);
    const end = advanceTo(s, 120 * MS_PER_MINUTE, registry()).state;
    expect(unit(end, 'blue-1').center).toEqual(P(1850, 2050));
  });
});
