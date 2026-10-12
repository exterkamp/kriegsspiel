import { describe, expect, it } from 'vitest';
import { polygonCentroid } from './geometry.js';
import { holdTheBridgeFarStart } from './scenario.testkit.js';
import {
  FEATURE_KINDS,
  holdTheBridge,
  loadScenario,
  MS_PER_MINUTE,
  ScenarioError,
  subPositions,
  toWorld,
  terrainAt,
  footprintCorners,
  deserialize,
  serialize,
  createState,
} from './index.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- tests mutate raw scenario data freely */
function clone(): any {
  return JSON.parse(JSON.stringify(holdTheBridgeFarStart));
}

describe('Hold the Bridge scenario', () => {
  it('loads into a GameState', () => {
    const s = loadScenario(holdTheBridge);
    expect(s.time).toBe(0);
    expect(s.map.width).toBe(4_000_000);
    expect(s.map.height).toBe(3_000_000);
    expect(s.units.filter((u) => u.side === 'blue')).toHaveLength(3);
    expect(s.units.filter((u) => u.side === 'red')).toHaveLength(3);
    expect(s.victory.holdMs).toBe(50 * MS_PER_MINUTE);
    const kinds = new Set(s.map.features.map((f) => f.kind));
    for (const k of ['wood', 'river', 'road', 'bridge']) expect(kinds).toContain(k);
    expect(terrainAt(s.map, polygonCentroid(s.victory.objective))!.featureIds).toContain('bridge');
  });

  it('describes the ground as vector features, not cells', () => {
    const s = loadScenario(holdTheBridge);
    const shapes = new Set(s.map.features.map((f) => f.geometry.shape));
    expect([...shapes].sort()).toEqual(['point', 'polygon', 'polyline']);
    expect(JSON.stringify(s.map)).not.toMatch(/tile|cell|grid|legend|rows/i);
  });

  it('gives each unit a centre, a facing and a footprint from its formation', () => {
    const s = loadScenario(holdTheBridge);
    const blue = s.units.find((u) => u.id === 'blue-1')!;
    expect(blue.center).toEqual({ x: 1_960_000, y: 1_680_000 });
    expect(blue.facing).toBe(0);
    expect(s.units.find((u) => u.id === 'red-1')!.facing).toBeCloseTo(Math.PI);
    expect(blue.formation).toBe('line');
    expect(blue.footprint.frontage).toBeGreaterThan(blue.footprint.depth);
  });

  it('starts Blue at the bridge and Red a long march away (#178)', () => {
    const s = loadScenario(holdTheBridge);
    const goal = polygonCentroid(s.victory.objective);
    const away = (id: string) => {
      const c = s.units.find((u) => u.id === id)!.center;
      return Math.hypot(c.x - goal.x, c.y - goal.y) / 1000;
    };
    for (const id of ['blue-1', 'blue-2']) expect(away(id)).toBeLessThan(300);
    for (const id of ['red-1', 'red-2', 'red-3']) expect(away(id)).toBeGreaterThan(1100);
    expect(s.victory.takeMs).toBe(10 * MS_PER_MINUTE);
  });

  it('reads victory.takeMinutes, default 10, and rejects a negative one', () => {
    const d = clone();
    d.victory.takeMinutes = 3;
    expect(loadScenario(d).victory.takeMs).toBe(3 * MS_PER_MINUTE);
    d.victory.takeMinutes = -1;
    expect(() => loadScenario(d)).toThrow(/takeMinutes/);
  });

  it('keeps every coordinate and length in state an integer number of mm', () => {
    const s = loadScenario(holdTheBridge);
    const nums: number[] = [];
    for (const f of s.map.features) {
      const g = f.geometry;
      if (g.shape === 'point') nums.push(g.at.x, g.at.y, g.radius);
      else {
        for (const p of g.points) nums.push(p.x, p.y);
        if (g.shape === 'polyline') nums.push(g.width);
      }
    }
    for (const u of s.units)
      nums.push(u.center.x, u.center.y, u.footprint.frontage, u.footprint.depth);
    for (const side of s.sides) nums.push(side.hq.x, side.hq.y);
    expect(nums.every(Number.isInteger)).toBe(true);
  });

  it('quantises sub-millimetre input to the nearest millimetre', () => {
    const d = clone();
    d.units[0].at = { x: 1850.0004, y: 2450.0006 };
    expect(loadScenario(d).units[0]!.center).toEqual({ x: 1_850_000, y: 2_450_001 });
  });

  it('round-trips through JSON exactly, state and whole engine snapshot', () => {
    const s = loadScenario(holdTheBridge);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    const e = createState(s.seed, s, 0);
    expect(deserialize(serialize(e))).toEqual(e);
  });

  it('is loaded identically every time', () => {
    expect(loadScenario(holdTheBridge)).toEqual(
      loadScenario(JSON.parse(JSON.stringify(holdTheBridge))),
    );
  });
});

describe('free placement', () => {
  /** A battalion strung along an arc of radius 150 m, 12 sub-positions, facing north-east. */
  function arcScenario() {
    const d = clone();
    const shape = Array.from({ length: 12 }, (_, i) => {
      const a = (-55 + i * 10) * (Math.PI / 180); // from the unit's left, round to its right
      return [150 * Math.sin(a), 150 * (Math.cos(a) - 1)];
    });
    d.units[0] = {
      ...d.units[0],
      at: { x: 1000, y: 2000 },
      facingDeg: 37,
      formation: 'loose',
      frontage: 250,
      depth: 40,
      shape,
    };
    return d;
  }

  it('places a battalion as an irregular arc at any position and facing', () => {
    const s = loadScenario(arcScenario());
    const u = s.units[0]!;
    expect(u.formation).toBe('loose');
    expect(u.facing).toBeCloseTo((37 * Math.PI) / 180);
    expect(u.shape).toHaveLength(12);
    const pts = subPositions(u);
    expect(pts).toHaveLength(12);
    expect(pts.every((p) => Number.isInteger(p.x) && Number.isInteger(p.y))).toBe(true);
    // Not a line: the middle of the arc is well off the chord between its ends.
    const [a, b, mid] = [pts[0]!, pts[11]!, pts[5]!];
    const chord = Math.abs(
      ((b.y - a.y) * mid.x - (b.x - a.x) * mid.y + b.x * a.y - b.y * a.x) /
        Math.hypot(b.x - a.x, b.y - a.y),
    );
    expect(chord).toBeGreaterThan(5_000);
    // All twelve are 150 m from the arc's centre, however it is turned.
    const r = 150_000;
    const { x: cx, y: cy } = toWorld(u.center, u.facing, { x: 0, y: -r }); // the arc's centre, behind it
    for (const p of pts) expect(Math.hypot(p.x - cx, p.y - cy)).toBeCloseTo(r, -1);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('accepts units at odd facings, in columns, and beside one another', () => {
    const d = clone();
    d.units[0] = { ...d.units[0], at: { x: 500, y: 2000 }, facingDeg: 123.4, formation: 'column' };
    d.units[1] = { ...d.units[1], at: { x: 560, y: 2000 }, facingDeg: 301, formation: 'square' };
    const s = loadScenario(d);
    expect(s.units[0]!.footprint.depth).toBeGreaterThan(s.units[0]!.footprint.frontage);
    expect(footprintCorners(s.units[0]!)).toHaveLength(4);
  });

  it('puts a skirmish line along a treeline', () => {
    const d = clone();
    d.units[0] = {
      ...d.units[0],
      at: { x: 950, y: 600 },
      formation: 'skirmish',
      facingDeg: 270,
      shape: [
        [-250, 0],
        [-120, 3],
        [0, -2],
        [130, 5],
        [260, 0],
      ],
    };
    const u = loadScenario(d).units[0]!;
    const { x, y } = subPositions(u)[0]!;
    expect(terrainAt(loadScenario(d).map, { x, y })!.featureIds).toContain('north-wood');
  });
});

describe('unit commander', () => {
  const unit = (d: any) => d.units.find((u: any) => u.side === 'blue');

  it('is carried onto the unit when named, and absent otherwise', () => {
    const d = clone();
    unit(d).commander = 'Col. Aubry';
    expect(loadScenario(d).units.find((u) => u.id === unit(d).id)!.commander).toBe('Col. Aubry');
    delete unit(d).commander;
    const none = loadScenario(d).units.find((u) => u.id === unit(d).id)!;
    expect('commander' in none).toBe(false);
  });

  it('names a commander and a trait for every unit of both sides in the shipped scenarios', () => {
    for (const sc of [holdTheBridge, holdTheBridgeFarStart]) {
      const units = loadScenario(JSON.parse(JSON.stringify(sc))).units;
      expect(new Set(units.map((u) => u.side))).toEqual(new Set(['blue', 'red']));
      for (const u of units) {
        expect(u.commander, u.id).toBeTruthy();
        expect(u.trait, u.id).toBeTruthy();
      }
    }
  });

  it.each(['', 7])('rejects a commander of %j', (bad) => {
    const d = clone();
    unit(d).commander = bad;
    expect(() => loadScenario(d)).toThrow(ScenarioError);
    expect(() => loadScenario(d)).toThrow(/commander/);
  });
});

describe('loader validation', () => {
  const bad = (mutate: (d: any) => void, message: RegExp) => {
    const d = clone();
    mutate(d);
    expect(() => loadScenario(d)).toThrow(ScenarioError);
    expect(() => loadScenario(d)).toThrow(message);
  };

  it('rejects an empty loose shape, which the wire format refuses', () => {
    bad((d) => (d.units[0].shape = []), /shape must have at least one sub-position/);
  });

  it('rejects a side HQ in the river', () => {
    bad((d) => (d.sides[0].hq = { x: 500, y: 1450 }), /hq must be on passable ground/);
  });

  it('rejects a side HQ off the map', () => {
    bad((d) => (d.sides[0].hq = { x: -5, y: 100 }), /hq must be on passable ground/);
  });

  it('rejects a side without an HQ', () => {
    bad((d) => delete d.sides[0].hq, /sides\[0\]\.hq/);
  });

  it('rejects non-objects', () => {
    expect(() => loadScenario(null)).toThrow(ScenarioError);
    expect(() => loadScenario('x')).toThrow(/scenario must be an object/);
  });
  it('rejects a bad map size', () => bad((d) => (d.map.width = 0), /map\.width/));
  it('rejects unknown feature kinds', () =>
    bad(
      (d) => (d.map.features[0].kind = 'lava'),
      new RegExp(`one of ${FEATURE_KINDS.join(', ')}`),
    ));
  it('rejects duplicate feature ids', () =>
    bad((d) => (d.map.features[1].id = d.map.features[0].id), /duplicate feature id/));
  it('rejects a feature with no geometry or two', () => {
    bad((d) => delete d.map.features[0].polygon, /exactly one of polygon, polyline or at/);
    bad((d) => (d.map.features[0].at = { x: 1, y: 1 }), /exactly one of/);
  });
  it('rejects a degenerate polygon and polyline', () => {
    bad(
      (d) =>
        (d.map.features[0].polygon = [
          [0, 0],
          [1, 1],
        ]),
      /at least 3 points/,
    );
    bad((d) => (d.map.features[2].polyline = [[0, 0]]), /at least 2 points/);
  });
  it('rejects a polyline without a width', () =>
    bad((d) => delete d.map.features[2].width, /width must be a finite number/));
  it('rejects features off the map', () =>
    bad((d) => (d.map.features[0].polygon[0] = [-10, 0]), /lies off the map/));
  it('rejects bad terrain attributes', () => {
    bad((d) => (d.map.features[0].cover = 2), /cover must be between/);
    bad((d) => (d.map.features[0].passable = 'no'), /passable must be a boolean/);
    bad((d) => (d.map.features[0].height = 'tall'), /height must be one of/);
  });
  it('lets a feature override its kind defaults', () => {
    const d = clone();
    d.map.features[0].moveCost = 5;
    d.map.features[0].layer = 7;
    const f = loadScenario(d).map.features[0]!;
    expect([f.attrs.moveCost, f.layer]).toEqual([5, 7]);
  });
  it('rejects duplicate unit ids', () =>
    bad((d) => (d.units[1].id = d.units[0].id), /duplicate unit id/));
  it('rejects two units of a side with the same name, but not across sides', () => {
    bad((d) => (d.units[1].name = d.units[0].name), /duplicate unit name/);
    const d = clone();
    const other = d.units.find((u: { side: string }) => u.side !== d.units[0].side)!;
    other.name = d.units[0].name;
    expect(() => loadScenario(d)).not.toThrow();
  });
  it('rejects units off the map', () => bad((d) => (d.units[0].at.x = 9999), /off the map/));
  it('rejects units whose footprint runs off the map', () =>
    bad((d) => (d.units[0].at = { x: 20, y: 2000 }), /footprint extends off the map/));
  it('rejects units in the river', () =>
    bad((d) => (d.units[0].at = { x: 500, y: 1500 }), /impassable ground/));
  it('rejects loose sub-positions off the map or in the river', () => {
    bad(
      (d) =>
        (d.units[0].shape = [
          [0, 0],
          [0, -2000],
        ]),
      /sub-position off the map/,
    );
    bad(
      (d) =>
        (d.units[0].shape = [
          [0, 0],
          [0, 900],
        ]),
      /impassable ground/,
    );
  });
  it('rejects overlapping units', () =>
    bad((d) => (d.units[1].at = { x: 1860, y: 2455 }), /overlaps unit "blue-1"/));
  it('allows units that touch edge to edge but not overlap', () => {
    const d = clone();
    const f = loadScenario(d).units[0]!.footprint.frontage / 1000;
    d.units[1].at = { x: 1850 + f, y: 2450 };
    d.units[1].frontage = f;
    d.units[1].depth = 7;
    d.units[0].frontage = f;
    expect(() => loadScenario(d)).not.toThrow();
  });
  it('rejects bad morale', () => bad((d) => (d.units[0].morale = 101), /morale must be between/));
  it('rejects non-integer strength', () =>
    bad((d) => (d.units[0].strength = 1.5), /strength must be an integer/));
  it('rejects a missing or non-numeric facing', () => {
    bad((d) => delete d.units[0].facingDeg, /facingDeg must be a finite number/);
    bad((d) => (d.units[0].facingDeg = 'UP'), /facingDeg must be a finite number/);
  });
  it('rejects an unknown formation', () =>
    bad((d) => (d.units[0].formation = 'blob'), /formation must be one of/));
  it('rejects unknown side on a unit', () =>
    bad((d) => (d.units[0].side = 'green'), /side must be one of/));
  it('rejects a side with no units', () =>
    bad((d) => d.units.forEach((u: any) => (u.side = 'blue')), /side "red" has no units/));
  it('rejects wrong number of sides', () => bad((d) => d.sides.pop(), /exactly two sides/));
  it('rejects an objective area that is not centred on a bridge', () =>
    bad(
      (d) =>
        (d.victory.objective = [
          [100, 100],
          [160, 100],
          [160, 160],
        ]),
      /centred on a bridge/,
    ));
  it('rejects an objective with fewer than three points', () =>
    bad(
      (d) =>
        (d.victory.objective = [
          [100, 100],
          [160, 100],
        ]),
      /at least 3 points/,
    ));
  it('rejects defender equal to attacker', () =>
    bad((d) => (d.victory.attacker = 'blue'), /must differ/));
  it('rejects a non-positive hold time', () =>
    bad((d) => (d.victory.holdMinutes = 0), /holdMinutes/));
  it('rejects a missing seed', () => bad((d) => delete d.seed, /seed must be an integer/));
});
