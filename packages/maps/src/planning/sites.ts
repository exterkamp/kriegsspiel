import type { Point, Polygon, Site } from '../contract.js';
import { distance, pointSegmentDistance, polygonArea, polygonsOverlap } from '../geometry.js';
import { deriveSeed, placeId, resolveOverrides } from '../overrides.js';
import { decimal6 } from '../terrain/precision.js';
import { PlanningFailure } from './budget.js';
import { footprint } from './certificates.js';
import type { Context } from './context.js';
import type { SiteSizing } from './types.js';
import {
  degreeUnit,
  quarterTurnDegrees,
  quarterTurnVector,
  siteFrameExtents,
} from '../rotation.js';
export function square(anchor: Point, extent: number): Polygon {
  const r = extent / 2,
    [x, y] = anchor;
  const outer: Point[] = [
    [x - r, y - r],
    [x + r, y - r],
    [x + r, y + r],
    [x - r, y + r],
    [x - r, y - r],
  ].map((p) => p.map(decimal6) as Point);
  return { outer, holes: [] };
}
/**
 * A turned site square grows by this much on each side, so rounding its
 * corners to decimal6 never shrinks its area or its extent in its own frame
 * below the recorded size (#545).
 */
const ROTATED_PAD_M = 0.0000015;
/**
 * The permissible square of `extent` about `anchor`, turned by whole degrees
 * `rotationDeg` (local x along [cos θ, sin θ]). An unturned square is exactly
 * `square`. A turned one also carries the midpoint of each side as a vertex:
 * its regional entrance (`Router.attachSites`) then lies exactly on the
 * boundary in world and local coordinates, which a rounded point on a slanted
 * edge would not.
 */
export function orientedSquare(anchor: Point, extent: number, rotationDeg: number): Polygon {
  if (rotationDeg === 0) return square(anchor, extent);
  const [c, s] = degreeUnit(rotationDeg)!,
    h = extent / 2 + ROTATED_PAD_M,
    [x, y] = anchor;
  const at = (u: number, v: number): Point => [
    decimal6(x + c * u * h - s * v * h),
    decimal6(y + s * u * h + c * v * h),
  ];
  const outer = [
    at(-1, -1),
    at(0, -1),
    at(1, -1),
    at(1, 0),
    at(1, 1),
    at(0, 1),
    at(-1, 1),
    at(-1, 0),
  ];
  outer.push([...outer[0]!] as Point);
  return { outer, holes: [] };
}
/**
 * The side midpoints of an oriented site square with their outward unit
 * normals and whole-degree outward bearings (clockwise from north), in the
 * order local −y, +x, +y, −x (north, east, south, west when unturned).
 */
export function siteSides(site: Pick<Site, 'anchor' | 'rotationDeg' | 'placementArea'>): {
  point: Point;
  normal: Point;
  bearingDeg: number;
}[] {
  const ring = site.placementArea.outer;
  if (site.rotationDeg === 0) {
    const [x, y] = site.anchor,
      xs = ring.map((p) => p[0]),
      ys = ring.map((p) => p[1]);
    return [
      { point: [x, Math.min(...ys)], normal: [0, -1], bearingDeg: 0 },
      { point: [Math.max(...xs), y], normal: [1, 0], bearingDeg: 90 },
      { point: [x, Math.max(...ys)], normal: [0, 1], bearingDeg: 180 },
      { point: [Math.min(...xs), y], normal: [-1, 0], bearingDeg: 270 },
    ];
  }
  const [c, s] = degreeUnit(site.rotationDeg)!,
    r = site.rotationDeg;
  return [
    { point: ring[1]!, normal: [s, 0 - c], bearingDeg: r },
    { point: ring[3]!, normal: [c, s], bearingDeg: r + 90 },
    { point: ring[5]!, normal: [0 - s, c], bearingDeg: r + 180 },
    { point: ring[7]!, normal: [0 - c, 0 - s], bearingDeg: r + 270 },
  ];
}
/**
 * Frozen `rotated-sites-any-angle-network-v5` site orientation (#545). A site
 * square turns to follow its ground and its approach:
 *
 * - terrain: the gradient at the anchor and on rings of half and one extent,
 *   each weighted by its size, aligns the sides with the contour and fall
 *   line; it counts fully once the mean aligned gradient reaches `slopeFull`;
 * - valley: the nearest river within `riverM` aligns the sides with its
 *   reach, fading with distance;
 * - approach: the direction to the nearest placed site (else the nearest
 *   requested boundary exit), where its main road will come from, at weight
 *   `approach`, so flat ground still turns square to its road.
 *
 * Directions combine as quarter-turn vectors, and the best whole degree in
 * [0, 90) is read from a literal table: no runtime trigonometry.
 */
export const SITE_ORIENTATION = Object.freeze({
  slopeFull: 0.03,
  riverM: 400,
  river: 1,
  approach: 0.5,
});
export function siteExtent(c: Context, kind: 'village' | 'farm'): number {
  const s = c.settings.settlements,
    config = kind === 'village' ? s.villageSite : s.farmSite;
  const lo = Math.max(config.minExtentM, Math.sqrt(config.minAreaM2)),
    hi = Math.min(config.maxExtentM, Math.sqrt(config.maxAreaM2));
  if (lo > hi)
    throw new PlanningFailure(
      'SITE_SIZE',
      'permissible extents',
      'No extent satisfies the recorded site area/extent interval.',
    );
  const desired = Math.max(lo, c.preferredSiteExtentM[kind] ?? lo),
    step = c.spacing;
  const rounded = Math.ceil(desired / step) * step;
  return decimal6(rounded <= hi ? rounded : desired);
}
/**
 * Frozen `sited-graded-network-v2` site preferences. Lower scores are better. Villages
 * favour gentle valley floors near (but above) rivers, bridge sites and
 * confluences; summits, boggy river flats and the map margin are penalised.
 * Farms use the same terrain terms with weaker attraction to water.
 */
export const SITE_PREFERENCES = Object.freeze({
  /** Weight on (footprint gradient / limit)^2: room for streets and houses comes first. */
  gradient: 3,
  ringRadiusM: 400,
  ringSamples: 8,
  summit: 2,
  valley: 0.4,
  bogHeightM: 2,
  bog: 1,
  riverNearM: 120,
  riverFarM: 700,
  river: 0.8,
  crossingM: 500,
  crossing: 0.6,
  confluenceM: 600,
  confluence: 0.5,
  marginM: 400,
  margin: 0.8,
  farmWater: 0.3,
});
/** Unit ring offsets for relative-height sampling, exact eighth turns. */
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
type RiverSegment = { a: Point; b: Point; level: number; width: number };
interface Landscape {
  rivers: RiverSegment[];
  /** River segments binned by their box, for nearest-river queries. */
  bins: Map<number, number[]>;
  binColumns: number;
  crossings: Point[];
  confluences: Point[];
  reliefScale: number;
}
const RIVER_BIN_M = 250;
/** Candidate work for one site orientation: 17 gradient samples and a river query. */
const SITE_ORIENTATION_WORK = 24;
/** Nearest river segment by expanding bin rings; exact within `limit`, else none. */
function nearestRiver(l: Landscape, p: Point, limit: number): RiverSegment | undefined {
  const bx = Math.floor(p[0] / RIVER_BIN_M),
    by = Math.floor(p[1] / RIVER_BIN_M),
    rings = Math.ceil(limit / RIVER_BIN_M) + 1;
  let best: RiverSegment | undefined,
    near = limit;
  const seen = new Set<number>();
  for (let k = 0; k <= rings; k++) {
    if (best && (k - 1) * RIVER_BIN_M > near) break;
    for (let y = by - k; y <= by + k; y++)
      for (let x = bx - k; x <= bx + k; x++) {
        if (
          Math.max(Math.abs(x - bx), Math.abs(y - by)) !== k ||
          x < 0 ||
          y < 0 ||
          x >= l.binColumns
        )
          continue;
        for (const i of l.bins.get(y * l.binColumns + x) ?? []) {
          if (seen.has(i)) continue;
          seen.add(i);
          const r = l.rivers[i]!,
            dist = pointSegmentDistance(p, r.a, r.b);
          if (dist < near || (dist === near && !best)) {
            near = dist;
            best = r;
          }
        }
      }
  }
  return best;
}
function landscape(c: Context): Landscape {
  const rivers: Landscape['rivers'] = [],
    starts = new Map<string, string>(),
    confluences: Point[] = [];
  for (const w of c.water) {
    if (w.kind !== 'river') continue;
    for (let i = 1; i < w.centreline.length; i++)
      rivers.push({
        a: w.centreline[i - 1]!,
        b: w.centreline[i]!,
        level: w.surfaceProfileM[i]!,
        width: w.widthM,
      });
    starts.set(`${w.centreline[0]![0]}:${w.centreline[0]![1]}`, w.id.split(':')[2]!);
  }
  // A reach ending where another stream's reach begins (or inside it) is a confluence.
  for (const w of c.water) {
    if (w.kind !== 'river') continue;
    const end = w.centreline.at(-1)!,
      other = starts.get(`${end[0]}:${end[1]}`);
    if (other !== undefined && other !== w.id.split(':')[2]) confluences.push(end);
  }
  const crossings = (c.input.crossingCandidates ?? []).map((k): Point => [
    (k.endpoints[0][0] + k.endpoints[1][0]) / 2,
    (k.endpoints[0][1] + k.endpoints[1][1]) / 2,
  ]);
  let lo = Infinity,
    hi = -Infinity;
  for (const h of c.input.elevation.samples) {
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  const binColumns = Math.ceil(c.bounds.maxX / RIVER_BIN_M) + 1,
    bins = new Map<number, number[]>();
  for (const [i, r] of rivers.entries())
    for (
      let y = Math.floor(Math.min(r.a[1], r.b[1]) / RIVER_BIN_M);
      y <= Math.floor(Math.max(r.a[1], r.b[1]) / RIVER_BIN_M);
      y++
    )
      for (
        let x = Math.floor(Math.min(r.a[0], r.b[0]) / RIVER_BIN_M);
        x <= Math.floor(Math.max(r.a[0], r.b[0]) / RIVER_BIN_M);
        x++
      ) {
        const list = bins.get(y * binColumns + x) ?? [];
        list.push(i);
        bins.set(y * binColumns + x, list);
      }
  c.candidates.take(
    Math.ceil(c.input.elevation.samples.length / 64) + 4 * rivers.length + crossings.length,
  );
  return {
    rivers,
    bins,
    binColumns,
    crossings,
    confluences,
    reliefScale: Math.max(5, (hi - lo) * 0.15),
  };
}
function siteScore(
  c: Context,
  l: Landscape,
  kind: 'village' | 'farm',
  anchor: Point,
  gradient: number,
): number {
  const p = SITE_PREFERENCES,
    h = c.q.heightAt(...anchor),
    s = c.settings;
  let ring = 0,
    count = 0;
  for (const [ux, uy] of RING) {
    const x = anchor[0] + ux * p.ringRadiusM,
      y = anchor[1] + uy * p.ringRadiusM;
    if (x < 0 || y < 0 || x > c.bounds.maxX || y > c.bounds.maxY) continue;
    ring += c.q.heightAt(x, y);
    count++;
  }
  const relative = count ? (h - ring / count) / l.reliefScale : 0,
    water = kind === 'village' ? 1 : p.farmWater;
  const flat = gradient / s.settlements.maxBuildingGradient;
  let score = p.gradient * flat * flat;
  score += p.summit * Math.max(0, Math.min(1, relative));
  score -= p.valley * Math.max(0, Math.min(1, -relative));
  if (l.rivers.length) {
    // Beyond 3x the far distance the river penalty is saturated.
    const limit = 3 * p.riverFarM,
      river = nearestRiver(l, anchor, limit),
      near = river ? pointSegmentDistance(anchor, river.a, river.b) : limit,
      nearWidth = river?.width ?? 0;
    if (river && h - river.level < p.bogHeightM) score += p.bog;
    const band =
      near < p.riverNearM + nearWidth / 2
        ? (p.riverNearM + nearWidth / 2 - near) / p.riverNearM
        : near > p.riverFarM
          ? Math.min(1, (near - p.riverFarM) / (2 * p.riverFarM))
          : 0;
    score += water * p.river * band;
  }
  const nearest = (points: Point[]) =>
    points.reduce((m, q) => Math.min(m, distance(anchor, q)), Infinity);
  score -= water * p.crossing * Math.max(0, 1 - nearest(l.crossings) / p.crossingM);
  score -= water * p.confluence * Math.max(0, 1 - nearest(l.confluences) / p.confluenceM);
  const margin = Math.min(
    anchor[0],
    anchor[1],
    c.bounds.maxX - anchor[0],
    c.bounds.maxY - anchor[1],
  );
  score += p.margin * Math.max(0, Math.min(1, (p.marginM - margin) / p.marginM));
  return score;
}
/** The ground and valley part of a site's orientation, as a quarter-turn vector. */
function groundOrientation(c: Context, l: Landscape, anchor: Point, extent: number): Point {
  const o = SITE_ORIENTATION;
  let tx = 0,
    ty = 0,
    n = 0;
  for (const radius of [0, extent / 2, extent])
    for (const [ux, uy] of radius ? RING : [[0, 0] as Point]) {
      const x = anchor[0] + ux * radius,
        y = anchor[1] + uy * radius;
      if (x < 0 || y < 0 || x > c.bounds.maxX || y > c.bounds.maxY) continue;
      const g = c.q.gradientAt(x, y),
        m = Math.sqrt(g.dx * g.dx + g.dy * g.dy),
        [qx, qy] = quarterTurnVector(g.dx, g.dy);
      tx += m * qx;
      ty += m * qy;
      n++;
    }
  let vx = 0,
    vy = 0;
  if (n) {
    tx /= n;
    ty /= n;
    const t = Math.sqrt(tx * tx + ty * ty);
    if (t > 0) {
      const w = Math.min(1, t / o.slopeFull) / t;
      vx += tx * w;
      vy += ty * w;
    }
  }
  const river = l.rivers.length ? nearestRiver(l, anchor, o.riverM) : undefined;
  if (river) {
    const near = pointSegmentDistance(anchor, river.a, river.b),
      [qx, qy] = quarterTurnVector(river.b[0] - river.a[0], river.b[1] - river.a[1]),
      w = o.river * Math.max(0, 1 - near / o.riverM);
    vx += qx * w;
    vy += qy * w;
  }
  return [vx, vy];
}
/** Whole-degree rotation from a ground vector and an approach target. */
function orientation(
  c: Context,
  ground: Point,
  anchor: Point,
  target: Point | undefined,
  key: string,
): number {
  let [vx, vy] = ground;
  if (target) {
    const [qx, qy] = quarterTurnVector(target[0] - anchor[0], target[1] - anchor[1]);
    vx += qx * SITE_ORIENTATION.approach;
    vy += qy * SITE_ORIENTATION.approach;
  }
  return (
    quarterTurnDegrees([vx, vy]) ?? deriveSeed(c.input.seed, 'places:orientation:v1', key) % 90
  );
}
/** Midpoints of the requested boundary sides, where their exits are first tried. */
function exitTargets(c: Context): Point[] {
  const b = c.bounds;
  return (c.input.boundarySides ?? ['west']).map((side): Point =>
    side === 'north'
      ? [b.maxX / 2, 0]
      : side === 'south'
        ? [b.maxX / 2, b.maxY]
        : side === 'east'
          ? [b.maxX, b.maxY / 2]
          : [0, b.maxY / 2],
  );
}
function nearestPoint(p: Point, points: Point[]): Point | undefined {
  let best: Point | undefined,
    d = Infinity;
  for (const q of points) {
    const e = distance(p, q);
    if (e < d) {
      d = e;
      best = q;
    }
  }
  return best;
}
export function placeSites(c: Context): { sites: Site[]; sizes: SiteSizing[] } {
  const s = c.settings.settlements,
    slots: { id: string; kind: 'village' | 'farm' }[] = [];
  for (const kind of ['village', 'farm'] as const)
    for (let n = 0; n < (kind === 'village' ? s.villageCount : s.farmCount); n++)
      slots.push({ id: placeId(kind, n), kind });
  const o = resolveOverrides(
    c.input.overrides ?? [],
    slots.map((v) => v.id),
  );
  const sites: Site[] = [],
    sizes: SiteSizing[] = [];
  const stride = Math.max(
    c.spacing,
    Math.floor(Math.max(c.spacing, s.minSpacingM / 6) / c.spacing) * c.spacing,
  );
  type Candidate = {
    anchor: Point;
    gradient: number;
    score: number;
    key: number;
    rotation: number;
    ground: Point;
  };
  const candidateSets = new Map<string, Candidate[]>(),
    terrain = landscape(c),
    exits = exitTargets(c);
  // A turned square must still fit the recorded size once padded (#545).
  const turnable = (kind: 'village' | 'farm', extent: number) => {
    const config = kind === 'village' ? s.villageSite : s.farmSite,
      padded = extent + 4 * ROTATED_PAD_M;
    return padded <= config.maxExtentM && padded * padded <= config.maxAreaM2;
  };
  for (const kind of ['village', 'farm'] as const) {
    if (!slots.some((v) => v.kind === kind)) continue;
    const extent = siteExtent(c, kind),
      turns = turnable(kind, extent),
      candidates: Candidate[] = [];
    for (let y = stride; y <= c.bounds.maxY - stride; y += stride)
      for (let x = stride; x <= c.bounds.maxX - stride; x += stride) {
        c.candidates.take(turns ? SITE_ORIENTATION_WORK : 1);
        const anchor: Point = [x, y],
          ground = turns ? groundOrientation(c, terrain, anchor, extent) : ([0, 0] as Point),
          rotation = turns
            ? orientation(c, ground, anchor, nearestPoint(anchor, exits), `${kind}:${x}:${y}`)
            : 0,
          p = orientedSquare(anchor, extent, rotation);
        if (o.exclusions.some((e) => polygonsOverlap(p, e.polygon, c.meter, '$.exclusions')))
          continue;
        const f = footprint(c, p);
        if (!f.suitable) continue;
        c.candidates.take(
          SITE_PREFERENCES.ringSamples + 64 + terrain.crossings.length + terrain.confluences.length,
        );
        candidates.push({
          anchor,
          gradient: f.maxGradient,
          score: siteScore(c, terrain, kind, anchor, f.maxGradient),
          key: deriveSeed(c.input.seed, 'places:v1', `${kind}:${x}:${y}`),
          rotation,
          ground,
        });
      }
    c.candidates.take(candidates.length * Math.ceil(Math.log2(candidates.length + 1)));
    candidates.sort(
      (a, b) =>
        a.score - b.score ||
        a.key - b.key ||
        a.anchor[1] - b.anchor[1] ||
        a.anchor[0] - b.anchor[0],
    );
    candidateSets.set(kind, candidates);
  }
  // Moves are hard constraints; place them first so subsequent slots respect them.
  const ordered = [
    ...slots.filter((v) => o.anchors.has(v.id)),
    ...slots.filter((v) => !o.anchors.has(v.id)),
  ];
  for (const slot of ordered) {
    const extent = siteExtent(c, slot.kind),
      all = candidateSets.get(slot.kind) ?? [],
      moved = o.anchors.get(slot.id),
      turns = turnable(slot.kind, extent);
    const candidates: Candidate[] = moved
      ? [
          {
            anchor: moved,
            gradient: 0,
            score: 0,
            key: 0,
            rotation: 0,
            ground: turns ? groundOrientation(c, terrain, moved, extent) : [0, 0],
          },
        ]
      : all;
    let chosen: (Candidate & { area: Polygon }) | undefined,
      rank = -1;
    for (let i = 0; i < candidates.length; i++) {
      c.candidates.take();
      const cand = candidates[i]!;
      // Turn square to the road from the nearest placed site; a turn that no
      // longer fits falls back to the candidate's certified one (#545).
      const target = nearestPoint(cand.anchor, sites.length ? sites.map((t) => t.anchor) : exits);
      let rotation = turns ? orientation(c, cand.ground, cand.anchor, target, slot.id) : 0,
        p = orientedSquare(cand.anchor, extent, rotation);
      if (
        sites.some(
          (site) =>
            distance(site.anchor, cand.anchor) < s.minSpacingM ||
            polygonsOverlap(p, site.placementArea, c.meter, '$.sites'),
        )
      )
        continue;
      if (o.exclusions.some((e) => polygonsOverlap(p, e.polygon, c.meter, '$.exclusions')))
        continue;
      if (++c.placementAttempts > s.maxGlobalPlacementAttempts)
        throw new PlanningFailure(
          'SITE_RETRY_LIMIT',
          'placement attempts',
          'Global site placement attempts exhausted.',
        );
      let checked =
        moved || rotation !== cand.rotation
          ? footprint(c, p)
          : { suitable: true, maxGradient: cand.gradient };
      if (!checked.suitable && rotation !== cand.rotation) {
        // A ranked candidate's own turn was certified (a moved anchor's is unturned).
        rotation = cand.rotation;
        p = orientedSquare(cand.anchor, extent, rotation);
        if (
          sites.some((site) => polygonsOverlap(p, site.placementArea, c.meter, '$.sites')) ||
          o.exclusions.some((e) => polygonsOverlap(p, e.polygon, c.meter, '$.exclusions'))
        )
          continue;
        checked = moved ? footprint(c, p) : { suitable: true, maxGradient: cand.gradient };
      }
      if (!checked.suitable) {
        if (moved)
          throw new PlanningFailure(
            'SITE_OVERRIDE_UNSUITABLE',
            slot.id,
            'Moved permissible footprint violates dry, bounds or gradient constraints.',
          );
        continue;
      }
      chosen = { ...cand, gradient: checked.maxGradient, rotation, area: p };
      rank = i;
      break;
    }
    if (!chosen)
      throw new PlanningFailure(
        'SITE_COUNT_INFEASIBLE',
        slot.id,
        `Cannot place all ${s.villageCount} villages and ${s.farmCount} farms with ${s.minSpacingM}m spacing and complete suitable footprints.`,
      );
    const requested = slot.kind === 'village' ? s.villagePopulation : s.farmPopulation;
    const site: Site = {
      id: slot.id,
      kind: slot.kind,
      name:
        o.names.get(slot.id) ??
        `${slot.kind === 'village' ? 'Village' : 'Farm'} ${Number(slot.id.slice(-4)) + 1}`,
      anchor: chosen.anchor,
      rotationDeg: chosen.rotation,
      placementArea: chosen.area,
      occupiedFootprint: null,
      population: { requested, assigned: 0, unassigned: requested },
      entrances: [],
    };
    sites.push(site);
    sizes.push({
      siteId: site.id,
      areaM2: polygonArea(site.placementArea),
      // A turned square records its measured extent, a few micrometres over.
      extentM: chosen.rotation === 0 ? extent : Math.max(...siteFrameExtents(site)),
      maxGradient: chosen.gradient,
      minimumSpacingM: s.minSpacingM,
      candidateRank: rank,
    });
  }
  sites.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  sizes.sort((a, b) => (a.siteId < b.siteId ? -1 : 1));
  return { sites, sizes };
}
