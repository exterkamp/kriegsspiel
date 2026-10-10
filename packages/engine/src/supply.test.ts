import { describe, expect, it } from 'vitest';
import {
  AMMO_PER_FIRE_TICK,
  EXHAUSTED_FATIGUE,
  EventRegistry,
  FATIGUE_SPEED_LOSS,
  FORCED_PACE_FACTOR,
  LOW_AMMO,
  MS_PER_MINUTE,
  RESUPPLY_PER_TICK,
  SUPPLY_TICK_MS,
  advanceTo,
  createState,
  issueAttack,
  issueMove,
  issueOrder,
  msPerMetreOf,
  pointMm,
  registerCombat,
  registerMovement,
  registerOrders,
  registerVisibility,
  startGame,
  unitTypeOf,
  viewFor,
  type EngineState,
  type GameState,
  type Unit,
} from './index.js';
import { miniWorld, road, type RawUnit } from './scenario.testkit.js';

const M = MS_PER_MINUTE;

function registry() {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerCombat(r);
  registerOrders(r);
  registerVisibility(r);
  return r;
}

/** A started game whose clock will not end it, with `patch` applied to the named units. */
function game(
  units: RawUnit[],
  opts: { width?: number; features?: Parameters<typeof miniWorld>[0]['features'] } = {},
  patch: Record<string, Partial<Unit>> = {},
): EngineState<GameState> {
  const w = miniWorld({ width: opts.width ?? 12000, height: 2000, features: opts.features, units });
  const world: GameState = {
    ...w,
    victory: { ...w.victory, holdMs: 1000 * M },
    units: w.units.map((u) => ({ ...u, ...patch[u.id] })),
  };
  return startGame(createState(1, world, 0));
}

const get = (s: EngineState<GameState>, id: string) => s.world.units.find((u) => u.id === id)!;
const at = (s: EngineState<GameState>, id: string) => get(s, id).center;

// Two blue units on the same 6 km march along y = 500, far from the red unit parked in the corner.
const pair: RawUnit[] = [
  { id: 'slow', x: 100, y: 500 },
  { id: 'fast', x: 100, y: 700 },
];

describe('forced march', () => {
  it('is faster but tires the men more, and tired men are slower', () => {
    const fresh = { type: 'line_infantry', kind: 'infantry', formation: 'line' } as const;
    const base = msPerMetreOf(fresh);
    expect(msPerMetreOf({ ...fresh, pace: 'forced' })).toBeCloseTo(base / FORCED_PACE_FACTOR);
    expect(msPerMetreOf({ ...fresh, fatigue: 100 })).toBeCloseTo(base / (1 - FATIGUE_SPEED_LOSS));
    expect(msPerMetreOf(fresh)).toBe(base); // a fresh unit at a plain march is the baseline
  });

  it('costs fatigue on a scripted run: arrives sooner, but arrives more spent', () => {
    let s = game(pair);
    s = issueMove(s, 'slow', pointMm(6100, 500));
    s = issueMove(s, 'fast', pointMm(6100, 700), 0, 'forced');
    const arrival = new Map<string, number>();
    const spent = new Map<string, number>();
    const r = registry();
    for (let t = M; t <= 120 * M; t += M) {
      const res = advanceTo(s, t, r);
      s = res.state;
      for (const e of res.emitted) {
        if (e.type === 'unit.arrived') {
          const id = (e.payload as { unitId: string }).unitId;
          arrival.set(id, e.time);
          spent.set(id, get(res.state, id).fatigue);
        }
      }
    }
    expect(arrival.get('fast')!).toBeLessThan(arrival.get('slow')!);
    expect(spent.get('fast')!).toBeGreaterThan(spent.get('slow')! * 2);
    expect(spent.get('slow')!).toBeGreaterThan(0);
  });

  it('slows the next leg for the unit that was driven hard on the first', () => {
    let s = game([...pair, { id: 'fresh', x: 4100, y: 900 }]);
    s = issueMove(s, 'fast', pointMm(4100, 700), 0, 'forced');
    const r = registry();
    s = advanceTo(s, M, r).state; // the order has fired and the unit is marching
    while (!get(s, 'fast').intent || get(s, 'fast').intent.kind !== 'idle') {
      s = advanceTo(s, s.time + M, r).state;
    }
    const tired = get(s, 'fast').fatigue;
    expect(tired).toBeGreaterThan(20); // past what slows a march
    // The tired unit and a fresh one now march the same plain 2 km: the tired one takes longer.
    const t0 = s.time;
    s = issueMove(s, 'fast', pointMm(6100, 700), t0);
    s = issueMove(s, 'fresh', pointMm(6100, 900), t0);
    const done = new Map<string, number>();
    for (let t = t0 + M; t <= t0 + 60 * M; t += M) {
      const res = advanceTo(s, t, r);
      s = res.state;
      for (const e of res.emitted) {
        if (e.type === 'unit.arrived') done.set((e.payload as { unitId: string }).unitId, e.time);
      }
    }
    expect(done.get('fast')!).toBeGreaterThan(done.get('fresh')!);
  });

  it('rides in an order: a delivered move can carry its pace', () => {
    let s = game(pair);
    s = issueOrder(s, {
      id: 'o1',
      side: 'blue',
      to: 'fast',
      issuedAt: 0,
      text: 'Make all speed to the crossroads.',
      intents: [{ kind: 'move', to: pointMm(3100, 700), pace: 'forced' }],
    });
    s = advanceTo(s, 30 * M, registry()).state;
    expect(get(s, 'fast').pace).toBe('forced');
  });

  it('reports a unit exhausted once, as a dispatch', () => {
    let s = game(pair, {}, { fast: { fatigue: EXHAUSTED_FATIGUE - 0.5 } });
    s = issueMove(s, 'fast', pointMm(6100, 700), 0, 'forced');
    s = advanceTo(s, 40 * M, registry()).state;
    expect(get(s, 'fast').fatigue).toBeGreaterThanOrEqual(EXHAUSTED_FATIGUE);
    const view = viewFor(s.world, 'blue', 40 * M + 10 * M);
    const hits = view.reports.filter((r) => r.kind === 'exhausted');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.text).toContain('exhausted');
  });
});

describe('rest and morale', () => {
  it('a unit standing still recovers fatigue', () => {
    let s = game([{ id: 'a', x: 500, y: 500 }], {}, { a: { fatigue: 50 } });
    s = advanceTo(s, 30 * M, registry()).state;
    expect(get(s, 'a').fatigue).toBeCloseTo(50 - 3 * 4); // three ticks of ten minutes at 0.4/min
    s = advanceTo(s, 400 * M, registry()).state;
    expect(get(s, 'a').fatigue).toBe(0);
  });

  it('exhaustion wears morale down, but not past the break point', () => {
    const breakAt = unitTypeOf({ kind: 'infantry', type: 'line_infantry' }).breakMorale;
    // A marching unit does not rest, so it stays exhausted; hold it on a very long march.
    let s = game(
      [{ id: 'a', x: 100, y: 500 }],
      {},
      { a: { fatigue: 95, morale: breakAt + 2.5, ammo: 100 } },
    );
    s = issueMove(s, 'a', pointMm(11000, 500));
    s = advanceTo(s, 50 * M, registry()).state;
    expect(get(s, 'a').morale).toBe(breakAt);
    expect(get(s, 'a').status).toBe('active');
  });
});

/** Blue and red infantry 150 m apart, in range of each other, with the given ammunition. */
function duel(blueAmmo: number, redAmmo: number) {
  let s = game(
    [
      { id: 'b', side: 'blue', x: 3000, y: 500 },
      { id: 'r', side: 'red', x: 3150, y: 500 },
    ],
    {},
    { b: { ammo: blueAmmo }, r: { ammo: redAmmo } },
  );
  s = issueAttack(s, 'b', 'r');
  return s;
}

describe('ammunition', () => {
  it('firing spends ammunition and tires both sides', () => {
    const s = advanceTo(duel(100, 100), 6 * M, registry()).state;
    const per = AMMO_PER_FIRE_TICK.infantry;
    expect(get(s, 'b').ammo).toBeLessThan(100);
    expect(get(s, 'b').ammo % per).toBe(0);
    expect(get(s, 'b').fatigue).toBeGreaterThan(0);
    expect(get(s, 'r').fatigue).toBeGreaterThan(0);
  });

  it('a unit with no ammunition does almost no damage, and is hit as hard as ever', () => {
    const loaded = advanceTo(duel(100, 100), 2 * M, registry()).state;
    const dry = advanceTo(duel(0, 100), 2 * M, registry()).state;
    const lost = (st: EngineState<GameState>, id: string) => 437 - get(st, id).strength;
    expect(lost(dry, 'r')).toBeLessThan(lost(loaded, 'r') * 0.2);
    expect(lost(dry, 'b')).toBeCloseTo(lost(loaded, 'b'));
    expect(get(dry, 'b').ammo).toBe(0); // and it cannot go below empty
  });

  it('reports low ammunition once, as a dispatch to HQ', () => {
    const s = advanceTo(duel(LOW_AMMO + 5, 100), 4 * M, registry()).state;
    expect(get(s, 'b').ammo).toBeLessThanOrEqual(LOW_AMMO);
    const view = viewFor(s.world, 'blue', 30 * M);
    expect(view.reports.filter((r) => r.kind === 'lowAmmo')).toHaveLength(1);
    expect(view.ownUnits.find((u) => u.id === 'b')!.ammo).toBeLessThanOrEqual(LOW_AMMO);
  });
});

describe('resupply', () => {
  // Blue HQ is at (5, 5). A resting unit near it is reached by the wagons.
  it('wagons refill a resting unit near a depot a little each tick', () => {
    let s = game([{ id: 'a', x: 400, y: 300 }], {}, { a: { ammo: 10 } });
    s = advanceTo(s, SUPPLY_TICK_MS, registry()).state;
    expect(get(s, 'a').ammo).toBe(10 + RESUPPLY_PER_TICK);
    s = advanceTo(s, 10 * SUPPLY_TICK_MS, registry()).state;
    expect(get(s, 'a').ammo).toBe(100);
  });

  it('does not reach a unit beyond the wagons, unless a road carries them', () => {
    const far: RawUnit = { id: 'a', x: 9000, y: 300 };
    const dry = { a: { ammo: 10 } };
    const off = advanceTo(game([far], {}, dry), 3 * SUPPLY_TICK_MS, registry()).state;
    expect(get(off, 'a').ammo).toBe(10);
    // The same ground with a road from the depot: half the march cost, twice the reach.
    const onRoad = advanceTo(
      game([far], { features: [road('rd', 6, [5, 5], [9000, 300])] }, dry),
      3 * SUPPLY_TICK_MS,
      registry(),
    ).state;
    expect(get(onRoad, 'a').ammo).toBe(10 + 3 * RESUPPLY_PER_TICK);
  });

  it('serves a named depot rather than the HQ', () => {
    const w = miniWorld({ width: 12000, units: [{ id: 'a', x: 9000, y: 300 }] });
    const world: GameState = {
      ...w,
      victory: { ...w.victory, holdMs: 1000 * M },
      sides: w.sides.map((x) => (x.id === 'blue' ? { ...x, depots: [pointMm(8800, 300)] } : x)),
      units: w.units.map((u) => (u.id === 'a' ? { ...u, ammo: 10 } : u)),
    };
    const s = advanceTo(startGame(createState(1, world, 0)), SUPPLY_TICK_MS, registry()).state;
    expect(get(s, 'a').ammo).toBe(10 + RESUPPLY_PER_TICK);
  });

  it('does not resupply a unit that is marching or in contact', () => {
    let s = game([{ id: 'a', x: 400, y: 300 }], {}, { a: { ammo: 10 } });
    s = issueMove(s, 'a', pointMm(4000, 300));
    expect(get(advanceTo(s, SUPPLY_TICK_MS, registry()).state, 'a').ammo).toBe(10);
    const fight = advanceTo(duel(10, 100), 2 * M, registry()).state;
    expect(get(fight, 'b').ammo).toBeLessThanOrEqual(10);
  });
});

describe('determinism', () => {
  it('advancing in chunks gives the same state as advancing at once', () => {
    const script = () => {
      let s = duel(60, 60);
      s = issueMove(s, 'b', at(s, 'b'), 0, 'forced');
      return s;
    };
    const once = advanceTo(script(), 60 * M, registry()).state;
    let chunked = script();
    for (let t = 7 * M; t < 60 * M; t += 7 * M) chunked = advanceTo(chunked, t, registry()).state;
    chunked = advanceTo(chunked, 60 * M, registry()).state;
    expect(JSON.stringify(chunked)).toBe(JSON.stringify(once));
  });
});
