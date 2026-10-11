import { HARD_LIMITS, type Bounds, type Elevation, type MapAsset } from './contract.js';
import { fail } from './errors.js';

export function validateElevationShape(
  elevation: Elevation,
  bounds: Bounds,
  maxSamples: number = HARD_LIMITS.maxSamples,
): void {
  const { columns, rows, spacingM, samples } = elevation;
  if (
    ![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, columns, rows, spacingM].every(
      Number.isFinite,
    )
  )
    fail('$.elevation', 'Bounds, dimensions and spacing must be finite');
  if (
    bounds.minX !== 0 ||
    bounds.minY !== 0 ||
    bounds.maxX <= 0 ||
    bounds.maxY <= 0 ||
    bounds.maxX > 15_000 ||
    bounds.maxY > 15_000
  )
    fail('$.bounds', 'Expected positive local bounds starting at (0,0), at most 15000 m');
  if (
    !Number.isInteger(columns) ||
    !Number.isInteger(rows) ||
    columns < 2 ||
    rows < 2 ||
    spacingM < 0.001
  )
    fail('$.elevation', 'Expected integral dimensions >=2 and positive spacing >=.001 m');
  if (!Number.isSafeInteger(columns * rows) || columns * rows > maxSamples)
    fail('$.elevation', `Sample count exceeds ${maxSamples}`, 'RESOURCE_LIMIT');
  if (samples.length !== columns * rows)
    fail('$.elevation.samples', 'Row-major sample count must equal columns × rows');
  if (
    Math.abs((columns - 1) * spacingM - bounds.maxX) > 1e-8 ||
    Math.abs((rows - 1) * spacingM - bounds.maxY) > 1e-8
  )
    fail('$.elevation.spacingM', 'Grid must cover the exact bounds including the last row/column');
  for (let i = 0; i < samples.length; i++)
    if (!Number.isFinite(samples[i]) || Math.abs(samples[i]!) > 100_000)
      fail(`$.elevation.samples[${i}]`, 'Height must be finite and within ±100000 m');
}

export interface ElevationQueries {
  heightAt(x: number, y: number): number;
  gradientAt(x: number, y: number): { dx: number; dy: number };
  slopeAt(x: number, y: number): number;
}
export function createElevationQueries(
  input: Pick<MapAsset, 'bounds' | 'elevation'>,
  boundary: 'error' | 'clamp' = 'error',
): ElevationQueries {
  if (!['error', 'clamp'].includes(boundary)) throw new TypeError('Unknown query boundary policy');
  validateElevationShape(input.elevation, input.bounds);
  const { columns, rows, spacingM } = input.elevation;
  const maxX = input.bounds.maxX,
    maxY = input.bounds.maxY;
  // Validate all sizes/numbers before allocating, then snapshot caller data.
  const samples = new Float64Array(input.elevation.samples);
  const cell = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y))
      throw new RangeError('Height query coordinates must be finite');
    if (boundary === 'error' && (x < 0 || y < 0 || x > maxX || y > maxY))
      throw new RangeError(`Height query (${x},${y}) is outside [0,${maxX}] × [0,${maxY}]`);
    x = Math.max(0, Math.min(maxX, x));
    y = Math.max(0, Math.min(maxY, y));
    // Normalize binary64 representations of exact decimal grid nodes. Inside
    // this 8-ulp quotient band the east/south cell owns the derivative.
    const quotient = (coordinate: number) => {
      const q = coordinate / spacingM,
        nearest = Math.round(q);
      return Math.abs(q - nearest) <= 8 * Number.EPSILON * Math.max(1, Math.abs(q)) ? nearest : q;
    };
    const qx = quotient(x),
      qy = quotient(y);
    const cx = Math.min(columns - 2, Math.floor(qx)),
      cy = Math.min(rows - 2, Math.floor(qy));
    const tx = qx - cx,
      ty = qy - cy;
    const offset = cy * columns + cx;
    return {
      tx,
      ty,
      a: samples[offset]!,
      b: samples[offset + 1]!,
      c: samples[offset + columns]!,
      d: samples[offset + columns + 1]!,
    };
  };
  const gradientAt = (x: number, y: number) => {
    const { tx, ty, a, b, c, d } = cell(x, y);
    return {
      dx: ((b - a) * (1 - ty) + (d - c) * ty) / spacingM,
      dy: ((c - a) * (1 - tx) + (d - b) * tx) / spacingM,
    };
  };
  return {
    heightAt(x, y) {
      const { tx, ty, a, b, c, d } = cell(x, y);
      return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
    },
    gradientAt,
    slopeAt(x, y) {
      const { dx, dy } = gradientAt(x, y);
      return Math.hypot(dx, dy);
    },
  };
}
