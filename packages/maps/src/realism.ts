import type { MapAsset, Point } from './contract.js';
import { distance, pointSegmentDistance, polygonLocation } from './geometry.js';
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
  };
}
