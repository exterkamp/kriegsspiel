import type { Point, Polygon, Site } from '../contract.js';
import { distance, pointSegmentDistance, polygonArea, polygonsOverlap } from '../geometry.js';
import { deriveSeed, placeId, resolveOverrides } from '../overrides.js';
import { decimal6 } from '../terrain/precision.js';
import { PlanningFailure } from './budget.js';
import { footprint } from './certificates.js';
import type { Context } from './context.js';
import type { SiteSizing } from './types.js';
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
  type Candidate = { anchor: Point; gradient: number; score: number; key: number };
  const candidateSets = new Map<string, Candidate[]>(),
    terrain = landscape(c);
  for (const kind of ['village', 'farm'] as const) {
    if (!slots.some((v) => v.kind === kind)) continue;
    const extent = siteExtent(c, kind),
      candidates: Candidate[] = [];
    for (let y = stride; y <= c.bounds.maxY - stride; y += stride)
      for (let x = stride; x <= c.bounds.maxX - stride; x += stride) {
        c.candidates.take();
        const anchor: Point = [x, y],
          p = square(anchor, extent);
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
      moved = o.anchors.get(slot.id);
    const candidates = moved ? [{ anchor: moved, gradient: 0, score: 0, key: 0 }] : all;
    let chosen: (typeof candidates)[number] | undefined,
      rank = -1;
    for (let i = 0; i < candidates.length; i++) {
      c.candidates.take();
      const cand = candidates[i]!,
        p = square(cand.anchor, extent);
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
      const checked = moved ? footprint(c, p) : { suitable: true, maxGradient: cand.gradient };
      if (!checked.suitable) {
        if (moved)
          throw new PlanningFailure(
            'SITE_OVERRIDE_UNSUITABLE',
            slot.id,
            'Moved permissible footprint violates dry, bounds or gradient constraints.',
          );
        continue;
      }
      chosen = { ...cand, gradient: checked.maxGradient };
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
      rotationDeg: 0,
      placementArea: square(chosen.anchor, extent),
      occupiedFootprint: null,
      population: { requested, assigned: 0, unassigned: requested },
      entrances: [],
    };
    sites.push(site);
    sizes.push({
      siteId: site.id,
      areaM2: polygonArea(site.placementArea),
      extentM: extent,
      maxGradient: chosen.gradient,
      minimumSpacingM: s.minSpacingM,
      candidateRank: rank,
    });
  }
  sites.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  sizes.sort((a, b) => (a.siteId < b.siteId ? -1 : 1));
  return { sites, sizes };
}
