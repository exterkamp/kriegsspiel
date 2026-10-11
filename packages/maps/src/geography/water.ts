import type { Bounds, Drainage, Elevation, MapSettings, Point, Water } from '../contract.js';
import { pointSegmentDistance, polygonLocation } from '../geometry.js';
import { decimal6 } from '../terrain/precision.js';
import { Budget, GeographyFailure } from './budget.js';
import { cellRegions } from './regions.js';
import { gradeShoulders, shoulderPolicy, type ShoulderEvidence } from './shoulders.js';

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
/** Carve a single accumulation-derived trunk, then represent explicit constant standing stage. */
export function carveRiver(
  elevation: Elevation,
  bounds: Bounds,
  drainage: Drainage,
  ranks: number[],
  s: MapSettings,
  budget: Budget,
  output?: Budget,
): WaterConstruction | undefined {
  const n = elevation.samples.length,
    c = elevation.columns,
    d = elevation.spacingM;
  // Grid-aligned bank nodes and at least one submerged interior row need 4 spacings.
  if (s.hydrology.maxRiverWidthM < 4 * d) return;
  let minimum = Infinity,
    maximum = -Infinity;
  for (const v of elevation.samples) {
    minimum = Math.min(minimum, v);
    maximum = Math.max(maximum, v);
  }
  if (maximum - minimum <= 1e-6) return;
  budget.take(3 * n);
  const order = new Int32Array(n),
    length = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[ranks[i]!] = i;
  let start = -1,
    best = 0;
  for (const i of order) {
    const r = drainage.downstream[i]!;
    length[i] = r < 0 ? 1 : length[r]! + 1;
    if (
      drainage.accumulation[i]! >= s.hydrology.riverThresholdSamples &&
      (length[i]! > best || (length[i] === best && i < start))
    ) {
      best = length[i]!;
      start = i;
    }
  }
  if (start < 0 || best < 5) return;
  if (best > s.limits.maxVertices || best > 2048)
    throw new GeographyFailure(
      'GEOGRAPHY_RESOURCE_LIMIT',
      'river path',
      'River path exceeds frozen path budget.',
    );
  output?.take(best);
  const path: Point[] = [];
  for (let i = start; i >= 0; i = drainage.downstream[i]!)
    path.push([decimal6((i % c) * d), decimal6(Math.floor(i / c) * d)]);
  const w = c - 1,
    h = elevation.rows - 1,
    width = s.hydrology.maxRiverWidthM,
    radius = width / 2,
    coreRadius = radius - d / Math.SQRT2;
  budget.take(w * h);
  const mask = new Uint8Array(w * h);
  for (let j = 1; j < path.length; j++) {
    const a = path[j - 1]!,
      b = path[j]!,
      left = Math.max(0, Math.floor((Math.min(a[0], b[0]) - radius) / d)),
      right = Math.min(w - 1, Math.floor((Math.max(a[0], b[0]) + radius) / d)),
      top = Math.max(0, Math.floor((Math.min(a[1], b[1]) - radius) / d)),
      bottom = Math.min(h - 1, Math.floor((Math.max(a[1], b[1]) + radius) / d));
    budget.take((right - left + 1) * (bottom - top + 1));
    for (let y = top; y <= bottom; y++)
      for (let x = left; x <= right; x++)
        if (pointSegmentDistance([(x + 0.5) * d, (y + 0.5) * d], a, b) <= coreRadius)
          mask[y * w + x] = 1;
  }
  const regions = cellRegions(mask, elevation, budget, s.limits.maxVertices, output);
  if (
    regions.length !== 1 ||
    path.some((p) => polygonLocation(p, regions[0]!.polygon) === 'outside')
  )
    return;
  const region = regions[0]!,
    gradingPolicy = shoulderPolicy(s),
    level = decimal6(minimum - gradingPolicy.stageOffsetM),
    floor = decimal6(level - 1);
  if (floor < -100_000)
    throw new GeographyFailure(
      'HEIGHT_RANGE',
      'carved ground',
      'Carving exceeds supported elevation range.',
    );
  budget.take(2 * n + 4 * region.cells.length);
  const samples = elevation.samples.slice(),
    wetNodes = new Uint8Array(n),
    bankNodes = new Uint8Array(n);
  for (const cell of region.cells) {
    const x = cell % w,
      y = Math.floor(cell / w),
      i = y * c + x;
    for (const node of [i, i + 1, i + c, i + c + 1]) wetNodes[node] = 1;
  }
  // A node on any exposed cell edge is a bank. Interior boundary exits remain submerged.
  for (const cell of region.cells) {
    const x = cell % w,
      y = Math.floor(cell / w),
      i = y * c + x;
    if (y === 0 || !mask[cell - w]) {
      bankNodes[i] = 1;
      bankNodes[i + 1] = 1;
    }
    if (x === w - 1 || !mask[cell + 1]) {
      bankNodes[i + 1] = 1;
      bankNodes[i + c + 1] = 1;
    }
    if (y === h - 1 || !mask[cell + w]) {
      bankNodes[i + c] = 1;
      bankNodes[i + c + 1] = 1;
    }
    if (x === 0 || !mask[cell - 1]) {
      bankNodes[i] = 1;
      bankNodes[i + c] = 1;
    }
  }
  for (let i = 0; i < n; i++)
    if (wetNodes[i]) {
      samples[i] = bankNodes[i] ? level : floor;
    }
  const grading = gradeShoulders(samples, wetNodes, elevation, level, gradingPolicy, budget);
  const river: Water = {
    id: 'water:river:000000',
    kind: 'river',
    centreline: path,
    widthM: width,
    surfacePolicy: 'standing-water-v1',
    surfaceProfileM: path.map(() => level),
    polygons: [region.polygon],
  };
  return {
    elevation: { ...elevation, samples },
    water: [river],
    groundChanged: true,
    riverCells: mask,
    grading,
  };
}
