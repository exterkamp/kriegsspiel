import type { Drainage, Elevation, MapSettings, Water } from '../contract.js';
import { decimal6 } from '../terrain/precision.js';
import { Budget, GeographyFailure } from './budget.js';
import { cellRegions } from './regions.js';
import type { ShoulderEvidence } from './shoulders.js';

export interface WaterConstruction {
  elevation: Elevation;
  water: Water[];
  groundChanged: boolean;
  riverCells?: Uint8Array;
  grading?: ShoulderEvidence;
}
/** Basin cores consist of complete cells supported by a single filled spill level. */
export function depressionWater(
  elevation: Elevation,
  drainage: Drainage,
  s: MapSettings,
  budget: Budget,
  excluded?: Uint8Array,
  output?: Budget,
): Water[] {
  const w = elevation.columns - 1,
    h = elevation.rows - 1,
    n = w * h;
  budget.take(n * 6);
  const levels = new Map<number, number[]>();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (excluded?.[y * w + x]) continue;
      const i = y * elevation.columns + x,
        indices = [i, i + 1, i + elevation.columns, i + elevation.columns + 1],
        level = drainage.filledSamples[i]!;
      if (
        !indices.every(
          (j) => drainage.filledSamples[j] === level && elevation.samples[j]! <= level,
        ) ||
        !indices.some((j) => elevation.samples[j]! < level)
      )
        continue;
      const key = y * w + x,
        list = levels.get(level);
      if (list) list.push(key);
      else levels.set(level, [key]);
    }
  const water: Water[] = [];
  for (const [level, cells] of [...levels].sort(([a], [b]) => a - b)) {
    budget.take(cells.length);
    let left = w,
      right = 0,
      top = h,
      bottom = 0;
    for (const i of cells) {
      const x = i % w,
        y = Math.floor(i / w);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    const cw = right - left + 1,
      ch = bottom - top + 1;
    budget.take(cw * ch);
    const mask = new Uint8Array(cw * ch);
    for (const i of cells) mask[(Math.floor(i / w) - top) * cw + (i % w) - left] = 1;
    const local = { ...elevation, columns: cw + 1, rows: ch + 1 };
    for (const r of cellRegions(mask, local, budget, s.limits.maxVertices, output, true, [
      left * elevation.spacingM,
      top * elevation.spacingM,
    ])) {
      if (water.length >= s.limits.maxFeatures)
        throw new GeographyFailure(
          'GEOGRAPHY_RESOURCE_LIMIT',
          'water features',
          'Water feature cap exceeded.',
        );
      water.push({
        id: `water:lake:${water.length.toString().padStart(6, '0')}`,
        kind: 'lake',
        surfaceElevationM: level,
        polygons: [r.polygon],
      });
    }
  }
  return water;
}
/** Explicit diagnostic/preset primitive: conservative wet cells at a declared level. */
export function lakeCellsAtLevel(
  elevation: Elevation,
  level: number,
  budget: Budget,
  maxVertices: number,
) {
  if (!Number.isFinite(level) || decimal6(level) !== level)
    throw new RangeError('Lake level must be finite decimal6');
  const w = elevation.columns - 1,
    h = elevation.rows - 1;
  budget.take(w * h * 5);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * elevation.columns + x,
        heights = [i, i + 1, i + elevation.columns, i + elevation.columns + 1].map(
          (j) => elevation.samples[j]!,
        );
      if (heights.every((v) => v <= level) && heights.some((v) => v < level)) mask[y * w + x] = 1;
    }
  return cellRegions(mask, elevation, budget, maxVertices).map((r) => r.polygon);
}
