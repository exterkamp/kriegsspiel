import { AssetSchema, HARD_LIMITS, type GenerationResult, type Point } from '../contract.js';
import { fail } from '../errors.js';
import {
  bearingDegrees,
  distance,
  polygonLocation,
  polygonArea,
  polygonsOverlap,
  pointSegmentDistance,
  segmentDistance,
  polygonEdges,
  interpolate,
  validatePath,
  segmentCuts,
  segmentsIntersect,
} from '../geometry.js';
import { preflightAsset } from '../resources.js';
import { placeId, resolveOverrides } from '../overrides.js';
import { bounded, PlanningFailure } from './budget.js';
import { bridge } from './bridges.js';
import { ford } from './fords.js';
import { isMinorRoute } from '../geography/shallow.js';
import { footprint, corridor, requireFinitePoint } from './certificates.js';
import { Context, box, touches } from './context.js';
import type { PlanningInput, RegionalPlanningOutput } from './types.js';
import { CROSSING_VERSION } from '../geography/types.js';

const same = (p: Point, q: Point) => p[0] === q[0] && p[1] === q[1];
/** Segments sharing exactly one endpoint and leaving it on opposite sides (negative dot). */
function opposite(a: Point, b: Point, c: Point, d: Point): boolean {
  const away = (n: Point, u: Point, v: Point) =>
    (u[0] - n[0]) * (v[0] - n[0]) + (u[1] - n[1]) * (v[1] - n[1]) < 0;
  if (same(a, c)) return away(a, b, d);
  if (same(a, d)) return away(a, b, c);
  if (same(b, c)) return away(b, a, d);
  if (same(b, d)) return away(b, a, c);
  return false;
}
export function validate(c: Context, plan: RegionalPlanningOutput): void {
  preflightAsset(
    { layers: plan },
    {
      ...HARD_LIMITS,
      maxFeatures: c.settings.limits.maxFeatures,
      maxVertices: c.settings.limits.maxVertices,
    },
  );
  for (const key of ['sites', 'roadNodes', 'roads', 'crossings'] as const) {
    c.validation.take(plan[key].length);
    const parsed = AssetSchema.shape.layers.shape[key].safeParse(plan[key]);
    if (!parsed.success) fail(`$.planning.${key}`, parsed.error.message);
  }
  if (
    plan.sites.filter((s) => s.kind === 'village').length !== c.settings.settlements.villageCount ||
    plan.sites.filter((s) => s.kind === 'farm').length !== c.settings.settlements.farmCount
  )
    throw new PlanningFailure(
      'SITE_COUNTS',
      'required sites',
      'Plan does not contain exactly the requested stable site counts.',
    );
  const expectedIds = new Set<string>();
  for (const kind of ['village', 'farm'] as const)
    for (
      let i = 0;
      i <
      (kind === 'village' ? c.settings.settlements.villageCount : c.settings.settlements.farmCount);
      i++
    )
      expectedIds.add(placeId(kind, i));
  const overrides = resolveOverrides(c.input.overrides ?? [], expectedIds);
  for (const site of plan.sites) {
    if (!expectedIds.has(site.id) || !site.id.startsWith(`site:${site.kind}:`))
      throw new PlanningFailure(
        'SITE_IDENTITY',
        site.id,
        'Sites must retain the configured geometry-independent recipe slots.',
      );
    if (
      (overrides.anchors.has(site.id) &&
        distance(site.anchor, overrides.anchors.get(site.id)!) > 1e-6) ||
      (overrides.names.has(site.id) && site.name !== overrides.names.get(site.id)) ||
      overrides.exclusions.some((e) =>
        polygonsOverlap(site.placementArea, e.polygon, c.meter, '$.overrides'),
      )
    )
      throw new PlanningFailure(
        'SITE_OVERRIDE',
        site.id,
        'Actual site violates a resolved hard move/name or exclusion union.',
      );
  }
  const nodes = new Map(plan.roadNodes.map((n) => [n.id, n])),
    roads = new Map(plan.roads.map((r) => [r.id, r])),
    crossings = new Map(plan.crossings.map((b) => [b.id, b])),
    decks = new Map(plan.decks.map((d) => [d.crossingId, d])),
    fords = new Map((plan.fords ?? []).map((f) => [f.crossingId, f]));
  const ids = new Set<string>();
  for (const obj of [
    ...plan.roadNodes,
    ...plan.roads,
    ...plan.crossings,
    ...plan.sites,
    ...plan.sites.flatMap((s) => s.entrances),
  ]) {
    c.validation.take();
    if (ids.has(obj.id)) fail('$.planning', 'Duplicate global feature ID');
    ids.add(obj.id);
  }
  const adjacency = new Map<string, Set<string>>();
  const join = c.settings.geometry.joinToleranceM;
  for (const site of plan.sites) {
    const area = polygonArea(site.placementArea),
      rect = box(site.placementArea.outer),
      width = rect[2] - rect[0],
      height = rect[3] - rect[1],
      config =
        site.kind === 'village'
          ? c.settings.settlements.villageSite
          : c.settings.settlements.farmSite;
    const size = plan.sizes.find((s) => s.siteId === site.id);
    if (
      !size ||
      !Number.isFinite(size.areaM2) ||
      !Number.isFinite(size.extentM) ||
      Math.abs(size.areaM2 - area) > 1e-6 ||
      Math.abs(size.extentM - Math.max(width, height)) > 1e-6 ||
      area < config.minAreaM2 ||
      area > config.maxAreaM2 ||
      Math.min(width, height) < config.minExtentM ||
      Math.max(width, height) > config.maxExtentM
    )
      throw new PlanningFailure(
        'SITE_SIZE',
        site.id,
        'Actual permissible polygon area/extent and recorded sizing must satisfy the configured interval.',
      );
    if (polygonLocation(site.anchor, site.placementArea, c.meter) === 'outside')
      throw new PlanningFailure(
        'SITE_ANCHOR',
        site.id,
        'Site anchor must belong to its actual permissible region.',
      );
    const check = footprint(c, site.placementArea);
    if (!check.suitable)
      throw new PlanningFailure(
        'SITE_FOOTPRINT',
        site.id,
        `Complete permissible footprint fails ${check.reason}.`,
      );
    if (
      !Number.isFinite(size.maxGradient) ||
      Math.abs(size.maxGradient - check.maxGradient) > 1e-10 ||
      size.minimumSpacingM !== c.settings.settlements.minSpacingM
    )
      throw new PlanningFailure(
        'SITE_SIZE_EVIDENCE',
        site.id,
        'Recorded gradient/spacing evidence must agree with independent geometry checks.',
      );
    for (const other of plan.sites) {
      c.validation.take();
      if (
        other.id !== site.id &&
        distance(site.anchor, other.anchor) < c.settings.settlements.minSpacingM
      )
        throw new PlanningFailure('SITE_SPACING', site.id, 'Site anchors violate minimum spacing.');
    }
    if (!site.entrances.length)
      throw new PlanningFailure(
        'SITE_ENTRANCE_DISCONNECTED',
        site.id,
        'Required site has no authoritative regional entrance.',
      );
    for (const entrance of site.entrances) {
      const road = roads.get(entrance.roadId),
        node = nodes.get(entrance.nodeId);
      if (
        !road ||
        !node ||
        !road.routeIds.includes(entrance.routeId) ||
        !road.path.length ||
        !(road.fromNodeId === node.id || road.toNodeId === node.id) ||
        distance(entrance.endpoint, node.position) > join ||
        polygonLocation(entrance.endpoint, site.placementArea, c.meter) !== 'boundary' ||
        Math.abs(entrance.widthM - road.widthM) > join
      )
        throw new PlanningFailure(
          'ENTRANCE_JOIN',
          entrance.id,
          'Entrance must join its regional edge/node on the permissible boundary with matching width and route provenance.',
        );
      const atFrom = road.fromNodeId === node.id,
        endpoint = atFrom ? road.path[0]! : road.path.at(-1)!,
        next = atFrom ? road.path[1]! : road.path.at(-2)!;
      const delta = Math.abs(
        ((bearingDegrees(endpoint, next) - entrance.bearingDeg + 540) % 360) - 180,
      );
      if (distance(endpoint, entrance.endpoint) > join || delta > 0.01)
        throw new PlanningFailure(
          'ENTRANCE_BEARING',
          entrance.id,
          'Entrance endpoint/outward bearing must agree with the actual regional tangent.',
        );
    }
  }
  for (const road of plan.roads) {
    validatePath(road.path, '$.roads.path', c.meter);
    const a = nodes.get(road.fromNodeId),
      b = nodes.get(road.toNodeId);
    if (
      !a ||
      !b ||
      distance(road.path[0]!, a.position) > join ||
      distance(road.path.at(-1)!, b.position) > join
    )
      throw new PlanningFailure(
        'ROAD_JOIN',
        road.id,
        'Road path endpoints must coincide with explicit graph nodes.',
      );
    if (
      road.widthM > c.settings.roads.maxReservedWidthM ||
      road.surfaceWidthM > road.widthM ||
      !road.routeIds.length
    )
      throw new PlanningFailure(
        'ROAD_DIMENSIONS',
        road.id,
        'Road dimensions/provenance violate the recorded contract.',
      );
    for (const site of plan.sites) {
      c.validation.take();
      const rect = box(site.placementArea.outer),
        roadBox = box(road.path),
        radius = road.widthM / 2;
      if (
        !touches(rect, [
          roadBox[0] - radius,
          roadBox[1] - radius,
          roadBox[2] + radius,
          roadBox[3] + radius,
        ])
      )
        continue;
      const edges = polygonEdges(site.placementArea);
      for (let i = 1; i < road.path.length; i++) {
        const p = road.path[i - 1]!,
          q = road.path[i]!;
        const ownEntrance =
          road.siteId === site.id
            ? site.entrances.find(
                (e) =>
                  e.roadId === road.id &&
                  (distance(e.endpoint, p) <= 1e-6 || distance(e.endpoint, q) <= 1e-6),
              )
            : undefined;
        const cuts = segmentCuts(p, q, edges, c.meter, '$.roads.sites');
        for (let j = 1; j < cuts.length; j++)
          if (
            polygonLocation(
              interpolate(p, q, (cuts[j - 1]! + cuts[j]!) / 2),
              site.placementArea,
              c.meter,
            ) === 'inside'
          )
            throw new PlanningFailure(
              'ROAD_SITE_INTERIOR',
              road.id,
              'Regional centreline must leave its own boundary outward and may not enter any permissible site interior.',
            );
        for (const [u, v] of edges) {
          c.validation.take();
          if (ownEntrance && pointSegmentDistance(ownEntrance.endpoint, u, v) <= 1e-9) continue;
          if (segmentDistance(p, q, u, v) <= radius + 1e-9)
            throw new PlanningFailure(
              'ROAD_SITE_CORRIDOR',
              road.id,
              'Reserved corridor cuts a permissible site outside its explicit terminal entrance allowance.',
            );
        }
      }
    }
    if (road.crossingIds.length) {
      if (road.crossingIds.length !== 1)
        throw new PlanningFailure(
          'BRIDGE_EDGE',
          road.id,
          'Planning v1 uses one explicit bridge per straight deck edge.',
        );
      const bridge = crossings.get(road.crossingIds[0]!);
      if (
        !bridge ||
        !bridge.roadIds.includes(road.id) ||
        road.path.length !== 2 ||
        road.widthM > bridge.widthM ||
        !(
          (distance(road.path[0]!, bridge.endpoints[0]) <= 1e-6 &&
            distance(road.path[1]!, bridge.endpoints[1]) <= 1e-6) ||
          (distance(road.path[0]!, bridge.endpoints[1]) <= 1e-6 &&
            distance(road.path[1]!, bridge.endpoints[0]) <= 1e-6)
        )
      )
        throw new PlanningFailure(
          'BRIDGE_EDGE',
          road.id,
          'Deck edge must cover and join the complete explicit bridge span with reciprocal references.',
        );
    } else {
      for (let i = 1; i < road.path.length; i++) {
        let p = road.path[i - 1]!,
          q = road.path[i]!;
        let exit: 'north' | 'east' | 'south' | 'west' | undefined;
        if (i === 1 && a.kind === 'boundary-exit') {
          [p, q] = [q, p];
          exit = a.side;
        }
        if (i === road.path.length - 1 && b.kind === 'boundary-exit') exit = b.side;
        const check = corridor(c, p, q, road.widthM, exit);
        if (!check.traversable)
          throw new PlanningFailure(
            'ROAD_CORRIDOR',
            road.id,
            `Complete reserved ground corridor fails ${check.reason}.`,
          );
      }
    }
    for (const [x, y] of [
      [a.id, b.id],
      [b.id, a.id],
    ]) {
      const list = adjacency.get(x!) ?? new Set();
      list.add(y!);
      adjacency.set(x!, list);
    }
  }
  for (const crossing of plan.crossings) {
    if (crossing.kind === 'ford') {
      const recorded = fords.get(crossing.id);
      if (
        !recorded ||
        crossing.traversableWidthM !== crossing.widthM ||
        !crossing.roadIds.length ||
        crossing.roadIds.some((id) => !roads.get(id)?.crossingIds.includes(crossing.id))
      )
        throw new PlanningFailure(
          'ORPHAN_CROSSING',
          crossing.id,
          'Ford requires reciprocal road links and an explicit ford certificate.',
        );
      const actual = ford(c, {
        ...crossing,
        minimumAbutmentM: c.settings.roads.minimumAbutmentM,
        policy: CROSSING_VERSION,
      });
      if (JSON.stringify(actual) !== JSON.stringify(recorded))
        throw new PlanningFailure('FORD_PROFILE', crossing.id, 'Ford certificate disagrees.');
      c.validation.take(crossing.roadIds.length * plan.sites.length);
      if (
        crossing.roadIds.some((id) =>
          roads.get(id)!.routeIds.some((r) => !isMinorRoute(r, plan.sites)),
        )
      )
        throw new PlanningFailure(
          'FORD_MAIN_ROAD',
          crossing.id,
          'Only minor (farm) roads may ford; main roads cross water by bridge.',
        );
    }
    const profile = crossing.kind === 'bridge' ? decks.get(crossing.id) : undefined;
    if (
      crossing.kind === 'bridge' &&
      (!profile ||
        !crossing.roadIds.length ||
        crossing.roadIds.some((id) => !roads.get(id)?.crossingIds.includes(crossing.id)))
    )
      throw new PlanningFailure(
        'ORPHAN_CROSSING',
        crossing.id,
        'Crossing requires reciprocal road links and an explicit deck certificate.',
      );
    if (crossing.kind === 'bridge')
      bridge(
        c,
        {
          ...crossing,
          minimumAbutmentM: c.settings.roads.minimumAbutmentM,
          policy: CROSSING_VERSION,
        },
        profile,
      );
    for (const endpoint of crossing.endpoints) {
      const node = plan.roadNodes.find((n) => distance(n.position, endpoint) <= 1e-6);
      if (
        !node ||
        ![...roads.values()].some(
          (r) => !r.crossingIds.length && (r.fromNodeId === node.id || r.toNodeId === node.id),
        )
      )
        throw new PlanningFailure(
          'BRIDGE_APPROACH',
          crossing.id,
          'Each abutment must have an actually joined certified ground approach.',
        );
    }
  }
  for (const n of plan.roadNodes)
    if (n.kind === 'boundary-exit') {
      const on =
        n.side === 'north'
          ? n.position[1] === 0
          : n.side === 'south'
            ? n.position[1] === c.bounds.maxY
            : n.side === 'east'
              ? n.position[0] === c.bounds.maxX
              : n.position[0] === 0;
      if (!on || adjacency.get(n.id)?.size !== 1)
        throw new PlanningFailure(
          'BOUNDARY_EXIT',
          n.id,
          'Declared exits lie on their exact side and have degree one.',
        );
    }
  const requestedSides = c.input.boundarySides ?? ['west'],
    actualSides = plan.roadNodes
      .filter((n) => n.kind === 'boundary-exit')
      .map((n) => (n.kind === 'boundary-exit' ? n.side : ''));
  if (
    new Set(requestedSides).size !== requestedSides.length ||
    actualSides.length !== requestedSides.length ||
    requestedSides.some((side) => !actualSides.includes(side))
  )
    throw new PlanningFailure(
      'BOUNDARY_EXIT_SET',
      'requested boundary sides',
      'Actual explicit exits must match the complete requested boundary-side set.',
    );
  const routeIds = new Set<string>();
  const terminals = new Map<string, string[]>();
  for (const site of plan.sites)
    terminals.set(
      site.id,
      site.entrances.map((e) => e.nodeId),
    );
  for (const n of plan.roadNodes)
    if (n.kind === 'boundary-exit') terminals.set(`boundary:${n.side}`, [n.id]);
  const routeMembership = new Map<string, Set<string>>();
  for (const road of plan.roads)
    for (const id of road.routeIds) {
      c.validation.take();
      const set = routeMembership.get(id) ?? new Set<string>();
      set.add(road.id);
      routeMembership.set(id, set);
    }
  for (const route of plan.routes) {
    c.validation.take(route.roadIds.length + route.crossingIds.length + 1);
    if (
      !/^[a-z][a-z0-9:_-]{0,95}$/.test(route.id) ||
      routeIds.has(route.id) ||
      !terminals.has(route.from) ||
      !terminals.has(route.to) ||
      route.from === route.to
    )
      throw new PlanningFailure(
        'ROUTE_PROVENANCE',
        route.id,
        'Logical routes require unique valid IDs and existing distinct site/exit terminals.',
      );
    routeIds.add(route.id);
    const membership = routeMembership.get(route.id) ?? new Set<string>();
    if (
      !route.roadIds.length ||
      new Set(route.roadIds).size !== route.roadIds.length ||
      route.roadIds.length !== membership.size ||
      route.roadIds.some((id) => !membership.has(id))
    )
      throw new PlanningFailure(
        'ROUTE_MEMBERSHIP',
        route.id,
        'Road/route memberships must be complete and reciprocal.',
      );
    const crossingSet = new Set<string>(),
      adj = new Map<string, string[]>();
    for (const id of route.roadIds) {
      c.validation.take();
      const road = roads.get(id)!;
      for (const cid of road.crossingIds) crossingSet.add(cid);
      for (const [a, b] of [
        [road.fromNodeId, road.toNodeId],
        [road.toNodeId, road.fromNodeId],
      ])
        adj.set(a!, [...(adj.get(a!) ?? []), b!]);
    }
    if (
      new Set(route.crossingIds).size !== route.crossingIds.length ||
      route.crossingIds.length !== crossingSet.size ||
      route.crossingIds.some((id) => !crossingSet.has(id))
    )
      throw new PlanningFailure(
        'ROUTE_CROSSINGS',
        route.id,
        'Route crossing memberships must equal its actual deck edges.',
      );
    const visited = new Set<string>(),
      queue = [terminals.get(route.from)![0]!];
    for (let i = 0; i < queue.length; i++) {
      const n = queue[i]!;
      if (visited.has(n)) continue;
      visited.add(n);
      for (const other of adj.get(n) ?? []) {
        c.validation.take();
        if (!visited.has(other)) queue.push(other);
      }
    }
    if (
      !terminals.get(route.to)!.some((id) => visited.has(id)) ||
      [...adj.keys()].some((id) => !visited.has(id))
    )
      throw new PlanningFailure(
        'ROUTE_CONNECTIVITY',
        route.id,
        'Each logical route must connect its declared terminals through its own emitted edge set.',
      );
  }
  if ([...routeMembership.keys()].some((id) => !routeIds.has(id)))
    throw new PlanningFailure(
      'ROUTE_PROVENANCE',
      'roads',
      'A road references a nonexistent logical route.',
    );
  // Independent graph walk on validated emitted edges, never candidate adjacency.
  const required = [
    ...plan.sites.flatMap((s) => s.entrances.map((e) => e.nodeId)),
    ...plan.roadNodes.filter((n) => n.kind === 'boundary-exit').map((n) => n.id),
  ];
  const reached = new Set<string>(),
    queue: string[] = required.length ? [required[0]!] : [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    if (reached.has(id)) continue;
    reached.add(id);
    for (const other of adjacency.get(id) ?? []) {
      c.validation.take();
      if (!reached.has(other)) queue.push(other);
    }
  }
  if (required.some((id) => !reached.has(id)) || plan.roadNodes.some((n) => !reached.has(n.id)))
    throw new PlanningFailure(
      'REGIONAL_CONNECTIVITY',
      'validated graph',
      'Required site approaches, boundary exits and all deck nodes must share one traversable graph component.',
    );
  if (c.input.requireBridge && !plan.crossings.some((x) => x.kind === 'bridge'))
    throw new PlanningFailure(
      'REQUIRED_BRIDGE_INFEASIBLE',
      'used bridge',
      'Required crossing fixture emitted no linked bridge.',
    );
  // Reject geometric intersections that are not explicit shared endpoint nodes.
  const segments = plan.roads.flatMap((road) =>
      road.path.slice(1).map((b, i) => ({ road, a: road.path[i]!, b })),
    ),
    bins = new Map<string, number[]>();
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!,
      rect = box([s.a, s.b]),
      near = new Set<number>();
    for (let y = Math.floor(rect[1] / c.binSize); y <= Math.floor(rect[3] / c.binSize); y++)
      for (let x = Math.floor(rect[0] / c.binSize); x <= Math.floor(rect[2] / c.binSize); x++) {
        c.validation.take();
        const key = `${x}:${y}`,
          list = bins.get(key) ?? [];
        for (const j of list) {
          c.validation.take();
          near.add(j);
        }
        list.push(i);
        bins.set(key, list);
      }
    for (const j of near) {
      const t = segments[j]!;
      c.validation.take();
      if (!touches(rect, box([t.a, t.b])) || !segmentsIntersect(s.a, s.b, t.a, t.b)) continue;
      if (s.road.id === t.road.id) continue;
      const shared = [s.road.fromNodeId, s.road.toNodeId].filter(
        (id) => id === t.road.fromNodeId || id === t.road.toNodeId,
      );
      if (!shared.length)
        throw new PlanningFailure(
          'UNJOINED_INTERSECTION',
          s.road.id,
          'Geometrically intersecting edges require an explicit common endpoint node.',
        );
      // Two straight edges meeting end to end at one point, running away from
      // it on opposite sides, meet only there. Nearly collinear, the line
      // intersection is ill-conditioned and lands micrometres inside an edge,
      // a false overlap (#542); the shared point itself is the join.
      if (opposite(s.a, s.b, t.a, t.b)) continue;
      const cuts = segmentCuts(s.a, s.b, [[t.a, t.b]], c.meter, '$.roads');
      if (cuts.some((v) => v > 1e-8 && v < 1 - 1e-8))
        throw new PlanningFailure(
          'OVERLAPPING_ROADS',
          s.road.id,
          'Road interiors may not overlap even when endpoints are shared.',
        );
    }
  }
}
export function validatePlanning(
  input: PlanningInput,
  plan: RegionalPlanningOutput,
): GenerationResult<{ connected: true; validationWork: number }> {
  return bounded(() => {
    const c = new Context(input);
    validate(c, plan);
    return { connected: true, validationWork: c.validation.used };
  });
}
export function validateRoadPath(
  input: PlanningInput,
  path: Point[],
  width?: number,
): GenerationResult<{ maxDirectionalGrade: number }> {
  return bounded(() => {
    const c = new Context(input);
    preflightAsset({ path }, { ...HARD_LIMITS, maxVertices: c.settings.limits.maxVertices }, () =>
      c.validation.take(),
    );
    if (!Array.isArray(path) || path.length < 2)
      fail('$.path', 'Road path requires at least two finite points');
    for (const [i, p] of path.entries()) requireFinitePoint(p, `$.path[${i}]`);
    validatePath(path, '$.path', c.meter);
    let max = 0;
    for (let i = 1; i < path.length; i++) {
      const check = corridor(
        c,
        path[i - 1]!,
        path[i]!,
        width ?? c.settings.roads.maxReservedWidthM,
      );
      if (!check.traversable)
        throw new PlanningFailure(
          'ROAD_CORRIDOR',
          'smoothed path',
          `Complete proposed corridor fails ${check.reason}.`,
        );
      max = Math.max(max, check.maxDirectionalGrade);
    }
    return { maxDirectionalGrade: max };
  });
}
