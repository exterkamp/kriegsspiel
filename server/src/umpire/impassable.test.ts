import {
  FORMATIONS,
  distPointSegment,
  holdTheBridge,
  loadScenario,
  mm,
  pointInPolygon,
  proposedArrangement,
  terrainAt,
  type TerrainMap,
} from '@kriegsspiel/engine';
import { describe, expect, it } from 'vitest';
import { TURN_CASES } from './eval/turnCases.js';
import { turnInput } from './eval/turnInput.js';
import { footprintsInput } from './adjudicate.js';
import { CROSSING_MAX_POINTS, impassableInput } from './impassable.js';

const world = loadScenario(holdTheBridge);
const at = (x: number, y: number) => ({ x: mm(x), y: mm(y) });
const passable = (map: TerrainMap, x: number, y: number) =>
  terrainAt(map, at(x, y))?.attrs.passable === true;

describe("the umpire's impassable ground (#535)", () => {
  const [river, ...rest] = impassableInput(world.map);

  it('gives the river its banks and the bridge as the ground over it a unit may stand on', () => {
    expect(rest).toEqual([]);
    expect(river).toMatchObject({
      id: 'river',
      banks: {
        north: [
          [0, 1400],
          [4000, 1400],
        ],
        south: [
          [0, 1600],
          [4000, 1600],
        ],
      },
    });
    const crossings = (river as { crossings: { id: string; area: [number, number][] }[] })
      .crossings;
    expect(crossings.map((c) => c.id)).toEqual(['bridge']);
    const area = crossings[0]!.area;
    expect(area.length).toBeGreaterThanOrEqual(4);
    expect(area.length).toBeLessThanOrEqual(CROSSING_MAX_POINTS);
    // Every corner is on the bridge and over the water.
    for (const [x, y] of area) {
      expect(passable(world.map, x, y), `${x},${y}`).toBe(true);
      expect(y).toBeGreaterThanOrEqual(1400);
      expect(y).toBeLessThanOrEqual(1600);
    }
    // It spans the river from bank to bank, and stays inside the bridge's 110 m.
    const ys = area.map(([, y]) => y);
    expect(Math.min(...ys)).toBe(1400);
    expect(Math.max(...ys)).toBe(1600);
    const xs = area.map(([x]) => x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(1940);
    expect(Math.max(...xs)).toBeLessThanOrEqual(2160);
  });

  it("leaves out the playtest's river placements beside the bridge, which the engine refused", () => {
    const area = (river as { crossings: { area: [number, number][] }[] }).crossings[0]!.area.map(
      ([x, y]) => ({ x, y }),
    );
    // First replies of #408 that failed the march check (`docs/turn-playtest.md`).
    for (const [x, y] of [
      [2160, 1565],
      [2130, 1590],
      [2130, 1410],
      [2110, 1400],
    ] as const) {
      expect(passable(world.map, x, y), `${x},${y}`).toBe(false);
      expect(pointInPolygon({ x, y }, area), `${x},${y}`).toBe(false);
    }
  });

  it('offsets a bent river by half its width at each corner, and names a north-south one west and east', () => {
    const map: TerrainMap = {
      width: mm(2000),
      height: mm(2000),
      features: [
        {
          id: 'brook',
          kind: 'river',
          layer: 3,
          geometry: {
            shape: 'polyline',
            points: [at(1000, 0), at(1000, 1000), at(2000, 2000)],
            width: mm(40),
          },
          attrs: { moveCost: 1, cover: 0, concealment: 0, height: 'low', passable: false },
        },
      ],
    };
    const brook = impassableInput(map)[0] as { banks: Record<string, [number, number][]> };
    expect(Object.keys(brook.banks).sort()).toEqual(['east', 'west']);
    for (const bank of Object.values(brook.banks)) {
      // Each bank point is 20 m from the centre line; on the outside of the bend the mitre's
      // corner is a little further than the water's rounded edge (it errs toward the water).
      for (const [x, y] of bank) {
        const d = Math.min(
          distPointSegment(at(x, y), at(1000, 0), at(1000, 1000)),
          distPointSegment(at(x, y), at(1000, 1000), at(2000, 2000)),
        );
        expect(d / 1000, `${x},${y}`).toBeGreaterThanOrEqual(19.5);
        expect(d / 1000, `${x},${y}`).toBeLessThanOrEqual(22);
      }
    }
    expect(brook.banks.west![0]).toEqual([980, 0]);
    expect(brook.banks.east![0]).toEqual([1020, 0]);
  });
});

describe("each unit's footprints in the umpire's input (#535)", () => {
  it('are what the validator gives the unit in each formation', () => {
    for (const u of world.units) {
      const shown = footprintsInput(u);
      expect(Object.keys(shown)).toEqual([...FORMATIONS]);
      for (const f of FORMATIONS) {
        const want = proposedArrangement(u, { center: u.center, formation: f });
        if (!('wanted' in want)) throw new Error('no arrangement');
        const fp = want.wanted.footprint;
        expect(shown[f]).toEqual([Math.round(fp.frontage / 1000), Math.round(fp.depth / 1000)]);
      }
    }
  });

  it('come with the impassable ground in every benchmark input, at a modest size', () => {
    for (const c of TURN_CASES) {
      const input = turnInput(c);
      expect(input.map.impassable).toEqual(impassableInput(world.map));
      for (const u of input.units) expect(u.footprintM.line).toHaveLength(2);
      const added =
        JSON.stringify(input.map.impassable).length +
        input.units.reduce((n, u) => n + JSON.stringify(u.footprintM).length + 15, 0);
      // About a thousand characters (some 300 tokens) on a turn input of about 10,000.
      expect(added, c.id).toBeLessThan(1200);
    }
  });
});
