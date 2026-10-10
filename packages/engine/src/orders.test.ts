import { describe, expect, it } from 'vitest';
import {
  COURIER_MS_PER_TILE,
  EventRegistry,
  MS_PER_MINUTE,
  MS_PER_TILE,
  advanceTo,
  createState,
  findPath,
  holdTheBridge,
  issueOrder,
  loadScenario,
  registerMovement,
  registerOrders,
  type EngineState,
  type GameState,
  type Order,
  type OrderIntent,
} from './index.js';

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

const DELIVERY_MS = (9 * COURIER_MS_PER_TILE) / 2;
const unit = (s: EngineState<GameState>, id: string) => s.world.units.find((u) => u.id === id)!;

describe('courier delivery', () => {
  // Blue HQ (20,29) to blue-1 (18,24): 5 road tiles then 2 open tiles = 9 half-units.
  const DELIVERY = (9 * COURIER_MS_PER_TILE) / 2;

  it('takes the computed game time to take effect', () => {
    expect(DELIVERY).toBe(67_500);
    const s0 = issueOrder(game(), order('blue-1', { kind: 'move', to: { x: 20, y: 20 } }));
    const hq = s0.world.sides[0]!.hq;
    expect(findPath(s0.world.map, hq, unit(s0, 'blue-1').position)!.cost).toBe(9);

    const before = advanceTo(s0, DELIVERY - 1, registry());
    expect(unit(before.state, 'blue-1').intent).toEqual({ kind: 'idle' });
    expect(before.emitted).toEqual([]);

    const after = advanceTo(before.state, DELIVERY, registry());
    expect(unit(after.state, 'blue-1').intent).toEqual({
      kind: 'move',
      to: { x: 20, y: 20 },
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
    const s0 = issueOrder(game(), order('blue-1', { kind: 'move', to: { x: 17, y: 24 } }), t);
    const end = advanceTo(s0, t + DELIVERY + MS_PER_TILE.infantry, registry()).state;
    expect(unit(end, 'blue-1').position).toEqual({ x: 17, y: 24 });
    expect(unit(end, 'blue-1').intent).toEqual({ kind: 'idle' });
  });

  it('gives the same result however advanceTo is chunked', () => {
    const s0 = issueOrder(game(), order('blue-1', { kind: 'withdraw', toward: { x: 20, y: 29 } }));
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
  function cutOff(unitAt?: { x: number; y: number }): EngineState<GameState> {
    const g = game();
    const world = {
      ...g.world,
      map: {
        ...g.world.map,
        tiles: g.world.map.tiles.map((t) => (t === 'bridge' ? ('river' as const) : t)),
      },
      units: g.world.units.map((u) =>
        u.id === 'blue-1' && unitAt ? { ...u, position: unitAt } : u,
      ),
    };
    return { ...g, world };
  }

  it('fails with no route for courier when the unit is cut off from HQ', () => {
    const s = issueOrder(
      cutOff({ x: 18, y: 5 }),
      order('blue-1', { kind: 'hold', at: { x: 18, y: 5 } }),
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
    expect(unit(r.state, 'blue-1').position).toEqual({ x: 18, y: 5 });
  });

  it('a delivered move to an unreachable tile reports moveBlocked and keeps the standing march', () => {
    let s = issueOrder(cutOff(), order('blue-1', { kind: 'move', to: { x: 18, y: 26 } }, 'a'));
    s = issueOrder(s, order('blue-1', { kind: 'move', to: { x: 18, y: 5 } }, 'b'), 1000);
    const r = advanceTo(s, 120 * MS_PER_MINUTE, registry());
    const types = r.emitted.map((e) => e.type);
    expect(types).toContain('unit.moveBlocked');
    expect(r.emitted.filter((e) => e.type === 'order_delivered')).toHaveLength(2);
    expect(r.emitted.some((e) => e.type === 'order_failed')).toBe(false);
    // Order b was blocked, so the march from order a is untouched.
    expect(unit(r.state, 'blue-1').position).toEqual({ x: 18, y: 26 });
  });

  it('stamps issuedAt from the issue time, not the caller', () => {
    const t = 5 * MS_PER_MINUTE;
    const s = issueOrder(game(), order('blue-1', { kind: 'hold', at: { x: 18, y: 24 } }), t);
    const r = advanceTo(s, t + DELIVERY_MS, registry());
    expect(r.emitted[0]!.payload).toMatchObject({ orderId: 'o1', issuedAt: t });
  });
});

describe('standing intents', () => {
  it('keeps marching when no new order arrives', () => {
    let s = game();
    s = issueOrder(s, order('blue-1', { kind: 'move', to: { x: 18, y: 20 } }, 'a'), 0);
    // A later order to a different unit must not disturb blue-1.
    s = issueOrder(
      s,
      order('blue-2', { kind: 'hold', at: { x: 22, y: 25 } }, 'b'),
      10 * MS_PER_MINUTE,
    );
    const end = advanceTo(s, 60 * MS_PER_MINUTE, registry()).state;
    expect(unit(end, 'blue-1').position).toEqual({ x: 18, y: 20 });
    expect(unit(end, 'blue-2').intent).toEqual({ kind: 'hold', at: { x: 22, y: 25 } });
  });

  it('keeps a hold until a newer order is delivered', () => {
    let s = issueOrder(game(), order('blue-1', { kind: 'hold', at: { x: 18, y: 24 } }));
    const held = advanceTo(s, 60 * MS_PER_MINUTE, registry()).state;
    expect(unit(held, 'blue-1').intent).toEqual({ kind: 'hold', at: { x: 18, y: 24 } });
    s = issueOrder(held, order('blue-1', { kind: 'move', to: { x: 18, y: 22 } }, 'o2'));
    const moved = advanceTo(s, 120 * MS_PER_MINUTE, registry()).state;
    expect(unit(moved, 'blue-1').position).toEqual({ x: 18, y: 22 });
  });

  it('a later order replaces an earlier one that was still on its way', () => {
    let s = issueOrder(game(), order('blue-1', { kind: 'move', to: { x: 18, y: 20 } }, 'a'));
    s = issueOrder(s, order('blue-1', { kind: 'hold', at: { x: 18, y: 24 } }, 'b'), 1000);
    const end = advanceTo(s, 120 * MS_PER_MINUTE, registry()).state;
    // The first order lands first, then the second overrides it.
    expect(unit(end, 'blue-1').position).toEqual({ x: 18, y: 24 });
    expect(unit(end, 'blue-1').intent).toEqual({ kind: 'hold', at: { x: 18, y: 24 } });
  });
});

describe('intents', () => {
  it('a hold elsewhere marches there, then holds', () => {
    const s = issueOrder(game(), order('blue-1', { kind: 'hold', at: { x: 18, y: 22 } }));
    const end = advanceTo(s, 120 * MS_PER_MINUTE, registry());
    expect(unit(end.state, 'blue-1').position).toEqual({ x: 18, y: 22 });
    expect(unit(end.state, 'blue-1').intent).toEqual({ kind: 'hold', at: { x: 18, y: 22 } });
  });

  it('a withdrawal marches to its destination and goes idle', () => {
    const s = issueOrder(game(), order('blue-1', { kind: 'withdraw', toward: { x: 18, y: 26 } }));
    const mid = advanceTo(s, 67_500, registry()).state;
    expect(unit(mid, 'blue-1').intent.kind).toBe('withdraw');
    const end = advanceTo(mid, 120 * MS_PER_MINUTE, registry()).state;
    expect(unit(end, 'blue-1').position).toEqual({ x: 18, y: 26 });
    expect(unit(end, 'blue-1').intent).toEqual({ kind: 'idle' });
  });
});

describe('failed orders', () => {
  const failures = (s: EngineState<GameState>, until = 60 * MS_PER_MINUTE) =>
    advanceTo(s, until, registry());

  it('fails for a unit that does not exist, leaving state alone', () => {
    const s = issueOrder(game(), order('ghost', { kind: 'hold', at: { x: 1, y: 1 } }));
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
      order('blue-1', { kind: 'hold', at: { x: 1, y: 1 } }),
    );
    expect(failures(s).emitted.map((e) => [e.type, e.payload])).toEqual([
      ['order_failed', { orderId: 'o1', unitId: 'blue-1', reason: 'unit destroyed' }],
    ]);
  });

  it('fails if the unit is destroyed while the courier rides', () => {
    const s = issueOrder(game(), order('blue-1', { kind: 'hold', at: { x: 18, y: 22 } }));
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
        time: 67_500,
        type: 'order_failed',
        payload: { orderId: 'o1', unitId: 'blue-1', reason: 'unit destroyed' },
      },
    ]);
    expect(unit(r.state, 'blue-1').intent).toEqual({ kind: 'idle' });
  });

  it('refuses to order the other side’s units', () => {
    const s = issueOrder(game(), order('red-1', { kind: 'hold', at: { x: 1, y: 1 } }));
    expect(failures(s).emitted[0]!.payload).toMatchObject({
      reason: 'unit belongs to another side',
    });
  });

  it('fails an order with no intents', () => {
    const o: Order = { ...order('blue-1', { kind: 'hold', at: { x: 1, y: 1 } }), intents: [] };
    expect(failures(issueOrder(game(), o)).emitted[0]!.payload).toMatchObject({
      reason: 'order has no intents',
    });
  });

  it('does not touch a march already under way when an order fails', () => {
    let s = issueOrder(game(), order('blue-1', { kind: 'move', to: { x: 18, y: 20 } }, 'a'));
    s = issueOrder(s, order('ghost', { kind: 'hold', at: { x: 1, y: 1 } }, 'b'), 100_000);
    const end = advanceTo(s, 120 * MS_PER_MINUTE, registry()).state;
    expect(unit(end, 'blue-1').position).toEqual({ x: 18, y: 20 });
  });
});
