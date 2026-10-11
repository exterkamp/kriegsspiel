import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type GenerationResult, type Water } from '../src/contract.js';
import { createGeographyQueries } from '../src/geography/index.js';
function value<T>(r: GenerationResult<T>): T {
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.value;
}
const bounds = { minX: 0 as const, minY: 0 as const, maxX: 100, maxY: 100 };
function fixture() {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.widthM = s.heightM = 100;
  const samples: number[] = [];
  for (let y = 0; y <= 100; y += 25)
    for (let x = 0; x <= 100; x += 25) samples.push(Number((100 + 0.03 * x - 0.07 * y).toFixed(6)));
  const elevation = { columns: 5, rows: 5, spacingM: 25, samples };
  const water: Water[] = [
    {
      id: 'lake:hole',
      kind: 'lake',
      surfaceElevationM: 105,
      polygons: [
        {
          outer: [
            [10, 10],
            [90, 10],
            [90, 90],
            [10, 90],
            [10, 10],
          ],
          holes: [
            [
              [40, 40],
              [60, 40],
              [60, 60],
              [40, 60],
              [40, 40],
            ],
          ],
        },
      ],
    },
  ];
  return { s, elevation, water };
}
describe('bounded geography suitability query seam', () => {
  it('delegates authoritative bilinear plane height and gradients including exact maximum bounds', () => {
    const { s, elevation, water } = fixture(),
      q = value(createGeographyQueries(elevation, bounds, water, s));
    expect(q.heightAt(12.5, 6.25)).toBeCloseTo(100 + 0.03 * 12.5 - 0.07 * 6.25, 12);
    expect(q.gradientAt(100, 100)).toEqual({ dx: 0.03, dy: -0.07 });
    expect(q.slopeAt(25, 25)).toBeCloseTo(Math.hypot(0.03, 0.07), 12);
  });
  it('preserves dry holes and checks full closed disks, bounds and water boundary contact', () => {
    const { s, elevation, water } = fixture(),
      q = value(createGeographyQueries(elevation, bounds, water, s));
    expect(value(q.waterAt(50, 50))).toEqual([]);
    expect(value(q.waterAt(20, 20))).toEqual(['lake:hole']);
    expect(value(q.waterAt(40, 50))).toEqual(['lake:hole']);
    expect(value(q.isDry(50, 50, 9))).toBe(true);
    expect(value(q.isDry(50, 50, 10))).toBe(false);
    expect(value(q.isDry(5, 5, 6))).toBe(false);
  });
  it('snapshots input data and preserves invalid query errors', () => {
    const { s, elevation, water } = fixture(),
      q = value(createGeographyQueries(elevation, bounds, water, s));
    const before = q.heightAt(50, 50);
    elevation.samples.fill(0);
    water[0]!.polygons[0]!.holes = [];
    expect(q.heightAt(50, 50)).toBe(before);
    expect(value(q.isDry(50, 50))).toBe(true);
    expect(() => q.heightAt(NaN, 0)).toThrow();
    expect(() => q.waterAt(101, 0)).toThrow();
    expect(() => q.isDry(50, 50, Infinity)).toThrow(RangeError);
  });
  it('snapshots bounds for dry disks through caller enlargement and shrinkage', () => {
    const { s, elevation } = fixture(),
      mutableBounds = { ...bounds },
      q = value(createGeographyQueries(elevation, mutableBounds, [], s));
    expect(value(q.isDry(98, 10, 5))).toBe(false);
    expect(value(q.isDry(90, 10, 5))).toBe(true);
    mutableBounds.maxX = mutableBounds.maxY = 200;
    expect(value(q.isDry(98, 10, 5))).toBe(false);
    mutableBounds.maxX = mutableBounds.maxY = 80;
    expect(value(q.isDry(90, 10, 5))).toBe(true);
    expect(q.heightAt(100, 100)).toBe(96);
  });
  it('charges ground and water snapshots before creating queries', () => {
    const { s, elevation, water } = fixture();
    expect(
      createGeographyQueries(elevation, bounds, water, s, { maxPhysicsWork: 24 }),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'GEOGRAPHY_RESOURCE_LIMIT' }] });
  });
});
