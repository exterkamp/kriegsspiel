import type { Point } from '../contract.js';
import { distance, orientation, segmentDistance, segmentsIntersect } from '../geometry.js';
import { decimal6 } from '../terrain/precision.js';
import { corridor } from './certificates.js';
import type { Context } from './context.js';
import type { Edge, Router } from './router.js';

/**
 * Frozen any-angle policy (`sited-graded-any-angle-network-v4`, D48). Routes
 * are still searched on the lattice (now sixteen neighbours). Each chain of lattice
 * edges between junctions and fixed connectors is then string-pulled, free
 * junctions move toward the point that shortens their branches, and corners
 * are rounded, so roads run at any bearing and bend in gentle curves.
 */
export const ANY_ANGLE = Object.freeze({
  /** Longest shortcut tried, in lattice steps along the original chain. */
  maxShortcutSteps: 48,
  /** Passes that drop a kept vertex whose neighbours see each other. */
  relaxPasses: 3,
  /** Weiszfeld iterations toward a junction's shortest-branches point. */
  junctionIterations: 24,
  /** Fractions of the way toward that point tried, in order. */
  junctionSteps: Object.freeze([1, 0.5, 0.25]),
  /** Rounds of junction moves, each followed by relaxing the moved branches. */
  junctionRounds: 3,
  /** Target corner radius in metres; a corner is cut back by R·tan(θ/2). */
  cornerRadiusM: 150,
  /** Largest share of either neighbouring segment one corner may consume. */
  cornerShare: 0.45,
  /** Curve pieces per corner: about one per 15° of turn (unit chord 0.26), at least two. */
  pieceChord: 0.26,
  maxPieces: 8,
  /** Halvings of the corner cut tried before keeping the sharp corner. */
  cornerRetries: 3,
  /** Smallest corner cut worth a curve, in metres. */
  minCutM: 3,
  /** Extra corridor half-width (metres) when certifying new lines; see `strict`. */
  marginM: 0.001,
  /** Grade headroom when certifying new lines; see `strict`. */
  gradeMargin: 1e-6,
  /** Clearance between a new segment and unrelated road segments, in road widths. */
  clearanceWidths: 1,
});

export interface NetworkSegment {
  edge: Edge;
  routes: Set<string>;
  a: Point;
  b: Point;
}

type Line = { a: Point; b: Point };
interface Indexed extends Line {
  owner: number;
  box: [number, number, number, number];
}

const same = (p: Point, q: Point) => p[0] === q[0] && p[1] === q[1];
const round = (p: Point): Point => [decimal6(p[0]), decimal6(p[1])];
const segBox = (a: Point, b: Point): [number, number, number, number] => [
  Math.min(a[0], b[0]),
  Math.min(a[1], b[1]),
  Math.max(a[0], b[0]),
  Math.max(a[1], b[1]),
];
const lines = (points: Point[]): Line[] => points.slice(1).map((b, i) => ({ a: points[i]!, b }));

/** Spatial bins of the current network geometry, by owning chain (-1: fixed edges). */
class SegmentIndex {
  readonly items: Indexed[] = [];
  readonly bins = new Map<string, number[]>();
  constructor(
    readonly c: Context,
    readonly size: number,
  ) {}
  add(a: Point, b: Point, owner: number): void {
    const box = segBox(a, b),
      id = this.items.length;
    this.items.push({ a, b, owner, box });
    for (const key of this.keys(box, 0)) {
      this.c.validation.take();
      const list = this.bins.get(key) ?? [];
      list.push(id);
      this.bins.set(key, list);
    }
  }
  /** Replaces a chain's segments; retired entries stay binned but are skipped. */
  replace(owner: number, points: Point[]): void {
    for (const item of this.items) if (item.owner === owner) item.owner = -2;
    for (const l of lines(points)) this.add(l.a, l.b, owner);
  }
  *keys(b: [number, number, number, number], pad: number): Generator<string> {
    const s = this.size;
    for (let y = Math.floor((b[1] - pad) / s); y <= Math.floor((b[3] + pad) / s); y++)
      for (let x = Math.floor((b[0] - pad) / s); x <= Math.floor((b[2] + pad) / s); x++)
        yield `${x}:${y}`;
  }
  near(a: Point, b: Point, pad: number): Indexed[] {
    const box = segBox(a, b),
      seen = new Set<number>(),
      out: Indexed[] = [];
    for (const key of this.keys(box, pad)) {
      this.c.validation.take();
      for (const id of this.bins.get(key) ?? []) {
        if (seen.has(id)) continue;
        seen.add(id);
        this.c.validation.take();
        const item = this.items[id]!;
        if (item.owner === -2) continue;
        if (
          item.box[0] > box[2] + pad ||
          item.box[2] < box[0] - pad ||
          item.box[1] > box[3] + pad ||
          item.box[3] < box[1] - pad
        )
          continue;
        out.push(item);
      }
    }
    return out;
  }
}

/** Whether two segments meet only at one shared endpoint, without running along each other. */
function meetOnlyAtEnd(p: Point, q: Point, t: Line): boolean {
  const shared = same(p, t.a) || same(p, t.b) ? p : same(q, t.a) || same(q, t.b) ? q : undefined;
  if (!shared) return false;
  const o1 = same(shared, p) ? q : p,
    o2 = same(shared, t.a) ? t.b : t.a;
  if (orientation(shared, o1, o2) !== 0) return true;
  return (o1[0] - shared[0]) * (o2[0] - shared[0]) + (o1[1] - shared[1]) * (o2[1] - shared[1]) < 0;
}

interface Chain {
  nodes: number[];
  routes: Set<string>;
  edges: Edge[];
  /** Current geometry: pulled vertices, ends possibly moved off the lattice. */
  points: Point[];
}

/**
 * Replaces every chain of selected lattice edges by an any-angle polyline with
 * rounded corners. Fixed edges (bridge and ford decks and approaches, site
 * connectors, boundary exits) and the lattice nodes they join are kept
 * exactly. Every new line is a complete certified corridor (grade, water,
 * bounds) with a micrometre margin, clears every site, costs no more than what
 * it replaces, and neither crosses nor crowds any other road; where no such
 * line exists the lattice geometry stays.
 */
export function anyAngle(
  c: Context,
  r: Router,
  selected: Map<string, { edge: Edge; routes: Set<string> }>,
): NetworkSegment[] {
  const width = c.settings.roads.maxReservedWidthM,
    clearance = width * ANY_ANGLE.clearanceWidths,
    margin = ANY_ANGLE.marginM,
    incident = new Map<number, { edge: Edge; routes: Set<string> }[]>(),
    crossingEnds = new Set<number>();
  for (const s of selected.values()) if (s.edge.candidate) crossingEnds.add(s.edge.a).add(s.edge.b);
  /**
   * Lattice edges, and the short connectors that join a bridge's straight
   * outward approach to the lattice, may be replaced. Decks, the outward
   * approaches and ford connectors (D46), site connectors and boundary exits stay.
   */
  const lattice = (e: Edge) =>
    !e.candidate &&
    !e.siteId &&
    !e.exit &&
    ((e.a < c.cells && e.b < c.cells) || (!crossingEnds.has(e.a) && !crossingEnds.has(e.b)));
  for (const s of selected.values())
    for (const n of [s.edge.a, s.edge.b]) {
      c.validation.take();
      const list = incident.get(n) ?? [];
      list.push(s);
      incident.set(n, list);
    }
  const sameRoutes = (x: Set<string>, y: Set<string>) =>
    x.size === y.size && [...x].every((v) => y.has(v));
  const interior = (n: number) => {
    const list = incident.get(n)!;
    return (
      list.length === 2 &&
      list.every((s) => lattice(s.edge)) &&
      sameRoutes(list[0]!.routes, list[1]!.routes)
    );
  };
  // Chains between anchors, in a fixed order: anchors ascending, then each
  // anchor's lattice edges by the far node; anchor-free cycles last.
  const chains: Chain[] = [],
    walked = new Set<Edge>();
  const other = (e: Edge, n: number) => (e.a === n ? e.b : e.a);
  const walk = (start: number, first: { edge: Edge; routes: Set<string> }) => {
    const chain: Chain = { nodes: [start], routes: first.routes, edges: [], points: [] };
    let n = start,
      s = first;
    for (;;) {
      c.validation.take();
      walked.add(s.edge);
      chain.edges.push(s.edge);
      n = other(s.edge, n);
      chain.nodes.push(n);
      if (n === start || !interior(n)) break;
      const next = incident.get(n)!.find((v) => !walked.has(v.edge));
      if (!next) break;
      s = next;
    }
    chain.points = chain.nodes.map((v) => r.points[v]!);
    chains.push(chain);
  };
  const nodes = [...incident.keys()].sort((a, b) => a - b);
  for (const n of nodes) {
    if (interior(n)) continue;
    const list = incident
      .get(n)!
      .filter((s) => lattice(s.edge))
      .sort((x, y) => other(x.edge, n) - other(y.edge, n));
    for (const s of list) if (!walked.has(s.edge)) walk(n, s);
  }
  for (const n of nodes) {
    const s = incident.get(n)!.find((v) => lattice(v.edge) && !walked.has(v.edge));
    if (s) walk(n, s);
  }
  const index = new SegmentIndex(c, c.binSize);
  for (const s of selected.values())
    if (!lattice(s.edge)) index.add(r.points[s.edge.a]!, r.points[s.edge.b]!, -1);
  for (const [k, chain] of chains.entries())
    for (const l of lines(chain.points)) index.add(l.a, l.b, k);

  const height = (p: Point) => {
    c.validation.take();
    return c.q.heightAt(p[0], p[1]);
  };
  /** Routing cost estimate along a straight line, in pieces of at most one lattice step. */
  const lineCost = (p: Point, q: Point) => {
    const length = distance(p, q),
      pieces = Math.max(1, Math.ceil(length / c.spacing - 1e-9));
    let cost = 0,
      prev = p,
      h0 = height(p);
    for (let i = 1; i <= pieces; i++) {
      const t = i / pieces,
        next: Point = i === pieces ? q : [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t],
        h1 = height(next),
        l = length / pieces;
      cost += l * r.factor(prev, next, Math.abs(h1 - h0) / l);
      prev = next;
      h0 = h1;
    }
    return cost;
  };
  /**
   * Neither crosses other roads (except where it meets them at a shared end)
   * nor runs within the clearance of one, unless that road ends at an
   * `exempt` point; and crosses none of the `own` lines.
   */
  const clear = (p: Point, q: Point, skip: Set<number>, own: Line[], exempt: Point[]) => {
    for (const t of index.near(p, q, clearance)) {
      if (skip.has(t.owner)) continue;
      c.validation.take();
      if (segmentsIntersect(p, q, t.a, t.b)) {
        if (!meetOnlyAtEnd(p, q, t)) return false;
      } else if (
        !exempt.some((e) => same(e, t.a) || same(e, t.b)) &&
        segmentDistance(p, q, t.a, t.b) < clearance
      )
        return false;
    }
    for (const t of own) {
      c.validation.take();
      if (segmentsIntersect(p, q, t.a, t.b) && !meetOnlyAtEnd(p, q, t)) return false;
    }
    return true;
  };
  /**
   * Certified with a small margin in width and grade, so any part of the line
   * whose ends are rounded to the micrometre still certifies exactly.
   */
  const strict = (p: Point, q: Point, knownDry: boolean) => {
    if (distance(p, q) <= 1e-6 || !r.clearSites(p, q, undefined, margin)) return false;
    const cert = corridor(c, p, q, width + 2 * margin, undefined, knownDry);
    return (
      cert.traversable &&
      cert.maxDirectionalGrade <= c.settings.roads.maxGrade - ANY_ANGLE.gradeMargin
    );
  };
  const ends = (k: number) => [chains[k]!.points[0]!, chains[k]!.points.at(-1)!];

  // 1. String-pull: from each kept vertex, the farthest later vertex (within
  // the shortcut reach) whose straight line costs no more than the lattice
  // steps it replaces.
  for (const [k, chain] of chains.entries()) {
    const points = chain.points,
      skip = new Set([k]),
      exempt = ends(k),
      prefix = [0];
    for (let i = 1; i < points.length; i++)
      prefix.push(prefix[i - 1]! + lineCost(points[i - 1]!, points[i]!));
    const pulled: Point[] = [points[0]!],
      own: Line[] = [];
    for (let i = 0; i < points.length - 1;) {
      let best = i + 1;
      for (let j = Math.min(points.length - 1, i + ANY_ANGLE.maxShortcutSteps); j > i + 1; j--) {
        c.candidates.take();
        const p = points[i]!,
          q = points[j]!;
        if (same(p, q) || lineCost(p, q) > prefix[j]! - prefix[i]! + 1e-9) continue;
        if (!clear(p, q, skip, own, exempt) || !strict(p, q, true)) continue;
        best = j;
        break;
      }
      own.push({ a: points[i]!, b: points[best]! });
      pulled.push(points[best]!);
      i = best;
    }
    chain.points = pulled;
    index.replace(k, pulled);
  }
  /** Drop a kept vertex when the line joining its neighbours costs no more. */
  const relax = (k: number) => {
    const pts = chains[k]!.points,
      skip = new Set([k]),
      exempt = ends(k);
    let any = false;
    for (let pass = 0; pass < ANY_ANGLE.relaxPasses; pass++) {
      let changed = false;
      for (let i = 1; i < pts.length - 1; i++) {
        c.candidates.take();
        const p = pts[i - 1]!,
          v = pts[i]!,
          q = pts[i + 1]!;
        if (same(p, q) || lineCost(p, q) > lineCost(p, v) + lineCost(v, q) + 1e-9) continue;
        const own = [...lines(pts.slice(0, i)), ...lines(pts.slice(i + 1))];
        if (!clear(p, q, skip, own, exempt) || !strict(p, q, false)) continue;
        pts.splice(i, 1);
        changed = any = true;
      }
      if (!changed) break;
    }
    if (any) index.replace(k, pts);
  };
  // 2. Relax every chain: an L-shaped lattice run longer than one shortcut becomes one line.
  for (const k of chains.keys()) relax(k);

  // 3. Junctions. A lattice junction joining only chains slides: the
  // straightest pair of branches becomes one through line and the others join
  // it at the nearest point; otherwise it moves toward the point that
  // minimises its branches' total length (Weiszfeld). A move is kept only when
  // every new line certifies and the lines cost no more than before.
  const junctions = nodes.filter((n) => {
    const list = incident.get(n)!;
    return n < c.cells && list.length >= 3 && list.every((s) => lattice(s.edge));
  });
  const junctionAt = new Map<number, Point>();
  for (let round_ = 0; round_ < ANY_ANGLE.junctionRounds; round_++) {
    const touched = new Set<number>();
    for (const n of junctions) {
      const at = junctionAt.get(n) ?? r.points[n]!,
        branches: { k: number; start: boolean }[] = [];
      let loop = false;
      for (const [k, chain] of chains.entries()) {
        const s = same(chain.points[0]!, at),
          e = same(chain.points.at(-1)!, at);
        if (s && e) loop = true;
        if (s) branches.push({ k, start: true });
        if (e) branches.push({ k, start: false });
      }
      if (loop || branches.length !== incident.get(n)!.length) continue;
      const targets = branches.map((b) => {
        const pts = chains[b.k]!.points;
        return b.start ? pts[1]! : pts.at(-2)!;
      });
      // Candidate positions, in order: slides onto each through pair, straightest first.
      const candidates: Point[] = [],
        pairs: { i: number; j: number; cos: number }[] = [];
      for (let i = 0; i < targets.length; i++)
        for (let j = i + 1; j < targets.length; j++) {
          const u = targets[i]!,
            v = targets[j]!,
            lu = distance(at, u),
            lv = distance(at, v),
            cos = ((u[0] - at[0]) * (v[0] - at[0]) + (u[1] - at[1]) * (v[1] - at[1])) / (lu * lv);
          if (cos < 0) pairs.push({ i, j, cos });
        }
      pairs.sort((x, y) => x.cos - y.cos || x.i - y.i || x.j - y.j);
      for (const { i, j } of pairs) {
        const u = targets[i]!,
          v = targets[j]!,
          dx = v[0] - u[0],
          dy = v[1] - u[1],
          dd = dx * dx + dy * dy,
          onLine = (p: Point): Point => {
            const t = Math.max(
              0.05,
              Math.min(0.95, ((p[0] - u[0]) * dx + (p[1] - u[1]) * dy) / dd),
            );
            return [u[0] + dx * t, u[1] + dy * t];
          },
          others = targets.filter((_, m) => m !== i && m !== j),
          mean: Point = [
            others.reduce((s, p) => s + p[0], 0) / others.length,
            others.reduce((s, p) => s + p[1], 0) / others.length,
          ];
        candidates.push(onLine(mean), onLine(at));
      }
      let x: Point = [
        targets.reduce((s, p) => s + p[0], 0) / targets.length,
        targets.reduce((s, p) => s + p[1], 0) / targets.length,
      ];
      for (let it = 0; it < ANY_ANGLE.junctionIterations; it++) {
        c.candidates.take();
        let wx = 0,
          wy = 0,
          w = 0;
        for (const p of targets) {
          const d = Math.max(distance(x, p), 1e-3);
          wx += p[0] / d;
          wy += p[1] / d;
          w += 1 / d;
        }
        x = [wx / w, wy / w];
      }
      for (const f of ANY_ANGLE.junctionSteps)
        candidates.push([at[0] + (x[0] - at[0]) * f, at[1] + (x[1] - at[1]) * f]);
      const before = targets.reduce((s, p) => s + lineCost(at, p), 0),
        skip = new Set(branches.map((b) => b.k)),
        exempt = branches.flatMap((b) => ends(b.k)).filter((p) => !same(p, at)),
        // Rest of each branch, which the moved lines must not cross.
        rest = branches.flatMap((b) => {
          const pts = chains[b.k]!.points;
          return lines(b.start ? pts.slice(1) : pts.slice(0, -1));
        });
      for (const candidate of candidates) {
        c.candidates.take();
        const moved = round(candidate);
        if (distance(moved, at) < 1 || targets.some((p) => distance(moved, p) < 1)) continue;
        if (targets.reduce((s, p) => s + lineCost(moved, p), 0) > before + 1e-9) continue;
        const own: Line[] = [...rest];
        let ok = true;
        for (const p of targets) {
          c.candidates.take();
          if (!clear(moved, p, skip, own, exempt) || !strict(moved, p, false)) {
            ok = false;
            break;
          }
          own.push({ a: moved, b: p });
        }
        if (!ok) continue;
        for (const b of branches) {
          const pts = chains[b.k]!.points;
          if (b.start) pts[0] = moved;
          else pts[pts.length - 1] = moved;
          index.replace(b.k, pts);
          touched.add(b.k);
        }
        junctionAt.set(n, moved);
        break;
      }
    }
    if (!touched.size) break;
    for (const k of [...touched].sort((a, b) => a - b)) relax(k);
  }

  // 4. Round each interior corner with a quadratic curve inside its triangle;
  // the straight runs between curves are parts of the certified lines.
  for (const [k, chain] of chains.entries()) {
    const pulled = chain.points,
      skip = new Set([k]),
      exempt = ends(k),
      chords = lines(pulled),
      smooth: Point[] = [pulled[0]!],
      curves: Line[] = [];
    for (let i = 1; i < pulled.length - 1; i++) {
      const before = pulled[i - 1]!,
        v = pulled[i]!,
        after = pulled[i + 1]!,
        l0 = distance(before, v),
        l1 = distance(v, after),
        u0: Point = [(v[0] - before[0]) / l0, (v[1] - before[1]) / l0],
        u1: Point = [(after[0] - v[0]) / l1, (after[1] - v[1]) / l1],
        cos = Math.max(-1, Math.min(1, u0[0] * u1[0] + u0[1] * u1[1]));
      let curve: Point[] | undefined;
      if (cos < 1 - 1e-9 && cos > -1 + 1e-9) {
        // Turn θ: tan(θ/2) = √((1−cosθ)/(1+cosθ)); its unit-circle chord is √(2(1−cosθ)).
        const tanHalf = Math.sqrt((1 - cos) / (1 + cos)),
          pieces = Math.min(
            ANY_ANGLE.maxPieces,
            Math.max(2, Math.ceil(Math.sqrt(2 * (1 - cos)) / ANY_ANGLE.pieceChord)),
          ),
          own = [...chords.slice(0, i - 1), ...chords.slice(i + 1), ...curves];
        let d = Math.min(
          l0 * ANY_ANGLE.cornerShare,
          l1 * ANY_ANGLE.cornerShare,
          ANY_ANGLE.cornerRadiusM * tanHalf,
        );
        for (let attempt = 0; attempt <= ANY_ANGLE.cornerRetries && !curve; attempt++, d /= 2) {
          if (d < ANY_ANGLE.minCutM) break;
          const a = round([v[0] - u0[0] * d, v[1] - u0[1] * d]),
            b = round([v[0] + u1[0] * d, v[1] + u1[1] * d]),
            candidate: Point[] = [a];
          for (let s = 1; s < pieces; s++) {
            const t = s / pieces,
              w0 = (1 - t) * (1 - t),
              w1 = 2 * t * (1 - t),
              w2 = t * t;
            candidate.push(
              round([w0 * a[0] + w1 * v[0] + w2 * b[0], w0 * a[1] + w1 * v[1] + w2 * b[1]]),
            );
          }
          candidate.push(b);
          let ok = true;
          for (let s = 1; s < candidate.length && ok; s++) {
            c.candidates.take();
            const p = candidate[s - 1]!,
              q = candidate[s]!;
            ok = clear(p, q, skip, own, exempt) && strict(p, q, false);
          }
          if (ok) curve = candidate;
        }
      }
      if (curve) {
        curves.push(...lines(curve));
        smooth.push(...curve);
      } else smooth.push(v);
    }
    smooth.push(pulled.at(-1)!);
    chain.points = smooth;
    index.replace(k, smooth);
  }

  const output: NetworkSegment[] = [],
    template: Edge = { a: -1, b: -1, cost: 0 };
  for (const chain of chains)
    for (const l of lines(chain.points))
      if (distance(l.a, l.b) > 1e-6)
        output.push({ edge: template, routes: chain.routes, a: l.a, b: l.b });
  for (const s of selected.values())
    if (!lattice(s.edge)) output.push({ ...s, a: r.points[s.edge.a]!, b: r.points[s.edge.b]! });
  return output;
}
