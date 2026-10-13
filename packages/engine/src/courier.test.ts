import { describe, expect, it } from 'vitest';
import {
  COURIER_DELAY_MS,
  EventRegistry,
  MS_PER_MINUTE,
  advanceTo,
  createState,
  interceptChance,
  issueOrder,
  loadScenario,
  pointMm,
  registerCombat,
  registerMovement,
  registerOrders,
  registerVisibility,
  rideRisk,
  viewFor,
  type EmittedEvent,
  type EngineState,
  type GameState,
  type Order,
  type Point,
} from './index.js';
import { miniWorld, wood, holdTheBridgeFarStart } from './scenario.testkit.js';

function registry() {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerCombat(r);
  registerOrders(r);
  registerVisibility(r);
  return r;
}

const DEST = pointMm(2050, 2050);
const ORDER: Order = {
  id: 'o1',
  side: 'blue',
  to: 'blue-1',
  issuedAt: 0,
  text: 'Advance to the crossroads at once.',
  intents: [{ kind: 'move', to: DEST }],
};

/** A game with red's hussars sitting on blue's courier route to blue-1, unless `lurk` is false. */
function game(seed: number, opts: { lurk?: boolean; sightFactor?: number; order?: Order } = {}) {
  const g = loadScenario(holdTheBridgeFarStart);
  const world: GameState = {
    ...g,
    seed,
    ...(opts.sightFactor === undefined ? {} : { sightFactor: opts.sightFactor }),
    units: g.units.map((u) =>
      u.id === 'red-3' && opts.lurk !== false ? { ...u, center: pointMm(1950, 2700) } : u,
    ),
  };
  return issueOrder(createState(seed, world, 0), opts.order ?? ORDER);
}

const END = 60 * MS_PER_MINUTE;
const types = (e: EmittedEvent[]) => e.map((x) => x.type);
const unit = (s: EngineState<GameState>, id: string) => s.world.units.find((u) => u.id === id)!;

function run(s: EngineState<GameState>) {
  return advanceTo(s, END, registry());
}

/** Seeds 1..N in which `pick` finds the outcome. */
function seedsWhere(n: number, make: (seed: number) => EngineState<GameState>, has: string) {
  return Array.from({ length: n }, (_, i) => i + 1).filter((seed) =>
    types(run(make(seed)).emitted).includes(has),
  );
}

/** The first seed in 1..n in which `pick` finds the outcome; stops there instead of sweeping all n. */
function firstSeedWhere(n: number, make: (seed: number) => EngineState<GameState>, has: string) {
  for (let seed = 1; seed <= n; seed++) {
    if (types(run(make(seed)).emitted).includes(has)) return seed;
  }
  return undefined;
}

describe('courier interception', () => {
  const taken = seedsWhere(60, (s) => game(s), 'courier_intercepted');

  it('happens when enemy cavalry is in reach, and only then', () => {
    expect(taken.length).toBeGreaterThan(0);
    expect(taken.length).toBeLessThan(60);
    expect(seedsWhere(60, (s) => game(s, { lurk: false }), 'courier_intercepted')).toEqual([]);
  });

  it('is deterministic given the seed', () => {
    const a = run(game(taken[0]!));
    const b = run(game(taken[0]!));
    expect(b.state).toEqual(a.state);
    expect(b.emitted).toEqual(a.emitted);
  });

  it('never executes the order, and leaves no courier on the map', () => {
    for (const seed of taken) {
      const r = run(game(seed));
      expect(types(r.emitted)).not.toContain('order_delivered');
      expect(unit(r.state, 'blue-1').intent).toEqual({ kind: 'idle' });
      expect(unit(r.state, 'blue-1').center).toEqual(unit(game(seed), 'blue-1').center);
      expect(r.state.world.couriers).toEqual([]);
      // The sender hears nothing back.
      expect(r.state.world.intel.blue.reports.filter((x) => x.kind === 'orderDelivered')).toEqual(
        [],
      );
    }
  });

  it('hands the dispatch to the captor as a document once it reaches HQ, and to nobody else', () => {
    const r = run(game(taken[0]!));
    const capturedAt = r.emitted.find((e) => e.type === 'courier_intercepted')!.time;
    const red = r.state.world.intel.red.documents;
    expect(red).toHaveLength(1);
    expect(red[0]).toMatchObject({ capturedAt, fromSide: 'blue', text: ORDER.text });

    const before = viewFor(r.state.world, 'red', capturedAt + COURIER_DELAY_MS - 1);
    expect(before.documents).toEqual([]);
    const after = viewFor(r.state.world, 'red', capturedAt + COURIER_DELAY_MS);
    expect(after.documents).toHaveLength(1);
    expect(after.documents[0]).toMatchObject({
      addressedTo: '1st Battalion',
      text: ORDER.text,
      deliveredAt: capturedAt + COURIER_DELAY_MS,
    });
    expect(viewFor(r.state.world, 'blue', END).documents).toEqual([]);
  });

  it('gives the same result however advanceTo is chunked', () => {
    const s0 = game(taken[0]!);
    const whole = run(s0);
    let s = s0;
    const emitted: EmittedEvent[] = [];
    for (let t = 90_000; t < END; t += 90_000) {
      const r = advanceTo(s, t, registry());
      s = r.state;
      emitted.push(...r.emitted);
    }
    const last = advanceTo(s, END, registry());
    expect(last.state).toEqual(whole.state);
    expect([...emitted, ...last.emitted]).toEqual(whole.emitted);
  });
});

describe('courier loss and garbling', () => {
  // Fog makes every ride four times as risky, so a short ride shows both within a few hundred seeds.
  const foggy = (seed: number) => game(seed, { lurk: false, sightFactor: 0.25 });
  const lost = seedsWhere(500, foggy, 'order_failed');
  const garbled = seedsWhere(500, foggy, 'order_garbled');

  it('loses some couriers, which never arrive', () => {
    expect(lost.length).toBeGreaterThan(0);
    const r = run(foggy(lost[0]!));
    const failed = r.emitted.find((e) => e.type === 'order_failed')!;
    expect(failed.payload).toMatchObject({ orderId: 'o1', reason: 'courier lost' });
    expect(types(r.emitted)).not.toContain('order_delivered');
    expect(unit(r.state, 'blue-1').intent).toEqual({ kind: 'idle' });
    expect(r.state.world.couriers).toEqual([]);
  });

  it('garbles some orders: the unit still acts, but on a wrong destination', () => {
    expect(garbled.length).toBeGreaterThan(0);
    const r = run(foggy(garbled[0]!));
    expect(types(r.emitted)).toContain('order_delivered');
    const u = unit(r.state, 'blue-1');
    expect(u.center).not.toEqual(DEST);
  });

  it('garbles the intent the unit adopts, not a leading conditional one', () => {
    const later = pointMm(2600, 2600);
    const order: Order = {
      ...ORDER,
      intents: [
        { kind: 'at', gameTime: 500 * MS_PER_MINUTE, then: [{ kind: 'hold', at: later }] },
        { kind: 'move', to: DEST },
      ],
    };
    const mixed = (seed: number) => game(seed, { lurk: false, sightFactor: 0.25, order });
    const seed = firstSeedWhere(500, mixed, 'order_garbled');
    expect(seed).toBeDefined();
    const r = run(mixed(seed!));
    const u = unit(r.state, 'blue-1');
    // The unit marched to the garbled destination, not DEST.
    expect(u.center).not.toEqual(DEST);
    expect(u.center).not.toEqual(later);
    // The standing order keeps its own destination.
    expect(u.standing?.[0]?.then).toEqual([{ kind: 'hold', at: later }]);
  });

  it('does not garble an order with no destination to move', () => {
    const order: Order = {
      ...ORDER,
      intents: [{ kind: 'at', gameTime: 50 * MS_PER_MINUTE, then: [] }],
    };
    const none = seedsWhere(
      200,
      (s) => game(s, { lurk: false, sightFactor: 0.25, order }),
      'order_garbled',
    );
    expect(none).toEqual([]);
  });

  it('is rarer in clear weather', () => {
    const clear = seedsWhere(500, (s) => game(s, { lurk: false }), 'order_garbled');
    expect(clear.length).toBeLessThan(garbled.length);
  }, 30_000);
});

describe('rideRisk', () => {
  const world = loadScenario(holdTheBridgeFarStart);
  const to = world.units.find((u) => u.id === 'blue-1')!;
  const km = 1_000_000;

  it('grows with distance and rough ground', () => {
    const base = rideRisk(world, to, 2 * km, 2 * km);
    expect(rideRisk(world, to, 4 * km, 4 * km).loss).toBeGreaterThan(base.loss);
    expect(rideRisk(world, to, 4 * km, 4 * km).garble).toBeGreaterThan(base.garble);
    expect(rideRisk(world, to, 2 * km, 4 * km).loss).toBeGreaterThan(base.loss);
    expect(rideRisk(world, to, 2 * km, km).loss).toBeLessThan(base.loss);
  });

  it('grows in fog, and garbling falls with training', () => {
    const base = rideRisk(world, to, 2 * km, 2 * km);
    expect(rideRisk({ ...world, sightFactor: 0.5 }, to, 2 * km, 2 * km).loss).toBeGreaterThan(
      base.loss,
    );
    const drilled = world.units.find((u) => u.type === 'artillery') ?? {
      ...to,
      type: 'artillery',
      kind: 'artillery' as const,
    };
    expect(rideRisk(world, drilled, 2 * km, 2 * km).garble).toBeLessThan(base.garble);
  });

  it('never makes a ride certain to fail', () => {
    const r = rideRisk({ ...world, sightFactor: 0.25 }, to, 1000 * km, 1000 * km);
    expect(r.loss).toBeLessThan(1);
    expect(r.garble).toBeLessThan(1);
  });
});

describe('interceptChance', () => {
  // Enemy at (1000, 1000) m; wood covers 1500-1700 m east of it, open ground elsewhere.
  const raw = (kind: 'infantry' | 'cavalry' | 'artillery', over: { strength?: number } = {}) =>
    miniWorld({
      features: [wood('w', 1500, 900, 1700, 1100)],
      units: [
        { id: 'b', side: 'blue', x: 200, y: 200 },
        { id: 'e', side: 'red', x: 1000, y: 1000, kind, ...over },
      ],
    });
  const m = (x: number): Point => ({ x: x * 1000, y: 1_000_000 });
  const chance = (w: GameState, x: number) =>
    interceptChance(
      w,
      w.units.find((u) => u.id === 'e')!,
      m(x),
    );

  it('is nothing for artillery, even at point-blank', () => {
    const w = raw('artillery');
    expect(chance(w, 1000)).toBe(0);
    expect(chance(w, 1050)).toBe(0);
  });

  it('reaches 300 m for infantry and no further', () => {
    const w = raw('infantry');
    expect(chance(w, 1300)).toBeCloseTo(0.1);
    expect(chance(w, 1301)).toBe(0);
  });

  it('reaches 800 m for cavalry and no further', () => {
    const w = raw('cavalry');
    expect(chance(w, 1800)).toBeGreaterThan(0);
    expect(chance(w, 1801)).toBe(0);
    expect(chance(w, 1100)).toBeCloseTo(0.3);
  });

  it('halves in sight-blocking ground', () => {
    const w = raw('cavalry');
    expect(chance(w, 1600)).toBeCloseTo(0.15);
    expect(chance(w, 1400)).toBeCloseTo(0.3);
  });

  it('is nothing for a dead or non-active enemy', () => {
    const w = raw('cavalry');
    const e = w.units.find((u) => u.id === 'e')!;
    expect(interceptChance(w, { ...e, strength: 0 }, m(1100))).toBe(0);
    expect(interceptChance(w, { ...e, status: 'withdrawn' }, m(1100))).toBe(0);
  });

  it('is scaled by the sight factor', () => {
    const w = { ...raw('cavalry'), sightFactor: 0.5 };
    expect(chance(w, 1100)).toBeCloseTo(0.15);
  });
});

describe('couriers on the table (#196)', () => {
  const foggy = (seed: number) => game(seed, { lurk: false, sightFactor: 0.25 });
  const seed = firstSeedWhere(500, foggy, 'order_failed')!;
  const lostRun = () => run(foggy(seed));

  it('shows a side its own riding courier, with a delivery estimate, and no one else', () => {
    const arrival = run(game(1, { lurk: false })).emitted.find(
      (e) => e.type === 'order_delivered',
    )!.time;
    const s = advanceTo(game(1, { lurk: false }), arrival / 2, registry()).state;
    const mine = viewFor(s.world, 'blue', s.time).couriers;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: 'o1', unitId: 'blue-1' });
    expect(mine[0]!.arriveAt).toBeGreaterThan(s.time);
    expect(viewFor(s.world, 'red', s.time).couriers).toEqual([]);
    // Leak: nothing of the courier reaches the enemy's view, even with a hussar beside its road.
    const lurked = advanceTo(game(1), arrival / 2, registry()).state;
    const json = JSON.stringify(viewFor(lurked.world, 'red', lurked.time));
    for (const hidden of ['"o1"', 'Advance to the crossroads', 'courier-']) {
      expect(json).not.toContain(hidden);
    }
  });

  it('drops the courier from the view once it arrives', () => {
    const s = run(game(1, { lurk: false })).state;
    expect(viewFor(s.world, 'blue', s.time).couriers).toEqual([]);
  });

  it('keeps a lost courier on the sender’s table until it is overdue, then reports it', () => {
    const r = lostRun();
    const lostAt = r.emitted.find((e) => e.type === 'order_failed')!.time;
    const mid = advanceTo(foggy(seed), lostAt, registry()).state;
    const view = viewFor(mid.world, 'blue', mid.time);
    // The sender cannot tell: the courier still rides on its plan and no report has come.
    expect(view.couriers).toHaveLength(1);
    expect(view.reports.some((x) => x.kind === 'courierLost')).toBe(false);
    const overdue = mid.world.intel.blue.reports.find((x) => x.kind === 'courierLost')!;
    expect(overdue.deliverAt).toBeGreaterThanOrEqual(view.couriers[0]!.arriveAt);
    // The written time is when HQ gave the courier up, not when it fell (no timing tell).
    expect(overdue.observedAt).toBeGreaterThanOrEqual(view.couriers[0]!.arriveAt);
    expect(overdue.observedAt).toBeGreaterThan(lostAt);
    const later = advanceTo(foggy(seed), overdue.deliverAt, registry()).state;
    const told = viewFor(later.world, 'blue', later.time);
    const report = told.reports.find((x) => x.kind === 'courierLost')!;
    expect(report.text).toMatch(/^Sir, .*no word from /);
    expect(report.observedAt).toBeGreaterThanOrEqual(view.couriers[0]!.arriveAt);
    expect(told.couriers).toEqual([]);
    expect(
      viewFor(later.world, 'red', later.time).reports.some((x) => x.kind === 'courierLost'),
    ).toBe(false);
  });

  it('does not say "no word" from a unit that has reported since its orders were due (#417)', () => {
    const r = lostRun();
    const overdue = r.state.world.intel.blue.reports.find((x) => x.kind === 'courierLost')!;
    expect(overdue.orderDueAt).toBeLessThanOrEqual(overdue.observedAt);
    const later = advanceTo(foggy(seed), overdue.deliverAt, registry()).state;
    const textOf = (w: typeof later.world) =>
      viewFor(w, 'blue', later.time).reports.find((x) => x.kind === 'courierLost')!.text;
    expect(textOf(later.world)).toMatch(/no word from/);
    // The unit reports itself engaged after its orders should have come, and HQ has that report.
    const engaged = {
      ...overdue,
      id: 'blue-engaged',
      kind: 'engaged' as const,
      observedAt: overdue.orderDueAt! + 1,
      deliverAt: overdue.deliverAt,
    };
    delete (engaged as { orderDueAt?: number }).orderDueAt;
    const heard = {
      ...later.world,
      intel: {
        ...later.world.intel,
        blue: { ...later.world.intel.blue, reports: [...later.world.intel.blue.reports, engaged] },
      },
    };
    expect(textOf(heard)).not.toMatch(/no word/);
    expect(textOf(heard)).toMatch(/courier.*(overdue|lost)/);
    // A report from before the orders were due, or one still on the road, does not count.
    for (const early of [
      { ...engaged, observedAt: overdue.orderDueAt! - 1 },
      { ...engaged, deliverAt: overdue.deliverAt + 1 },
    ]) {
      const w = {
        ...later.world,
        intel: {
          ...later.world.intel,
          blue: { ...later.world.intel.blue, reports: [...later.world.intel.blue.reports, early] },
        },
      };
      expect(textOf(w)).toMatch(/no word from/);
    }
  });

  it('does the same at any stepping of the clock (replay)', () => {
    const whole = lostRun();
    let s = foggy(seed);
    for (let t = 77_000; t < END; t += 77_000) s = advanceTo(s, t, registry()).state;
    expect(advanceTo(s, END, registry()).state).toEqual(whole.state);
  });
});
