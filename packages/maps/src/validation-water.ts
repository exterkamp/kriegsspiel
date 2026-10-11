import type { Point, Polygon } from './contract.js';
import { TopologyBudget } from './errors.js';
import { pointSegmentDistance, segmentDistance, TOPOLOGY_EPSILON } from './geometry.js';

export type Box = [number, number, number, number];
export function segmentBox(a: Point, b: Point, padding = TOPOLOGY_EPSILON): Box {
  return [
    Math.min(a[0], b[0]) - padding,
    Math.min(a[1], b[1]) - padding,
    Math.max(a[0], b[0]) + padding,
    Math.max(a[1], b[1]) + padding,
  ];
}
export function boxesMeet(a: Box, b: Box): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}
interface Edge {
  a: Point;
  b: Point;
  ring: number;
  bounds: Box;
}

/** Per-polygon row index. Exact predicates below match the accepted geometry
 * routines; bounds only exclude edges that cannot affect those predicates. */
export class WaterPolygonIndex {
  readonly bounds: Box = [Infinity, Infinity, -Infinity, -Infinity];
  private readonly edges: Edge[] = [];
  private readonly rows = new Map<number, number[]>();
  private readonly rings: number;
  private readonly spacing = 100;
  constructor(
    readonly polygon: Polygon,
    private readonly budget: TopologyBudget,
    path: string,
  ) {
    this.rings = polygon.holes.length + 1;
    budget.consume(path, this.rings);
    for (const [ringIndex, ring] of [polygon.outer, ...polygon.holes].entries()) {
      budget.consume(path, ring.length);
      if (ringIndex === 0)
        for (const p of ring) {
          this.bounds[0] = Math.min(this.bounds[0], p[0]);
          this.bounds[1] = Math.min(this.bounds[1], p[1]);
          this.bounds[2] = Math.max(this.bounds[2], p[0]);
          this.bounds[3] = Math.max(this.bounds[3], p[1]);
        }
      for (let i = 1; i < ring.length; i++) {
        budget.consume(path);
        const a = ring[i - 1]!,
          b = ring[i]!,
          bounds = segmentBox(a, b, 0);
        const id = this.edges.length;
        this.edges.push({ a, b, ring: ringIndex, bounds });
        for (
          let row = Math.floor(bounds[1] / this.spacing);
          row <= Math.floor(bounds[3] / this.spacing);
          row++
        ) {
          budget.consume(path);
          let bucket = this.rows.get(row);
          if (!bucket) {
            bucket = [];
            this.rows.set(row, bucket);
          }
          bucket.push(id);
        }
      }
    }
  }
  private candidates(bounds: Box, path: string): Edge[] {
    const seen = new Set<number>(),
      output: Edge[] = [];
    for (
      let row = Math.floor(bounds[1] / this.spacing);
      row <= Math.floor(bounds[3] / this.spacing);
      row++
    ) {
      this.budget.consume(path);
      for (const id of this.rows.get(row) ?? []) {
        this.budget.consume(path);
        if (seen.has(id)) continue;
        seen.add(id);
        const edge = this.edges[id]!;
        if (boxesMeet(bounds, edge.bounds)) output.push(edge);
      }
    }
    return output;
  }
  cutEdges(a: Point, b: Point, path: string): [Point, Point][] {
    const edges = this.candidates(segmentBox(a, b), path);
    this.budget.consume(path, edges.length);
    return edges.map((e) => [e.a, e.b]);
  }
  location(point: Point, path: string): 'inside' | 'outside' | 'boundary' {
    this.budget.consume(path);
    const epsilon = TOPOLOGY_EPSILON;
    if (!boxesMeet(segmentBox(point, point), this.bounds)) return 'outside';
    // The horizontal ray needs every edge crossing this y, including edges far
    // to the right. Including epsilon-adjacent rows also preserves boundary tests.
    const candidates = this.candidates(
      [point[0] - epsilon, point[1] - epsilon, this.bounds[2] + epsilon, point[1] + epsilon],
      path,
    );
    for (let ring = 0; ring < this.rings; ring++) {
      let inside = false;
      for (const edge of candidates) {
        this.budget.consume(path);
        if (edge.ring !== ring) continue;
        const { a, b } = edge;
        if (pointSegmentDistance(point, a, b) <= epsilon) return 'boundary';
        if (
          a[1] > point[1] !== b[1] > point[1] &&
          point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
        )
          inside = !inside;
      }
      if (ring === 0 && !inside) return 'outside';
      if (ring > 0 && inside) return 'outside';
    }
    return 'inside';
  }
  intersectsCapsule(a: Point, b: Point, radius: number, path: string): boolean {
    const box = segmentBox(a, b, radius + TOPOLOGY_EPSILON);
    this.budget.consume(path);
    if (!boxesMeet(box, this.bounds)) return false;
    if (this.location(a, path) === 'inside' || this.location(b, path) === 'inside') return true;
    for (const edge of this.candidates(box, path)) {
      this.budget.consume(path);
      if (segmentDistance(a, b, edge.a, edge.b) < radius - TOPOLOGY_EPSILON) return true;
    }
    return false;
  }
}
