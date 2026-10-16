import type { MapAsset, Point, Polygon } from './contract.js';
import {
  distance,
  interpolate,
  pointSegmentDistance,
  polygonEdges,
  polygonLocation,
  segmentCuts,
} from './geometry.js';
import { fordDepthM, isMinorRoute, riffleDepthM, reachSlope } from './geography/shallow.js';
import { createElevationQueries } from './queries.js';
import { TopologyBudget } from './errors.js';

/**
 * Measurable cartographic realism of a saved map, computed only from public
 * geometry (no generator). Used by tests as acceptance thresholds and by the
 * render scripts to compare generator versions. Not a validity certificate:
 * `validateBattlefield` remains the authority for physical constraints.
 */
export interface RealismReport {
  terrain: {
    reliefM: number;
    lakes: number;
    /** Share of samples whose drainage leaves through a boundary outlet. */
    boundaryDrainedShare: number;
  };
  rivers: {
    features: number;
    /** Distinct downstream-connected systems that reach the boundary. */
    systems: number;
    confluences: number;
    /** Reaches whose downstream neighbour's surface is higher. */
    uphillSteps: number;
    /** Reaches that neither reach the boundary nor join other water. */
    deadEnds: number;
    /** Largest drop from a system source surface to its outlet surface, metres. */
    maxFallM: number;
  };
  roads: {
    lengthM: number;
    /** Length-weighted mean absolute directional grade of regional roads. */
    meanGrade: number;
    maxGrade: number;
    /** Share of regional road length within 100 m of the map edge. */
    marginShare: number;
    junctions: number;
    bridges: number;
  };
  settlements: {
    sites: number;
    /** Largest gradient at any site anchor. */
    maxAnchorSlope: number;
    /** Sites standing higher than every point on a 400 m ring around them. */
    summits: number;
    /** Sites less than 1 m above the nearest river surface. */
    lowRiverFlats: number;
    /** Villages within 800 m of a river, as a share of villages (rivers present). */
    villagesNearRiver: number;
  };
  cover: CoverRealism;
  crossings: CrossingRealism;
  grain: GrainRealism;
}

/**
 * Whether ground and water share one combed direction (#540). Terrain is read
 * from central-difference gradients of the samples, weighted by their
 * magnitude; directions are axes (mod 180 degrees), compared through the
 * doubled-angle vector so no trigonometry is needed.
 */
export interface GrainRealism {
  /**
   * Elongation of the relief: the ratio of the gradient structure tensor's
   * eigenvalues (1 = isotropic; v2 terrain measured 1.9-3.5).
   */
  anisotropy: number;
  /** Unit vector of the grain: along ridges, perpendicular to the dominant slope axis. */
  grainAxis: Point;
  /**
   * Gradient-weighted share of slope aspect within 7.5 degrees of 0, 45, 90
   * and 135 degrees (axes; a uniform aspect gives 1/12 = 8.3% each).
   */
  aspectLatticeShare: [number, number, number, number];
  /** River bank length, metres (polygon rings, excluding the map frame). */
  riverBankLengthM: number;
  /** Length-weighted mean |cos| between river banks and the grain (uniform 2/pi = 0.64). */
  riverGrainAlignment: number;
  /** Share of river bank length within 15 degrees of the grain (uniform 1/6). */
  riverNearGrainShare: number;
  /**
   * Share of river bank length within 2.5 degrees of 0, 45, 90 and 135
   * degrees (uniform 2.8% each, 11.1% in total).
   */
  riverGridShare: [number, number, number, number];
}

/** cos(15 deg) and cos(5 deg): doubled half-widths of the 7.5 and 2.5 degree windows. */
const COS_15 = 0.9659258262890683,
  COS_5 = 0.9961946980917455,
  COS_30 = 0.8660254037844387;
/** Which of the axes 0, 45, 90, 135 degrees a doubled-angle unit vector lies within. */
function latticeAxis(c2: number, s2: number, cosWindow: number): number {
  if (c2 >= cosWindow) return 0;
  if (s2 >= cosWindow) return 1;
  if (-c2 >= cosWindow) return 2;
  if (-s2 >= cosWindow) return 3;
  return -1;
}

/** A corpus of grain measurements: per-map terrain shares averaged, river banks pooled by length. */
export interface GrainSummary {
  maps: number;
  meanAnisotropy: number;
  maxAnisotropy: number;
  /** Mean over maps of each lattice axis's aspect share. */
  aspectLatticeShare: [number, number, number, number];
  riverBankLengthM: number;
  riverGrainAlignment: number;
  riverNearGrainShare: number;
  riverGridShare: [number, number, number, number];
  /** Sum of the four river grid shares. */
  riverGridTotal: number;
}

export function summarizeGrain(reports: readonly GrainRealism[]): GrainSummary {
  const n = reports.length || 1,
    length = reports.reduce((t, r) => t + r.riverBankLengthM, 0),
    pooled = (f: (r: GrainRealism) => number) =>
      length ? reports.reduce((t, r) => t + f(r) * r.riverBankLengthM, 0) / length : 0,
    four = (f: (k: number) => number) => [0, 1, 2, 3].map(f) as [number, number, number, number];
  const riverGridShare = four((k) => pooled((r) => r.riverGridShare[k]!));
  return {
    maps: reports.length,
    meanAnisotropy: reports.reduce((t, r) => t + r.anisotropy, 0) / n,
    maxAnisotropy: reports.reduce((t, r) => Math.max(t, r.anisotropy), 0),
    aspectLatticeShare: four((k) => reports.reduce((t, r) => t + r.aspectLatticeShare[k]!, 0) / n),
    riverBankLengthM: length,
    riverGrainAlignment: pooled((r) => r.riverGrainAlignment),
    riverNearGrainShare: pooled((r) => r.riverNearGrainShare),
    riverGridShare,
    riverGridTotal: riverGridShare.reduce((t, v) => t + v, 0),
  };
}

/** The public layers the grain measurement reads: ground and water. */
export type GrainInput = Pick<MapAsset, 'bounds' | 'elevation'> & {
  layers: Pick<MapAsset['layers'], 'water'>;
};

export function grainRealism(asset: GrainInput): GrainRealism {
  const e = asset.elevation,
    z = e.samples,
    w = e.columns,
    h = e.rows,
    b = asset.bounds;
  let sxx = 0,
    syy = 0,
    sxy = 0,
    weight = 0;
  const aspect = [0, 0, 0, 0];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const gx = (z[y * w + x + 1]! - z[y * w + x - 1]!) / 2,
        gy = (z[(y + 1) * w + x]! - z[(y - 1) * w + x]!) / 2,
        m2 = gx * gx + gy * gy;
      sxx += gx * gx;
      syy += gy * gy;
      sxy += gx * gy;
      if (!m2) continue;
      const m = Math.sqrt(m2),
        axis = latticeAxis((gx * gx - gy * gy) / m2, (2 * gx * gy) / m2, COS_15);
      weight += m;
      if (axis >= 0) aspect[axis]! += m;
    }
  // Eigenvalues of [[sxx, sxy], [sxy, syy]]; the larger one's vector is the slope axis.
  const mean = (sxx + syy) / 2,
    root = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy),
    major = mean + root,
    minor = mean - root,
    anisotropy = minor > 0 ? major / minor : major > 0 ? Infinity : 1;
  let ax = sxy,
    ay = major - sxx;
  if (Math.hypot(ax, ay) < 1e-12 * (major || 1)) [ax, ay] = sxx >= syy ? [1, 0] : [0, 1];
  const am = Math.hypot(ax, ay),
    grainAxis: Point = [-ay / am, ax / am];
  // River banks: every ring edge of every river polygon, except edges on the map frame.
  const grid = [0, 0, 0, 0];
  let length = 0,
    align = 0,
    near = 0;
  for (const water of asset.layers.water ?? [])
    if (water.kind === 'river')
      for (const polygon of water.polygons)
        for (const ring of [polygon.outer, ...polygon.holes])
          for (let k = 1; k < ring.length; k++) {
            const p = ring[k - 1]!,
              q = ring[k]!,
              dx = q[0] - p[0],
              dy = q[1] - p[1],
              len = Math.hypot(dx, dy);
            if (
              len < 1e-6 ||
              (dx === 0 && (p[0] <= b.minX || p[0] >= b.maxX)) ||
              (dy === 0 && (p[1] <= b.minY || p[1] >= b.maxY))
            )
              continue;
            const cos = Math.abs((dx * grainAxis[0] + dy * grainAxis[1]) / len),
              axis = latticeAxis(
                (dx * dx - dy * dy) / (len * len),
                (2 * dx * dy) / (len * len),
                COS_5,
              );
            length += len;
            align += len * cos;
            // Within 15 degrees of the grain: cos(2 delta) = 2cos^2 - 1 >= cos 30.
            if (2 * cos * cos - 1 >= COS_30) near += len;
            if (axis >= 0) grid[axis]! += len;
          }
  const share = (v: number, total: number) => (total ? v / total : 0);
  return {
    anisotropy,
    grainAxis,
    aspectLatticeShare: aspect.map((v) => share(v, weight)) as GrainRealism['aspectLatticeShare'],
    riverBankLengthM: length,
    riverGrainAlignment: share(align, length),
    riverNearGrainShare: share(near, length),
    riverGridShare: grid.map((v) => share(v, length)) as GrainRealism['riverGridShare'],
  };
}

/**
 * Bridges and fords (D46), measured from public geometry with the
 * `shallow-riffle-v1` depth model. Main roads carry a route between villages
 * or boundary exits; minor roads serve a farm.
 */
export interface CrossingRealism {
  bridges: number;
  fords: number;
  /** Deepest modelled riffle depth under any ford, metres. */
  fordMaxDepthM: number;
  /** Fords whose road carries a main (village or boundary) route. */
  fordsOnMainRoads: number;
  /** Highest ford end above its water surface, metres. */
  fordMaxBankM: number;
  /** Steepest ground on a ford's dry ramp, between an end and the water. */
  fordMaxRampGrade: number;
  /** Steepest ground on the roads that join a ford's ends. */
  fordMaxApproachGrade: number;
  /** Crossings that carry a main road. */
  mainRoadCrossings: number;
  /** Shallowest modelled riffle depth under any bridge, metres (Infinity without bridges). */
  bridgeMinDepthM: number;
}

/**
 * Land cover measured on the elevation sample-cell centres (each point takes
 * the cover feature containing it) and on the cover outlines.
 */
export interface CoverRealism {
  features: number;
  /** Shares of covered area (sampled), comparable with the recipe's fractions. */
  woodShare: number;
  fieldShare: number;
  openShare: number;
  /** Mean ground slope (rise/run) under woods and under fields. */
  woodMeanSlope: number;
  fieldMeanSlope: number;
  /** Steepest sampled ground under any field. */
  fieldMaxSlope: number;
  /** Mean distance to the nearest site anchor, metres (0 without sites). */
  woodMeanSettlementDistanceM: number;
  fieldMeanSettlementDistanceM: number;
  /** River flats: covered points within 150 m of a river and under 2 m above its surface. */
  riverFlatPoints: number;
  riverFlatOpenShare: number;
  riverFlatWoodShare: number;
  /** Outline length away from the map edge, metres. */
  boundaryLengthM: number;
  /** Share of that length on axis-aligned (lattice-like) segments. */
  axisAlignedShare: number;
  /** The same share, only on edges two cover features share (land boundaries). */
  sharedAxisAlignedShare: number;
  /** Mean number of outline vertices per feature. */
  meanVertices: number;
}

/** Even-odd scanline fill of a polygon over row/column centre coordinates. */
function scanPolygon(
  polygon: Polygon,
  columns: number,
  rows: number,
  spacing: number,
  visit: (i: number, j: number) => void,
): void {
  const rings = [polygon.outer, ...polygon.holes];
  let minY = Infinity,
    maxY = -Infinity;
  for (const [, y] of polygon.outer) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const j0 = Math.max(0, Math.ceil(minY / spacing - 0.5)),
    j1 = Math.min(rows - 1, Math.floor(maxY / spacing - 0.5));
  for (let j = j0; j <= j1; j++) {
    const y = (j + 0.5) * spacing,
      cuts: number[] = [];
    for (const ring of rings)
      for (let k = 1; k < ring.length; k++) {
        const a = ring[k - 1]!,
          b = ring[k]!;
        if (a[1] > y !== b[1] > y) cuts.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    cuts.sort((p, q) => p - q);
    for (let k = 0; k + 1 < cuts.length; k += 2) {
      const i0 = Math.max(0, Math.ceil(cuts[k]! / spacing - 0.5)),
        i1 = Math.min(columns - 1, Math.floor(cuts[k + 1]! / spacing - 0.5));
      for (let i = i0; i <= i1; i++) visit(i, j);
    }
  }
}

export function coverRealism(asset: MapAsset): CoverRealism {
  const q = createElevationQueries(asset),
    b = asset.bounds,
    spacing = asset.elevation.spacingM,
    columns = asset.elevation.columns - 1,
    rows = asset.elevation.rows - 1,
    cover = asset.layers.cover ?? [],
    kinds = ['open', 'wood', 'field'] as const;
  const kindAt = new Int8Array(columns * rows).fill(-1);
  for (const f of cover)
    for (const p of f.polygons)
      scanPolygon(p, columns, rows, spacing, (i, j) => {
        kindAt[j * columns + i] = kinds.indexOf(f.kind);
      });
  // River segments with their surface level, binned for nearest-segment lookup.
  const bin = 200,
    binColumns = Math.ceil(b.maxX / bin) + 1,
    bins = new Map<number, { a: Point; b: Point; level: number }[]>();
  for (const w of asset.layers.water ?? [])
    if (w.kind === 'river')
      for (let k = 1; k < w.centreline.length; k++) {
        const a = w.centreline[k - 1]!,
          c = w.centreline[k]!,
          level = w.surfaceProfileM[k]!;
        for (
          let by = Math.floor(Math.min(a[1], c[1]) / bin);
          by <= Math.floor(Math.max(a[1], c[1]) / bin);
          by++
        )
          for (
            let bx = Math.floor(Math.min(a[0], c[0]) / bin);
            bx <= Math.floor(Math.max(a[0], c[0]) / bin);
            bx++
          ) {
            const key = by * binColumns + bx;
            bins.set(key, [...(bins.get(key) ?? []), { a, b: c, level }]);
          }
      }
  const sites = asset.layers.sites ?? [];
  const area = [0, 0, 0],
    slope = [0, 0, 0],
    settlement = [0, 0, 0];
  let fieldMaxSlope = 0,
    flat = 0,
    flatOpen = 0,
    flatWood = 0;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < columns; i++) {
      const k = kindAt[j * columns + i]!;
      if (k < 0) continue;
      const x = (i + 0.5) * spacing,
        y = (j + 0.5) * spacing,
        g = q.slopeAt(x, y);
      area[k]!++;
      slope[k]! += g;
      if (k === 2) fieldMaxSlope = Math.max(fieldMaxSlope, g);
      let near = Infinity;
      for (const site of sites) near = Math.min(near, distance([x, y], site.anchor));
      if (near < Infinity) settlement[k]! += near;
      let river = Infinity,
        level = 0;
      const bx = Math.floor(x / bin),
        by = Math.floor(y / bin);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          for (const seg of bins.get((by + dy) * binColumns + bx + dx) ?? []) {
            const d = pointSegmentDistance([x, y], seg.a, seg.b);
            if (d < river) {
              river = d;
              level = seg.level;
            }
          }
      if (river <= 150 && q.heightAt(x, y) - level < 2) {
        flat++;
        if (k === 0) flatOpen++;
        if (k === 1) flatWood++;
      }
    }
  const covered = area[0]! + area[1]! + area[2]!;
  // Outline segments: length on the map edge is excluded; shared segments are
  // those two features both use (cover features never overlap).
  const onEdge = (p: Point, c: Point) =>
    (p[0] === c[0] && (p[0] <= b.minX || p[0] >= b.maxX)) ||
    (p[1] === c[1] && (p[1] <= b.minY || p[1] >= b.maxY));
  const segments = new Map<string, number>();
  const key = (p: Point, c: Point) =>
    p[0] < c[0] || (p[0] === c[0] && p[1] < c[1])
      ? `${p[0]},${p[1]},${c[0]},${c[1]}`
      : `${c[0]},${c[1]},${p[0]},${p[1]}`;
  let vertices = 0;
  for (const f of cover)
    for (const p of f.polygons)
      for (const ring of [p.outer, ...p.holes]) {
        vertices += ring.length - 1;
        for (let k = 1; k < ring.length; k++) {
          const id = key(ring[k - 1]!, ring[k]!);
          segments.set(id, (segments.get(id) ?? 0) + 1);
        }
      }
  let length = 0,
    axis = 0,
    shared = 0,
    sharedAxis = 0;
  for (const [id, uses] of segments) {
    const [x0, y0, x1, y1] = id.split(',').map(Number) as [number, number, number, number];
    if (onEdge([x0, y0], [x1, y1])) continue;
    const len = Math.hypot(x1 - x0, y1 - y0),
      aligned = Math.abs(x1 - x0) < 1e-6 || Math.abs(y1 - y0) < 1e-6;
    length += len;
    if (aligned) axis += len;
    if (uses > 1) {
      shared += len;
      if (aligned) sharedAxis += len;
    }
  }
  const mean = (values: number[], k: number) => (area[k] ? values[k]! / area[k]! : 0);
  return {
    features: cover.length,
    woodShare: covered ? area[1]! / covered : 0,
    fieldShare: covered ? area[2]! / covered : 0,
    openShare: covered ? area[0]! / covered : 0,
    woodMeanSlope: mean(slope, 1),
    fieldMeanSlope: mean(slope, 2),
    fieldMaxSlope,
    woodMeanSettlementDistanceM: mean(settlement, 1),
    fieldMeanSettlementDistanceM: mean(settlement, 2),
    riverFlatPoints: flat,
    riverFlatOpenShare: flat ? flatOpen / flat : 0,
    riverFlatWoodShare: flat ? flatWood / flat : 0,
    boundaryLengthM: length,
    axisAlignedShare: length ? axis / length : 0,
    sharedAxisAlignedShare: shared ? sharedAxis / shared : 0,
    meanVertices: cover.length ? vertices / cover.length : 0,
  };
}

const RING: Point[] = [
  [1, 0],
  [Math.SQRT1_2, Math.SQRT1_2],
  [0, 1],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [-1, 0],
  [-Math.SQRT1_2, -Math.SQRT1_2],
  [0, -1],
  [Math.SQRT1_2, -Math.SQRT1_2],
];

/** Exact maximum directional grade of a straight segment on the bilinear surface. */
export function segmentGradeOnSurface(
  heightAt: (x: number, y: number) => number,
  a: Point,
  b: Point,
  spacing: number,
): { max: number; mean: number } {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = Math.hypot(dx, dy),
    cuts = [0, 1];
  if (!length) return { max: 0, mean: 0 };
  for (const [origin, delta] of [
    [a[0], dx],
    [a[1], dy],
  ] as const)
    if (delta)
      for (
        let k = Math.floor(Math.min(origin, origin + delta) / spacing) + 1;
        k * spacing < Math.max(origin, origin + delta);
        k++
      ) {
        const t = (k * spacing - origin) / delta;
        if (t > 0 && t < 1) cuts.push(t);
      }
  const sorted = [...new Set(cuts)].sort((x, y) => x - y);
  let max = 0;
  for (let j = 1; j < sorted.length; j++) {
    const lo = sorted[j - 1]!,
      hi = sorted[j]!;
    if (hi - lo <= 1e-12) continue;
    const h = (t: number) => heightAt(a[0] + dx * t, a[1] + dy * t),
      h0 = h(lo),
      h1 = h(hi),
      hm = h((lo + hi) / 2),
      quadratic = 2 * (h0 + h1 - 2 * hm),
      linear = h1 - h0 - quadratic,
      piece = length * (hi - lo);
    max = Math.max(max, Math.abs(linear) / piece, Math.abs(2 * quadratic + linear) / piece);
  }
  return { max, mean: Math.abs(heightAt(b[0], b[1]) - heightAt(a[0], a[1])) / length };
}

export function realismReport(asset: MapAsset): RealismReport {
  const q = createElevationQueries(asset),
    b = asset.bounds,
    budget = new TopologyBudget(Number.MAX_SAFE_INTEGER);
  let lo = Infinity,
    hi = -Infinity;
  for (const h of asset.elevation.samples) {
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  const water = asset.layers.water,
    rivers = water.filter((w) => w.kind === 'river');
  const onEdge = (p: Point) => p[0] <= b.minX || p[1] <= b.minY || p[0] >= b.maxX || p[1] >= b.maxY;
  const key = (p: Point) => `${p[0]}:${p[1]}`;
  const starts = new Map<string, typeof rivers>();
  for (const r of rivers) {
    const k = key(r.centreline[0]!);
    starts.set(k, [...(starts.get(k) ?? []), r]);
  }
  // Downstream neighbour: a reach starting where this one ends, else water containing the end.
  const next = new Map<string, (typeof water)[number] | 'outlet' | undefined>();
  let uphillSteps = 0,
    deadEnds = 0,
    confluences = 0;
  // Each reach is checked once; a downstream identity becomes the reach's 'next'.
  for (const r of rivers) {
    const end = r.centreline.at(-1)!,
      level = r.surfaceProfileM.at(-1)!;
    if (onEdge(end)) {
      next.set(r.id, 'outlet');
      continue;
    }
    const following = (starts.get(key(end)) ?? []).filter((o) => o.id !== r.id);
    const joined =
      following[0] ??
      water.find(
        (o) =>
          o.id !== r.id &&
          o.polygons.some((p) => polygonLocation(end, p, budget, '$') !== 'outside'),
      );
    next.set(r.id, joined);
    if (!joined) {
      deadEnds++;
      continue;
    }
    const downstream =
      joined.kind === 'lake' ? joined.surfaceElevationM : joined.surfaceProfileM[0]!;
    if (downstream > level + 1e-6) uphillSteps++;
  }
  // Confluences: water receiving reaches from more than one upstream reach.
  const inflow = new Map<string, number>();
  for (const r of rivers) {
    const n = next.get(r.id);
    if (n && n !== 'outlet') inflow.set(n.id, (inflow.get(n.id) ?? 0) + 1);
  }
  for (const count of inflow.values()) if (count > 1) confluences++;
  const outletOf = (id: string): string | undefined => {
    const seen = new Set<string>();
    for (let cur = rivers.find((r) => r.id === id); cur;) {
      if (seen.has(cur.id)) return undefined;
      seen.add(cur.id);
      const n = next.get(cur.id);
      if (n === 'outlet') return cur.id;
      if (!n || n.kind !== 'river') return n?.id;
      cur = n;
    }
    return undefined;
  };
  const systems = new Set<string>();
  let maxFallM = 0;
  for (const r of rivers) {
    const o = outletOf(r.id);
    if (o === undefined) continue;
    systems.add(o);
    const outlet = rivers.find((x) => x.id === o);
    if (outlet)
      maxFallM = Math.max(maxFallM, r.surfaceProfileM[0]! - outlet.surfaceProfileM.at(-1)!);
  }
  const d = asset.drainage;
  let drained = 0;
  if (d) {
    const outlets = new Set(d.outlets);
    for (const o of outlets) drained += d.accumulation[o]!;
  }
  // Roads.
  let length = 0,
    gradeSum = 0,
    maxGrade = 0,
    margin = 0;
  const degree = new Map<string, number>();
  for (const road of asset.layers.roads) {
    if (road.kind !== 'regional') continue;
    for (const id of [road.fromNodeId, road.toNodeId]) degree.set(id, (degree.get(id) ?? 0) + 1);
    if (road.crossingIds.length) continue;
    for (let i = 1; i < road.path.length; i++) {
      const a = road.path[i - 1]!,
        c = road.path[i]!,
        len = distance(a, c),
        g = segmentGradeOnSurface((x, y) => q.heightAt(x, y), a, c, asset.elevation.spacingM),
        mid: Point = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
      length += len;
      gradeSum += g.mean * len;
      maxGrade = Math.max(maxGrade, g.max);
      if (Math.min(mid[0], mid[1], b.maxX - mid[0], b.maxY - mid[1]) < 100) margin += len;
    }
  }
  // Settlements.
  const segments = rivers.flatMap((r) =>
    r.centreline
      .slice(1)
      .map((p, i) => ({ a: r.centreline[i]!, b: p, level: r.surfaceProfileM[i + 1]! })),
  );
  let maxAnchorSlope = 0,
    summits = 0,
    lowRiverFlats = 0,
    villages = 0,
    nearVillages = 0;
  for (const site of asset.layers.sites) {
    const [x, y] = site.anchor,
      h = q.heightAt(x, y);
    maxAnchorSlope = Math.max(maxAnchorSlope, q.slopeAt(x, y));
    const ring = RING.map(([ux, uy]): Point => [x + ux * 400, y + uy * 400]).filter(
      (p) => p[0] >= 0 && p[1] >= 0 && p[0] <= b.maxX && p[1] <= b.maxY,
    );
    if (ring.length && ring.every((p) => q.heightAt(...p) < h - 1e-6)) summits++;
    let near = Infinity,
      level = -Infinity;
    for (const seg of segments) {
      const dist = pointSegmentDistance(site.anchor, seg.a, seg.b);
      if (dist < near) {
        near = dist;
        level = seg.level;
      }
    }
    if (near < Infinity && h - level < 1) lowRiverFlats++;
    if (site.kind === 'village') {
      villages++;
      if (near <= 800) nearVillages++;
    }
  }
  return {
    terrain: {
      reliefM: hi - lo,
      lakes: water.length - rivers.length,
      boundaryDrainedShare: d ? drained / asset.elevation.samples.length : 0,
    },
    rivers: {
      features: rivers.length,
      systems: systems.size,
      confluences,
      uphillSteps,
      deadEnds,
      maxFallM,
    },
    roads: {
      lengthM: length,
      meanGrade: length ? gradeSum / length : 0,
      maxGrade,
      marginShare: length ? margin / length : 0,
      junctions: [...degree.values()].filter((n) => n >= 3).length,
      bridges: asset.layers.crossings.filter((c) => c.kind === 'bridge').length,
    },
    settlements: {
      sites: asset.layers.sites.length,
      maxAnchorSlope,
      summits,
      lowRiverFlats,
      villagesNearRiver: villages && segments.length ? nearVillages / villages : 0,
    },
    cover: coverRealism(asset),
    crossings: crossingRealism(asset, (x, y) => q.heightAt(x, y), budget),
    grain: grainRealism(asset),
  };
}

function crossingRealism(
  asset: MapAsset,
  heightAt: (x: number, y: number) => number,
  budget: TopologyBudget,
): CrossingRealism {
  const water = asset.layers.water,
    roads = new Map(asset.layers.roads.map((r) => [r.id, r])),
    spacing = asset.elevation.spacingM;
  const result: CrossingRealism = {
    bridges: 0,
    fords: 0,
    fordMaxDepthM: 0,
    fordsOnMainRoads: 0,
    fordMaxBankM: 0,
    fordMaxRampGrade: 0,
    fordMaxApproachGrade: 0,
    mainRoadCrossings: 0,
    bridgeMinDepthM: Infinity,
  };
  for (const crossing of asset.layers.crossings) {
    const river = water.find((w) => w.id === crossing.waterId);
    if (!river || river.kind !== 'river') continue;
    const main = crossing.roadIds.some((id) =>
      roads.get(id)?.routeIds.some((r) => !isMinorRoute(r, asset.layers.sites)),
    );
    if (main) result.mainRoadCrossings++;
    if (crossing.kind === 'bridge') {
      result.bridges++;
      result.bridgeMinDepthM = Math.min(result.bridgeMinDepthM, fordDepthM(river, water, budget));
      continue;
    }
    result.fords++;
    if (main) result.fordsOnMainRoads++;
    result.fordMaxDepthM = Math.max(
      result.fordMaxDepthM,
      riffleDepthM(river.widthM, reachSlope(river, water, budget)),
    );
    const [a, b] = crossing.endpoints,
      surface = river.surfaceProfileM[0]!,
      cuts = segmentCuts(a, b, river.polygons.flatMap(polygonEdges), budget, '$.ford');
    let first: number | undefined,
      last = 1;
    for (let i = 1; i < cuts.length; i++) {
      const mid = interpolate(a, b, (cuts[i - 1]! + cuts[i]!) / 2);
      if (!river.polygons.some((p) => polygonLocation(mid, p, budget, '$.ford') === 'inside'))
        continue;
      first ??= cuts[i - 1]!;
      last = cuts[i]!;
    }
    for (const [end, edge] of [
      [a, interpolate(a, b, first ?? 0)],
      [b, interpolate(a, b, last)],
    ] as [Point, Point][]) {
      result.fordMaxBankM = Math.max(result.fordMaxBankM, heightAt(...end) - surface);
      if (distance(end, edge) > 1e-9)
        result.fordMaxRampGrade = Math.max(
          result.fordMaxRampGrade,
          segmentGradeOnSurface(heightAt, end, edge, spacing).max,
        );
      // Ground roads joining this end: their first segment away from the ford.
      for (const road of asset.layers.roads) {
        if (road.crossingIds.length) continue;
        const at =
          distance(road.path[0]!, end) <= 1e-6
            ? 0
            : distance(road.path.at(-1)!, end) <= 1e-6
              ? road.path.length - 1
              : -1;
        if (at < 0) continue;
        const next = road.path[at === 0 ? 1 : at - 1]!;
        result.fordMaxApproachGrade = Math.max(
          result.fordMaxApproachGrade,
          segmentGradeOnSurface(heightAt, end, next, spacing).max,
        );
      }
    }
  }
  return result;
}
