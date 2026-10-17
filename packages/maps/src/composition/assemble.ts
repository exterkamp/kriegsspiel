import clipping from 'polygon-clipping';
import type {
  Building,
  MapLayers,
  MapSettings,
  Point,
  Polygon,
  Road,
  RoadNode,
} from '../contract.js';
import { HARD_LIMITS } from '../contract.js';
import { preflightAsset } from '../resources.js';
import { distance, orientation, pointSegmentDistance } from '../geometry.js';
import { decimal6 } from '../terrain/precision.js';
import { degreeUnit } from '../rotation.js';
import { settlementFrame } from './frame.js';
import { CompositionFailure, Meter } from './budget.js';
import type { LocalLayout } from './settlements.js';

export const localScope = (siteId: string) => siteId.slice('site:'.length);
export const buildingId = (siteId: string, n: number) =>
  `building:${localScope(siteId)}:${String(n).padStart(4, '0')}`;
export const accessId = (id: string) => `road:${id.slice('building:'.length)}:access`;
export const isLocalRoad = (r: Road) =>
  !!r.siteId && r.id.startsWith(`road:${localScope(r.siteId)}:`);
const key = (p: Point) => `${p[0]},${p[1]}`;
/**
 * The projection of p onto the line through a along d, rounded to the decimal6
 * point (of the nine around it) nearest that line. Given the segment's other
 * end b (d = b − a), the projection stays on the segment, at an end exactly.
 */
function onLine(p: Point, a: Point, d: Point, b?: Point): Point {
  const l = d[0] * d[0] + d[1] * d[1];
  if (!(l > 0)) return a;
  const t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l;
  if (b && t <= 0) return a;
  if (b && t >= 1) return b;
  const x = decimal6(a[0] + t * d[0]),
    y = decimal6(a[1] + t * d[1]);
  let best: Point = [x, y],
    offset = Infinity;
  for (const dy of [0, -1, 1])
    for (const dx of [0, -1, 1]) {
      const q: Point = [decimal6(x + dx * 1e-6), decimal6(y + dy * 1e-6)],
        e = Math.abs((q[0] - a[0]) * d[1] - (q[1] - a[1]) * d[0]);
      if (e < offset) {
        offset = e;
        best = q;
      }
    }
  return best;
}
const compare = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** Internal linear index; unmatched accesses never cause a street-by-access scan. */
export function indexStreetAccesses<T extends { streetId: string }>(
  accesses: T[],
  meter: Meter,
): Map<string, T[]> {
  meter.take(accesses.length * 3 + 1);
  const result = new Map<string, T[]>();
  for (const access of accesses) {
    const rows = result.get(access.streetId) ?? [];
    rows.push(access);
    result.set(access.streetId, rows);
  }
  return result;
}
/** Convex occupied envelope; gaps are not occupied primitives or terrain certificates. */
export function occupiedEnvelope(
  buildings: Building[],
  permissible: Polygon,
  meter: Meter,
): Polygon {
  meter.take(buildings.length + 1);
  const count = buildings.reduce((n, b) => n + b.footprint.outer.length - 1, 0);
  meter.take(count * (Math.ceil(Math.log2(count + 1)) + 8));
  const points = buildings.flatMap((b) => b.footprint.outer.slice(0, -1));
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const unique = points.filter((p, i) => i === 0 || key(p) !== key(points[i - 1]!));
  if (unique.length < 3)
    throw new CompositionFailure(
      'OCCUPATION_EMPTY',
      'actual buildings',
      'A populated site needs complete actual footprints.',
    );
  const chain = (rows: Point[]) => {
    const result: Point[] = [];
    for (const p of rows) {
      while (result.length > 1 && orientation(result.at(-2)!, result.at(-1)!, p) <= 0) result.pop();
      result.push(p);
    }
    return result;
  };
  const lo = chain(unique),
    hi = chain([...unique].reverse()),
    ring = [...lo.slice(0, -1), ...hi.slice(0, -1)];
  ring.push([...ring[0]!] as Point);
  meter.take(permissible.holes.length + 1);
  const vertices =
    ring.length + permissible.outer.length + permissible.holes.reduce((n, r) => n + r.length, 0);
  meter.take(vertices * vertices);
  const cut = clipping.intersection([ring], [permissible.outer, ...permissible.holes]);
  if (cut.length !== 1)
    throw new CompositionFailure(
      'OCCUPATION_TOPOLOGY',
      'single polygon envelope',
      'Derived occupied envelope is disconnected.',
    );
  return { outer: cut[0]![0]!, holes: cut[0]!.slice(1) };
}
export function assembleLayouts(
  layers: MapLayers,
  layouts: LocalLayout[],
  settings: MapSettings,
  meter: Meter,
): void {
  const usage = preflightAsset(
    { layers },
    {
      ...HARD_LIMITS,
      maxFeatures: settings.limits.maxFeatures,
      maxVertices: settings.limits.maxVertices,
    },
    () => meter.take(),
    () => meter.take(),
  );
  let features = usage.features,
    vertices = usage.vertices;
  const reserve = (f: number, v: number) => {
    if (features + f > settings.limits.maxFeatures || vertices + v > settings.limits.maxVertices)
      throw new CompositionFailure(
        'COMPOSITION_RESOURCE_LIMIT',
        'aggregate output',
        'Composed feature/coordinate cap exceeded before allocation.',
      );
    features += f;
    vertices += v;
    meter.take(f + v);
  };
  for (const { site, model } of layouts) {
    const source = model.constraints!,
      accessCount = source.buildings.length;
    const upperFeatures = source.nodes.length + source.streets.length + accessCount * 5 + 1;
    const upperVertices =
      source.nodes.length +
      source.streets.length * 2 +
      accessCount * 16 +
      site.placementArea.outer.length +
      1;
    if (
      features + upperFeatures > settings.limits.maxFeatures ||
      vertices + upperVertices > settings.limits.maxVertices
    )
      throw new CompositionFailure(
        'COMPOSITION_RESOURCE_LIMIT',
        'aggregate output staging',
        'Conservative local graph/footprint staging exceeds remaining feature/coordinate capacity before transformations.',
      );
    meter.take(source.nodes.length * 2 + source.streets.length * 4 + accessCount * 20);
    const f = settlementFrame(site),
      metadata = model.constraints!,
      scope = localScope(site.id),
      // A turned frame rounds local points to world points independently (#545).
      turned = site.rotationDeg % 90 !== 0;
    const existing = new Map<string, string>(),
      points = new Map<string, Point>(),
      entrances = new Map<string, Point>();
    meter.take(site.entrances.length * 5 + 1);
    for (const e of site.entrances) {
      existing.set(key(e.endpoint), e.nodeId);
      points.set(e.nodeId, e.endpoint);
      const local = f.local(e.endpoint);
      entrances.set(`${local.x},${local.y}`, e.endpoint);
    }
    // An exact supplied entrance maps back to its own world point, not a rounded
    // copy. In a turned frame every vertex of its lead (exactly on the local
    // axis through it, split wherever accesses join) goes back onto the line of
    // the entrance bearing, within rounding.
    const leads = new Map<string, Point>();
    if (turned) {
      const vertices = metadata.streets.flatMap((street) => street.path);
      meter.take(vertices.length * site.entrances.length + site.entrances.length * 4);
      for (const e of site.entrances) {
        // Whole-degree bearings read the literal table; local ones are quarter turns.
        const unit = degreeUnit(e.bearingDeg),
          localUnit = degreeUnit(f.localBearing(e.bearingDeg));
        if (!unit || !localUnit) continue;
        const local = f.local(e.endpoint),
          inward: Point = [0 - unit[1], unit[0]],
          lx = 0 - localUnit[1],
          ly = localUnit[0],
          reach = e.widthM + 10;
        for (const p of vertices) {
          const dx = p.x - local.x,
            dy = p.y - local.y,
            along = dx * lx + dy * ly;
          if (dx * ly - dy * lx !== 0 || !(along > 0) || along > reach) continue;
          leads.set(`${p.x},${p.y}`, onLine(f.world(p), e.endpoint, inward));
        }
      }
    }
    const world = (p: { x: number; y: number }): Point =>
      entrances.get(`${p.x},${p.y}`) ?? leads.get(`${p.x},${p.y}`) ?? f.world(p);
    let ordinal = 0;
    const node = (p: Point): string => {
      const k = key(p),
        known = existing.get(k);
      if (known) return known;
      const id = `node:${scope}:local:${String(ordinal++).padStart(4, '0')}`;
      reserve(1, 1);
      const n: RoadNode = { id, kind: 'junction', position: p };
      layers.roadNodes.push(n);
      existing.set(k, id);
      points.set(id, p);
      return id;
    };
    const sorted = <T extends { id: string }>(rows: T[]): T[] => {
      meter.take(rows.length * (Math.ceil(Math.log2(rows.length + 1)) + 2) + 1);
      return [...rows].sort(compare);
    };
    for (const n of sorted(metadata.nodes)) node(world(n.point));
    meter.take(model.buildings.length * 2 + 1);
    const account = new Map(model.buildings.map((b) => [b.id, b]));
    const meta = sorted(metadata.buildings),
      buildings: Building[] = [],
      accesses: { id: string; streetId: string; path: [Point, Point]; width: number }[] = [];
    for (const [n, b] of meta.entries()) {
      const raw = account.get(b.id)!;
      const polygon = f.worldPolygon({ outer: raw.footprint, holes: [] });
      const id = buildingId(site.id, n);
      reserve(1, polygon.outer.length);
      const output: Building = {
        id,
        siteId: site.id,
        kind: site.kind === 'farm' ? 'agricultural' : 'residential',
        footprint: polygon,
        capacity: raw.capacity,
        residents: raw.residents,
      };
      buildings.push(output);
      layers.buildings.push(output);
      if (!b.access)
        throw new CompositionFailure(
          'BUILDING_ACCESS',
          'local access',
          'Non-isolated battlefield dwelling lacks certified access.',
          id,
        );
      meter.take(4);
      const access = {
        id,
        streetId: b.access.streetId,
        path: [world(b.access.path[0]), world(b.access.path[1])] as [Point, Point],
        width: b.access.widthM,
      };
      if (turned) {
        // The doorway goes back onto the nearest world footprint edge.
        meter.take(polygon.outer.length);
        let door = access.path[0],
          best = Infinity;
        for (let i = 1; i < polygon.outer.length; i++) {
          const a = polygon.outer[i - 1]!,
            z = polygon.outer[i]!,
            d = pointSegmentDistance(access.path[0], a, z);
          if (d < best) {
            best = d;
            door = onLine(access.path[0], a, [z[0] - a[0], z[1] - a[1]], z);
          }
        }
        access.path[0] = door;
      }
      accesses.push(access);
    }
    const accessesByStreet = indexStreetAccesses(accesses, meter);
    let streetOrdinal = 0;
    for (const street of sorted(metadata.streets)) {
      meter.take(3);
      const a = world(street.path[0]!),
        b = world(street.path.at(-1)!);
      const cuts: Point[] = [a, b];
      for (const access of accessesByStreet.get(street.id) ?? []) {
        meter.take();
        // The join goes back onto the world street it splits.
        if (turned) access.path[1] = onLine(access.path[1], a, [b[0] - a[0], b[1] - a[1]], b);
        if (pointSegmentDistance(access.path[1], a, b) > 1e-6)
          throw new CompositionFailure(
            'BUILDING_ACCESS',
            'normalized street join',
            'Access projection leaves normalized local street.',
            access.id,
          );
        cuts.push(access.path[1]);
      }
      meter.take(cuts.length * (Math.ceil(Math.log2(cuts.length + 1)) + 2));
      cuts.sort((p, q) => distance(a, p) - distance(a, q));
      const ordered = cuts.filter((p, i) => i === 0 || key(p) !== key(cuts[i - 1]!));
      for (let i = 1; i < ordered.length; i++) {
        const p = ordered[i - 1]!,
          q = ordered[i]!;
        const fromNodeId = node(p),
          toNodeId = node(q);
        reserve(1, 2);
        meter.take(street.routeIds.length);
        const road: Road = {
          id: `road:${scope}:street:${String(streetOrdinal++).padStart(4, '0')}`,
          kind: 'street',
          siteId: site.id,
          fromNodeId,
          toNodeId,
          path: [p, q],
          widthM: street.widthM,
          surfaceWidthM: street.surfaceWidthM,
          setbackM: street.setbackM,
          routeIds: [...street.routeIds],
          crossingIds: [],
        };
        layers.roads.push(road);
      }
    }
    for (const access of accesses) {
      const [p, q] = access.path,
        fromNodeId = node(p),
        toNodeId = node(q);
      reserve(1, 2);
      layers.roads.push({
        id: accessId(access.id),
        kind: 'track',
        siteId: site.id,
        fromNodeId,
        toNodeId,
        path: [p, q],
        widthM: access.width,
        surfaceWidthM: access.width,
        setbackM: 0,
        routeIds: [`route:${access.id.slice('building:'.length)}:access`],
        crossingIds: [],
      });
    }
    const occupied = occupiedEnvelope(buildings, site.placementArea, meter);
    reserve(0, occupied.outer.length + occupied.holes.reduce((n, r) => n + r.length, 0));
    site.occupiedFootprint = occupied;
    site.population = {
      requested: model.residents.requested,
      assigned: model.residents.assigned,
      unassigned: model.residents.unassigned,
    };
    reserve(1, 1);
    layers.landmarks.push({
      id: `landmark:${scope}`,
      name: site.name,
      kind: 'settlement',
      position: [...site.anchor],
      featureId: site.id,
    });
  }
}
