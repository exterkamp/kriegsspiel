import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  createElevationQueries,
  type Contour,
  type Elevation,
  type GenerationResult,
  type MapSettings,
  type Point,
} from '../src/index.js';
import { extractContours, validateContourHeights } from '../src/terrain/index.js';

function value<T>(r: GenerationResult<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  return r.value;
}
function fixture(columns: number, rows: number, samples: number[], interval = 1) {
  const elevation: Elevation = { columns, rows, spacingM: 25, samples };
  const bounds = {
    minX: 0 as const,
    minY: 0 as const,
    maxX: (columns - 1) * 25,
    maxY: (rows - 1) * 25,
  };
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.widthM = bounds.maxX;
  settings.heightM = bounds.maxY;
  settings.contours.minorIntervalM = interval;
  settings.contours.indexIntervalM = interval * 5;
  settings.contours.verticalToleranceM = 0.01;
  return { elevation, bounds, settings };
}
const at = (contours: Contour[], level: number) =>
  contours.filter((c) => Math.abs(c.elevationM - level) < 1e-12);

// Independent numerical oracle: split every exported segment at cell seams,
// obtain bilinear values using row-major corners, inspect quadratic extrema.
function maxInteriorError(e: Elevation, contours: Contour[]): number {
  const height = ([x, y]: Point) => {
    const cx = Math.min(e.columns - 2, Math.floor(x / e.spacingM)),
      cy = Math.min(e.rows - 2, Math.floor(y / e.spacingM));
    const u = x / e.spacingM - cx,
      v = y / e.spacingM - cy,
      i = cy * e.columns + cx;
    return (
      (1 - u) * (1 - v) * e.samples[i]! +
      u * (1 - v) * e.samples[i + 1]! +
      (1 - u) * v * e.samples[i + e.columns]! +
      u * v * e.samples[i + e.columns + 1]!
    );
  };
  let maximum = 0;
  for (const c of contours)
    for (let i = 1; i < c.path.length; i++) {
      const p = c.path[i - 1]!,
        q = c.path[i]!,
        cuts = [0, 1];
      const point = (t: number): Point => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      for (const axis of [0, 1] as const)
        if (p[axis] !== q[axis])
          for (let k = 1; k < (axis === 0 ? e.columns : e.rows) - 1; k++) {
            const t = (k * e.spacingM - p[axis]) / (q[axis] - p[axis]);
            if (t > 0 && t < 1) cuts.push(t);
          }
      cuts.sort((a, b) => a - b);
      for (let k = 1; k < cuts.length; k++) {
        const start = cuts[k - 1]!,
          end = cuts[k]!,
          f0 = height(point(start)) - c.elevationM,
          fm = height(point((start + end) / 2)) - c.elevationM,
          f1 = height(point(end)) - c.elevationM;
        const a = 2 * (f1 + f0 - 2 * fm),
          b = f1 - f0 - a,
          root = a ? -b / (2 * a) : -1;
        maximum = Math.max(
          maximum,
          Math.abs(f0),
          Math.abs(f1),
          root > 0 && root < 1 ? Math.abs(f0 + b * root + a * root ** 2) : 0,
        );
      }
    }
  return maximum;
}

describe('bilinear stitched analytical contours', () => {
  it('aligns a negative plane in metres with exact inclined height/slope and boundary endpoints', () => {
    const f = fixture(
      5,
      3,
      Array.from({ length: 15 }, (_, i) => -35 + 0.1 * (i % 5) * 25 + 0.2 * Math.floor(i / 5) * 25),
      5,
    );
    const contours = value(extractContours(f.elevation, f.bounds, f.settings));
    const queries = createElevationQueries(f);
    expect(queries.heightAt(37.5, 12.5)).toBe(-28.75);
    expect(queries.gradientAt(100, 50)).toEqual({ dx: 0.1, dy: 0.2 });
    expect(queries.slopeAt(25, 25)).toBeCloseTo(Math.sqrt(0.05), 14);
    for (const level of [-30, -25]) {
      const paths = at(contours, level);
      expect(paths).toHaveLength(1);
      const endpoints = [paths[0]!.path[0], paths[0]!.path.at(-1)];
      expect(endpoints).toContainEqual([0, (level + 35) / 0.2]);
      expect(endpoints).toContainEqual([(level + 35) / 0.1, 0]);
    }
    expect(maxInteriorError(f.elevation, contours)).toBeLessThan(1e-12);
  });
  it('produces no isolines on the flat 5m plateau including an exact-level field', () => {
    const f = fixture(3, 3, Array(9).fill(5) as number[]);
    expect(value(extractContours(f.elevation, f.bounds, f.settings))).toEqual([]);
  });
  it('stitches exact x-y grid nodes into one diagonal without zero-length events', () => {
    const f = fixture(
      3,
      3,
      Array.from({ length: 9 }, (_, i) => (i % 3) - Math.floor(i / 3)),
    );
    const paths = at(value(extractContours(f.elevation, f.bounds, f.settings)), 0);
    expect(paths).toHaveLength(1);
    expect(paths[0]!.path).toEqual([
      [0, 0],
      [25, 25],
      [50, 50],
    ]);
  });
  it('emits an exact grid-column edge once and stitches its row-major segments', () => {
    const f = fixture(3, 3, [-1, 0, 1, -1, 0, 1, -1, 0, 1]);
    const paths = at(value(extractContours(f.elevation, f.bounds, f.settings)), 0);
    expect(paths).toHaveLength(1);
    expect(paths[0]!.path).toEqual([
      [25, 0],
      [25, 25],
      [25, 50],
    ]);
  });
  it('keeps fractional repeated rows linear despite subtraction rounding', () => {
    const f = fixture(2, 2, [-1.1, 2.2, -1.1, 2.2]);
    const paths = at(value(extractContours(f.elevation, f.bounds, f.settings)), 0);
    expect(paths).toHaveLength(1);
    expect(paths[0]!.path).toHaveLength(2);
    expect(Math.abs(paths[0]!.path[0]![0] - 25 / 3)).toBeLessThanOrEqual(0.5e-6);
    expect(maxInteriorError(f.elevation, paths)).toBeLessThan(0.01);
  });
  it('emits a closed loop around a centre2/surround0 hill at level1', () => {
    const f = fixture(3, 3, [0, 0, 0, 0, 2, 0, 0, 0, 0]);
    const paths = at(value(extractContours(f.elevation, f.bounds, f.settings)), 1);
    expect(paths).toHaveLength(1);
    expect(paths[0]!.path[0]).toEqual(paths[0]!.path.at(-1));
    expect(paths[0]!.path.length).toBeGreaterThan(5);
    expect(maxInteriorError(f.elevation, paths)).toBeLessThanOrEqual(0.01);
  });
  it('enumerates negative/fractional levels once and flags index levels without duplication', () => {
    const f = fixture(2, 2, [-0.75, 0.75, -0.75, 0.75], 0.25);
    f.settings.contours.indexIntervalM = 0.5;
    const contours = value(extractContours(f.elevation, f.bounds, f.settings));
    expect(contours.map((c) => c.elevationM)).toEqual([-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75]);
    expect(contours.filter((c) => c.index).map((c) => c.elevationM)).toEqual([-0.5, 0, 0.5]);
    expect(new Set(contours.map((c) => c.id)).size).toBe(contours.length);
  });
  it.each([
    [
      [10, -4, -4, 1],
      ['NW', 'ES'],
    ],
    [
      [4, -10, -1, 4],
      ['NE', 'SW'],
    ],
  ])('uses the asymptotic determinant despite a misleading centre (%j)', (samples, expected) => {
    const f = fixture(2, 2, samples as number[]),
      paths = at(value(extractContours(f.elevation, f.bounds, f.settings)), 0);
    const side = ([x, y]: Point) => (y === 0 ? 'N' : x === 25 ? 'E' : y === 25 ? 'S' : 'W');
    const order = 'NESW';
    const pairs = paths
      .map((c) =>
        [side(c.path[0]!), side(c.path.at(-1)!)]
          .sort((a, b) => order.indexOf(a) - order.indexOf(b))
          .join(''),
      )
      .sort();
    expect(pairs).toEqual([...(expected as string[])].sort());
    expect(maxInteriorError(f.elevation, paths)).toBeLessThanOrEqual(0.01);
  });
  it('preserves four true branches at the exact symmetric saddle', () => {
    const f = fixture(2, 2, [1, -1, -1, 1]),
      paths = at(value(extractContours(f.elevation, f.bounds, f.settings)), 0);
    expect(paths).toHaveLength(4);
    for (const c of paths) expect([c.path[0], c.path.at(-1)]).toContainEqual([12.5, 12.5]);
    expect(
      paths.flatMap((c) =>
        c.path.filter((p) => p[0] === 0 || p[1] === 0 || p[0] === 25 || p[1] === 25),
      ),
    ).toHaveLength(4);
    expect(maxInteriorError(f.elevation, paths)).toBe(0);
  });
  it('preserves a T-junction on a zero edge without overlapping or missing the level edge', () => {
    const f = fixture(2, 2, [0, 0, -1, 1]),
      paths = at(value(extractContours(f.elevation, f.bounds, f.settings)), 0);
    expect(paths).toHaveLength(3);
    for (const c of paths) expect([c.path[0], c.path.at(-1)]).toContainEqual([12.5, 0]);
    expect(maxInteriorError(f.elevation, paths)).toBe(0);
  });
  it('partitions a shared zero edge at distinct branches from both adjacent cells', () => {
    const f = fixture(2, 3, [-1, 1, 0, 0, -3, 1]),
      paths = at(value(extractContours(f.elevation, f.bounds, f.settings)), 0);
    expect(paths).toHaveLength(5);
    for (const junction of [
      [12.5, 25],
      [18.75, 25],
    ])
      expect(
        paths.filter(
          (c) =>
            JSON.stringify(c.path[0]) === JSON.stringify(junction) ||
            JSON.stringify(c.path.at(-1)) === JSON.stringify(junction),
        ),
      ).toHaveLength(3);
    const horizontalLength = paths
      .filter((c) => c.path.every((p) => p[1] === 25))
      .reduce((sum, c) => sum + Math.abs(c.path[0]![0] - c.path.at(-1)![0]), 0);
    expect(horizontalLength).toBe(25);
    expect(maxInteriorError(f.elevation, paths)).toBe(0);
  });
  it('rejects the uv=.25 chord by its .140625m complete-interior error, then refines to .01m', () => {
    const f = fixture(2, 2, [0, 0, 0, 1], 0.25);
    const chord: Contour[] = [
      {
        id: 'contour:bad',
        elevationM: 0.25,
        index: false,
        path: [
          [6.25, 25],
          [25, 6.25],
        ],
      },
    ];
    expect(maxInteriorError(f.elevation, chord)).toBe(0.140625);
    expect(validateContourHeights(f.elevation, f.bounds, chord, f.settings)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'CONTOUR_HEIGHT_ERROR' }],
    });
    const contours = value(extractContours(f.elevation, f.bounds, f.settings));
    expect(at(contours, 0.25)[0]!.path.length).toBeGreaterThan(2);
    expect(maxInteriorError(f.elevation, contours)).toBeLessThanOrEqual(0.01);
    expect(
      value(validateContourHeights(f.elevation, f.bounds, contours, f.settings)).maxErrorM,
    ).toBeLessThanOrEqual(0.01);
  });
  it('checks a long imported chord across seams even if its overall midpoint is on-level', () => {
    const f = fixture(3, 2, [0, 1, 0, 0, 1, 0]);
    const chord: Contour[] = [
      {
        id: 'contour:bad',
        elevationM: 0.5,
        index: false,
        path: [
          [12.5, 0],
          [37.5, 25],
        ],
      },
    ];
    expect(validateContourHeights(f.elevation, f.bounds, chord, f.settings).ok).toBe(false);
  });
});

describe('all-or-nothing contour resource budgets', () => {
  it('rejects unnormalized authoritative ground instead of certifying against a different saved surface', () => {
    const f = fixture(2, 2, [0.00000049, 1.00000049, 0.00000049, 1.00000049], 0.5);
    f.settings.contours.verticalToleranceM = 1e-7;
    const original = [...f.elevation.samples];
    expect(() => extractContours(f.elevation, f.bounds, f.settings)).toThrow(
      /samples\[0\].*decimal-6-v1.*UNSUPPORTED_PRECISION/,
    );
    expect(() => validateContourHeights(f.elevation, f.bounds, [], f.settings)).toThrow(
      /UNSUPPORTED_PRECISION/,
    );
    expect(f.elevation.samples).toEqual(original);
    f.elevation.samples = f.elevation.samples.map((h) => Number(h.toFixed(6)));
    const contours = value(extractContours(f.elevation, f.bounds, f.settings));
    expect(at(contours, 0.5)[0]!.path).toEqual([
      [12.5, 0],
      [12.5, 25],
    ]);
    expect(maxInteriorError(f.elevation, contours)).toBe(0);
  });
  it('requires canonical-stable grid bounds and spacing without silently mutating metadata', () => {
    const f = fixture(2, 2, [0, 1, 0, 1]);
    f.bounds.maxX = f.bounds.maxY = f.elevation.spacingM = 25.00000049;
    f.settings.widthM = f.settings.heightM = f.settings.sampleSpacingM = 25.00000049;
    expect(() => extractContours(f.elevation, f.bounds, f.settings)).toThrow(
      /bounds.maxX.*UNSUPPORTED_PRECISION/,
    );
    expect(f.elevation.spacingM).toBe(25.00000049);
  });
  it('returns bounded precision infeasibility when distinct levels cannot survive canonical rounding', () => {
    const f = fixture(2, 2, [0, 0, 0, 0.000001], 0.0000001);
    expect(extractContours(f.elevation, f.bounds, f.settings)).toMatchObject({
      ok: false,
      diagnostics: [{ constraint: 'level precision' }],
    });
  });
  it.each([
    [
      'levels',
      (s: MapSettings) => {
        s.contours.minorIntervalM = 1e-12;
        s.contours.indexIntervalM = 5e-12;
      },
    ],
    [
      'cell-level work',
      (s: MapSettings) => {
        s.contours.maxCellLevelWork = 1;
      },
    ],
    [
      'refinement work',
      (s: MapSettings) => {
        s.contours.maxRefinementWork = 1;
      },
    ],
    [
      'vertices',
      (s: MapSettings) => {
        s.contours.maxVertices = 1;
      },
    ],
    [
      'features',
      (s: MapSettings) => {
        s.limits.maxFeatures = 1;
      },
    ],
    [
      'stitch work',
      (s: MapSettings) => {
        s.limits.maxTopologyChecks = 1;
      },
    ],
  ])('returns typed infeasibility for %s without truncated output', (_, edit) => {
    const f = fixture(2, 2, [0, 0, 0, 1], 0.25);
    edit(f.settings);
    const result = extractContours(f.elevation, f.bounds, f.settings);
    expect(result).toMatchObject({ ok: false, kind: 'infeasible' });
    expect(result).not.toHaveProperty('value');
  });
  it('accepts a 601×601 maximum flat field and rejects dense contour work before graph allocation', () => {
    const f = fixture(601, 601, Array(601 * 601).fill(5) as number[]);
    expect(value(extractContours(f.elevation, f.bounds, f.settings))).toEqual([]);
    f.elevation.samples[0] = 0;
    f.settings.contours.minorIntervalM = 0.01;
    f.settings.contours.indexIntervalM = 0.05;
    expect(extractContours(f.elevation, f.bounds, f.settings)).toMatchObject({
      ok: false,
      diagnostics: [{ constraint: 'levels' }],
    });
    f.settings.contours.maxLevels = 1024;
    expect(extractContours(f.elevation, f.bounds, f.settings)).toMatchObject({
      ok: false,
      diagnostics: [{ constraint: 'cell-level work' }],
    });
  });
  it('rejects invalid/nonfinite fields/settings with paths rather than reclassifying programmer errors', () => {
    const f = fixture(2, 2, [0, 0, 0, NaN]);
    expect(() => extractContours(f.elevation, f.bounds, f.settings)).toThrow(
      /samples\[3\].*finite/,
    );
    const g = fixture(2, 2, [0, 0, 0, 1]);
    g.settings.contours.minorIntervalM = 0;
    expect(() => extractContours(g.elevation, g.bounds, g.settings)).toThrow(/minorIntervalM/);
  });
});
