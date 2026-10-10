import { describe, expect, it } from 'vitest';
import {
  EventRegistry,
  advanceTo,
  createState,
  issueMove,
  issuePlacement,
  registerCombat,
  registerMovement,
  registerPlacement,
  MAX_SHAPE_EXTENT_MM,
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
      placement: {
        center: { x: 612_345, y: 678_901 },
        facing: 1.234,
        formation: w.units[0]!.formation,
        footprint: w.units[0]!.footprint,
      },
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

describe('arbitrary arrangements', () => {
  const arc: Point[] = [-60, -30, 0, 30, 60].map((x) => pointMm(x, x * x * 0.01));

  it('accepts a loose arc, with the footprint bounding it', () => {
    const r = validatePlacement(world(), {
      unitId: 'a',
      center: P(500, 600),
      formation: 'skirmish',
      shape: arc,
      elapsedMs: 1e9,
    });
    expect(r.verdict).toBe('accept');
    if (r.verdict !== 'accept') return;
    expect(r.placement.formation).toBe('skirmish');
    expect(r.placement.shape).toEqual(arc);
    expect(r.placement.footprint).toEqual({ frontage: mm(120), depth: mm(72) });
  });

  it('rejects a sub-position in the river, or one that is far away', () => {
    const w = world();
    // Facing north, local -y is behind the unit: 100 m behind (500, 900) is the river.
    const wet = validatePlacement(w, {
      unitId: 'a',
      center: P(500, 900),
      shape: [pointMm(0, 0), pointMm(0, -100)],
      facing: 0,
      elapsedMs: 1e9,
    });
    expect(wet.verdict).toBe('reject');
    expect(wet.reasons.join()).toMatch(/impassable/);
    const far = validatePlacement(w, {
      unitId: 'a',
      center: P(500, 600),
      shape: [{ x: MAX_SHAPE_EXTENT_MM + 1, y: 0 }],
      elapsedMs: 1e9,
    });
    expect(far.verdict).toBe('reject');
    expect(far.reasons.join()).toMatch(/from the centre/);
  });

  it('rejects an unknown formation and a non-finite shape', () => {
    const base = { unitId: 'a', center: P(500, 600), elapsedMs: 1e9 };
    expect(
      validatePlacement(world(), { ...base, formation: 'blob' as never }).reasons.join(),
    ).toMatch(/formation/);
    expect(validatePlacement(world(), { ...base, shape: [{ x: NaN, y: 0 }] }).verdict).toBe(
      'reject',
    );
  });

  it('keeps the shape when it clamps a proposal that is too far', () => {
    const r = validatePlacement(world(), {
      unitId: 'a',
      center: P(2500, 600),
      shape: arc,
      elapsedMs: MS_PER_MINUTE,
    });
    expect(r.verdict).toBe('clamp');
    if (r.verdict === 'clamp') expect(r.placement.shape).toEqual(arc);
  });
});

describe('registerPlacement', () => {
  const registry = () => {
    const r = new EventRegistry<GameState>();
    registerMovement(r);
    registerCombat(r);
    registerPlacement(r);
    return r;
  };
  const ruled = (proposal: Parameters<typeof issuePlacement>[1]['proposal']) => {
    const s = issuePlacement(
      createState(1, world(), 0),
      { proposal, rationale: 'because', narrative: 'they deployed' },
      0,
    );
    return advanceTo(s, 0, registry());
  };

  it('applies an irregular formation exactly and records the ruling', () => {
    const arc: Point[] = [pointMm(-40, 0), pointMm(0, 10), pointMm(40, 0)];
    const { state, emitted } = ruled({
      unitId: 'a',
      center: P(500, 600),
      facing: 0.5,
      formation: 'loose',
      shape: arc,
      elapsedMs: 1e9,
    });
    const a = state.world.units.find((u) => u.id === 'a')!;
    expect(a).toMatchObject({ center: P(500, 600), facing: 0.5, formation: 'loose', shape: arc });
    expect(a.intent).toEqual({ kind: 'idle' });
    const [ruling] = state.world.rulings;
    expect(ruling).toMatchObject({
      id: 'ruling-1',
      rationale: 'because',
      narrative: 'they deployed',
      verdict: { verdict: 'accept' },
    });
    expect(emitted.map((e) => e.type)).toContain('umpire.ruling');
  });

  it('clamps an implausible jump and logs why', () => {
    const { state } = ruled({ unitId: 'a', center: P(2500, 600), elapsedMs: MS_PER_MINUTE });
    const a = state.world.units.find((u) => u.id === 'a')!;
    expect(a.center.x).toBeLessThan(P(700, 0).x);
    expect(a.center.x).toBeGreaterThan(P(500, 0).x);
    const [ruling] = state.world.rulings;
    expect(ruling!.verdict.verdict).toBe('clamp');
    expect(ruling!.verdict.reasons.join()).toMatch(/too far/);
  });

  it('refuses a unit through the river: nothing moves, the rejection is on record', () => {
    const before = world().units.find((u) => u.id === 'a')!;
    const { state } = ruled({ unitId: 'a', center: P(300, 1000), elapsedMs: 1e9 });
    expect(state.world.units.find((u) => u.id === 'a')).toEqual(before);
    expect(state.world.rulings[0]!.verdict.verdict).toBe('reject');
  });

  it('ends a march in progress: the old steps go stale', () => {
    let s = createState(1, world(), 0);
    s = issueMove(s, 'a', P(500, 900), 0);
    s = issuePlacement(
      s,
      {
        proposal: { unitId: 'a', center: P(520, 540), elapsedMs: 1e9 },
        rationale: 'r',
        narrative: 'n',
      },
      1000,
    );
    const { state } = advanceTo(s, 20 * MS_PER_MINUTE, registry());
    const a = state.world.units.find((u) => u.id === 'a')!;
    expect(a.center).toEqual(P(520, 540));
    expect(a.leg).toBeUndefined();
  });

  it('is deterministic: the same logged proposal gives the same state', () => {
    const p = { unitId: 'a', center: P(900, 600), elapsedMs: 5 * MS_PER_MINUTE };
    expect(JSON.stringify(ruled(p).state)).toBe(JSON.stringify(ruled(p).state));
  });
});
