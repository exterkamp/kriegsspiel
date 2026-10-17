import clipping from 'polygon-clipping';
import {
  HARD_LIMITS,
  type MapAsset,
  type Point,
  type Polygon,
  type Road,
  type Building,
  type Site,
} from '../contract.js';
import { parseAsset } from '../import.js';
import { preflightAsset } from '../resources.js';
import { TopologyBudget } from '../errors.js';
import {
  distance,
  polygonContainsPolygon,
  polygonEdges,
  polygonLocation,
  polygonsOverlap,
  segmentDistance,
  pointSegmentDistance,
  signedRingArea,
  interpolate,
  segmentCuts,
} from '../geometry.js';
import { placeId, resolveOverrides } from '../overrides.js';
import { createPlanningCertificates, type PlanningCertificates } from '../planning/index.js';
import { validateWaterPhysics } from '../geography/index.js';
import { validateContourHeights } from '../terrain/index.js';
import { accessId, isLocalRoad, occupiedEnvelope } from './assemble.js';
import { bounded, compositionLimits, CompositionFailure, Meter, requireValue } from './budget.js';
import { crossingPolicyFor, supportsValidation } from './identity.js';
import { isMinorRoute } from '../geography/shallow.js';
import {
  COMPLETE_VALIDATION_VERSION,
  type CompositionLimits,
  type CompleteValidationResult,
} from './types.js';

export class GeometryMeter extends TopologyBudget {
  constructor(readonly work: Meter) {
    super(Number.MAX_SAFE_INTEGER);
  }
  override consume(_path: string, n = 1): void {
    this.work.take(n);
  }
}
function stop(code: string, message: string, id?: string): never {
  throw new CompositionFailure(code, 'saved complete map', message, id);
}
const equalPolygon = (a: Polygon, b: Polygon, meter: Meter) => {
  meter.take(a.holes.length + b.holes.length + 2);
  meter.take(
    3 *
      (a.outer.length +
        b.outer.length +
        a.holes.reduce((n, r) => n + r.length, 0) +
        b.holes.reduce((n, r) => n + r.length, 0)),
  );
  return JSON.stringify(a) === JSON.stringify(b);
};
type Box = readonly [number, number, number, number];
type Edges = [Point, Point][];
interface PolygonGeometry {
  bounds: Box;
  edges: Edges;
  vertices: number;
  holes: { polygon: Polygon; edges: Edges }[];
}
/** Internal helpers: reserve scans before reads/copies, then reuse their results. */
export function validationBounds(points: Point[], meter: Meter): Box {
  meter.take(points.length * 2 + 1);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    const x = p[0],
      y = p[1];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
}
function polygonGeometry(p: Polygon, meter: Meter): PolygonGeometry {
  meter.take(p.holes.length + 1);
  let vertices = p.outer.length;
  for (const hole of p.holes) vertices += hole.length;
  meter.take(vertices * 4 + p.holes.length + 1);
  const edges = polygonEdges(p),
    holes: PolygonGeometry['holes'] = [];
  for (const outer of p.holes) {
    const polygon = { outer, holes: [] };
    holes.push({ polygon, edges: polygonEdges(polygon) });
  }
  return { bounds: validationBounds(p.outer, meter), edges, vertices, holes };
}
/** Not a public certificate; indexes belong to one already parsed detached asset. */
export class ValidationIndex {
  readonly sites: Map<string, Site>;
  readonly nodes: Map<string, MapAsset['layers']['roadNodes'][number]>;
  readonly roads: Map<string, Road>;
  readonly crossings: Map<string, MapAsset['layers']['crossings'][number]>;
  readonly siteGeometry: Map<string, PolygonGeometry>;
  readonly buildingGeometry: Map<string, PolygonGeometry>;
  readonly roadBounds: Map<string, Box>;
  readonly buildingsBySite: Map<string, Building[]>;
  readonly localBySite: Map<string, Road[]>;
  readonly accessBySite: Map<string, Set<string>>;
  readonly incident: Map<string, Road[]>;
  readonly landmarksBySite: Map<string, MapAsset['layers']['landmarks']>;
  readonly terminalNodes: Map<string, string[]>;
  readonly terminals: Set<string>;
  readonly regional: Road[];
  readonly exits: MapAsset['layers']['roadNodes'];
  constructor(asset: MapAsset, meter: Meter) {
    const l = asset.layers;
    meter.take(
      1 +
        l.sites.length +
        l.roadNodes.length +
        l.roads.length +
        l.buildings.length +
        l.crossings.length +
        l.landmarks.length,
    );
    this.sites = new Map();
    this.nodes = new Map();
    this.roads = new Map();
    this.crossings = new Map();
    this.siteGeometry = new Map();
    this.buildingGeometry = new Map();
    this.roadBounds = new Map();
    this.buildingsBySite = new Map();
    this.localBySite = new Map();
    this.accessBySite = new Map();
    this.incident = new Map();
    this.landmarksBySite = new Map();
    this.terminalNodes = new Map();
    this.terminals = new Set();
    this.regional = [];
    this.exits = [];
    for (const site of l.sites) {
      meter.take(3 + site.entrances.length * 3);
      this.sites.set(site.id, site);
      this.siteGeometry.set(site.id, polygonGeometry(site.placementArea, meter));
      const entries: string[] = [];
      for (const e of site.entrances) {
        entries.push(e.nodeId);
        this.terminals.add(e.nodeId);
      }
      this.terminalNodes.set(site.id, entries);
    }
    for (const b of l.buildings) {
      meter.take(4);
      this.buildingGeometry.set(b.id, polygonGeometry(b.footprint, meter));
      const rows = this.buildingsBySite.get(b.siteId) ?? [];
      rows.push(b);
      this.buildingsBySite.set(b.siteId, rows);
      const ids = this.accessBySite.get(b.siteId) ?? new Set<string>();
      ids.add(accessId(b.id));
      this.accessBySite.set(b.siteId, ids);
    }
    for (const n of l.roadNodes) {
      meter.take(3);
      this.nodes.set(n.id, n);
      if (n.kind === 'boundary-exit') {
        this.exits.push(n);
        this.terminals.add(n.id);
        const id = `boundary:${n.side}`,
          rows = this.terminalNodes.get(id) ?? [];
        rows.push(n.id);
        this.terminalNodes.set(id, rows);
      }
    }
    for (const r of l.roads) {
      meter.take(8);
      this.roads.set(r.id, r);
      this.roadBounds.set(r.id, validationBounds(r.path, meter));
      for (const id of [r.fromNodeId, r.toNodeId]) {
        const rows = this.incident.get(id) ?? [];
        rows.push(r);
        this.incident.set(id, rows);
      }
      if (isLocalRoad(r)) {
        const rows = this.localBySite.get(r.siteId!) ?? [];
        rows.push(r);
        this.localBySite.set(r.siteId!, rows);
      } else this.regional.push(r);
    }
    for (const crossing of l.crossings) {
      meter.take();
      this.crossings.set(crossing.id, crossing);
    }
    for (const landmark of l.landmarks) {
      meter.take(2);
      if (landmark.kind === 'settlement' && landmark.featureId) {
        const rows = this.landmarksBySite.get(landmark.featureId) ?? [];
        rows.push(landmark);
        this.landmarksBySite.set(landmark.featureId, rows);
      }
    }
  }
}
const overlaps = (a: readonly number[], b: readonly number[]) =>
  a[0]! <= b[2]! && b[0]! <= a[2]! && a[1]! <= b[3]! && b[1]! <= a[3]!;
function touchesCorridor(
  p: Polygon,
  edges: Edges,
  a: Point,
  b: Point,
  r: number,
  m: GeometryMeter,
): boolean {
  if (polygonLocation(a, p, m) !== 'outside' || polygonLocation(b, p, m) !== 'outside') return true;
  for (const [c, d] of edges) {
    m.consume('$');
    if (segmentDistance(a, b, c, d) <= r + 1e-9) return true;
  }
  return false;
}
function area(polys: clipping.MultiPolygon, meter: Meter): number {
  meter.take(polys.length + 1);
  for (const p of polys) {
    meter.take(p.length + 1);
    for (const ring of p) meter.take(ring.length + 1);
  }
  return polys.reduce(
    (n, p) =>
      n +
      Math.abs(signedRingArea(p[0]!)) -
      p.slice(1).reduce((s, r) => s + Math.abs(signedRingArea(r)), 0),
    0,
  );
}
function capsule(a: Point, b: Point, r: number, m: Meter): Polygon {
  m.take(128);
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]),
    radius = (r + 2e-6) / Math.cos(Math.PI / 32),
    points: Point[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = angle - Math.PI / 2 + (i * Math.PI) / 16;
    points.push([b[0] + radius * Math.cos(t), b[1] + radius * Math.sin(t)]);
  }
  for (let i = 0; i <= 16; i++) {
    const t = angle + Math.PI / 2 + (i * Math.PI) / 16;
    points.push([a[0] + radius * Math.cos(t), a[1] + radius * Math.sin(t)]);
  }
  points.push([...points[0]!] as Point);
  return { outer: points, holes: [] };
}
function localCorridor(
  asset: MapAsset,
  road: Road,
  meter: Meter,
  geom: GeometryMeter,
  index: ValidationIndex,
): void {
  meter.take();
  const site = index.sites.get(road.siteId!);
  if (!site) stop('LOCAL_SITE', 'Local road lacks a supported site.', road.id);
  for (let i = 1; i < road.path.length; i++) {
    const a = road.path[i - 1]!,
      b = road.path[i]!,
      p = capsule(a, b, road.widthM / 2, meter);
    const v = p.outer.length + site.placementArea.outer.length;
    meter.take(v * v);
    const outside = clipping.difference([p.outer], [site.placementArea.outer]);
    let remainder = outside;
    meter.take(site.entrances.length * (road.routeIds.length + 3));
    const e = site.entrances.find((e) => {
      if (!road.routeIds.includes(e.routeId) || Math.abs(road.widthM - e.widthM) > 1e-6)
        return false;
      const t = (e.bearingDeg * Math.PI) / 180,
        ux = -Math.sin(t),
        uy = Math.cos(t);
      return [a, b].every(
        (p) =>
          Math.abs((p[0] - e.endpoint[0]) * uy - (p[1] - e.endpoint[1]) * ux) < 1e-6 &&
          (p[0] - e.endpoint[0]) * ux + (p[1] - e.endpoint[1]) * uy >= -1e-6,
      );
    });
    if (e) {
      // Only finite outer-boundary overflow at an authoritative inward approach.
      // The mouth runs along the street itself, which lies on the entrance
      // bearing within a micrometre (checked above): a polygonal capsule turned
      // by that micrometre's angle would leave slivers at any bearing that is
      // not a quarter turn (#545).
      const c = e.endpoint,
        [near, far] = distance(a, c) <= distance(b, c) ? [a, b] : [b, a],
        length = distance(near, far),
        ux = (far[0] - near[0]) / length,
        uy = (far[1] - near[1]) / length,
        r = road.widthM / 2,
        L = r + asset.settings.geometry.joinToleranceM;
      // 10 µm wider than the street, as the fork's own mouth: coincident
      // capsule edges are where polygon clipping's sweep line breaks down.
      const mouth = capsule(c, [c[0] + ux * L, c[1] + uy * L], r + 1e-5, meter);
      meter.take((v + mouth.outer.length) ** 2);
      remainder = clipping.difference(outside, [mouth.outer]);
    }
    if (area(remainder, meter) > 1e-9)
      stop(
        'LOCAL_CORRIDOR',
        'Reserved local corridor leaves permissible land outside an exact entrance mouth.',
        road.id,
      );
    for (const hole of index.siteGeometry.get(site.id)!.holes)
      if (touchesCorridor(hole.polygon, hole.edges, a, b, road.widthM / 2, geom))
        stop('LOCAL_CORRIDOR', 'Local corridor contacts a forbidden site hole.', road.id);
  }
}
function graph(roads: Road[], meter: Meter): Map<string, Set<string>> {
  meter.take();
  const result = new Map<string, Set<string>>();
  for (const r of roads) {
    meter.take(3);
    for (const [a, b] of [
      [r.fromNodeId, r.toNodeId],
      [r.toNodeId, r.fromNodeId],
    ]) {
      let set = result.get(a!);
      if (!set) {
        set = new Set();
        result.set(a!, set);
      }
      set.add(b!);
    }
  }
  return result;
}
function reachable(g: Map<string, Set<string>>, start: string, meter: Meter): Set<string> {
  meter.take();
  const seen = new Set([start]),
    queue = [start];
  for (let i = 0; i < queue.length; i++) {
    meter.take();
    for (const next of g.get(queue[i]!) ?? []) {
      meter.take();
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** Independent saved geometry certificate. It never calls any generator. */
export function validateBattlefield(
  raw: unknown,
  options: Partial<CompositionLimits> = {},
): CompleteValidationResult {
  return bounded(() => {
    const limits = compositionLimits(options),
      meter = new Meter(limits.maxValidationWork, 'complete saved validation'),
      geom = new GeometryMeter(meter);
    const usage = preflightAsset(
      raw,
      HARD_LIMITS,
      () => meter.take(),
      () => meter.take(),
    );
    meter.take(usage.nodes); // Reserve Zod's detached schema traversal before cloning.
    // The accepted parser owns its independent topology counter. Reserve its
    // complete hard ceiling rather than allowing hidden work outside this meter.
    meter.take(HARD_LIMITS.maxTopologyChecks);
    const asset = parseAsset(raw);
    if (!supportsValidation(asset))
      stop(
        'UNSUPPORTED_REPLAY',
        'Generator/stage/fork identities are unsupported by this complete validator.',
      );
    if (!asset.drainage)
      stop(
        'DRAINAGE_REQUIRED',
        'A complete supported geography recipe must retain its separate drainage layer.',
      );
    const s = asset.settings;
    meter.take(Math.min(100_000_000, s.limits.maxTopologyChecks * 8));
    requireValue(validateWaterPhysics(asset.elevation, asset.bounds, asset.layers.water, s));
    meter.take(s.limits.maxTopologyChecks);
    requireValue(validateContourHeights(asset.elevation, asset.bounds, asset.layers.contours, s));
    const cert = requireValue(
      createPlanningCertificates(
        {
          elevation: asset.elevation,
          bounds: asset.bounds,
          water: asset.layers.water,
          settings: s,
          seed: asset.provenance.seed,
          limits: { maxValidationWork: Math.min(100_000_000, meter.remaining) },
        },
        (n) => meter.take(n),
      ),
    );
    const sites = asset.layers.sites,
      index = new ValidationIndex(asset, meter),
      nodes = index.nodes,
      roads = index.roads;
    meter.take(1 + (s.settlements.villageCount + s.settlements.farmCount) * 3);
    const expected: string[] = [];
    for (const kind of ['village', 'farm'] as const) {
      const count = kind === 'village' ? s.settlements.villageCount : s.settlements.farmCount;
      for (let i = 0; i < count; i++) {
        const id = placeId(kind, i);
        expected.push(id);
        if (index.sites.get(id)?.kind !== kind)
          stop(
            'SITE_IDENTITY',
            'Stable place slot kind differs from its configured village/farm identity.',
            id,
          );
      }
    }
    if (sites.length !== expected.length)
      stop(
        'SITE_IDENTITY',
        'Complete map does not contain exactly the configured stable place slots.',
      );
    meter.take(asset.overrides.length * 2 + expected.length + 1);
    // resolveOverrides repeats descriptor traversal and schema cloning. Reserve
    // that separate work rather than crediting the initial asset preflight.
    let overrideTraversal = 0;
    preflightAsset(
      asset.overrides,
      HARD_LIMITS,
      () => {
        meter.take();
        overrideTraversal++;
      },
      () => {
        meter.take();
        overrideTraversal++;
      },
    );
    meter.take(overrideTraversal * 2);
    const overrides = resolveOverrides(asset.overrides, expected);
    const allGraph = graph(asset.layers.roads, meter),
      seen = reachable(allGraph, asset.layers.roadNodes[0]?.id ?? '', meter);
    meter.take(asset.layers.roads.length);
    if (asset.layers.roads.some((r) => !seen.has(r.fromNodeId) || !seen.has(r.toNodeId)))
      stop(
        'COMPLETE_CONNECTIVITY',
        'Emitted road graph has a disconnected street, deck or access component.',
      );
    const exits = index.exits;
    if (exits.length !== 1 || exits[0]!.kind !== 'boundary-exit' || exits[0]!.side !== 'west')
      stop(
        'REGIONAL_TERMINALS',
        'Composition v1 requires exactly its declared west boundary exit.',
      );
    const regional = index.regional,
      regionalGraph = graph(regional, meter),
      regionalSeen = reachable(regionalGraph, exits[0]!.id, meter);
    for (const road of regional) {
      meter.take();
      if (road.kind === 'street')
        stop(
          'ROAD_IDENTITY',
          'A local street must use its versioned safe place-scoped identity.',
          road.id,
        );
    }
    for (let i = 0; i < sites.length; i++)
      for (let j = 0; j < i; j++) {
        meter.take();
        const a = sites[i]!,
          b = sites[j]!;
        meter.take(a.placementArea.holes.length + b.placementArea.holes.length + 2);
        if (
          distance(a.anchor, b.anchor) < s.settlements.minSpacingM ||
          polygonsOverlap(a.placementArea, b.placementArea, geom, '$.sites')
        )
          stop('SITE_SPACING', 'Saved sites overlap or violate minimum anchor spacing.', a.id);
      }
    validateRegionalPlacement(asset, regional, geom, meter, index);
    for (const site of sites) {
      meter.take();
      const moved = overrides.anchors.get(site.id),
        renamed = overrides.names.get(site.id);
      if (
        (moved && (moved[0] !== site.anchor[0] || moved[1] !== site.anchor[1])) ||
        (renamed && renamed !== site.name)
      )
        stop('SITE_OVERRIDE', 'Saved site violates resolved ordered move/name overrides.', site.id);
      for (const excluded of overrides.exclusions) {
        meter.take(site.placementArea.holes.length + excluded.polygon.holes.length + 3);
        if (polygonsOverlap(site.placementArea, excluded.polygon, geom, '$.overrides'))
          stop('SITE_OVERRIDE', 'Saved permissible site intersects a hard exclusion.', site.id);
      }
      const suitability = requireValue(cert.footprint(site.placementArea));
      if (!suitability.suitable)
        stop(
          'SITE_SUITABILITY',
          'Whole permissible site fails authoritative suitability.',
          site.id,
        );
      const linked = index.buildingsBySite.get(site.id) ?? [];
      if (
        !linked.length ||
        site.population.unassigned !== 0 ||
        site.population.assigned !== site.population.requested
      )
        stop(
          'POPULATION_CAPACITY',
          'Complete map must satisfy every requested site population.',
          site.id,
        );
      if (
        !site.occupiedFootprint ||
        !equalPolygon(
          site.occupiedFootprint,
          occupiedEnvelope(linked, site.placementArea, meter),
          meter,
        )
      )
        stop(
          'OCCUPIED_ENVELOPE',
          'Occupied envelope differs from the versioned derivation of actual footprints.',
          site.id,
        );
      const local = index.localBySite.get(site.id) ?? [],
        localGraph = graph(local, meter),
        localSeen = reachable(localGraph, site.entrances[0]?.nodeId ?? '', meter);
      for (const road of local) {
        meter.take();
        if (road.kind !== 'street' && !index.accessBySite.get(site.id)?.has(road.id))
          stop(
            'BUILDING_ACCESS',
            'Local track is not a supported explicit dwelling-access identity.',
            road.id,
          );
      }
      for (const e of site.entrances) {
        const entries = index.incident.get(e.nodeId) ?? [];
        meter.take(entries.length * 2 + 1);
        const incident = entries.filter((r) => r.siteId === site.id && isLocalRoad(r));
        if (!regionalSeen.has(e.nodeId) || !localSeen.has(e.nodeId) || incident.length !== 1)
          stop(
            'ENTRANCE_JOIN',
            'Regional entry does not connect exactly to a real local approach.',
            e.id,
          );
        const road = incident[0]!,
          other = road.fromNodeId === e.nodeId ? road.path[1]! : road.path.at(-2)!;
        const bearing =
          ((Math.atan2(other[0] - e.endpoint[0], -(other[1] - e.endpoint[1])) * 180) / Math.PI +
            360) %
          360;
        meter.take(road.routeIds.length + 1);
        const delta = Math.abs(((bearing - e.bearingDeg + 540) % 360) - 180);
        if (
          road.kind !== 'street' ||
          !road.routeIds.includes(e.routeId) ||
          Math.abs(road.widthM - e.widthM) > 1e-6 ||
          Math.abs(delta - 180) > 0.01
        )
          stop(
            'ENTRANCE_JOIN',
            'Local inward tangent, reserved width or route identity differs from exact supplied entry.',
            e.id,
          );
      }
      meter.take(local.length);
      if (local.some((r) => !localSeen.has(r.fromNodeId) || !localSeen.has(r.toNodeId)))
        stop(
          'LOCAL_CONNECTIVITY',
          'Site has a disconnected local/access street component.',
          site.id,
        );
      for (const b of linked) validateBuilding(asset, b, cert, index, geom, meter);
      const landmark = index.landmarksBySite.get(site.id) ?? [];
      if (
        landmark.length !== 1 ||
        landmark[0]!.name !== site.name ||
        distance(landmark[0]!.position, site.anchor) !== 0
      )
        stop(
          'LANDMARK_IDENTITY',
          'Settlement landmark must match its stable site/name/anchor.',
          site.id,
        );
    }
    meter.take(asset.layers.landmarks.length);
    if (
      asset.layers.landmarks.length !== sites.length ||
      asset.layers.landmarks.some((l) => l.kind !== 'settlement')
    )
      stop(
        'LANDMARK_IDENTITY',
        'Composition v1 contains exactly one settlement label per actual place; unsupported decorative landmarks are not certified.',
      );
    meter.take(asset.layers.buildings.length);
    for (const [i, b] of asset.layers.buildings.entries())
      for (let j = 0; j < i; j++) {
        meter.take();
        const other = asset.layers.buildings[j]!;
        meter.take(b.footprint.holes.length + other.footprint.holes.length + 2);
        if (
          overlaps(
            index.buildingGeometry.get(b.id)!.bounds,
            index.buildingGeometry.get(other.id)!.bounds,
          ) &&
          polygonsOverlap(b.footprint, other.footprint, geom, '$.buildings')
        )
          stop('BUILDING_OVERLAP', 'Actual buildings overlap or touch.', b.id);
      }
    for (const crossing of asset.layers.crossings) {
      meter.take(crossing.roadIds.length + 1);
      if (crossing.kind === 'ford') {
        // Fords (D46): wadeable modelled depth, low banks, gentle ramps, minor roads only.
        requireValue(
          cert.ford({
            ...crossing,
            policy: crossingPolicyFor(asset),
            minimumAbutmentM: s.roads.minimumAbutmentM,
          }),
        );
        meter.take(crossing.roadIds.length * (sites.length + 4));
        if (
          crossing.roadIds.some((id) =>
            roads.get(id)?.routeIds.some((r) => !isMinorRoute(r, asset.layers.sites)),
          )
        )
          stop(
            'FORD_MAIN_ROAD',
            'Only minor (farm) roads may ford; main roads cross water by bridge.',
            crossing.id,
          );
      } else
        requireValue(
          cert.bridge({
            ...crossing,
            kind: 'bridge',
            policy: crossingPolicyFor(asset),
            minimumAbutmentM: s.roads.minimumAbutmentM,
          }),
        );
      if (
        !crossing.roadIds.some((id) => {
          const r = roads.get(id);
          return !!r && !isLocalRoad(r);
        })
      )
        stop(
          'BRIDGE_UNUSED',
          'Crossing is not used by the regional terminal network.',
          crossing.id,
        );
    }
    if (s.hydrology.requireRiver && !asset.layers.crossings.some((c) => c.kind === 'bridge'))
      stop('BRIDGE_REQUIRED', 'Required river map has no used bridge.');
    for (const road of asset.layers.roads) {
      meter.take();
      if (isLocalRoad(road)) localCorridor(asset, road, meter, geom, index);
      if (road.crossingIds.length) {
        const crossing = index.crossings.get(road.crossingIds[0]!)!;
        const a = road.path[0]!,
          b = road.path.at(-1)!;
        if (
          road.crossingIds.length !== 1 ||
          road.path.length !== 2 ||
          !(
            (distance(a, crossing.endpoints[0]) <= 1e-6 &&
              distance(b, crossing.endpoints[1]) <= 1e-6) ||
            (distance(a, crossing.endpoints[1]) <= 1e-6 &&
              distance(b, crossing.endpoints[0]) <= 1e-6)
          )
        )
          stop(
            'BRIDGE_LINK',
            'A linked deck edge must be the complete explicit span; ground approaches require separate certified edges.',
            road.id,
          );
      }
      for (let i = 1; i < road.path.length; i++) {
        if (road.crossingIds.length) continue; // Full explicit linear deck was independently certified above.
        let a = road.path[i - 1]!,
          b = road.path[i]!,
          exit: 'north' | 'east' | 'south' | 'west' | undefined;
        const from = nodes.get(road.fromNodeId)!,
          to = nodes.get(road.toNodeId)!;
        if (i === 1 && from.kind === 'boundary-exit') {
          [a, b] = [b, a];
          exit = from.side;
        } else if (i === road.path.length - 1 && to.kind === 'boundary-exit') exit = to.side;
        const certificate = requireValue(cert.roadSegment(a, b, road.widthM, exit));
        if (!certificate.traversable)
          stop('ROAD_CORRIDOR', `Complete reserved corridor fails ${certificate.reason}.`, road.id);
      }
    }
    validateRoutes(asset, regional, index, meter);
    meter.take(sites.length);
    return {
      version: COMPLETE_VALIDATION_VERSION,
      connected: true,
      sites: sites.length,
      buildings: asset.layers.buildings.length,
      assignedPopulation: sites.reduce((n, v) => n + v.population.assigned, 0),
      validationWork: meter.used,
    };
  });
}
export function validateRegionalPlacement(
  asset: MapAsset,
  roads: Road[],
  geom: GeometryMeter,
  meter: Meter,
  index = new ValidationIndex(asset, meter),
): void {
  meter.take(roads.length * asset.layers.sites.length);
  for (const road of roads)
    for (const site of asset.layers.sites) {
      const shape = index.siteGeometry.get(site.id)!,
        rect = shape.bounds,
        rb = index.roadBounds.get(road.id)!,
        r = road.widthM / 2;
      if (!overlaps(rect, [rb[0] - r, rb[1] - r, rb[2] + r, rb[3] + r])) continue;
      const edges = shape.edges;
      for (let i = 1; i < road.path.length; i++) {
        meter.take(site.entrances.length + 1);
        const a = road.path[i - 1]!,
          b = road.path[i]!,
          entry =
            road.siteId === site.id
              ? site.entrances.find(
                  (e) =>
                    e.roadId === road.id &&
                    (distance(e.endpoint, a) <= 1e-6 || distance(e.endpoint, b) <= 1e-6),
                )
              : undefined;
        const cuts = meteredCuts(a, b, edges, geom, meter, '$.regional.sites');
        for (let k = 1; k < cuts.length; k++)
          if (
            polygonLocation(
              interpolate(a, b, (cuts[k - 1]! + cuts[k]!) / 2),
              site.placementArea,
              geom,
            ) === 'inside'
          )
            stop(
              'REGIONAL_SITE_CORRIDOR',
              'Regional centreline enters an unrelated permissible site or turns inward at its own exact entrance.',
              road.id,
            );
        for (const [c, d] of edges) {
          meter.take();
          if (entry && pointSegmentDistance(entry.endpoint, c, d) <= 1e-9) continue;
          if (segmentDistance(a, b, c, d) <= r + 1e-9)
            stop(
              'REGIONAL_SITE_CORRIDOR',
              'Reserved regional corridor contacts permissible land outside its own explicit terminal boundary allowance.',
              road.id,
            );
        }
      }
    }
}
function meteredCuts(
  a: Point,
  b: Point,
  edges: Edges,
  geom: GeometryMeter,
  meter: Meter,
  path: string,
): number[] {
  const maxCuts = edges.length * 2 + 2;
  meter.take(maxCuts * (Math.ceil(Math.log2(maxCuts + 1)) + 3));
  return segmentCuts(a, b, edges, geom, path);
}
export function validateBuilding(
  _asset: MapAsset,
  b: Building,
  cert: PlanningCertificates,
  index: ValidationIndex,
  geom: GeometryMeter,
  meter: Meter,
): void {
  meter.take();
  const site = index.sites.get(b.siteId)!,
    roads = index.roads,
    nodes = index.nodes,
    shape = index.buildingGeometry.get(b.id)!,
    permissible = index.siteGeometry.get(site.id)!;
  if (b.kind !== (site.kind === 'farm' ? 'agricultural' : 'residential'))
    stop(
      'BUILDING_IDENTITY',
      'Dwelling kind differs from its versioned stable village/farm slot.',
      b.id,
    );
  // The common containment helper creates edge arrays and sorts segment cuts.
  // Reserve those copies/sorts independently of its metered exact predicates.
  const maxCuts = permissible.edges.length * 2 + 2;
  meter.take(
    (shape.vertices + permissible.vertices) * 4 +
      shape.edges.length * maxCuts * (Math.ceil(Math.log2(maxCuts + 1)) + 3),
  );
  if (
    b.capacity !== 4 ||
    b.residents < 1 ||
    b.residents > b.capacity ||
    !polygonContainsPolygon(site.placementArea, b.footprint, geom, '$.building')
  )
    stop(
      'BUILDING_CAPACITY',
      'Building violates fixed truthful dwelling capacity/permissible footprint.',
      b.id,
    );
  const suitability = requireValue(cert.footprint(b.footprint));
  meter.take(); // No lookup/scan may proceed after the certificate exhausts work.
  if (!suitability.suitable)
    stop('BUILDING_FOOTPRINT', `Whole building fails ${suitability.reason}.`, b.id);
  const access = roads.get(accessId(b.id));
  if (
    !access ||
    access.kind !== 'track' ||
    access.siteId !== site.id ||
    access.path.length !== 2 ||
    access.widthM !== 0.8 ||
    access.surfaceWidthM !== 0.8 ||
    access.setbackM !== 0 ||
    access.crossingIds.length ||
    access.routeIds.length !== 1 ||
    access.routeIds[0] !== `route:${b.id.slice('building:'.length)}:access`
  )
    stop('BUILDING_ACCESS', 'Building lacks its explicit versioned access track.', b.id);
  const [door, join] = access.path;
  const candidates = index.incident.get(access.toNodeId) ?? [];
  meter.take(candidates.length * 2 + 1);
  const incident = candidates.filter(
    (r) =>
      r.kind === 'street' &&
      r.siteId === site.id &&
      (r.fromNodeId === access.toNodeId || r.toNodeId === access.toNodeId),
  );
  // Nearest-boundary projections are independently rounded to decimal6. The
  // resulting maximum displacement is sqrt(2)/2 micrometre, not a join gap.
  let boundaryDistance = Infinity;
  for (const [a, z] of shape.edges) {
    meter.take();
    boundaryDistance = Math.min(boundaryDistance, pointSegmentDistance(door!, a, z));
  }
  if (
    boundaryDistance > 1e-6 ||
    polygonLocation(interpolate(door!, join!, 1e-4), b.footprint, geom) !== 'outside' ||
    !incident.length ||
    distance(nodes.get(access.toNodeId)!.position, join!) > 1e-9
  )
    stop(
      'BUILDING_ACCESS',
      'Access does not leave actual footprint outward and join a real local street node.',
      b.id,
    );
  const cuts = meteredCuts(door!, join!, shape.edges, geom, meter, '$.access');
  for (let i = 1; i < cuts.length; i++)
    if (
      cuts[i]! > 1e-4 &&
      polygonLocation(
        interpolate(door!, join!, Math.max(1e-4, (cuts[i - 1]! + cuts[i]!) / 2)),
        b.footprint,
        geom,
      ) !== 'outside'
    )
      stop(
        'BUILDING_ACCESS',
        'Access crosses its own actual footprint after the rounded boundary join.',
        b.id,
      );
  meter.take();
  if (index.incident.get(access.fromNodeId)?.length !== 1)
    stop(
      'BUILDING_ACCESS',
      'A building doorway is a terminal node, not an unchecked circulation junction.',
      b.id,
    );
  const rect = shape.bounds;
  meter.take(roads.size * 2 + 1);
  for (const road of roads.values()) {
    if (road.id === access.id) continue;
    const radius = road.widthM / 2 + road.setbackM,
      rb = index.roadBounds.get(road.id)!;
    if (!overlaps(rect, [rb[0] - radius, rb[1] - radius, rb[2] + radius, rb[3] + radius])) continue;
    for (let i = 1; i < road.path.length; i++)
      if (touchesCorridor(b.footprint, shape.edges, road.path[i - 1]!, road.path[i]!, radius, geom))
        stop(
          'BUILDING_ROAD_CLEARANCE',
          'Building contacts another reserved road/access corridor plus setback.',
          b.id,
        );
  }
}
function validateRoutes(
  asset: MapAsset,
  regional: Road[],
  index: ValidationIndex,
  meter: Meter,
): void {
  meter.take();
  const byRoute = new Map<string, Road[]>(),
    terminals = index.terminals;
  for (const road of regional) {
    meter.take();
    if (!road.routeIds.length)
      stop('ROUTE_PROVENANCE', 'Regional road has no logical route provenance.', road.id);
    for (const id of road.routeIds) {
      meter.take(2);
      const list = byRoute.get(id) ?? [];
      list.push(road);
      byRoute.set(id, list);
    }
  }
  meter.take(asset.layers.sites.length + 2);
  const terminalIds = [...index.terminalNodes.keys()];
  const permitted = new Map<string, string[]>();
  for (const from of terminalIds)
    for (const to of terminalIds)
      if (from !== to) {
        meter.take(2);
        permitted.set(`route:${from}:${to}`, [from, to]);
        permitted.set(`route:extra:${from}:${to}`, [from, to]);
      }
  for (const [id, edges] of byRoute) {
    meter.take();
    const g = graph(edges, meter),
      seen = reachable(g, edges[0]!.fromNodeId, meter),
      pair = permitted.get(id),
      bridge = id.startsWith('route:bridge:')
        ? index.crossings.get(id.slice('route:bridge:'.length))
        : undefined;
    if (!pair && !bridge)
      stop(
        'ROUTE_PROVENANCE',
        'Logical regional route has unsupported or missing terminal identity.',
        id,
      );
    let disconnected = false,
      reachedTerminals = 0,
      missingPair = false,
      usedBridge = !bridge;
    for (const n of g.keys()) {
      meter.take();
      if (!seen.has(n)) disconnected = true;
    }
    for (const n of seen) {
      meter.take();
      if (terminals.has(n)) reachedTerminals++;
    }
    for (const t of pair ?? []) {
      const ns = index.terminalNodes.get(t) ?? [];
      meter.take(ns.length + 1);
      if (!ns.some((n) => seen.has(n))) missingPair = true;
    }
    if (bridge)
      for (const e of edges) {
        meter.take(e.crossingIds.length + 1);
        if (e.crossingIds.includes(bridge.id)) usedBridge = true;
      }
    if (disconnected || reachedTerminals < 2 || missingPair || !usedBridge)
      stop(
        'ROUTE_PROVENANCE',
        'Logical regional route is disconnected or does not connect its declared real terminals/deck.',
        id,
      );
  }
}
