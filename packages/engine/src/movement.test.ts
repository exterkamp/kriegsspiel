import { describe, expect, it } from 'vitest';
import {
  EventRegistry,
  MS_PER_METRE,
  MS_PER_MINUTE,
  advanceTo,
  createState,
  findPath,
  holdTheBridge,
  issueFormation,
  issueHalt,
  issueMove,
  legDuration,
  loadScenario,
  mm,
  pathDuration,
  pointMm,
  positionAlong,
  profileAlong,
  registerCombat,
  registerMovement,
  segmentPassable,
  serialize,
  type GameState,
  type Point,
} from './index.js';
import { bridge, miniWorld, river, road, wood } from './scenario.testkit.js';

const P = (x: number, y: number): Point => pointMm(x, y);

function registry() {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerCombat(r);
  return r;
}

function game() {
  const g = loadScenario(holdTheBridge);
  return createState(g.seed, g, 0);
}

const unit = (s: ReturnType<typeof game>, id: string) => s.world.units.find((u) => u.id === id)!;
const MINUTE = MS_PER_MINUTE;

describe('findPath', () => {
  const noUnits = [{ id: 'u', x: 500, y: 300 }];

  it('goes straight across open ground, as one free leg at any angle', () => {
    const w = miniWorld({ units: noUnits });
    const p = findPath(w.map, P(100, 100), P(2700, 1500))!;
    expect(p.waypoints).toEqual([P(100, 100), P(2700, 1500)]);
    expect(p.cost).toBeCloseTo(Math.hypot(mm(2600), mm(1400)));
  });

  it('is a single point when the unit is already there', () => {
    const w = miniWorld({ units: noUnits });
    expect(findPath(w.map, P(100, 100), P(100, 100))).toEqual({
      waypoints: [P(100, 100)],
      cost: 0,
    });
  });

  it('goes round a wood rather than through it when that is cheaper', () => {
    const w = miniWorld({ features: [wood('w', 200, 100, 800, 300)], units: noUnits });
    const p = findPath(w.map, P(50, 200), P(950, 200))!;
    for (let i = 1; i < p.waypoints.length; i++) {
      const pieces = profileAlong(w.map, p.waypoints[i - 1]!, p.waypoints[i]!);
      expect(pieces.every((x) => x.featureId !== 'w')).toBe(true);
    }
    expect(p.cost).toBeGreaterThan(mm(900));
    expect(p.cost).toBeLessThan(mm(600) * 3);
  });

  it('goes through a wood when going round costs more', () => {
    const w = miniWorld({ features: [wood('w', 200, 0, 800, 1990)], units: noUnits });
    const p = findPath(w.map, P(100, 1000), P(900, 1000))!;
    expect(p.waypoints).toEqual([P(100, 1000), P(900, 1000)]);
    expect(p.cost).toBeCloseTo(mm(200) + mm(600) * 3);
  });

  it('prefers a longer way along a road to the short way over open ground', () => {
    const w = miniWorld({ features: [road('r', 10, [0, 350], [1000, 350])], units: noUnits });
    const p = findPath(w.map, P(50, 450), P(950, 450))!;
    expect(p.waypoints.some((q) => q.y === mm(350))).toBe(true);
    expect(p.cost).toBeLessThan(mm(900) * 0.8);
  });

  it('never crosses the river except at the bridge', () => {
    const w = miniWorld({
      features: [river('rv', 100, [0, 1000], [3000, 1000]), bridge('b', 1450, 1000, 110)],
      units: noUnits,
    });
    const p = findPath(w.map, P(250, 450), P(250, 1550))!;
    for (let i = 1; i < p.waypoints.length; i++) {
      expect(segmentPassable(w.map, p.waypoints[i - 1]!, p.waypoints[i]!)).toBe(true);
    }
    const crossing = p.waypoints.find((q) => q.y >= mm(1000));
    expect(crossing).toBeDefined();
    // Somewhere between its two waypoints either side of the river, the route is on the bridge.
    const j = p.waypoints.findIndex((q) => q.y >= mm(1000));
    const a = p.waypoints[j - 1]!;
    const b = p.waypoints[j]!;
    const t = (mm(1000) - a.y) / (b.y - a.y);
    expect(Math.abs(a.x + (b.x - a.x) * t - mm(1450))).toBeLessThanOrEqual(mm(110));
  });

  it('returns null when the river blocks every route or the target is impassable', () => {
    const w = miniWorld({ features: [river('rv', 100, [0, 1000], [3000, 1000])], units: noUnits });
    expect(findPath(w.map, P(500, 500), P(500, 1500))).toBeNull();
    expect(findPath(w.map, P(500, 500), P(500, 1000))).toBeNull();
    expect(findPath(w.map, P(500, 500), P(9999, 9999))).toBeNull();
    expect(findPath(w.map, P(500, 1000), P(500, 500))).toBeNull();
  });

  it('crosses the real scenario map only over the bridge', () => {
    const g = loadScenario(holdTheBridge);
    const p = findPath(g.map, P(1850, 2450), P(1950, 450))!;
    expect(p.waypoints.length).toBeGreaterThan(2);
    let crossedAt: number | undefined;
    for (let i = 1; i < p.waypoints.length; i++) {
      const a = p.waypoints[i - 1]!;
      const b = p.waypoints[i]!;
      expect(segmentPassable(g.map, a, b)).toBe(true);
      if (a.y > mm(1500) && b.y <= mm(1500)) {
        crossedAt = a.x + ((b.x - a.x) * (a.y - mm(1500))) / (a.y - b.y);
      }
    }
    expect(Math.abs(crossedAt! - mm(2050))).toBeLessThanOrEqual(mm(110));
  });

  it('is deterministic', () => {
    const g = loadScenario(holdTheBridge);
    expect(findPath(g.map, P(0, 0), P(3900, 2900))).toEqual(
      findPath(g.map, P(0, 0), P(3900, 2900)),
    );
  });
});

describe('march times', () => {
  it('infantry cover open ground at 100 m a minute, a road in half the time, a wood in triple', () => {
    const w = miniWorld({
      features: [road('r', 20, [0, 500], [1000, 500]), wood('w', 100, 800, 300, 900)],
      units: [{ id: 'u', x: 500, y: 300 }],
    });
    expect(MS_PER_METRE.infantry).toBe(MINUTE / 100);
    expect(legDuration(w.map, P(500, 1500), P(600, 1500), 'infantry')).toBe(MINUTE);
    expect(legDuration(w.map, P(500, 495), P(600, 495), 'infantry')).toBe(MINUTE / 2);
    expect(legDuration(w.map, P(100, 850), P(200, 850), 'infantry')).toBe(MINUTE * 3);
    expect(legDuration(w.map, P(500, 1500), P(600, 1500), 'cavalry')).toBe(MINUTE / 3);
    expect(legDuration(w.map, P(500, 1500), P(600, 1500), 'artillery')).toBe((MINUTE * 3) / 2);
  });

  it('cost scales with true distance, at any angle', () => {
    const w = miniWorld({ units: [{ id: 'u', x: 500, y: 300 }] });
    expect(legDuration(w.map, P(0, 0), P(300, 400), 'infantry')).toBe(5 * MINUTE);
  });

  it('is null for a blocked leg', () => {
    const w = miniWorld({
      features: [river('rv', 100, [0, 1000], [3000, 1000])],
      units: [{ id: 'u', x: 500, y: 500 }],
    });
    expect(legDuration(w.map, P(500, 900), P(500, 1100), 'infantry')).toBeNull();
    expect(pathDuration(w.map, [P(500, 900), P(500, 1100)], 'infantry')).toBe(Infinity);
  });
});

describe('movement events', () => {
  it('arrives exactly when the march rate says', () => {
    // blue-1 at (1850, 2450) to the road at (2050, 2450): 190 m of open ground then 10 m of road.
    const s0 = game();
    const to = P(2050, 2450);
    const expected = 117_000;
    const path = findPath(s0.world.map, unit(s0, 'blue-1').center, to)!;
    expect(pathDuration(s0.world.map, path.waypoints, 'infantry')).toBe(expected);
    const s1 = issueMove(s0, 'blue-1', to);

    const early = advanceTo(s1, expected - 1, registry());
    expect(early.emitted).toEqual([]);
    expect(unit(early.state, 'blue-1').center).not.toEqual(to);

    const done = advanceTo(early.state, expected, registry());
    expect(done.emitted).toEqual([
      {
        time: expected,
        type: 'unit.arrived',
        payload: { unitId: 'blue-1', at: [2_050_000, 2_450_000] },
      },
    ]);
    expect(unit(done.state, 'blue-1').center).toEqual(to);
    expect(unit(done.state, 'blue-1').intent).toEqual({ kind: 'idle' });
  });

  it('cavalry are faster than infantry over the same ground', () => {
    const run = (id: string) => {
      const s = game();
      const u = unit(s, id);
      return pathDuration(
        s.world.map,
        findPath(s.world.map, u.center, P(2000, 2000))!.waypoints,
        u.kind,
      );
    };
    expect(run('blue-3')).toBeLessThan(run('blue-1'));
  });

  it('marches leg by leg, each a scheduled event', () => {
    const s0 = game();
    const to = P(1850, 1000);
    const path = findPath(s0.world.map, unit(s0, 'blue-1').center, to)!;
    expect(path.waypoints.length).toBeGreaterThan(2); // round by the bridge
    const first = legDuration(s0.world.map, path.waypoints[0]!, path.waypoints[1]!, 'infantry')!;
    const r = advanceTo(issueMove(s0, 'blue-1', to), first, registry());
    expect(unit(r.state, 'blue-1').center).toEqual(path.waypoints[1]);
    expect(r.state.queue).toHaveLength(1);
    expect(r.emitted).toEqual([]);
  });

  it('a new intent stops a march where the unit has got to; stale steps do nothing', () => {
    const s0 = game();
    const to = P(1850, 1000);
    const path = findPath(s0.world.map, unit(s0, 'blue-1').center, to)!;
    const first = legDuration(s0.world.map, path.waypoints[0]!, path.waypoints[1]!, 'infantry')!;
    const mid = advanceTo(issueMove(s0, 'blue-1', to), first + 1000, registry());
    expect(unit(mid.state, 'blue-1').center).toEqual(path.waypoints[1]);
    expect(mid.state.queue).toHaveLength(1);

    // One second into the next step the unit is 1/60 of a minute's march past the waypoint.
    const leg = unit(mid.state, 'blue-1').leg!;
    const where = positionAlong(mid.state.world.map, leg.from, leg.to, 'infantry', 1000);
    expect(where).not.toEqual(path.waypoints[1]);

    const halted = advanceTo(issueHalt(mid.state, 'blue-1'), 600 * MINUTE, registry());
    expect(unit(halted.state, 'blue-1').center).toEqual(where);
    expect(unit(halted.state, 'blue-1').leg).toBeUndefined();
    expect(halted.emitted).toEqual([]);
    expect(halted.state.queue).toEqual([]);

    const redirected = advanceTo(
      issueMove(mid.state, 'blue-1', P(1650, 2450)),
      600 * MINUTE,
      registry(),
    );
    expect(unit(redirected.state, 'blue-1').center).toEqual(P(1650, 2450));
    expect(redirected.emitted.map((e) => e.type)).toEqual(['unit.arrived']);
  });

  it('halts at the exact point reached, part way through a leg', () => {
    const s = advanceTo(issueMove(game(), 'blue-1', P(1850, 2000)), 150_000, registry());
    // 2.5 minutes at 100 m a minute from (1850, 2450): 250 m on, between two 90 m steps.
    expect(unit(s.state, 'blue-1').center).toEqual(P(1850, 2270)); // last 90 m step reached
    const halted = advanceTo(issueHalt(s.state, 'blue-1', 150_000), 150_000, registry());
    expect(unit(halted.state, 'blue-1').center).toEqual(P(1850, 2200));
  });

  it('halts at the exact instant a step ends without losing the step', () => {
    // The first 90 m step ends at 54 000 ms; the halt sorts ahead of the step event.
    const s = issueHalt(issueMove(game(), 'blue-1', P(1850, 2000)), 'blue-1', 54_000);
    const halted = advanceTo(s, 54_000, registry());
    expect(unit(halted.state, 'blue-1').center).toEqual(P(1850, 2360));
    const late = advanceTo(issueMove(game(), 'blue-1', P(1850, 2000)), 54_000, registry());
    const s2 = advanceTo(issueHalt(late.state, 'blue-1', 54_000), 54_000, registry());
    expect(unit(s2.state, 'blue-1').center).toEqual(P(1850, 2360));
  });

  it('reports an unreachable destination and stays put', () => {
    const r = advanceTo(issueMove(game(), 'blue-1', P(500, 1500)), 0, registry());
    expect(r.emitted.map((e) => e.type)).toEqual(['unit.moveBlocked']);
    expect(r.emitted[0]!.payload).toEqual({ unitId: 'blue-1', to: [500_000, 1_500_000] });
    expect(unit(r.state, 'blue-1').center).toEqual(P(1850, 2450));
  });

  it('a rejected order does not stop a march already under way', () => {
    const s = advanceTo(issueMove(game(), 'blue-1', P(1850, 2000)), 3 * MINUTE, registry());
    const r = advanceTo(issueMove(s.state, 'blue-1', P(500, 1500)), 600 * MINUTE, registry());
    expect(r.emitted.map((e) => e.type)).toEqual(['unit.moveBlocked', 'unit.arrived']);
    expect(unit(r.state, 'blue-1').center).toEqual(P(1850, 2000));
  });

  it('re-issuing a move to the same destination kills the old step chain', () => {
    const to = P(1850, 2000); // 450 m of open ground: 4.5 minutes
    const first = advanceTo(issueMove(game(), 'blue-1', to), 2 * MINUTE, registry());
    const again = advanceTo(issueMove(first.state, 'blue-1', to), first.state.time, registry());
    // The old step event is still queued but stale, plus the new order's step.
    expect(again.state.queue).toHaveLength(2);
    const done = advanceTo(again.state, 600 * MINUTE, registry());
    // Replanned at 2 min from the exact point reached (200 m along), so the 250 m left arrive
    // at 4.5 min: the same as the old chain, and no progress is lost to the re-issue.
    expect(done.emitted.map((e) => [e.time, e.type])).toEqual([[4.5 * MINUTE, 'unit.arrived']]);
    expect(unit(done.state, 'blue-1').center).toEqual(to);
    expect(done.state.queue).toEqual([]);
  });

  it('orders for an unknown unit are rejected without wedging the queue', () => {
    const s = issueHalt(issueMove(game(), 'nobody', P(100, 100)), 'ghost');
    const r = advanceTo(issueMove(s, 'blue-1', P(1850, 2400)), 5 * MINUTE, registry());
    expect(r.emitted.map((e) => e.type)).toEqual([
      'order.rejected',
      'order.rejected',
      'unit.arrived',
    ]);
    expect(r.state.queue).toEqual([]);
  });

  it('red can cross the bridge and reach the objective', () => {
    const r = advanceTo(issueMove(game(), 'red-1', P(2050, 1500)), 200 * MINUTE, registry());
    expect(unit(r.state, 'red-1').center).toEqual(P(2050, 1500));
  });

  it('moves to a free point, not a cell: any destination, to the millimetre', () => {
    const to = { x: 1_234_567, y: 2_345_678 };
    const r = advanceTo(issueMove(game(), 'blue-1', to), 600 * MINUTE, registry());
    expect(unit(r.state, 'blue-1').center).toEqual(to);
  });

  it('gives the same result however the clock is chunked, and does not mutate input', () => {
    const s = issueMove(issueMove(game(), 'blue-1', P(2050, 500)), 'red-3', P(2050, 2000));
    const before = serialize(s);
    const whole = advanceTo(s, 90 * MINUTE, registry());
    let chunked = s;
    const emitted = [];
    for (let t = 7000; ; t += 7000) {
      const r = advanceTo(chunked, Math.min(t, 90 * MINUTE), registry());
      chunked = r.state;
      emitted.push(...r.emitted);
      if (t >= 90 * MINUTE) break;
    }
    expect(serialize(chunked)).toBe(serialize(whole.state));
    expect(emitted).toEqual(whole.emitted);
    expect(serialize(s)).toBe(before);
  });

  it('survives a JSON snapshot mid-march', () => {
    const s = issueMove(game(), 'blue-1', P(2050, 500));
    const mid = advanceTo(s, 5 * MINUTE, registry()).state;
    const resumed = JSON.parse(JSON.stringify(mid)) as typeof mid;
    expect(resumed).toEqual(mid);
    expect(serialize(advanceTo(resumed, 600 * MINUTE, registry()).state)).toBe(
      serialize(advanceTo(mid, 600 * MINUTE, registry()).state),
    );
  });
});

describe('formation changes', () => {
  const crossing = () =>
    miniWorld({
      features: [river('rv', 40, [0, 1000], [3000, 1000]), bridge('narrow', 1450, 1000, 25)],
      units: [{ id: 'u', x: 1450, y: 600 }],
    });
  const regs = registry;

  it('takes game time, stands the unit still, then changes footprint', () => {
    const s0 = issueFormation(game(), 'blue-1', 'column');
    const line = unit(s0, 'blue-1').footprint;
    const start = advanceTo(s0, 0, regs());
    expect(unit(start.state, 'blue-1').intent).toMatchObject({
      kind: 'reform',
      formation: 'column',
    });
    const early = advanceTo(start.state, 2 * MINUTE - 1, regs());
    expect(unit(early.state, 'blue-1').formation).toBe('line');
    expect(early.emitted).toEqual([]);
    const done = advanceTo(early.state, 2 * MINUTE, regs());
    const u = unit(done.state, 'blue-1');
    expect(u.formation).toBe('column');
    expect(u.intent).toEqual({ kind: 'idle' });
    expect(u.footprint.frontage).toBeLessThan(line.frontage);
    expect(done.emitted.map((e) => e.type)).toEqual(['unit.reformed']);
  });

  it('is cancelled by a newer order, and stops a march where it is', () => {
    let s = advanceTo(issueMove(game(), 'blue-1', P(1850, 2000)), 60_000, regs()).state;
    s = advanceTo(issueFormation(s, 'blue-1', 'column', 60_000), 60_000, regs()).state;
    expect(unit(s, 'blue-1').center).toEqual(P(1850, 2350)); // 100 m into the march, part way along its 90 m steps
    s = advanceTo(issueHalt(s, 'blue-1', 90_000), 10 * MINUTE, regs()).state;
    expect(unit(s, 'blue-1').formation).toBe('line');
  });

  it('a second reform supersedes the first, whose completion must not apply', () => {
    let s = advanceTo(issueFormation(game(), 'blue-1', 'column'), 0, regs()).state;
    s = advanceTo(issueFormation(s, 'blue-1', 'square', MINUTE), MINUTE, regs()).state;
    // The column reform's done event (2 min) fires while the square reform is under way.
    s = advanceTo(s, 2 * MINUTE + 1, regs()).state;
    expect(unit(s, 'blue-1').formation).toBe('line');
    expect(unit(s, 'blue-1').intent).toMatchObject({ kind: 'reform', formation: 'square' });
    s = advanceTo(s, 3 * MINUTE, regs()).state;
    expect(unit(s, 'blue-1').formation).toBe('square');
  });

  it('ordering back to the formation it is still in cancels the reform', () => {
    let s = advanceTo(issueFormation(game(), 'blue-1', 'column'), 0, regs()).state;
    s = advanceTo(issueFormation(s, 'blue-1', 'line', MINUTE), MINUTE, regs()).state;
    expect(unit(s, 'blue-1').intent).toEqual({ kind: 'idle' });
    const done = advanceTo(s, 10 * MINUTE, regs());
    expect(unit(done.state, 'blue-1').formation).toBe('line');
    expect(done.emitted.map((e) => e.type)).not.toContain('unit.reformed');
  });

  it('rejects a change to the formation the unit is already in', () => {
    const r = advanceTo(issueFormation(game(), 'blue-1', 'line'), 0, regs());
    expect(r.emitted).toEqual([
      {
        time: 0,
        type: 'order.rejected',
        payload: { unitId: 'blue-1', reason: 'already in that formation' },
      },
    ]);
  });

  it('a line cannot take a narrow bridge, a column can once it has re-formed', () => {
    const s0 = createState(1, crossing(), 0);
    const to = P(1450, 1400);
    const refused = advanceTo(issueMove(s0, 'u', to), 0, registry());
    expect(refused.emitted).toEqual([
      {
        time: 0,
        type: 'unit.moveBlocked',
        payload: { unitId: 'u', to: [1_450_000, 1_400_000], tooWide: true },
      },
    ]);

    let s = advanceTo(issueFormation(s0, 'u', 'column'), 0, registry()).state;
    s = advanceTo(issueMove(s, 'u', to, 2 * MINUTE), 100 * MINUTE, registry()).state;
    expect(unit(s, 'u').center).toEqual(to);
  });

  it('survives chunked advances', () => {
    const s = issueMove(
      issueFormation(game(), 'blue-1', 'column'),
      'blue-1',
      P(2050, 2000),
      3 * MINUTE,
    );
    const whole = advanceTo(s, 40 * MINUTE, registry());
    let chunked = s;
    for (let t = 9000; ; t += 9000) {
      chunked = advanceTo(chunked, Math.min(t, 40 * MINUTE), registry()).state;
      if (t >= 40 * MINUTE) break;
    }
    expect(serialize(chunked)).toBe(serialize(whole.state));
  });
});
