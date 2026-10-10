import type { Point, Polygon, Site } from '../contract.js';
import { distance, polygonArea, polygonsOverlap } from '../geometry.js';
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
  const desired = lo,
    step = c.spacing;
  const rounded = Math.ceil(desired / step) * step;
  return decimal6(rounded <= hi ? rounded : desired);
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
  const candidateSets = new Map<string, { anchor: Point; gradient: number; key: number }[]>();
  for (const kind of ['village', 'farm'] as const) {
    if (!slots.some((v) => v.kind === kind)) continue;
    const extent = siteExtent(c, kind),
      candidates: { anchor: Point; gradient: number; key: number }[] = [];
    for (let y = stride; y <= c.bounds.maxY - stride; y += stride)
      for (let x = stride; x <= c.bounds.maxX - stride; x += stride) {
        c.candidates.take();
        const anchor: Point = [x, y],
          p = square(anchor, extent);
        if (o.exclusions.some((e) => polygonsOverlap(p, e.polygon, c.meter, '$.exclusions')))
          continue;
        const f = footprint(c, p);
        if (!f.suitable) continue;
        candidates.push({
          anchor,
          gradient: f.maxGradient,
          key: deriveSeed(c.input.seed, 'places:v1', `${kind}:${x}:${y}`),
        });
      }
    c.candidates.take(candidates.length * Math.ceil(Math.log2(candidates.length + 1)));
    candidates.sort(
      (a, b) =>
        a.gradient - b.gradient ||
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
    const candidates = moved ? [{ anchor: moved, gradient: 0, key: 0 }] : all;
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
