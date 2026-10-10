import type { Crossing, Point, Road, RoadNode, Site } from '../contract.js';
import { bearingDegrees, distance, interpolate, segmentCuts } from '../geometry.js';
import { decimal6 } from '../terrain/precision.js';
import { PlanningFailure, Work } from './budget.js';
import { box, touches, type Context } from './context.js';
import { type Edge, Router } from './router.js';
import {
  PLANNING_VERSION,
  type RegionalPlanningOutput,
  type RouteProvenance,
  type SiteSizing,
} from './types.js';
export const coordinateId = (p: Point): string =>
  `${Math.round(decimal6(p[0]) * 1_000_000)}:${Math.round(decimal6(p[1]) * 1_000_000)}`;
export function assemble(
  c: Context,
  r: Router,
  sites: Site[],
  sizes: SiteSizing[],
): RegionalPlanningOutput {
  const routes: RouteProvenance[] = [],
    selected = new Map<string, { edge: Edge; routes: Set<string> }>();
  const key = (e: Edge) => (e.a < e.b ? `${e.a}:${e.b}` : `${e.b}:${e.a}`);
  const add = (id: string, from: string, to: string, edges: Edge[]) => {
    const route: RouteProvenance = { id, from, to, roadIds: [], crossingIds: [] };
    routes.push(route);
    for (const edge of edges) {
      const k = key(edge),
        old = selected.get(k);
      if (old) old.routes.add(id);
      else selected.set(k, { edge, routes: new Set([id]) });
    }
  };
  if (r.terminals.length === 1)
    throw new PlanningFailure(
      'REGIONAL_TERMINALS',
      'required terminals',
      'One requested terminal cannot form a connected regional route; request another site/exit or an explicit empty boundary set with zero sites.',
    );
  const terms = r.terminals,
    joined = new Set<number>();
  if (terms.length) joined.add(0);
  let attempts = 0;
  const failed = new Set<string>();
  while (joined.size < terms.length) {
    let best: { i: number; j: number; d: number } | undefined;
    for (const i of joined)
      for (let j = 0; j < terms.length; j++)
        if (!joined.has(j)) {
          c.candidates.take();
          if (failed.has(`${i}:${j}`)) continue;
          const d = distance(r.points[terms[i]!.node]!, r.points[terms[j]!.node]!);
          if (!best || d < best.d || (d === best.d && (i < best.i || (i === best.i && j < best.j))))
            best = { i, j, d };
        }
    if (!best)
      throw new PlanningFailure(
        'REGIONAL_CONNECTIVITY',
        'required terminals',
        'Required sites and boundary exits cannot all connect through certified ground/deck edges.',
      );
    if (++attempts > terms.length * terms.length)
      throw new PlanningFailure(
        'NETWORK_RETRY_LIMIT',
        'route attempts',
        'Bounded terminal reconciliation exhausted.',
      );
    const a = terms[best.i]!,
      b = terms[best.j]!,
      path = r.route(a.node, b.node);
    if (!path) {
      failed.add(`${best.i}:${best.j}`);
      continue;
    }
    add(`route:${a.id}:${b.id}`, a.id, b.id, path);
    joined.add(best.j);
  }
  if (c.input.requireBridge && !Array.from(selected.values()).some((s) => s.edge.candidate)) {
    const e = Array.from(r.special.values())
      .flat()
      .find((e) => e.candidate);
    if (!e)
      throw new PlanningFailure(
        'REQUIRED_BRIDGE_INFEASIBLE',
        'used bridge',
        'No geometrically and grade-certified bridge with dry outward lattice approaches is available.',
      );
    const siteTerms = terms.filter((t) => t.site);
    if (siteTerms.length < 2)
      throw new PlanningFailure(
        'REQUIRED_BRIDGE_INFEASIBLE',
        'two required sites',
        'An explicit bridge route needs at least two required sites.',
      );
    const a = [...siteTerms].sort(
      (t, u) =>
        distance(r.points[t.node]!, r.points[e.a]!) - distance(r.points[u.node]!, r.points[e.a]!) ||
        (t.id < u.id ? -1 : t.id > u.id ? 1 : 0),
    )[0]!;
    const b = [...siteTerms.filter((t) => t.id !== a.id)].sort(
      (t, u) =>
        distance(r.points[t.node]!, r.points[e.b]!) - distance(r.points[u.node]!, r.points[e.b]!) ||
        (t.id < u.id ? -1 : t.id > u.id ? 1 : 0),
    )[0]!;
    const left = r.route(a.node, e.a, e.candidate!.id),
      right = r.route(e.b, b.node, e.candidate!.id);
    if (!left || !right)
      throw new PlanningFailure(
        'REQUIRED_BRIDGE_CONNECTIVITY',
        'used bridge',
        'Bridge endpoints cannot join two required sites by certified approaches.',
      );
    add(`route:bridge:${e.candidate!.id}`, a.id, b.id, [...left, e, ...right]);
  }
  // Extra links are bounded desired redundancy; inability is an explicit failure.
  let extra = 0;
  const pairs: { i: number; j: number; d: number }[] = [];
  for (let i = 0; i < terms.length; i++)
    for (let j = i + 1; j < terms.length; j++)
      if (
        terms[i]!.site &&
        terms[j]!.site &&
        !routes.some(
          (v) =>
            (v.from === terms[i]!.id && v.to === terms[j]!.id) ||
            (v.to === terms[i]!.id && v.from === terms[j]!.id),
        )
      ) {
        c.candidates.take();
        pairs.push({ i, j, d: distance(r.points[terms[i]!.node]!, r.points[terms[j]!.node]!) });
      }
  pairs.sort((a, b) => a.d - b.d || a.i - b.i || a.j - b.j);
  for (const p of pairs) {
    if (extra >= c.settings.roads.extraLinks) break;
    const a = terms[p.i]!,
      b = terms[p.j]!,
      path = r.route(a.node, b.node);
    if (!path) continue;
    add(`route:extra:${a.id}:${b.id}`, a.id, b.id, path);
    extra++;
  }
  if (extra < Math.min(c.settings.roads.extraLinks, pairs.length))
    throw new PlanningFailure(
      'EXTRA_LINK_CONNECTIVITY',
      'redundant links',
      'Requested bounded redundant site links could not be routed.',
    );
  const segments = [...selected.values()].map((v) => ({
    ...v,
    a: r.points[v.edge.a]!,
    b: r.points[v.edge.b]!,
  }));
  // Planarize actual emitted edges, including off-lattice bridge/site connectors.
  // Local spatial bins bound pair discovery; collinear overlaps split and merge.
  const bins = new Map<string, number[]>(),
    cuts = segments.map(() => [0, 1]);
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!,
      rect = box([s.a, s.b]),
      near = new Set<number>();
    for (let y = Math.floor(rect[1] / c.binSize); y <= Math.floor(rect[3] / c.binSize); y++)
      for (let x = Math.floor(rect[0] / c.binSize); x <= Math.floor(rect[2] / c.binSize); x++) {
        c.validation.take();
        const k = `${x}:${y}`,
          bucket = bins.get(k) ?? [];
        for (const j of bucket) {
          c.validation.take();
          near.add(j);
        }
        bucket.push(i);
        bins.set(k, bucket);
      }
    for (const j of near) {
      const t = segments[j]!;
      if (!touches(rect, box([t.a, t.b]))) continue;
      const a = segmentCuts(s.a, s.b, [[t.a, t.b]], c.meter, '$.roads'),
        b = segmentCuts(t.a, t.b, [[s.a, s.b]], c.meter, '$.roads');
      if (
        (s.edge.candidate && a.some((v) => v > 1e-8 && v < 1 - 1e-8)) ||
        (t.edge.candidate && b.some((v) => v > 1e-8 && v < 1 - 1e-8))
      )
        throw new PlanningFailure(
          'BRIDGE_INTERIOR_JOIN',
          'deck graph',
          'A road attempts to join a deck interior instead of its explicit abutments.',
        );
      cuts[i]!.push(...a);
      cuts[j]!.push(...b);
    }
  }
  const output = new Work(
    Math.min(
      c.input.limits?.maxOutputFeatures ?? c.settings.limits.maxFeatures,
      c.settings.limits.maxFeatures,
    ),
    'output features',
  );
  const vertices = new Work(c.settings.limits.maxVertices, 'output vertices');
  output.take(sites.length);
  vertices.take(
    sites.reduce(
      (n, s) =>
        n +
        2 +
        s.placementArea.outer.length +
        s.placementArea.holes.reduce((m, r) => m + r.length, 0),
      0,
    ),
  );
  const nodes = new Map<string, RoadNode>(),
    roads = new Map<string, Road>(),
    crossings = new Map<string, Crossing>(),
    decks = new Map<string, NonNullable<Edge['profile']>>();
  const terminalSide = new Map<string, 'north' | 'east' | 'south' | 'west'>();
  for (const t of terms)
    if (t.edge?.exit) terminalSide.set(coordinateId(r.points[t.node]!), t.edge.exit);
  const node = (p: Point): string => {
    const k = coordinateId(p),
      id = `node:regional:${k}`;
    if (!nodes.has(id)) {
      output.take();
      vertices.take();
      const side = terminalSide.get(k);
      nodes.set(
        id,
        side
          ? { id, kind: 'boundary-exit', side, position: p }
          : { id, kind: 'junction', position: p },
      );
    }
    return id;
  };
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!,
      values = [...new Set(cuts[i])].sort((a, b) => a - b);
    for (let j = 1; j < values.length; j++) {
      const a = interpolate(s.a, s.b, values[j - 1]!).map(decimal6) as Point,
        b = interpolate(s.a, s.b, values[j]!).map(decimal6) as Point;
      if (distance(a, b) < 1e-6) continue;
      const nA = node(a),
        nB = node(b),
        forward = nA < nB,
        from = forward ? nA : nB,
        to = forward ? nB : nA,
        id = `road:${from}:${to}`;
      let road = roads.get(id);
      if (!road) {
        output.take();
        vertices.take(2);
        road = {
          id,
          kind: s.edge.siteId ? 'track' : 'regional',
          fromNodeId: from,
          toNodeId: to,
          path: forward ? [a, b] : [b, a],
          widthM: c.settings.roads.maxReservedWidthM,
          surfaceWidthM: c.settings.roads.maxReservedWidthM,
          setbackM: 0,
          routeIds: [],
          crossingIds: [],
          ...(s.edge.siteId ? { siteId: s.edge.siteId } : {}),
        };
        roads.set(id, road);
      }
      for (const route of s.routes) if (!road.routeIds.includes(route)) road.routeIds.push(route);
      if (s.edge.candidate) {
        const cand = s.edge.candidate;
        road.crossingIds = [cand.id];
        let crossing = crossings.get(cand.id);
        if (!crossing) {
          output.take();
          vertices.take(cand.deck.outer.length + 2);
          crossing = {
            id: cand.id,
            kind: 'bridge',
            waterId: cand.waterId,
            roadIds: [],
            endpoints: cand.endpoints,
            spanM: cand.spanM,
            widthM: cand.widthM,
            deck: cand.deck,
          };
          crossings.set(cand.id, crossing);
          decks.set(cand.id, s.edge.profile!);
        }
        if (!crossing.roadIds.includes(road.id)) crossing.roadIds.push(road.id);
      }
    }
  }
  for (const site of sites) {
    const t = terms.find((t) => t.id === site.id)!,
      p = r.points[t.node]!,
      id = `node:regional:${coordinateId(p)}`;
    const road = [...roads.values()].find((e) => e.fromNodeId === id || e.toNodeId === id);
    if (!road)
      throw new PlanningFailure(
        'SITE_ENTRANCE_DISCONNECTED',
        site.id,
        'No emitted regional edge joins the authoritative site entrance.',
      );
    const other = nodes.get(road.fromNodeId === id ? road.toNodeId : road.fromNodeId)!.position;
    site.entrances = [
      {
        id: `entrance:${site.id}:0000`,
        routeId: road.routeIds[0]!,
        roadId: road.id,
        nodeId: id,
        endpoint: p,
        widthM: road.widthM,
        bearingDeg: decimal6(bearingDegrees(p, other)),
      },
    ];
  }
  const roadsArray = [...roads.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const road of roadsArray) road.routeIds.sort();
  for (const route of routes) {
    route.roadIds = roadsArray.filter((r) => r.routeIds.includes(route.id)).map((r) => r.id);
    route.crossingIds = [
      ...new Set(
        roadsArray.filter((r) => r.routeIds.includes(route.id)).flatMap((r) => r.crossingIds),
      ),
    ].sort();
  }
  const features = nodes.size + roads.size + crossings.size + sites.length;
  if (
    features >
      Math.min(
        c.input.limits?.maxOutputFeatures ?? c.settings.limits.maxFeatures,
        c.settings.limits.maxFeatures,
      ) ||
    roads.size * 2 + nodes.size + sites.length * 5 > c.settings.limits.maxVertices
  )
    throw new PlanningFailure(
      'PLANNING_OUTPUT_LIMIT',
      'output features/vertices',
      'Complete network exceeds output resource limits.',
    );
  return {
    version: PLANNING_VERSION,
    roadNodes: [...nodes.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    roads: roadsArray,
    crossings: [...crossings.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    sites,
    routes,
    sizes,
    decks: [...decks.values()].sort((a, b) => (a.crossingId < b.crossingId ? -1 : 1)),
    evidence: {
      candidateWork: c.candidates.used,
      validationWork: c.validation.used,
      heapWork: c.heap.used,
      expansions: c.expansions,
      placementAttempts: c.placementAttempts,
      planningCells: c.cells,
    },
  };
}
