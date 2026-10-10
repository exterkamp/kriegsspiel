import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type MapSettings, type Polygon, type Water } from '../src/contract.js';
import {
  crossingCandidate,
  findCrossingCandidates,
  validateCrossingCandidate,
  validateCrossingCandidateMetered,
} from '../src/geography/index.js';
import { Budget } from '../src/geography/budget.js';
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
const bounds = { minX: 0 as const, minY: 0 as const, maxX: 200, maxY: 200 };
function settings(): MapSettings {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.widthM = s.heightM = 200;
  return s;
}
function river(polygons = [rect(90, 20, 110, 180)]): Water {
  return {
    id: 'river:straight',
    kind: 'river',
    polygons,
    centreline: [
      [100, 20],
      [100, 180],
    ],
    widthM: 20,
    surfacePolicy: 'standing-water-v1',
    surfaceProfileM: [5, 5],
  };
}
describe('buffered crossing candidates without final road links', () => {
  it('charges repeated candidate validation against one shared budget', () => {
    const s = settings(),
      water = [river()];
    const candidate = crossingCandidate(
      'metered',
      water[0]!.id,
      [
        [80, 100],
        [120, 100],
      ],
      s,
    );
    const measured = new Budget(s.limits.maxTopologyChecks, 'shared crossing work');
    expect(validateCrossingCandidateMetered(candidate, water, bounds, s, measured).ok).toBe(true);
    expect(measured.used).toBeGreaterThan(0);
    const exact = new Budget(measured.used, 'shared crossing work');
    expect(validateCrossingCandidateMetered(candidate, water, bounds, s, exact).ok).toBe(true);
    expect(validateCrossingCandidateMetered(candidate, water, bounds, s, exact)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'GEOGRAPHY_RESOURCE_LIMIT' }],
    });
    expect(exact.used).toBe(measured.used);
    const rejected = new Budget(measured.used * 2, 'rejected candidate work');
    const invalid = { ...candidate, widthM: candidate.widthM + 1 };
    expect(validateCrossingCandidateMetered(invalid, water, bounds, s, rejected)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'CROSSING_DIMENSIONS' }],
    });
    expect(rejected.used).toBeGreaterThan(0);
    const before = rejected.used;
    validateCrossingCandidateMetered(invalid, water, bounds, s, rejected);
    expect(rejected.used).toBeGreaterThan(before);
  });
  it('requires full 8m reserved width and dry endpoint disks of radius 7m', () => {
    const s = settings();
    s.roads.maxReservedWidthM = 8;
    const water = [river()];
    const valid = crossingCandidate(
      'crossing:good',
      water[0]!.id,
      [
        [82.999999, 100],
        [117.000001, 100],
      ],
      s,
    );
    expect(validateCrossingCandidate(valid, water, bounds, s)).toMatchObject({ ok: true });
    const wet = crossingCandidate(
      'crossing:wet',
      water[0]!.id,
      [
        [84, 100],
        [116, 100],
      ],
      s,
    );
    expect(validateCrossingCandidate(wet, water, bounds, s)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'WET_ABUTMENT' }],
    });
    valid.widthM = 4;
    expect(validateCrossingCandidate(valid, water, bounds, s)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'CROSSING_DIMENSIONS' }],
    });
  });
  it('rejects exact closed-disk tangency while accepting one micrometre clearance', () => {
    const s = settings(),
      water = [river()];
    expect(
      validateCrossingCandidate(
        crossingCandidate(
          'tangent',
          water[0]!.id,
          [
            [81, 100],
            [119, 100],
          ],
          s,
        ),
        water,
        bounds,
        s,
      ),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'WET_ABUTMENT' }] });
    expect(
      validateCrossingCandidate(
        crossingCandidate(
          'clear',
          water[0]!.id,
          [
            [80.999999, 100],
            [119.000001, 100],
          ],
          s,
        ),
        water,
        bounds,
        s,
      ),
    ).toMatchObject({ ok: true });
    const found = findCrossingCandidates(water, bounds, s);
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.value.length).toBeGreaterThan(0);
      for (const c of found.value)
        expect(validateCrossingCandidate(c, water, bounds, s)).toMatchObject({ ok: true });
      expect(Math.min(...found.value[0]!.endpoints.map((p) => p[0]))).toBeLessThan(81);
    }
  });
  it('rejects an interior dry hole missed by centre and both corridor side traces', () => {
    const s = settings(),
      p = rect(90, 20, 110, 180);
    p.holes = [rect(98, 102, 102, 104).outer];
    const water = [river([p])];
    const c = crossingCandidate(
      'hole',
      water[0]!.id,
      [
        [80, 100],
        [120, 100],
      ],
      s,
    );
    expect(validateCrossingCandidate(c, water, bounds, s)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'CROSSING_HOLE' }],
    });
  });
  it('rejects an outer-bank notch hidden between the centre and side traces', () => {
    const s = settings(),
      p: Polygon = {
        outer: [
          [90, 20],
          [110, 20],
          [110, 102],
          [105, 102],
          [105, 104],
          [110, 104],
          [110, 180],
          [90, 180],
          [90, 20],
        ],
        holes: [],
      },
      water = [river([p])];
    expect(
      validateCrossingCandidate(
        crossingCandidate(
          'notch',
          water[0]!.id,
          [
            [80, 100],
            [120, 100],
          ],
          s,
        ),
        water,
        bounds,
        s,
      ),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'CROSSING_BEND' }] });
  });
  it('rejects orphan/non-river identity, displaced spans, narrow reaches and excess spans', () => {
    const s = settings(),
      water = [river()],
      c = crossingCandidate(
        'good',
        water[0]!.id,
        [
          [80, 100],
          [120, 100],
        ],
        s,
      );
    expect(validateCrossingCandidate({ ...c, waterId: 'missing' }, water, bounds, s)).toMatchObject(
      { ok: false, diagnostics: [{ code: 'CROSSING_WATER' }] },
    );
    expect(
      validateCrossingCandidate(
        c,
        [{ id: c.waterId, kind: 'lake', surfaceElevationM: 5, polygons: [rect(90, 20, 110, 180)] }],
        bounds,
        s,
      ),
    ).toMatchObject({ ok: false });
    expect(validateCrossingCandidate({ ...c, spanM: 1 }, water, bounds, s)).toMatchObject({
      ok: false,
    });
    s.hydrology.minRiverWidthM = 25;
    expect(validateCrossingCandidate(c, water, bounds, s)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'CROSSING_NARROW' }],
    });
    s.hydrology.minRiverWidthM = 4;
    s.roads.maxCrossingSpanM = 30;
    expect(validateCrossingCandidate(c, water, bounds, s)).toMatchObject({ ok: false });
  });
  it('rejects oblique insufficient abutments, bends/wet caps, confluences and bounds', () => {
    const s = settings(),
      water = [river()];
    expect(
      validateCrossingCandidate(
        crossingCandidate(
          'oblique',
          water[0]!.id,
          [
            [85, 90],
            [115, 110],
          ],
          s,
        ),
        water,
        bounds,
        s,
      ),
    ).toMatchObject({ ok: false });
    expect(
      validateCrossingCandidate(
        crossingCandidate(
          'cap',
          water[0]!.id,
          [
            [80, 22],
            [120, 22],
          ],
          s,
        ),
        water,
        bounds,
        s,
      ),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'CROSSING_BEND' }] });
    const confluent = [
      river(),
      {
        id: 'lake:confluence',
        kind: 'lake' as const,
        surfaceElevationM: 5,
        polygons: [rect(85, 96, 115, 104)],
      },
    ];
    expect(
      validateCrossingCandidate(
        crossingCandidate(
          'confluence',
          water[0]!.id,
          [
            [75, 100],
            [125, 100],
          ],
          s,
        ),
        confluent,
        bounds,
        s,
      ),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'CROSSING_CONFLUENCE' }] });
    expect(
      validateCrossingCandidate(
        crossingCandidate(
          'bounds',
          water[0]!.id,
          [
            [80, 5],
            [120, 5],
          ],
          s,
        ),
        water,
        bounds,
        s,
      ),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'CROSSING_BOUNDS' }] });
  });
  it('fails deterministic search budgets without partial candidates and preserves invalid input errors', () => {
    const s = settings(),
      water = [river()];
    expect(findCrossingCandidates(water, bounds, s, { maxCrossingWork: 1 })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'GEOGRAPHY_RESOURCE_LIMIT' }],
    });
    const c = crossingCandidate(
      'good',
      water[0]!.id,
      [
        [80, 100],
        [120, 100],
      ],
      s,
    );
    c.endpoints[0][0] = Infinity;
    expect(() => validateCrossingCandidate(c, water, bounds, s)).toThrow(/finite/);
    expect(() =>
      validateCrossingCandidate({ ...c, kind: 'ford' as 'bridge' }, water, bounds, s),
    ).toThrow();
  });
});
