import { describe, expect, it } from 'vitest';
import {
  createElevationQueries,
  createReferenceAsset,
  deriveSeed,
  localToWorld,
  worldToLocal,
} from '../src/index.js';

describe('bilinear numerical oracles', () => {
  it('matches h=100+.03x-.07y at corners, interiors, seams and maximum bounds', () => {
    const q = createElevationQueries(createReferenceAsset());
    for (const [x, y] of [
      [0, 0],
      [150, 150],
      [150, 0],
      [25, 75],
      [12.5, 6.25],
      [49.999, 50.001],
      [149.999, 150],
    ]) {
      expect(q.heightAt(x!, y!)).toBeCloseTo(100 + 0.03 * x! - 0.07 * y!, 11);
      expect(q.gradientAt(x!, y!).dx).toBeCloseTo(0.03, 12);
      expect(q.gradientAt(x!, y!).dy).toBeCloseTo(-0.07, 12);
      expect(q.slopeAt(x!, y!)).toBeCloseTo(Math.hypot(0.03, 0.07), 12);
    }
  });
  it('matches the independent mixed-term row-major oracle', () => {
    const q = createElevationQueries({
      bounds: { minX: 0, minY: 0, maxX: 25, maxY: 25 },
      elevation: { columns: 2, rows: 2, spacingM: 25, samples: [2, 6, 10, 18] },
    });
    expect(q.heightAt(12.5, 6.25)).toBe(6.5);
    expect(q.gradientAt(12.5, 6.25)).toEqual({ dx: 0.2, dy: 0.4 });
    expect(q.heightAt(25, 25)).toBe(18);
    expect(q.gradientAt(25, 25)).toEqual({ dx: 0.32, dy: 0.48 });
  });
  it('chooses east/south cell at seams and the last cell at exact maximum', () => {
    const q = createElevationQueries({
      bounds: { minX: 0, minY: 0, maxX: 50, maxY: 25 },
      elevation: { columns: 3, rows: 2, spacingM: 25, samples: [0, 25, 75, 0, 25, 75] },
    });
    expect(q.heightAt(25, 10)).toBe(25);
    expect(q.gradientAt(25, 10)).toEqual({ dx: 2, dy: 0 });
    expect(q.gradientAt(25 - 1e-8, 10).dx).toBe(1);
    expect(q.gradientAt(50, 25)).toEqual({ dx: 2, dy: 0 });
  });
  it('rejects out-of-range/nonfinite queries, has explicit clamping and snapshots input', () => {
    const a = createReferenceAsset(),
      q = createElevationQueries(a),
      clamp = createElevationQueries(a, 'clamp');
    expect(() => q.heightAt(-0.01, 0)).toThrow(RangeError);
    expect(() => q.heightAt(150.01, 0)).toThrow(RangeError);
    expect(() => clamp.heightAt(Infinity, 0)).toThrow(RangeError);
    expect(() => q.gradientAt(1, NaN)).toThrow(RangeError);
    expect(clamp.heightAt(-100, 500)).toBeCloseTo(89.5, 12);
    a.elevation.samples[0] = 999;
    expect(q.heightAt(0, 0)).toBe(100);
  });
  it('checks dimensions/counts/finite samples before query storage allocation', () => {
    const a = createReferenceAsset();
    a.elevation.columns = 400_000;
    expect(() => createElevationQueries(a)).toThrow(/RESOURCE_LIMIT/);
    const b = createReferenceAsset();
    b.elevation.samples[4] = NaN;
    expect(() => createElevationQueries(b)).toThrow(/samples\[4\]/);
  });
  it('uses asymmetric rotated metres and independent stable stage seed streams', () => {
    expect(localToWorld([137, -241], [3456, 1234], 90)).toEqual([3697, 1371]);
    const local = worldToLocal([3697, 1371], [3456, 1234], 90);
    expect(local[0]).toBeCloseTo(137, 10);
    expect(local[1]).toBeCloseTo(-241, 10);
    const terrain = deriveSeed(7, 'terrain:v1');
    deriveSeed(7, 'contours:v2');
    expect(deriveSeed(7, 'terrain:v1')).toBe(terrain);
    expect(deriveSeed(7, 'contours:v1')).not.toBe(terrain);
    expect(deriveSeed(7, 'settlements:v1', 'site:village:0000')).not.toBe(
      deriveSeed(7, 'settlements:v1', 'site:village:0001'),
    );
  });
});
