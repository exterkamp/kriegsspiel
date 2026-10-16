import type { Point, Site } from '../contract.js';
import { distance, polygonEdges, segmentDistance, polygonLocation } from '../geometry.js';
import { decimal6 } from '../terrain/precision.js';
import { bridge, outward } from './bridges.js';
import { ford } from './fords.js';
import { SHALLOW_WATER } from '../geography/shallow.js';
import { PlanningFailure } from './budget.js';
import { corridor, segmentGrade } from './certificates.js';
import { box, type Context, touches } from './context.js';
import type { CrossingCandidate } from '../geography/types.js';
import type { DeckProfile, FordProfile } from './types.js';
export interface Edge {
  a: number;
  b: number;
  cost: number;
  candidate?: CrossingCandidate;
  profile?: DeckProfile;
  ford?: FordProfile;
  exit?: 'north' | 'east' | 'south' | 'west';
  siteId?: string;
}
export interface Terminal {
  id: string;
  node: number;
  site?: Site;
  entry?: number;
  edge?: Edge;
}
/** `exact` entries carry certified edge costs; others carry an optimistic estimate. */
type QueueItem = {
  node: number;
  g: number;
  f: number;
  from: number;
  edge: Edge | null;
  exact: boolean;
};
/**
 * Frozen route costs (`sited-graded-network-v2`, kept by `-fording-network-v3`;
 * fords cost `SHALLOW_WATER.routeSpanFactor` per metre plus `routeFixedM`). Eight-neighbour lattice moves
 * avoid staircase roads; the grade penalty grows quadratically so roads wind
 * along contours, valleys and spurs instead of climbing straight; bridges carry
 * a fixed cost so routes share crossings; existing road edges are discounted so
 * later routes join the network at junctions rather than running in parallel;
 * and the map margin is avoided.
 */
export const ROUTE_COSTS = Object.freeze({
  gradeLinear: 6,
  gradeQuadratic: 120,
  bridgeSpanFactor: 2,
  bridgeFixedM: 250,
  reuse: 0.55,
  /** Heuristic metres per straight-line metre (weighted A*). */
  heuristic: 1,
  marginM: 150,
  margin: 0.6,
});
class Heap {
  data: QueueItem[] = [];
  constructor(readonly c: Context) {}
  less(a: QueueItem, b: QueueItem): boolean {
    return (
      a.f < b.f ||
      (a.f === b.f &&
        (a.g < b.g || (a.g === b.g && (a.node < b.node || (a.node === b.node && a.from < b.from)))))
    );
  }
  push(v: QueueItem): void {
    const a = this.data;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      this.c.heap.take();
      const p = (i - 1) >> 1;
      if (!this.less(v, a[p]!)) break;
      a[i] = a[p]!;
      i = p;
    }
    a[i] = v;
  }
  pop(): QueueItem {
    const a = this.data,
      r = a[0]!,
      v = a.pop()!;
    if (a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        this.c.heap.take();
        let j = i * 2 + 1;
        if (j + 1 < a.length && this.less(a[j + 1]!, a[j]!)) j++;
        if (!this.less(a[j]!, v)) break;
        a[i] = a[j]!;
        i = j;
      }
      a[i] = v;
    }
    return r;
  }
}
export class Router {
  readonly points: Point[];
  readonly special = new Map<number, Edge[]>();
  readonly cached = new Map<string, Edge | null>();
  readonly wet: Int8Array;
  readonly blocked: Int8Array;
  readonly terminals: Terminal[] = [];
  readonly profiles = new Map<string, DeckProfile>();
  readonly fords = new Map<string, FordProfile>();
  readonly bridgeFailures: string[] = [];
  readonly sites: Site[];
  /** Placement-area boxes, computed once; sites never move during routing. */
  readonly siteBoxes: [number, number, number, number][];
  /** Undirected edge keys already emitted by earlier routes. */
  readonly used = new Set<string>();
  constructor(
    readonly c: Context,
    sites: Site[],
  ) {
    this.sites = sites;
    this.siteBoxes = sites.map((s) => box(s.placementArea.outer));
    c.candidates.take(c.cells * 2);
    this.points = Array.from({ length: c.cells }, (_, i) => c.point(i));
    this.wet = new Int8Array(c.cells);
    this.wet.fill(-1);
    this.blocked = new Int8Array(c.cells);
    this.blocked.fill(-1);
  }
  addPoint(p: Point): number {
    this.c.candidates.take();
    if (this.points.length >= this.c.cells + this.c.settings.limits.maxFeatures)
      throw new PlanningFailure(
        'PLANNING_RESOURCE_LIMIT',
        'special routing nodes',
        'Special node allocation exceeds the feature cap.',
      );
    this.points.push(p.map(decimal6) as Point);
    return this.points.length - 1;
  }
  addEdge(e: Edge): void {
    for (const id of [e.a, e.b]) {
      const list = this.special.get(id) ?? [];
      list.push(e);
      this.special.set(id, list);
    }
  }
  open(id: number): boolean {
    if (id >= this.c.cells) return true;
    if (this.blocked[id] === -1) {
      const p = this.points[id]!,
        r = this.c.settings.roads.maxReservedWidthM / 2;
      this.c.candidates.take(this.sites.length + 1);
      this.blocked[id] =
        this.c.inBounds(p, r) &&
        !this.siteBoxes.some(
          (b) => p[0] >= b[0] - r && p[0] <= b[2] + r && p[1] >= b[1] - r && p[1] <= b[3] + r,
        )
          ? 0
          : 1;
    }
    if (this.blocked[id]) return false;
    if (this.wet[id] === -1) this.wet[id] = this.c.wet(this.points[id]!) ? 1 : 0;
    return !this.wet[id];
  }
  clearSites(a: Point, b: Point, ignore?: string): boolean {
    const r = this.c.settings.roads.maxReservedWidthM / 2,
      rect: [number, number, number, number] = [
        Math.min(a[0], b[0]),
        Math.min(a[1], b[1]),
        Math.max(a[0], b[0]),
        Math.max(a[1], b[1]),
      ];
    for (const [i, s] of this.sites.entries()) {
      this.c.candidates.take();
      if (s.id === ignore) continue;
      const p = s.placementArea,
        q = this.siteBoxes[i]!,
        expanded: [number, number, number, number] = [
          rect[0] - r,
          rect[1] - r,
          rect[2] + r,
          rect[3] + r,
        ];
      if (!touches(q, expanded)) continue;
      if (
        polygonLocation(a, p, this.c.meter) !== 'outside' ||
        polygonLocation(b, p, this.c.meter) !== 'outside'
      )
        return false;
      for (const [u, v] of polygonEdges(p)) {
        this.c.validation.take();
        if (segmentDistance(a, b, u, v) <= r + 1e-9) return false;
      }
    }
    return true;
  }
  edge(a: number, b: number): Edge | null {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const cached = this.cached.get(key);
    if (cached !== undefined) return cached;
    if (!this.open(a) || !this.open(b)) {
      this.cached.set(key, null);
      return null;
    }
    const p = this.points[a]!,
      q = this.points[b]!;
    if (!this.clearSites(p, q)) {
      this.cached.set(key, null);
      return null;
    }
    const cert = corridor(this.c, p, q, this.c.settings.roads.maxReservedWidthM, undefined, true);
    const e = cert.traversable
      ? { a, b, cost: distance(p, q) * this.factor(p, q, cert.maxDirectionalGrade) }
      : null;
    this.cached.set(key, e);
    return e;
  }
  attachSites(): void {
    for (const site of this.sites) {
      const b = box(site.placementArea.outer),
        x = site.anchor[0],
        y = site.anchor[1];
      const options: [Point, Point][] = [
        [
          [x, b[1]],
          [x, b[1] - this.c.spacing],
        ],
        [
          [b[2], y],
          [b[2] + this.c.spacing, y],
        ],
        [
          [x, b[3]],
          [x, b[3] + this.c.spacing],
        ],
        [
          [b[0], y],
          [b[0] - this.c.spacing, y],
        ],
      ];
      let best: { p: Point; n: number; grade: number } | undefined;
      for (const [p, out] of options) {
        this.c.candidates.take();
        if (!this.c.inBounds(out)) continue;
        const n = this.c.node(out),
          q = this.points[n];
        if (!q || !this.open(n) || !this.clearSites(p, q, site.id)) continue;
        const cert = corridor(this.c, p, q, this.c.settings.roads.maxReservedWidthM);
        if (cert.traversable && (!best || cert.maxDirectionalGrade < best.grade))
          best = { p, n, grade: cert.maxDirectionalGrade };
      }
      if (!best)
        throw new PlanningFailure(
          'SITE_APPROACH_INFEASIBLE',
          site.id,
          'No complete dry, grade-certified approach reaches this permissible footprint.',
        );
      const entry = this.addPoint(best.p),
        edge: Edge = {
          a: entry,
          b: best.n,
          cost: distance(best.p, this.points[best.n]!),
          siteId: site.id,
        };
      this.addEdge(edge);
      this.terminals.push({ id: site.id, node: entry, entry, site, edge });
    }
  }
  attachBoundary(): void {
    const sides = this.c.input.boundarySides ?? ['west'];
    if (
      new Set(sides).size !== sides.length ||
      sides.some((s) => !['north', 'east', 'south', 'west'].includes(s))
    )
      throw new RangeError('Unique supported boundary sides required');
    for (const side of sides) {
      let attached = false;
      const horizontal = side === 'north' || side === 'south',
        count = horizontal ? this.c.columns : this.c.rows;
      const order = Array.from({ length: Math.max(0, count - 2) }, (_, i) => i + 1).sort(
        (a, b) => Math.abs(a - count / 2) - Math.abs(b - count / 2) || a - b,
      );
      this.c.candidates.take(order.length * Math.ceil(Math.log2(order.length + 1)));
      for (const k of order) {
        this.c.candidates.take();
        const p: Point = horizontal
          ? [k * this.c.spacing, side === 'north' ? 0 : this.c.bounds.maxY]
          : [side === 'west' ? 0 : this.c.bounds.maxX, k * this.c.spacing];
        const inside: Point = horizontal
          ? [p[0], side === 'north' ? this.c.spacing : this.c.bounds.maxY - this.c.spacing]
          : [side === 'west' ? this.c.spacing : this.c.bounds.maxX - this.c.spacing, p[1]];
        const n = this.c.node(inside),
          a = this.points[n];
        if (!a || !this.open(n) || !this.clearSites(a, p)) continue;
        const cert = corridor(this.c, a, p, this.c.settings.roads.maxReservedWidthM, side);
        if (!cert.traversable) continue;
        const exit = this.addPoint(p),
          e: Edge = { a: n, b: exit, cost: distance(a, p), exit: side };
        this.addEdge(e);
        this.terminals.push({ id: `boundary:${side}`, node: exit, edge: e });
        attached = true;
        break;
      }
      if (!attached)
        throw new PlanningFailure(
          'BOUNDARY_EXIT_INFEASIBLE',
          side,
          'No certified road reaches the requested boundary side.',
        );
    }
  }
  attachBridges(): void {
    const candidates = [...(this.c.input.crossingCandidates ?? [])].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    this.c.candidates.take(candidates.length * Math.ceil(Math.log2(candidates.length + 1)));
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (seen.has(candidate.id)) throw new RangeError('Duplicate crossing candidate identity');
      seen.add(candidate.id);
      this.c.candidates.take();
      try {
        const isFord = candidate.kind === 'ford',
          profile = isFord ? undefined : bridge(this.c, candidate),
          fordProfile = isFord ? ford(this.c, candidate) : undefined,
          [a, b] = candidate.endpoints,
          paths: Point[][] = [],
          connectors: number[][] = [];
        for (const [p, opposite] of [
          [a, b],
          [b, a],
        ] as [Point, Point][]) {
          if (isFord) {
            connectors.push(this.fordConnectors(candidate, p, opposite));
            continue;
          }
          const out = outward(p, opposite, this.c.spacing),
            n = this.c.node(out),
            snap = this.points[n];
          if (!snap || !this.open(n))
            throw new PlanningFailure(
              'BRIDGE_APPROACH',
              'outward lattice connector',
              'Bridge cannot connect to a dry planning lattice node.',
            );
          const path = [p, out.map(decimal6) as Point, snap];
          for (let i = 1; i < path.length; i++) {
            if (distance(path[i - 1]!, path[i]!) < 1e-9) continue;
            if (
              !this.clearSites(path[i - 1]!, path[i]!) ||
              !corridor(this.c, path[i - 1]!, path[i]!, candidate.widthM).traversable
            )
              throw new PlanningFailure(
                'BRIDGE_APPROACH',
                candidate.id,
                'Complete dry outward approach violates grade, water or site constraints.',
              );
          }
          paths.push(path);
        }
        const endpointNodes: number[] = [];
        for (const [j, nodes] of connectors.entries()) {
          const from = this.addPoint(candidate.endpoints[j]!),
            p = this.points[from]!;
          endpointNodes.push(from);
          for (const n of nodes) {
            const q = this.points[n]!;
            this.addEdge({
              a: from,
              b: n,
              cost: distance(p, q) * this.factor(p, q, segmentGrade(this.c, p, q)),
            });
          }
        }
        for (const path of paths) {
          let from = this.addPoint(path[0]!);
          endpointNodes.push(from);
          for (let i = 1; i < path.length; i++) {
            if (distance(path[i - 1]!, path[i]!) < 1e-9) continue;
            const to = i === path.length - 1 ? this.c.node(path[i]!) : this.addPoint(path[i]!);
            this.addEdge({ a: from, b: to, cost: distance(this.points[from]!, this.points[to]!) });
            from = to;
          }
        }
        const e: Edge = {
          a: endpointNodes[0]!,
          b: endpointNodes[1]!,
          cost: fordProfile
            ? candidate.spanM * SHALLOW_WATER.routeSpanFactor + SHALLOW_WATER.routeFixedM
            : candidate.spanM * ROUTE_COSTS.bridgeSpanFactor + ROUTE_COSTS.bridgeFixedM,
          candidate,
          ...(profile ? { profile } : {}),
          ...(fordProfile ? { ford: fordProfile } : {}),
        };
        this.addEdge(e);
        if (profile) this.profiles.set(candidate.id, profile);
        if (fordProfile) this.fords.set(candidate.id, fordProfile);
      } catch (e) {
        if (e instanceof PlanningFailure && e.code !== 'PLANNING_RESOURCE_LIMIT') {
          this.bridgeFailures.push(`${candidate.id}:${e.code}`);
          continue;
        }
        throw e;
      }
    }
  }
  /**
   * Ford approaches (D46): every certified straight connector from a ford end
   * to a lattice node within two lattice spacings that lies ahead of the bank.
   * Each becomes a graded edge, so a ford road can slant up a valley side
   * toward where it is going instead of climbing straight out.
   */
  fordConnectors(candidate: CrossingCandidate, p: Point, opposite: Point): number[] {
    const d = distance(p, opposite),
      ux = (p[0] - opposite[0]) / d,
      uy = (p[1] - opposite[1]) / d,
      sp = this.c.spacing,
      cx = Math.round(p[0] / sp),
      cy = Math.round(p[1] / sp),
      result: number[] = [];
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx,
          y = cy + dy;
        this.c.candidates.take();
        if (x < 0 || y < 0 || x >= this.c.columns || y >= this.c.rows) continue;
        const n = y * this.c.columns + x,
          q = this.points[n]!,
          length = distance(p, q),
          ahead = (q[0] - p[0]) * ux + (q[1] - p[1]) * uy;
        if (length < sp / 2 || length > 2.5 * sp || ahead < sp / 4 || !this.open(n)) continue;
        if (this.clearSites(p, q) && corridor(this.c, p, q, candidate.widthM).traversable)
          result.push(n);
      }
    if (!result.length)
      throw new PlanningFailure(
        'BRIDGE_APPROACH',
        candidate.id,
        'No dry, grade-certified approach joins this ford end to the planning lattice.',
      );
    return result;
  }
  /** Lattice neighbours in fixed order: four axes, then four diagonals. */
  latticeNeighbours(id: number): number[] {
    if (id >= this.c.cells) return [];
    const cols = this.c.columns,
      x = id % cols,
      y = Math.floor(id / cols),
      west = x > 0,
      east = x + 1 < cols,
      north = y > 0,
      south = y + 1 < this.c.rows;
    return [
      west ? id - 1 : -1,
      east ? id + 1 : -1,
      north ? id - cols : -1,
      south ? id + cols : -1,
      north && west ? id - cols - 1 : -1,
      north && east ? id - cols + 1 : -1,
      south && west ? id + cols - 1 : -1,
      south && east ? id + cols + 1 : -1,
    ].filter((n) => n >= 0);
  }
  /**
   * Optimistic lattice edge cost: the endpoint height difference never exceeds
   * the certified maximum directional grade, so this is a lower bound.
   */
  private estimate(a: number, b: number): number | null {
    if (!this.open(a) || !this.open(b)) return null;
    const p = this.points[a]!,
      q = this.points[b]!,
      length = distance(p, q),
      g = Math.abs(this.c.q.heightAt(...q) - this.c.q.heightAt(...p)) / length;
    this.c.validation.take(2);
    return length * this.factor(p, q, g);
  }
  factor(p: Point, q: Point, g: number): number {
    const mid: Point = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2],
      margin = Math.min(
        mid[0] - this.c.bounds.minX,
        mid[1] - this.c.bounds.minY,
        this.c.bounds.maxX - mid[0],
        this.c.bounds.maxY - mid[1],
      );
    return (
      1 +
      ROUTE_COSTS.gradeLinear * g +
      ROUTE_COSTS.gradeQuadratic * g * g +
      ROUTE_COSTS.margin * Math.max(0, (ROUTE_COSTS.marginM - margin) / ROUTE_COSTS.marginM)
    );
  }
  private cost(e: Edge): number {
    return this.used.has(e.a < e.b ? `${e.a}:${e.b}` : `${e.b}:${e.a}`)
      ? e.cost * ROUTE_COSTS.reuse
      : e.cost;
  }
  /**
   * Lazy A*: lattice edges enter the queue with an optimistic estimate and are
   * certified only when popped; a dearer certified cost is re-queued, an
   * uncertifiable edge is dropped. Every emitted edge is certified exactly as
   * by eager search; only edges never reached are left uncertified.
   */
  /** Main roads (`allowFords` false) never use a ford edge; minor roads may. */
  route(
    start: number,
    end: number,
    forbiddenCrossingId?: string,
    allowFords = false,
  ): Edge[] | null {
    // Allocation is bounded before arrays; stale heap entries still consume heap work.
    const count = this.points.length;
    this.c.heap.take(count * 3);
    const closed = new Uint8Array(count),
      settled = new Float64Array(count),
      queued = new Float64Array(count).fill(Infinity),
      previous = new Int32Array(count).fill(-1),
      byNode = new Map<number, Edge>(),
      heap = new Heap(this.c);
    // Weighted A*: the straight-line metre exceeds a reused road's cost, so routes
    // can be at most 1/reuse longer in cost than optimal, for far fewer expansions.
    const h = (n: number) => ROUTE_COSTS.heuristic * distance(this.points[n]!, this.points[end]!);
    heap.push({ node: start, g: 0, f: h(start), from: -1, edge: null, exact: true });
    let expansions = 0;
    while (heap.data.length) {
      this.c.heap.take();
      const item = heap.pop();
      if (closed[item.node]) continue;
      if (!item.exact) {
        const e = this.edge(item.from, item.node);
        if (!e) continue;
        const g = settled[item.from]! + this.cost(e);
        if (g > item.g + 1e-9) {
          if (g < queued[item.node]! - 1e-12) {
            queued[item.node] = g;
            heap.push({ ...item, g, f: g + h(item.node), edge: e, exact: true });
          }
          continue;
        }
        item.edge = e;
        item.g = g;
      }
      closed[item.node] = 1;
      settled[item.node] = item.g;
      previous[item.node] = item.from;
      if (item.edge) byNode.set(item.node, item.edge);
      if (item.node === end) {
        const result: Edge[] = [];
        let n = end;
        while (n !== start) {
          result.push(byNode.get(n)!);
          n = previous[n]!;
        }
        return result.reverse();
      }
      if (++expansions > this.c.settings.roads.maxExpansionsPerRoute)
        throw new PlanningFailure(
          'ROUTE_EXPANSION_LIMIT',
          'per-route expansions',
          'A* exhausted the recorded per-route expansion cap.',
        );
      if (++this.c.expansions > this.c.settings.roads.maxGlobalExpansions)
        throw new PlanningFailure(
          'ROUTING_EXPANSION_LIMIT',
          'global expansions',
          'A* exhausted the recorded global expansion cap.',
        );
      const exact = (e: Edge) => {
        if (forbiddenCrossingId && e.candidate?.id === forbiddenCrossingId) return;
        if (e.ford && !allowFords) return;
        const n = e.a === item.node ? e.b : e.a,
          g = item.g + this.cost(e);
        if (closed[n] || g >= queued[n]! - 1e-12) return;
        queued[n] = g;
        heap.push({ node: n, g, f: g + h(n), from: item.node, edge: e, exact: true });
      };
      for (const e of this.special.get(item.node) ?? []) exact(e);
      for (const n of this.latticeNeighbours(item.node)) {
        if (closed[n]) continue;
        const key = item.node < n ? `${item.node}:${n}` : `${n}:${item.node}`,
          known = this.cached.get(key);
        if (known === null) continue;
        if (known) {
          exact(known);
          continue;
        }
        const estimate = this.estimate(item.node, n);
        if (estimate === null) continue;
        const g = item.g + (this.used.has(key) ? estimate * ROUTE_COSTS.reuse : estimate);
        if (g >= queued[n]! - 1e-12) continue;
        heap.push({ node: n, g, f: g + h(n), from: item.node, edge: null, exact: false });
      }
    }
    return null;
  }
}
