import {
  type Bounds,
  type Cover,
  type Elevation,
  type GenerationResult,
  type MapSettings,
  type Point,
  type Polygon,
  type Water,
} from '../../contract.js';
import { polygonArea, polygonLocation } from '../../geometry.js';
import { deriveSeed } from '../../overrides.js';
import { boundedCover, CoverLimit, coverDiagnostic, CoverWork, MeteredTopology } from './budget.js';
import { checkInput, decimal6 } from './input.js';
import { coherentNoise } from './noise.js';
import { waterMask, type Lattice } from './mask.js';
import { ordered } from './order.js';
import { compartments, fieldParcels } from './parcels.js';
import { boxMean, chamferDistance, clamp01, components, hash01, sq, type Grid } from './raster.js';
import { removePinches, traceRegions } from './trace.js';

export const COVER_VERSION = 'terrain-parcels-v2' as const;
/** Rectangle cover of maps saved before D45; still certifiable, no longer generated. */
export const LEGACY_COVER_VERSION = 'coherent-dry-runs-v1' as const;
/** Cover lattice cells per axis at most; the default 10 km map uses 200 x 200 cells of 50 m. */
export const MAX_COVER_AXIS = 200;
/** Preferred cover cell side, metres (never finer than the elevation sampling). */
export const COVER_CELL_M = 50;
/** Steepest ground (rise/run, conservative cell bound) that may carry fields. */
export const MAX_FIELD_SLOPE = 0.08;
/** Woods, fields and clearings smaller than this become their surroundings. */
export const MIN_PATCH_M2 = 20_000;
/** Typical field parcel seed spacing and wood/open compartment spacing, metres. */
export const PARCEL_SPACING_M = 220;
export const COMPARTMENT_SPACING_M = 800;
/** Cover work may use this multiple of `settings.limits.maxTopologyChecks`. */
export const COVER_WORK_FACTOR = 8;

const OPEN = 0,
  WOOD = 1,
  FIELD = 2;
const KINDS = ['open', 'wood', 'field'] as const;

/**
 * Roads and settlements the cover is laid out around. Without them (geography
 * on its own) cover follows only the ground and water.
 */
export interface CoverContext {
  roads?: readonly { path: readonly Point[] }[];
  sites?: readonly { kind: 'village' | 'farm'; anchor: Point; placementArea: Polygon }[];
}

/** Land cover only; inputs are authoritative and never carved, filled or changed. */
export function generateCover(
  elevation: Elevation,
  bounds: Bounds,
  water: Water[],
  settings: MapSettings,
  seed: number,
  context: CoverContext = {},
): GenerationResult<Cover[]> {
  return boundedCover(() => {
    const stream = (name: string) => deriveSeed(seed, `cover:${COVER_VERSION}`, name);
    const woodSeed = stream('wood'),
      fieldSeed = stream('field'),
      soilSeed = stream('soil'),
      warpSeed = stream('warp'),
      parcelSeed = stream('parcels'),
      compartmentSeed = stream('compartments'),
      regionalSeed = stream('regional');
    const { settings: s, water: w } = checkInput(elevation, bounds, water, settings);
    const work = new CoverWork(s.limits.maxTopologyChecks * COVER_WORK_FACTOR);
    const roads = context.roads ?? [],
      sites = context.sites ?? [];
    for (const road of roads)
      for (const p of road.path)
        if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]))
          throw new RangeError('Cover road context must have finite coordinates');
    for (const site of sites)
      if (!Number.isFinite(site.anchor[0]) || !Number.isFinite(site.anchor[1]))
        throw new RangeError('Cover site context must have finite coordinates');

    // Lattice: about 50 m cells, never finer than the samples, at most 200 per axis.
    const spacing = elevation.spacingM,
      target = Math.min(COVER_CELL_M, Math.min(bounds.maxX, bounds.maxY) / 24);
    const step = Math.ceil(
      Math.max(
        1,
        target / spacing,
        (elevation.columns - 1) / MAX_COVER_AXIS,
        (elevation.rows - 1) / MAX_COVER_AXIS,
      ),
    );
    const columns = Math.ceil((elevation.columns - 1) / step),
      rows = Math.ceil((elevation.rows - 1) / step),
      count = columns * rows,
      cellM = step * spacing,
      cellArea = cellM * cellM;
    const grid: Grid = { columns, rows, cellW: cellM, cellH: cellM };
    work.reserve(count * CELL_PASSES, 'cover terrain, distances and scores');
    const xs = Array.from({ length: columns + 1 }, (_, i) =>
      i === columns ? bounds.maxX : decimal6(i * cellM),
    );
    const ys = Array.from({ length: rows + 1 }, (_, i) =>
      i === rows ? bounds.maxY : decimal6(i * cellM),
    );
    if (xs.some((x, i) => i > 0 && x <= xs[i - 1]!) || ys.some((y, i) => i > 0 && y <= ys[i - 1]!))
      throw new CoverLimit('cover precision', 'Cover lattice collapsed at decimal-6 precision.');
    const lattice: Lattice = { xs, ys, columns, rows };
    const { wet, boundary } = waterMask(lattice, w, work);

    // Ground per cell: mean height, mean gradient and a conservative slope bound.
    const sample = (gx: number, gy: number) => elevation.samples[gy * elevation.columns + gx]!;
    const height = new Float64Array(count),
      gradX = new Float64Array(count),
      gradY = new Float64Array(count),
      slope = new Float64Array(count),
      slopeBound = new Float64Array(count),
      areas = new Float64Array(count);
    let groundWork = 0;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < columns; x++)
        groundWork +=
          (Math.min(elevation.columns - 2, (x + 1) * step) - Math.max(0, x * step - 1) + 1) *
          (Math.min(elevation.rows - 2, (y + 1) * step) - Math.max(0, y * step - 1) + 1);
    work.reserve(groundWork, 'whole-cell conservative slope');
    let dryArea = 0,
      maskedArea = 0,
      lossBound = 0,
      maxCellArea = 0;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < columns; x++) {
        const i = y * columns + x,
          x0 = x * step,
          y0 = y * step,
          x1 = Math.min((x + 1) * step, elevation.columns - 1),
          y1 = Math.min((y + 1) * step, elevation.rows - 1);
        const a = sample(x0, y0),
          b = sample(x1, y0),
          c = sample(x0, y1),
          d = sample(x1, y1);
        height[i] = (a + b + c + d) / 4;
        gradX[i] = (b - a + d - c) / (2 * (x1 - x0) * spacing);
        gradY[i] = (c - a + d - b) / (2 * (y1 - y0) * spacing);
        slope[i] = Math.sqrt(gradX[i]! * gradX[i]! + gradY[i]! * gradY[i]!);
        const area = (xs[x + 1]! - xs[x]!) * (ys[y + 1]! - ys[y]!);
        areas[i] = area;
        maxCellArea = Math.max(maxCellArea, area);
        if (wet[i]) {
          maskedArea += area;
          if (boundary[i]) lossBound += area;
          continue;
        }
        dryArea += area;
        // Bilinear derivatives are affine: this bounds the slope throughout the
        // cell and its seam neighbours, so smoothed field edges stay on gentle ground.
        let bound = 0;
        for (let gy = Math.max(0, y0 - 1); gy <= Math.min(elevation.rows - 2, y1); gy++)
          for (let gx = Math.max(0, x0 - 1); gx <= Math.min(elevation.columns - 2, x1); gx++) {
            const p = sample(gx, gy),
              q = sample(gx + 1, gy),
              r = sample(gx, gy + 1),
              t = sample(gx + 1, gy + 1);
            const sx = Math.max(Math.abs(q - p), Math.abs(t - r)),
              sy = Math.max(Math.abs(r - p), Math.abs(t - q));
            bound = Math.max(bound, Math.sqrt(sx * sx + sy * sy) / spacing);
          }
        slopeBound[i] = bound;
      }
    const hasWater = wet.some((v) => v === 1);

    // Water: distance to the nearest masked cell and height above its bed.
    const toWater = chamferDistance(grid, (i) => wet[i] === 1);
    // Roads: cells crossed by any road, with that road's direction.
    let roadSamples = 0;
    for (const road of roads)
      for (let k = 1; k < road.path.length; k++) {
        const a = road.path[k - 1]!,
          b = road.path[k]!;
        roadSamples += Math.ceil(Math.sqrt(sq(b[0] - a[0]) + sq(b[1] - a[1])) / (cellM / 2)) + 1;
      }
    work.reserve(roadSamples, 'cover road raster');
    const roadCell = new Uint8Array(count),
      roadDirX = new Float64Array(count),
      roadDirY = new Float64Array(count);
    const cellOf = (p: Point) =>
      Math.min(rows - 1, Math.max(0, Math.floor(p[1] / cellM))) * columns +
      Math.min(columns - 1, Math.max(0, Math.floor(p[0] / cellM)));
    for (const road of roads)
      for (let k = 1; k < road.path.length; k++) {
        const a = road.path[k - 1]!,
          b = road.path[k]!,
          dx = b[0] - a[0],
          dy = b[1] - a[1],
          length = Math.sqrt(dx * dx + dy * dy);
        if (!length) continue;
        const steps = Math.ceil(length / (cellM / 2));
        for (let t = 0; t <= steps; t++) {
          const i = cellOf([a[0] + (dx * t) / steps, a[1] + (dy * t) / steps]);
          if (roadCell[i]) continue;
          roadCell[i] = 1;
          roadDirX[i] = dx / length;
          roadDirY[i] = dy / length;
        }
      }
    const toRoad = chamferDistance(grid, (i) => roadCell[i] === 1);
    // Settlements: cells inside a site's placement area, and distance to villages and farms.
    const siteCell = new Uint8Array(count),
      villageCell = new Uint8Array(count),
      farmCell = new Uint8Array(count);
    const topology = new MeteredTopology(work);
    for (const site of sites) {
      const outer = site.placementArea.outer;
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const [px, py] of outer) {
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
      }
      const mark = site.kind === 'village' ? villageCell : farmCell;
      const anchor = cellOf(site.anchor);
      mark[anchor] = siteCell[anchor] = 1;
      const cx0 = Math.max(0, Math.floor(minX / cellM)),
        cx1 = Math.min(columns - 1, Math.floor(maxX / cellM)),
        cy0 = Math.max(0, Math.floor(minY / cellM)),
        cy1 = Math.min(rows - 1, Math.floor(maxY / cellM));
      for (let y = cy0; y <= cy1; y++)
        for (let x = cx0; x <= cx1; x++) {
          const centre: Point = [(xs[x]! + xs[x + 1]!) / 2, (ys[y]! + ys[y + 1]!) / 2];
          if (polygonLocation(centre, site.placementArea, topology) !== 'outside')
            mark[y * columns + x] = siteCell[y * columns + x] = 1;
        }
    }
    const villages = sites.some((t) => t.kind === 'village'),
      farms = sites.some((t) => t.kind === 'farm');
    const toVillage = chamferDistance(grid, (i) => villageCell[i] === 1),
      toFarm = chamferDistance(grid, (i) => farmCell[i] === 1);

    // Relative height: ridges stand above the ground within about 400 m.
    const around = boxMean(grid, height, Math.max(1, Math.round(400 / cellM)));
    let spread = 0,
      dryCells = 0;
    for (let i = 0; i < count; i++)
      if (!wet[i]) {
        spread += sq(height[i]! - around[i]!);
        dryCells++;
      }
    spread = dryCells ? Math.sqrt(spread / dryCells) : 0;

    // Suitability. Woods: steep slopes, ridges, poor ground, far from people.
    // Fields: gentle ground near villages, farms and roads. Neither on river flats.
    const coherence = s.cover.coherenceM,
      woodScore = new Float64Array(count),
      fieldScore = new Float64Array(count),
      wetness = new Float64Array(count);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < columns; x++) {
        const i = y * columns + x,
          cx = (xs[x]! + xs[x + 1]!) / 2,
          cy = (ys[y]! + ys[y + 1]!) / 2;
        // Domain warp gives the soil pattern organic, non-lattice outlines.
        const px = cx + coherence * (coherentNoise(warpSeed, cx, cy, 2 * coherence) - 0.5),
          py = cy + coherence * (coherentNoise(warpSeed ^ 0x2545f491, cx, cy, 2 * coherence) - 0.5);
        const soil =
          0.65 * coherentNoise(soilSeed, px, py, coherence) +
          0.35 * coherentNoise(soilSeed ^ 0x6c8e9cf5, px, py, coherence / 2.5);
        const steep = clamp01(slope[i]! / 0.15),
          gentle = 1 - clamp01(slope[i]! / MAX_FIELD_SLOPE),
          ridge =
            spread > 1e-6
              ? Math.max(0, Math.min(1, (height[i]! - around[i]!) / (1.5 * spread)))
              : 0,
          settled = Math.max(
            villages ? 1 - clamp01(toVillage.distance[i]! / 1200) : 0,
            farms ? 1 - clamp01(toFarm.distance[i]! / 500) : 0,
          ),
          nearRoad = roads.length ? 1 - clamp01(toRoad.distance[i]! / 400) : 0;
        const source = toWater.nearest[i]!;
        wetness[i] =
          hasWater && source >= 0
            ? (1 - clamp01(toWater.distance[i]! / 250)) *
              (1 - clamp01((height[i]! - height[source]!) / 3))
            : 0;
        woodScore[i] =
          1.1 * steep +
          0.5 * ridge +
          0.9 * soil +
          0.4 * coherentNoise(woodSeed, px, py, 0.7 * coherence) -
          0.9 * settled -
          0.3 * nearRoad -
          1.2 * wetness[i]!;
        fieldScore[i] =
          0.9 * settled +
          0.4 * nearRoad +
          0.8 * (1 - soil) +
          0.3 * gentle +
          0.3 * coherentNoise(fieldSeed, px, py, 0.7 * coherence) -
          0.4 * ridge -
          0.6 * steep;
      }
    const woodRank = boxMean(grid, boxMean(grid, woodScore, 1), 1),
      fieldRank = boxMean(grid, boxMean(grid, fieldScore, 1), 1);
    const bank = Math.sqrt(2) * cellM + 1e-9;
    const woodAllowed = (i: number) => !wet[i] && !siteCell[i];
    const fieldAllowed = (i: number) =>
      !wet[i] &&
      !siteCell[i] &&
      slopeBound[i]! <= MAX_FIELD_SLOPE &&
      wetness[i]! < 0.35 &&
      (!hasWater || toWater.distance[i]! > bank);

    // Allocate the recipe's shares to the best-ranked cells (area-nearest prefix).
    const cls = new Int32Array(count);
    for (let i = 0; i < count; i++) cls[i] = wet[i] ? -1 : OPEN;
    work.reserve(2 * count * Math.ceil(Math.log2(Math.max(2, count))), 'cover ranking');
    const allocate = (
      scores: Float64Array,
      fraction: number,
      kind: number,
      eligible: (i: number) => boolean,
    ): number[] => {
      const target = fraction * dryArea,
        order = ordered(
          Array.from({ length: count }, (_, k) => k),
          (a, b) => scores[b]! - scores[a]! || a - b,
        );
      let assigned = 0;
      for (const i of order) {
        if (cls[i] !== OPEN || !eligible(i)) continue;
        if (
          assigned >= target ||
          Math.abs(assigned + areas[i]! - target) > Math.abs(assigned - target)
        )
          break;
        cls[i] = kind;
        assigned += areas[i]!;
      }
      return order;
    };
    let fieldSuitableArea = 0;
    for (let i = 0; i < count; i++) if (fieldAllowed(i)) fieldSuitableArea += areas[i]!;
    const woodOrder = allocate(woodRank, s.cover.woodFraction, WOOD, woodAllowed),
      fieldOrder = allocate(fieldRank, s.cover.fieldFraction, FIELD, fieldAllowed);

    // Patches: drop specks of wood or field, fill small enclosed clearings.
    const minPatch = Math.max(2, Math.ceil(MIN_PATCH_M2 / cellArea));
    const patches = components(grid, cls);
    for (let i = 0; i < count; i++)
      if (cls[i]! > OPEN && patches.sizes[patches.component[i]!]! < minPatch) cls[i] = OPEN;
    const clearings = components(grid, cls);
    const enclosing = new Int32Array(clearings.sizes.length).fill(-2);
    for (let i = 0; i < count; i++) {
      if (cls[i] !== OPEN) continue;
      const c = clearings.component[i]!,
        x = i % columns,
        y = Math.floor(i / columns);
      if (x === 0 || y === 0 || x === columns - 1 || y === rows - 1) enclosing[c] = -1;
      for (const n of [i - 1, i + 1, i - columns, i + columns]) {
        if (n < 0 || n >= count || (n === i - 1 && x === 0) || (n === i + 1 && x === columns - 1))
          continue;
        const k = cls[n]!;
        if (k === OPEN) continue;
        if (k < 0 || (enclosing[c] !== -2 && enclosing[c] !== k)) enclosing[c] = -1;
        else enclosing[c] = k;
      }
    }
    const fillable = new Uint8Array(clearings.sizes.length).fill(1);
    for (let i = 0; i < count; i++) {
      if (cls[i] !== OPEN) continue;
      const c = clearings.component[i]!,
        k = enclosing[c]!;
      if (
        k < 0 ||
        clearings.sizes[c]! >= minPatch ||
        !(k === WOOD ? woodAllowed(i) : fieldAllowed(i))
      )
        fillable[c] = 0;
    }
    for (let i = 0; i < count; i++)
      if (
        cls[i] === OPEN &&
        fillable[clearings.component[i]!] &&
        enclosing[clearings.component[i]!]! > 0
      )
        cls[i] = enclosing[clearings.component[i]!]!;
    // Restore the recipe's shares after clean-up: grow existing patches along
    // their best-ranked edge cells, or trim their worst-ranked edge cells.
    work.reserve(2 * (BALANCE_PASSES + 1) * count * 5, 'cover share balance');
    const touches = (i: number, kind: number) => {
      const x = i % columns;
      return (
        (x > 0 && cls[i - 1] === kind) ||
        (x + 1 < columns && cls[i + 1] === kind) ||
        (i >= columns && cls[i - columns] === kind) ||
        (i + columns < count && cls[i + columns] === kind)
      );
    };
    const balance = (
      order: number[],
      fraction: number,
      kind: number,
      eligible: (i: number) => boolean,
    ) => {
      const target = fraction * dryArea;
      let current = 0;
      for (let i = 0; i < count; i++) if (cls[i] === kind) current += areas[i]!;
      for (let pass = 0; pass < BALANCE_PASSES && target - current > maxCellArea / 2; pass++) {
        let grown = false;
        for (const i of order) {
          if (target - current <= areas[i]! / 2) break;
          if (cls[i] !== OPEN || !eligible(i) || !touches(i, kind)) continue;
          cls[i] = kind;
          current += areas[i]!;
          grown = true;
        }
        if (!grown) break;
      }
      for (let k = order.length - 1; k >= 0 && current - target > maxCellArea / 2; k--) {
        const i = order[k]!;
        if (cls[i] !== kind || !touches(i, OPEN) || current - target <= areas[i]! / 2) continue;
        cls[i] = OPEN;
        current -= areas[i]!;
      }
    };
    balance(woodOrder, s.cover.woodFraction, WOOD, woodAllowed);
    balance(fieldOrder, s.cover.fieldFraction, FIELD, fieldAllowed);

    // Field parcels follow contours on slopes and run back from roads; woods
    // and open ground are split into compartments to keep features compact.
    const slopeX = boxMean(grid, gradX, 2),
      slopeY = boxMean(grid, gradY, 2);
    let rx = hash01(regionalSeed, 1, 2) - 0.5,
      ry = hash01(regionalSeed, 3, 4) - 0.5;
    const rl = Math.sqrt(rx * rx + ry * ry);
    [rx, ry] = rl > 1e-9 ? [rx / rl, ry / rl] : [1, 0];
    const orientation = (i: number): [number, number] => {
      const r = toRoad.nearest[i]!;
      if (r >= 0 && toRoad.distance[i]! < 300) return [-roadDirY[r]!, roadDirX[r]!];
      const gx = slopeX[i]!,
        gy = slopeY[i]!,
        g = Math.sqrt(gx * gx + gy * gy);
      if (g > 0.012) return [-gy / g, gx / g];
      return [rx, ry];
    };
    const isField = new Uint8Array(count);
    for (let i = 0; i < count; i++) isField[i] = cls[i] === FIELD ? 1 : 0;
    // Partition edges wander smoothly instead of following lattice lines.
    const warp =
      (scaleM: number, amplitudeM: number) =>
      (i: number): [number, number] => {
        const cx = (xs[i % columns]! + xs[(i % columns) + 1]!) / 2,
          cy = (ys[Math.floor(i / columns)]! + ys[Math.floor(i / columns) + 1]!) / 2;
        return [
          (amplitudeM / cellM) * (coherentNoise(warpSeed ^ 0x3c6ef372, cx, cy, scaleM) - 0.5),
          (amplitudeM / cellM) * (coherentNoise(warpSeed ^ 0x7f4a7c15, cx, cy, scaleM) - 0.5),
        ];
      };
    const parcel = fieldParcels(
      grid,
      isField,
      roadCell,
      orientation,
      warp(PARCEL_SPACING_M * 1.5, PARCEL_SPACING_M * 0.5),
      parcelSeed,
      Math.max(2, Math.round(PARCEL_SPACING_M / cellM)),
      Math.max(2, Math.ceil((0.6 * MIN_PATCH_M2) / cellArea)),
      work,
    );
    const compartment = compartments(
      grid,
      warp(COMPARTMENT_SPACING_M, COMPARTMENT_SPACING_M * 0.6),
      compartmentSeed,
      Math.max(4, Math.round(COMPARTMENT_SPACING_M / cellM)),
      work,
    );
    const label = new Int32Array(count);
    for (let i = 0; i < count; i++)
      label[i] = cls[i]! < 0 ? -1 : 3 * (cls[i] === FIELD ? parcel[i]! : compartment[i]!) + cls[i]!;
    removePinches(
      grid,
      label,
      (i, value) =>
        !wet[i] && (value % 3 === OPEN || (value % 3 === WOOD ? woodAllowed(i) : fieldAllowed(i))),
      work,
    );
    const regions = components(grid, label);
    const kinds = new Uint8Array(regions.sizes.length);
    for (let i = 0; i < count; i++)
      if (label[i]! >= 0) kinds[regions.component[i]!] = label[i]! % 3;
    const traced = traceRegions(
      grid,
      xs,
      ys,
      regions.component,
      regions.sizes.length,
      {
        straightenM: 0.5 * cellM,
        spacingM: 0.5 * cellM,
        toleranceM: 0.1 * cellM,
        maxFeatures: s.limits.maxFeatures,
        maxVertices: s.limits.maxVertices,
        jitterSeed: stream('junctions'),
      },
      work,
    );
    const value: Cover[] = traced.regions.map(({ region, polygon }, k) => ({
      id: `cover:${String(k).padStart(5, '0')}`,
      kind: KINDS[kinds[region]!]!,
      polygons: [polygon],
    }));

    const achieved = [0, 0, 0];
    for (const f of value) achieved[KINDS.indexOf(f.kind)]! += polygonArea(f.polygons[0]!);
    const covered = achieved[0]! + achieved[1]! + achieved[2]!;
    const share = (k: number) => (covered ? decimal6(achieved[k]! / covered) : 0);
    const metrics = {
      dryEligibleAreaM2: decimal6(dryArea),
      coveredAreaM2: decimal6(covered),
      maskedAreaM2: decimal6(maskedArea),
      dryAreaLossUpperBoundM2: decimal6(lossBound),
      fieldSuitableAreaM2: decimal6(fieldSuitableArea),
      woodFraction: share(WOOD),
      fieldFraction: share(FIELD),
      openFraction: share(OPEN),
      maxCellAreaM2: decimal6(maxCellArea),
      features: value.length,
      demotedChains: traced.evidence.demotedChains,
    };
    const diagnostics = [
      coverDiagnostic('COVER_ACHIEVED', JSON.stringify(metrics)),
      coverDiagnostic(
        'COVER_LATTICE',
        `Version ${COVER_VERSION}; ${columns}x${rows} cells, nominal side ${decimal6(cellM)} m; smoothed shared boundaries, decimal-6 coordinates.`,
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
    if (covered && s.cover.fieldFraction - metrics.fieldFraction > COVER_SHARE_TOLERANCE)
      diagnostics.push(
        coverDiagnostic(
          'COVER_FIELD_SHORTFALL',
          `Requested field fraction ${s.cover.fieldFraction}; achieved ${metrics.fieldFraction} of covered area. Slope, river flats, settlements and wood allocation constrain fields.`,
          'warning',
        ),
      );
    if (covered && s.cover.woodFraction - metrics.woodFraction > COVER_SHARE_TOLERANCE)
      diagnostics.push(
        coverDiagnostic(
          'COVER_WOOD_SHORTFALL',
          `Requested wood fraction ${s.cover.woodFraction}; achieved ${metrics.woodFraction} of covered area. River flats and settlements constrain woods.`,
          'warning',
        ),
      );
    return { ok: true, value, diagnostics };
  });
}
/** Achieved wood/field shares may fall short of the recipe by this much before a warning. */
export const COVER_SHARE_TOLERANCE = 0.05;
/** Growth passes when restoring the recipe's shares after clean-up. */
const BALANCE_PASSES = 8;
/** Reserved cell visits per lattice cell for terrain, distances, noise, scores and cleanup. */
const CELL_PASSES = 96;
