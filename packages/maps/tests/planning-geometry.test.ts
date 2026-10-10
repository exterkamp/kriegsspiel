import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  type GenerationResult,
  type Point,
  type Polygon,
  type Water,
} from '../src/contract.js';
import {
  certifyFootprint,
  certifyRoadSegment,
  directionalGrade,
  certifyBridge,
  validateRoadPath,
  type PlanningInput,
} from '../src/planning/index.js';
import { crossingCandidate } from '../src/geography/index.js';
function value<T>(r: GenerationResult<T>): T {
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.value;
}
const rect = (x0: number, y0: number, x1: number, y1: number): Polygon => ({
  outer: [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ],
  holes: [],
});
function input(
  size = 100,
  spacing = 25,
  field: (x: number, y: number) => number = () => 0,
): PlanningInput {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.widthM = settings.heightM = size;
  settings.sampleSpacingM = spacing;
  settings.roads.maxReservedWidthM = 8;
  settings.roads.minimumAbutmentM = 3;
  settings.hydrology.minRiverWidthM = 20;
  const columns = size / spacing + 1,
    samples: number[] = [];
  for (let y = 0; y < columns; y++)
    for (let x = 0; x < columns; x++) samples.push(field(x * spacing, y * spacing));
  return {
    settings,
    seed: 17,
    bounds: { minX: 0, minY: 0, maxX: size, maxY: size },
    elevation: { columns, rows: columns, spacingM: spacing, samples },
    water: [],
  };
}
const lake = (p: Polygon): Water => ({
  id: 'lake:oracle',
  kind: 'lake',
  polygons: [p],
  surfaceElevationM: 0,
});
function river(): Water {
  return {
    id: 'river:oracle',
    kind: 'river',
    polygons: [rect(90, 0, 110, 200)],
    centreline: [
      [100, 0],
      [100, 200],
    ],
    widthM: 20,
    surfacePolicy: 'standing-water-v1',
    surfaceProfileM: [0, 0],
  };
}
describe('independent complete geometry certificates', () => {
  it('finds interior raised-node gradients despite flat anchor and outer ring; a hole removes the steep part', () => {
    const a = input(200, 25, (x, y) => (x === 75 && y === 75 ? 5 : 0)),
      p = rect(20, 20, 180, 180);
    expect(value(certifyFootprint(a, p))).toMatchObject({ suitable: false, reason: 'gradient' });
    p.holes = [rect(40, 40, 110, 110).outer];
    expect(value(certifyFootprint(a, p)).suitable).toBe(true);
  });
  it('checks clipped cells when a steep corner is covered and the anchor is flat', () => {
    const a = input(100, 25, (x, y) => (x === 75 && y === 75 ? 5 : 0));
    expect(value(certifyFootprint(a, rect(20, 20, 76, 76))).maxGradient).toBeGreaterThan(0.08);
  });
  it('preserves dry-island holes and rejects thin edge-only water contact', () => {
    const a = input(),
      p = rect(0, 0, 100, 100);
    p.holes = [rect(20, 20, 80, 80).outer];
    a.water = [lake(p)];
    expect(value(certifyFootprint(a, rect(30, 30, 70, 70))).suitable).toBe(true);
    a.water = [lake(rect(59.999, 0, 60.001, 100))];
    expect(value(certifyRoadSegment(a, [20, 56], [80, 56]))).toMatchObject({
      traversable: false,
      reason: 'water',
    });
    expect(value(certifyFootprint(a, rect(20, 20, 60, 40)))).toMatchObject({
      suitable: false,
      reason: 'water',
    });
  });
  it('uses directional grade, not gradient magnitude, including a contour-following diagonal', () => {
    const a = input(100, 25, (x, y) => 0.2 * x - 0.2 * y);
    expect(value(directionalGrade(a, [25, 25], [75, 75]))).toBeCloseTo(0, 12);
    expect(value(certifyRoadSegment(a, [25, 25], [75, 75])).traversable).toBe(true);
    expect(value(certifyRoadSegment(a, [25, 50], [75, 50]))).toMatchObject({
      traversable: false,
      reason: 'grade',
    });
  });
  it('finds a bilinear interior hump with equal endpoint heights', () => {
    const a = input(25, 25);
    a.elevation.samples = [0, 5, 0, 0];
    expect(value(directionalGrade(a, [0, 0], [25, 25]))).toBeCloseTo(5 / (25 * Math.SQRT2), 12);
    const b = input(50, 25);
    b.elevation.samples = [0, 0, 0, 0, 5, 0, 0, 0, 0];
    expect(value(certifyRoadSegment(b, [12.5, 12.5], [37.5, 37.5], 2)).traversable).toBe(false);
  });
  it('revalidates smoothing corridors instead of trusting safe endpoint heights', () => {
    const a = input();
    a.water = [lake(rect(45, 45, 55, 55))];
    expect(
      validateRoadPath(a, [
        [20, 50],
        [20, 70],
        [80, 70],
        [80, 50],
      ]),
    ).toMatchObject({ ok: true });
    expect(
      validateRoadPath(a, [
        [20, 50],
        [80, 50],
      ]),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'ROAD_CORRIDOR' }] });
  });
  it('clips round caps only at an explicit normal boundary exit', () => {
    const a = input();
    expect(value(certifyRoadSegment(a, [25, 50], [0, 50])).traversable).toBe(false);
    expect(value(certifyRoadSegment(a, [25, 50], [0, 50], 8, 'west')).traversable).toBe(true);
    expect(value(certifyRoadSegment(a, [25, 51], [0, 50], 8, 'west')).traversable).toBe(false);
  });
  it('certifies linear decks above deep channels and rejects discontinuous/steep decks', () => {
    const a = input(200, 25, (x) => (x >= 75 && x <= 125 ? -20 : 5));
    a.water = [river()];
    // Endpoints are dry with complete 7m disks; ground at x82/118 is depressed,
    // so use a separate continuous field with a deep centre channel.
    a.elevation.samples = a.elevation.samples.map((_, i) => (i % 9 === 4 ? -20 : 10));
    const c = crossingCandidate(
      'bridge:oracle',
      'river:oracle',
      [
        [80, 100],
        [120, 100],
      ],
      a.settings,
    );
    const p = value(certifyBridge(a, c));
    expect(p.endpointHeightsM[0]).toBeGreaterThan(0);
    expect(certifyBridge(a, c, { ...p, endpointHeightsM: [10, 10] })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'BRIDGE_ABUTMENT_HEIGHT' }],
    });
    a.elevation.samples = a.elevation.samples.map((z, i) => z + (i % 9) * 5);
    expect(certifyBridge(a, c)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'BRIDGE_DECK_GRADE' }],
    });
  });
  it('rejects empty/nonfinite paths and malformed deck height tuples before arithmetic', () => {
    const a = input();
    for (const path of [
      [],
      [[NaN, NaN]],
      [
        [20, 20],
        [20, 20],
      ],
    ] as Point[][])
      expect(() => validateRoadPath(a, path)).toThrow();
    const b = input(200, 25, () => 10);
    b.water = [river()];
    const c = crossingCandidate(
        'bridge:oracle',
        'river:oracle',
        [
          [80, 100],
          [120, 100],
        ],
        b.settings,
      ),
      profile = value(certifyBridge(b, c));
    for (const heights of [[], [10], [10, 10, 10]])
      expect(
        certifyBridge(b, c, { ...profile, endpointHeightsM: heights as [number, number] }),
      ).toMatchObject({ ok: false, diagnostics: [{ code: 'BRIDGE_ABUTMENT_HEIGHT' }] });
  });
  it('retains off-deck water touching the larger dry endpoint disk', () => {
    const a = input(200, 25, () => 10);
    a.settings.roads.maxReservedWidthM = 12;
    a.water = [river(), lake(rect(76, 106, 80, 108))];
    const c = crossingCandidate(
      'bridge:oracle',
      'river:oracle',
      [
        [80, 100],
        [120, 100],
      ],
      a.settings,
    );
    expect(certifyBridge(a, c)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'BRIDGE_GEOMETRY' }],
    });
  });
  it('rejects wet cap/confluence/inside-hole and too-narrow crossings', () => {
    const a = input(200, 25, () => 10);
    a.water = [river()];
    for (const endpoints of [
      [
        [83, 100],
        [117, 100],
      ],
      [
        [80, 3],
        [120, 3],
      ],
    ] as [Point, Point][])
      expect(
        certifyBridge(a, crossingCandidate('bridge:bad', 'river:oracle', endpoints, a.settings)),
      ).toMatchObject({ ok: false });
    a.water.push(lake(rect(98, 101, 102, 105)));
    expect(
      certifyBridge(
        a,
        crossingCandidate(
          'bridge:bad',
          'river:oracle',
          [
            [80, 100],
            [120, 100],
          ],
          a.settings,
        ),
      ),
    ).toMatchObject({ ok: false });
  });
  it('reserves sample snapshots and finite queries before numerical work', () => {
    const a = input();
    a.limits = { maxValidationWork: 1 };
    expect(certifyFootprint(a, rect(20, 20, 40, 40))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'PLANNING_RESOURCE_LIMIT' }],
    });
    a.limits = undefined;
    expect(() => directionalGrade(a, [NaN, 0], [25, 25])).toThrow();
  });
});
