import {
  type Bounds,
  type Cover,
  type Elevation,
  type GenerationResult,
  type MapSettings,
  type Water,
} from '../../contract.js';
import { deriveSeed } from '../../overrides.js';
import { boundedCover, CoverLimit, coverDiagnostic } from './budget.js';
import { checkInput, decimal6 } from './input.js';
import { coherentNoise } from './noise.js';
import { waterMask, type Lattice } from './mask.js';
import { polygonize } from './polygonize.js';
import { ordered } from './order.js';

export const COVER_VERSION = 'coherent-dry-runs-v1' as const;
export const MAX_COVER_AXIS = 128;
export const MAX_FIELD_SLOPE = 0.08;

/** Land cover only; inputs are authoritative and never carved, filled or changed. */
export function generateCover(
  elevation: Elevation,
  bounds: Bounds,
  water: Water[],
  settings: MapSettings,
  seed: number,
): GenerationResult<Cover[]> {
  return boundedCover(() => {
    const woodSeed = deriveSeed(seed, `cover:${COVER_VERSION}`, 'wood');
    const fieldSeed = deriveSeed(seed, `cover:${COVER_VERSION}`, 'field');
    const { settings: s, water: w, work } = checkInput(elevation, bounds, water, settings);
    const step = Math.ceil(
      Math.max(
        1,
        s.cover.coherenceM / (8 * elevation.spacingM),
        (elevation.columns - 1) / MAX_COVER_AXIS,
        (elevation.rows - 1) / MAX_COVER_AXIS,
      ),
    );
    const columns = Math.ceil((elevation.columns - 1) / step),
      rows = Math.ceil((elevation.rows - 1) / step),
      count = columns * rows;
    work.reserve(
      count * (32 + 6 * Math.ceil(Math.log2(Math.max(2, count)))),
      'cover allocation/noise/ranking/distance',
    );
    const xs = Array.from({ length: columns + 1 }, (_, i) =>
      i === columns ? bounds.maxX : decimal6(i * step * elevation.spacingM),
    );
    const ys = Array.from({ length: rows + 1 }, (_, i) =>
      i === rows ? bounds.maxY : decimal6(i * step * elevation.spacingM),
    );
    if (xs.some((x, i) => i > 0 && x <= xs[i - 1]!) || ys.some((y, i) => i > 0 && y <= ys[i - 1]!))
      throw new CoverLimit('cover precision', 'Cover lattice collapsed at decimal-6 precision.');
    const lattice: Lattice = { xs, ys, columns, rows };
    const { wet, boundary } = waterMask(lattice, w, work);
    const distances = new Int32Array(count).fill(columns + rows + 1),
      queue = new Int32Array(count);
    let head = 0,
      tail = 0;
    for (let i = 0; i < count; i++)
      if (wet[i]) {
        distances[i] = 0;
        queue[tail++] = i;
      }
    const hasWater = tail > 0;
    while (head < tail) {
      const i = queue[head++]!,
        x = i % columns,
        y = Math.floor(i / columns);
      for (const n of [
        x > 0 ? i - 1 : -1,
        x + 1 < columns ? i + 1 : -1,
        y > 0 ? i - columns : -1,
        y + 1 < rows ? i + columns : -1,
      ]) {
        if (n >= 0 && distances[n]! > distances[i]! + 1) {
          distances[n] = distances[i]! + 1;
          queue[tail++] = n;
        }
      }
    }
    // Reserve the complete ground-cell scan including conservative seam neighbours.
    let groundWork = 0;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < columns; x++)
        groundWork +=
          (Math.min(elevation.columns - 2, (x + 1) * step) - Math.max(0, x * step - 1) + 1) *
          (Math.min(elevation.rows - 2, (y + 1) * step) - Math.max(0, y * step - 1) + 1);
    work.reserve(groundWork, 'whole-cell conservative slope');
    const slopes = new Float64Array(count),
      areas = new Float64Array(count),
      woodScores = new Float64Array(count),
      fieldScores = new Float64Array(count);
    let dryArea = 0,
      maskedArea = 0,
      lossBound = 0,
      fieldEligibleArea = 0,
      maxCellArea = 0;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < columns; x++) {
        const i = y * columns + x,
          area = (xs[x + 1]! - xs[x]!) * (ys[y + 1]! - ys[y]!);
        areas[i] = area;
        maxCellArea = Math.max(maxCellArea, area);
        if (wet[i]) {
          maskedArea += area;
          if (boundary[i]) lossBound += area;
          continue;
        }
        dryArea += area;
        let slope = 0;
        for (
          let gy = Math.max(0, y * step - 1);
          gy <= Math.min(elevation.rows - 2, (y + 1) * step);
          gy++
        )
          for (
            let gx = Math.max(0, x * step - 1);
            gx <= Math.min(elevation.columns - 2, (x + 1) * step);
            gx++
          ) {
            const k = gy * elevation.columns + gx;
            const a = elevation.samples[k]!,
              b = elevation.samples[k + 1]!,
              c = elevation.samples[k + elevation.columns]!,
              d = elevation.samples[k + elevation.columns + 1]!;
            // Bilinear derivatives are affine: this is an upper bound throughout the cell.
            slope = Math.max(
              slope,
              Math.hypot(
                Math.max(Math.abs(b - a), Math.abs(d - c)),
                Math.max(Math.abs(c - a), Math.abs(d - b)),
              ) / elevation.spacingM,
            );
          }
        slopes[i] = slope;
        if (slope <= MAX_FIELD_SLOPE && (!hasWater || distances[i]! > 1)) fieldEligibleArea += area;
        const cx = (xs[x]! + xs[x + 1]!) / 2,
          cy = (ys[y]! + ys[y + 1]!) / 2;
        const bank = hasWater ? 1 / (distances[i]! + 1) : 0;
        woodScores[i] =
          coherentNoise(woodSeed, cx, cy, s.cover.coherenceM) +
          0.25 * Math.min(1, slope / 0.3) +
          0.3 * bank;
        fieldScores[i] = coherentNoise(fieldSeed, cx, cy, s.cover.coherenceM) - slope - 0.3 * bank;
      }
    const classes = new Uint8Array(count);
    for (let i = 0; i < count; i++) if (wet[i]) classes[i] = 255;
    const rank = (scores: Float64Array) =>
      ordered(
        Array.from({ length: count }, (_, i) => i),
        (a, b) => scores[b]! - scores[a]! || a - b,
      );
    const allocate = (
      order: number[],
      fraction: number,
      kind: number,
      eligible: (i: number) => boolean,
    ): number => {
      const target = fraction * dryArea;
      let assigned = 0;
      for (const i of order) {
        if (!eligible(i)) continue;
        if (
          assigned >= target ||
          Math.abs(assigned + areas[i]! - target) > Math.abs(assigned - target)
        )
          break;
        classes[i] = kind;
        assigned += areas[i]!;
      }
      return assigned;
    };
    const woodArea = allocate(rank(woodScores), s.cover.woodFraction, 1, (i) => !wet[i]);
    const fieldArea = allocate(
      rank(fieldScores),
      s.cover.fieldFraction,
      2,
      (i) => classes[i] === 0 && slopes[i]! <= MAX_FIELD_SLOPE && (!hasWater || distances[i]! > 1),
    );
    const openArea = dryArea - woodArea - fieldArea;
    const value = polygonize(lattice, classes, work, s.limits.maxFeatures, s.limits.maxVertices);
    const metrics = {
      dryEligibleAreaM2: decimal6(dryArea),
      maskedAreaM2: decimal6(maskedArea),
      dryAreaLossUpperBoundM2: decimal6(lossBound),
      fieldSuitableAreaM2: decimal6(fieldEligibleArea),
      woodFraction: dryArea ? decimal6(woodArea / dryArea) : 0,
      fieldFraction: dryArea ? decimal6(fieldArea / dryArea) : 0,
      openFraction: dryArea ? decimal6(openArea / dryArea) : 0,
      maxCellAreaM2: decimal6(maxCellArea),
    };
    const diagnostics = [
      coverDiagnostic('COVER_ACHIEVED', JSON.stringify(metrics)),
      coverDiagnostic(
        'COVER_LATTICE',
        `Version ${COVER_VERSION}; ${columns}x${rows} cells, nominal side ${decimal6(step * elevation.spacingM)} m; exact rectangle partition of classified cells, decimal-6 coordinates.`,
      ),
    ];
    if (!dryArea)
      diagnostics.push(
        coverDiagnostic(
          'COVER_NO_DRY_AREA',
          'Water mask leaves no whole dry cells; empty cover is explicit, not generated dry land.',
          'warning',
        ),
      );
    if (s.cover.fieldFraction * dryArea - fieldArea > maxCellArea / 2 + 1e-9)
      diagnostics.push(
        coverDiagnostic(
          'COVER_FIELD_SHORTFALL',
          `Requested field fraction ${s.cover.fieldFraction}; achieved ${metrics.fieldFraction} of dry eligible area. Slope, riparian exclusion and wood allocation constrain fields.`,
          'warning',
        ),
      );
    return { ok: true, value, diagnostics };
  });
}
