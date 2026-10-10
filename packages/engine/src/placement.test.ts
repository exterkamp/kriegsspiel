import { describe, expect, it } from 'vitest';
import {
  MS_PER_MINUTE,
  OVERLAP_TOLERANCE_MM,
  footprintCorners,
  holdTheBridge,
  loadScenario,
  mm,
  pointMm,
  validatePlacement,
  type GameState,
  type Point,
} from './index.js';
import { bridge, miniWorld, river } from './scenario.testkit.js';

const P = (x: number, y: number): Point => pointMm(x, y);

const world = (): GameState =>
  miniWorld({
    features: [river('rv', 100, [0, 1000], [3000, 1000]), bridge('b', 1450, 1000, 110)],
    units: [
      { id: 'a', x: 500, y: 500 },
      { id: 'b', x: 700, y: 500 },
      { id: 'c', side: 'red', x: 2500, y: 500 },
    ],
  });

describe('validatePlacement', () => {
  it('accepts a plausible spot to the millimetre, and does not change state', () => {
    const w = world();
    const before = JSON.stringify(w);
    const r = validatePlacement(w, {
      unitId: 'a',
      center: { x: 612_345, y: 678_901 },
      facing: 1.234,
      elapsedMs: 10 * MS_PER_MINUTE,
    });
    expect(r).toEqual({
      verdict: 'accept',
      placement: { center: { x: 612_345, y: 678_901 }, facing: 1.234 },
      reasons: [],
    });
    expect(JSON.stringify(w)).toBe(before);
  });

  it('rejects a spot off the map or a footprint hanging over the edge', () => {
    const w = world();
    const off = validatePlacement(w, { unitId: 'a', center: P(-10, 500), elapsedMs: 1e9 });
    expect(off.verdict).toBe('reject');
    expect(off.reasons.join()).toMatch(/off the map/);
    const edge = validatePlacement(w, { unitId: 'a', center: P(10, 10), elapsedMs: 1e9 });
    expect(edge).toMatchObject({ verdict: 'reject' });
    expect(edge.reasons.join()).toMatch(/footprint extends off the map/);
  });

  it('rejects impassable ground', () => {
    const r = validatePlacement(world(), { unitId: 'a', center: P(300, 1000), elapsedMs: 1e9 });
    expect(r.verdict).toBe('reject');
    expect(r.reasons.join()).toMatch(/impassable/);
  });

  it('rejects an overlap beyond the tolerance and allows one within it', () => {
    const w = world();
    const b = w.units.find((u) => u.id === 'b')!;
    const hit = validatePlacement(w, { unitId: 'a', center: P(700, 503), elapsedMs: 1e9 });
    expect(hit.verdict).toBe('reject');
    expect(hit.reasons).toContain('overlaps unit "b"');

    // Slide `a` alongside `b` so the footprints overlap by half the tolerance.
    const half =
      b.footprint.frontage / 2 + w.units.find((u) => u.id === 'a')!.footprint.frontage / 2;
    const ok = validatePlacement(w, {
      unitId: 'a',
      center: { x: b.center.x - half + OVERLAP_TOLERANCE_MM / 2, y: b.center.y },
      facing: b.facing,
      elapsedMs: 1e9,
    });
    expect(ok.verdict).toBe('accept');
    const bad = validatePlacement(w, {
      unitId: 'a',
      center: { x: b.center.x - half + OVERLAP_TOLERANCE_MM * 3, y: b.center.y },
      facing: b.facing,
      elapsedMs: 1e9,
    });
    expect(bad.verdict).toBe('reject');
  });

  it('clamps a displacement the elapsed time does not allow, along the real route', () => {
    const w = world();
    // 400 m of open ground north of the river is 4 minutes; allow 2.
    const r = validatePlacement(w, {
      unitId: 'a',
      center: P(500, 100),
      elapsedMs: 2 * MS_PER_MINUTE,
    });
    expect(r.verdict).toBe('clamp');
    if (r.verdict !== 'clamp') return;
    expect(r.placement.center).toEqual(P(500, 300));
    expect(r.reasons[0]).toMatch(/too far/);
  });

  it('clamps along the route, not the straight line: across the river means round by the bridge', () => {
    const w = world();
    const r = validatePlacement(w, {
      unitId: 'a',
      center: P(500, 1500),
      elapsedMs: 5 * MS_PER_MINUTE,
    });
    expect(r.verdict).toBe('clamp');
    if (r.verdict !== 'clamp') return;
    // Five minutes is 500 m, and the bridge is over 900 m away: it is still north of the river.
    expect(r.placement.center.y).toBeLessThan(mm(1000));
    // And the clamped spot is itself valid.
    const again = validatePlacement(w, {
      unitId: 'a',
      center: r.placement.center,
      elapsedMs: 5 * MS_PER_MINUTE,
    });
    expect(again.verdict).toBe('accept');
  });

  it('rejects when the clamped spot is taken', () => {
    const w = world();
    // `b` stands on the route 200 m east of `a`; time for 200 m ends inside its footprint.
    const r = validatePlacement(w, {
      unitId: 'a',
      center: P(1100, 500),
      elapsedMs: 2 * MS_PER_MINUTE,
    });
    expect(r.verdict).toBe('reject');
    expect(r.reasons[0]).toMatch(/too far/);
    expect(r.reasons.join()).toMatch(/overlaps unit "b"/);
  });

  it('rejects an unreachable spot', () => {
    const w = miniWorld({
      features: [river('rv', 100, [0, 1000], [3000, 1000])],
      units: [{ id: 'a', x: 500, y: 500 }],
    });
    const r = validatePlacement(w, { unitId: 'a', center: P(500, 1500), elapsedMs: 1e9 });
    expect(r).toEqual({
      verdict: 'reject',
      reasons: ['no passable route from where the unit stands'],
    });
  });

  it('rejects an unknown or inactive unit and bad time', () => {
    const w = world();
    expect(validatePlacement(w, { unitId: 'zz', center: P(1, 1), elapsedMs: 0 }).verdict).toBe(
      'reject',
    );
    const gone: GameState = {
      ...w,
      units: w.units.map((u) => (u.id === 'a' ? { ...u, status: 'destroyed' as const } : u)),
    };
    expect(
      validatePlacement(gone, { unitId: 'a', center: P(500, 400), elapsedMs: 0 }).verdict,
    ).toBe('reject');
    expect(validatePlacement(w, { unitId: 'a', center: P(500, 400), elapsedMs: -1 }).verdict).toBe(
      'reject',
    );
  });

  it('works on the real scenario map', () => {
    const g = loadScenario(holdTheBridge);
    const u = g.units.find((x) => x.id === 'blue-1')!;
    const r = validatePlacement(g, { unitId: 'blue-1', center: u.center, elapsedMs: 0 });
    expect(r.verdict).toBe('accept');
    expect(footprintCorners(u)).toHaveLength(4);
  });
});
