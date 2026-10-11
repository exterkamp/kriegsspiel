import { describe, expect, it } from 'vitest';
import {
  MS_PER_MINUTE,
  defaultFootprint,
  findPath,
  legCost,
  mm,
  pointMm,
  positionAlong,
  profileAlong,
  type Point,
} from './index.js';
import { bridge, miniWorld, river, road, wood } from './scenario.testkit.js';

const P = (x: number, y: number): Point => pointMm(x, y);
const units = [{ id: 'u', x: 500, y: 300 }];

describe('routing over continuous terrain', () => {
  it('follows a road through a wood rather than cutting across the wood', () => {
    const w = miniWorld({
      features: [wood('w', 300, 0, 700, 400), road('r', 10, [0, 200], [1000, 200])],
      units,
    });
    const from = P(100, 100);
    const to = P(900, 300);
    const p = findPath(w.map, from, to)!;
    const straight = legCost(w.map, from, to)!;
    expect(p.cost).toBeLessThan(straight * 0.8);
    expect(p.waypoints.some((q) => q.y === mm(200))).toBe(true);
    // Every leg is on passable ground and the cost is the sum of the legs.
    let sum = 0;
    for (let i = 1; i < p.waypoints.length; i++) {
      sum += legCost(w.map, p.waypoints[i - 1]!, p.waypoints[i]!)!;
    }
    expect(sum).toBeCloseTo(p.cost);
  });

  it('is not tied to any lattice: the same route at an arbitrary offset costs the same', () => {
    const feats = (dx: number) => [
      river('rv', 100, [0, 1000 + dx], [3000, 1000 + dx]),
      bridge('b', 1450 + dx, 1000 + dx, 110),
    ];
    const cost = (dx: number) => {
      const w = miniWorld({ features: feats(dx), units });
      return findPath(w.map, P(1450 + dx, 450 + dx), P(1450 + dx, 1550 + dx))!.cost;
    };
    expect(cost(0)).toBeCloseTo(cost(37.3), 0);
  });

  it('is deterministic', () => {
    const w = miniWorld({
      features: [wood('w', 300, 0, 700, 400), river('rv', 100, [0, 1000], [3000, 1000])],
      units,
    });
    expect(findPath(w.map, P(100, 100), P(2900, 1900))).toEqual(
      findPath(w.map, P(100, 100), P(2900, 1900)),
    );
  });
});

describe('formation-aware crossings', () => {
  // A bridge only 50 m across a 40 m river: a column (about 9 m wide) fits, a line (79 m) does not.
  const w = miniWorld({
    features: [river('rv', 40, [0, 1000], [3000, 1000]), bridge('narrow', 1450, 1000, 25)],
    units,
  });
  const column = defaultFootprint('infantry', 'column', 437).frontage;
  const line = defaultFootprint('infantry', 'line', 437).frontage;

  it('lets a column over a narrow bridge', () => {
    expect(column).toBeLessThan(mm(50));
    expect(line).toBeGreaterThan(mm(50));
    const p = findPath(w.map, P(1450, 450), P(1450, 1550), { width: column });
    expect(p).not.toBeNull();
  });

  it('keeps a line off it, and off the river, so there is no route', () => {
    expect(findPath(w.map, P(1450, 450), P(1450, 1550), { width: line })).toBeNull();
    // A lone courier (no width) still crosses.
    expect(findPath(w.map, P(1450, 450), P(1450, 1550))).not.toBeNull();
  });

  it('lets a line over a bridge as wide as itself', () => {
    const wide = miniWorld({
      features: [river('rv', 100, [0, 1000], [3000, 1000]), bridge('wide', 1450, 1000, 110)],
      units,
    });
    expect(findPath(wide.map, P(1450, 450), P(1450, 1550), { width: line })).not.toBeNull();
  });

  it('does not make a bridge over open ground a bottleneck', () => {
    const open = miniWorld({ features: [bridge('b', 1450, 1000, 20)], units });
    const p = findPath(open.map, P(1450, 450), P(1450, 1550), { width: line });
    expect(p).not.toBeNull();
    expect(p!.waypoints).toHaveLength(2); // straight across, not round the bridge circle
    expect(p!.cost).toBe(legCost(open.map, P(1450, 450), P(1450, 1550)));
  });
});

describe('positionAlong', () => {
  it('walks each stretch of ground at its own rate', () => {
    // 100 m of open ground then 100 m of wood (x3): 1 minute, then 3 more.
    const w = miniWorld({ features: [wood('w', 200, 0, 400, 400)], units });
    const a = P(100, 200);
    const b = P(300, 200);
    expect(positionAlong(w.map, a, b, 'infantry', 0)).toEqual(a);
    expect(positionAlong(w.map, a, b, 'infantry', MS_PER_MINUTE)).toEqual(P(200, 200));
    expect(positionAlong(w.map, a, b, 'infantry', MS_PER_MINUTE * 2)).toEqual(
      P(200 + 100 / 3, 200),
    );
    expect(positionAlong(w.map, a, b, 'infantry', MS_PER_MINUTE * 99)).toEqual(b);
    expect(profileAlong(w.map, a, b)).toHaveLength(2);
  });
});
