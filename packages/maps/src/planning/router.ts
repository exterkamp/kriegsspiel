import type { Point, Site } from '../contract.js';
import { distance, polygonEdges, segmentDistance, polygonLocation } from '../geometry.js';
import { decimal6 } from '../terrain/precision.js';
import { bridge, outward } from './bridges.js';
import { PlanningFailure } from './budget.js';
import { corridor } from './certificates.js';
import { box, type Context, touches } from './context.js';
import type { CrossingCandidate } from '../geography/types.js';
import type { DeckProfile } from './types.js';
export interface Edge {
  a: number;
  b: number;
  cost: number;
  candidate?: CrossingCandidate;
  profile?: DeckProfile;
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
type QueueItem = { node: number; g: number; f: number };
class Heap {
  data: QueueItem[] = [];
  constructor(readonly c: Context) {}
  less(a: QueueItem, b: QueueItem): boolean {
    return a.f < b.f || (a.f === b.f && (a.g < b.g || (a.g === b.g && a.node < b.node)));
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
  readonly bridgeFailures: string[] = [];
  readonly sites: Site[];
  constructor(
    readonly c: Context,
    sites: Site[],
  ) {
    this.sites = sites;
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
        !this.sites.some((s) => {
          const b = box(s.placementArea.outer);
          return p[0] >= b[0] - r && p[0] <= b[2] + r && p[1] >= b[1] - r && p[1] <= b[3] + r;
        })
          ? 0
          : 1;
    }
    if (this.blocked[id]) return false;
    if (this.wet[id] === -1) this.wet[id] = this.c.wet(this.points[id]!) ? 1 : 0;
    return !this.wet[id];
  }
  clearSites(a: Point, b: Point, ignore?: string): boolean {
    const r = this.c.settings.roads.maxReservedWidthM / 2,
      rect = box([a, b]);
    for (const s of this.sites) {
      this.c.candidates.take();
      if (s.id === ignore) continue;
      const p = s.placementArea,
        q = box(p.outer),
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
      ? { a, b, cost: distance(p, q) * (1 + 4 * cert.maxDirectionalGrade) }
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
        const profile = bridge(this.c, candidate),
          [a, b] = candidate.endpoints,
          paths: Point[][] = [];
        for (const [p, opposite] of [
          [a, b],
          [b, a],
        ] as [Point, Point][]) {
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
          cost: candidate.spanM,
          candidate,
          profile,
        };
        this.addEdge(e);
        this.profiles.set(candidate.id, profile);
      } catch (e) {
        if (e instanceof PlanningFailure && e.code !== 'PLANNING_RESOURCE_LIMIT') {
          this.bridgeFailures.push(`${candidate.id}:${e.code}`);
          continue;
        }
        throw e;
      }
    }
  }
  neighbours(id: number): Edge[] {
    const result = [...(this.special.get(id) ?? [])];
    if (id < this.c.cells) {
      const x = id % this.c.columns,
        y = Math.floor(id / this.c.columns);
      for (const n of [
        x > 0 ? id - 1 : -1,
        x + 1 < this.c.columns ? id + 1 : -1,
        y > 0 ? id - this.c.columns : -1,
        y + 1 < this.c.rows ? id + this.c.columns : -1,
      ])
        if (n >= 0) {
          const e = this.edge(id, n);
          if (e) result.push(e);
        }
    }
    return result;
  }
  route(start: number, end: number, forbiddenCrossingId?: string): Edge[] | null {
    // Allocation is bounded before arrays; stale heap entries still consume heap work.
    const count = this.points.length;
    this.c.heap.take(count * 2);
    const costs = new Float64Array(count);
    costs.fill(Infinity);
    const previous = new Int32Array(count);
    previous.fill(-1);
    const byNode = new Map<number, Edge>(),
      heap = new Heap(this.c);
    costs[start] = 0;
    heap.push({ node: start, g: 0, f: distance(this.points[start]!, this.points[end]!) });
    let expansions = 0;
    while (heap.data.length) {
      this.c.heap.take();
      const item = heap.pop();
      if (item.g !== costs[item.node]) continue;
      if (item.node === end) {
        const result: Edge[] = [];
        let n = end;
        while (n !== start) {
          const e = byNode.get(n)!;
          result.push(e);
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
      for (const e of this.neighbours(item.node)) {
        if (forbiddenCrossingId && e.candidate?.id === forbiddenCrossingId) continue;
        const n = e.a === item.node ? e.b : e.a,
          g = item.g + e.cost;
        if (g < costs[n]! - 1e-12) {
          costs[n] = g;
          previous[n] = item.node;
          byNode.set(n, e);
          heap.push({ node: n, g, f: g + distance(this.points[n]!, this.points[end]!) });
        }
      }
    }
    return null;
  }
}
