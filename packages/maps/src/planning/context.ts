import {
  AssetSchema,
  HARD_LIMITS,
  type Bounds,
  type MapSettings,
  type Point,
  type Polygon,
  type Water,
} from '../contract.js';
import { fail } from '../errors.js';
import { polygonEdges, polygonLocation, segmentDistance, validatePolygon } from '../geometry.js';
import { createElevationQueries } from '../queries.js';
import { preflightAsset } from '../resources.js';
import { checkField } from '../terrain/input.js';
import { deriveSeed } from '../overrides.js';
import { Meter, Work } from './budget.js';
import type { PlanningInput } from './types.js';
type Box = [number, number, number, number];
export function box(points: Point[]): Box {
  return [
    Math.min(...points.map((p) => p[0])),
    Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])),
    Math.max(...points.map((p) => p[1])),
  ];
}
export function touches(a: Box, b: Box): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}
export class Context {
  readonly settings: MapSettings;
  readonly bounds: Bounds;
  readonly water: Water[];
  readonly q: ReturnType<typeof createElevationQueries>;
  readonly validation: Work;
  readonly candidates: Work;
  readonly heap: Work;
  readonly meter: Meter;
  readonly polygons: { polygon: Polygon; box: Box; water: Water }[] = [];
  readonly edges: { a: Point; b: Point; box: Box }[] = [];
  readonly bins = new Map<number, number[]>();
  readonly binSize: number;
  readonly binCols: number;
  readonly spacing: number;
  readonly columns: number;
  readonly rows: number;
  readonly cells: number;
  readonly preferredSiteExtentM: { village?: number; farm?: number };
  readonly gradientCells = new Map<number, { dx: number; dy: number; dxy: number; dyx: number }>();
  expansions = 0;
  placementAttempts = 0;
  constructor(
    readonly input: PlanningInput,
    sharedValidation?: Work,
  ) {
    preflightAsset(input, HARD_LIMITS);
    this.settings = checkField(input.elevation, input.bounds, input.settings);
    deriveSeed(input.seed, 'planning:v1');
    const s = this.settings;
    const preferred = input.preferredSiteExtentM === undefined ? {} : input.preferredSiteExtentM;
    if (typeof preferred !== 'object' || preferred === null || Array.isArray(preferred))
      throw new RangeError('Invalid preferred site extents');
    this.preferredSiteExtentM = {};
    for (const [kind, extent] of Object.entries(preferred)) {
      if (kind !== 'village' && kind !== 'farm')
        throw new RangeError('Unknown preferred site kind');
      const config = kind === 'village' ? s.settlements.villageSite : s.settlements.farmSite;
      const minimum = Math.max(config.minExtentM, Math.sqrt(config.minAreaM2));
      const maximum = Math.min(config.maxExtentM, Math.sqrt(config.maxAreaM2));
      if (!Number.isFinite(extent) || extent! < minimum || extent! > maximum)
        throw new RangeError(`Preferred ${kind} extent is outside recorded area/extent limits`);
      this.preferredSiteExtentM[kind] = extent;
    }
    if (
      input.limits?.maxOutputFeatures !== undefined &&
      (!Number.isSafeInteger(input.limits.maxOutputFeatures) ||
        input.limits.maxOutputFeatures < 1 ||
        input.limits.maxOutputFeatures > HARD_LIMITS.maxFeatures)
    )
      throw new RangeError('Invalid output feature limit');
    if ((input.crossingCandidates?.length ?? 0) > s.limits.maxFeatures)
      fail('$.crossingCandidates', 'Crossing candidates exceed the feature cap', 'RESOURCE_LIMIT');
    this.bounds = { ...input.bounds };
    this.validation = new Work(
      input.limits?.maxValidationWork ?? Math.min(100_000_000, s.limits.maxTopologyChecks * 20),
      'geometry validation',
    );
    if (sharedValidation) {
      const take = this.validation.take.bind(this.validation);
      this.validation.take = (n = 1) => {
        sharedValidation.take(n);
        take(n);
      };
    }
    this.candidates = new Work(
      input.limits?.maxCandidateWork ?? Math.min(100_000_000, s.roads.maxPlanningCells * 64),
      'candidate scans',
    );
    this.heap = new Work(
      input.limits?.maxHeapWork ?? Math.min(100_000_000, s.roads.maxGlobalExpansions * 16),
      'routing heap operations',
    );
    this.meter = new Meter(this.validation);
    this.validation.take(input.elevation.samples.length);
    this.q = createElevationQueries({ elevation: input.elevation, bounds: this.bounds });
    preflightAsset(
      { layers: { water: input.water, cover: input.cover ?? [] } },
      { ...HARD_LIMITS, maxFeatures: s.limits.maxFeatures, maxVertices: s.limits.maxVertices },
    );
    const parsed = AssetSchema.shape.layers.shape.water.safeParse(input.water);
    if (!parsed.success) fail('$.water', parsed.error.message);
    this.water = parsed.data;
    const ids = new Set<string>();
    this.binSize = Math.max(25, s.roads.planningSpacingM * 4);
    this.binCols = Math.ceil(this.bounds.maxX / this.binSize) + 1;
    for (const w of this.water) {
      if (ids.has(w.id)) fail('$.water', 'Duplicate water identity');
      ids.add(w.id);
      for (const p of w.polygons) {
        validatePolygon(p, '$.water', this.meter);
        const b = box(p.outer);
        if (b[0] < 0 || b[1] < 0 || b[2] > this.bounds.maxX || b[3] > this.bounds.maxY)
          fail('$.water', 'Water outside bounds');
        this.polygons.push({ polygon: p, box: b, water: w });
        for (const [a, b] of polygonEdges(p)) {
          const rect = box([a, b]),
            id = this.edges.length;
          this.validation.take();
          this.edges.push({ a, b, box: rect });
          for (
            let y = Math.floor(rect[1] / this.binSize);
            y <= Math.floor(rect[3] / this.binSize);
            y++
          )
            for (
              let x = Math.floor(rect[0] / this.binSize);
              x <= Math.floor(rect[2] / this.binSize);
              x++
            ) {
              this.validation.take();
              const key = y * this.binCols + x;
              const bucket = this.bins.get(key) ?? [];
              bucket.push(id);
              this.bins.set(key, bucket);
            }
        }
      }
    }
    this.spacing = s.roads.planningSpacingM;
    this.columns = Math.floor(this.bounds.maxX / this.spacing) + 1;
    this.rows = Math.floor(this.bounds.maxY / this.spacing) + 1;
    this.cells = this.columns * this.rows;
    if (!Number.isSafeInteger(this.cells) || this.cells > s.roads.maxPlanningCells)
      fail(
        '$.settings.roads.maxPlanningCells',
        'Planning lattice exceeds allocation cap',
        'RESOURCE_LIMIT',
      );
  }
  point(id: number): Point {
    return [(id % this.columns) * this.spacing, Math.floor(id / this.columns) * this.spacing];
  }
  node(p: Point): number {
    return Math.round(p[1] / this.spacing) * this.columns + Math.round(p[0] / this.spacing);
  }
  inBounds(p: Point, r = 0): boolean {
    if (!p.every(Number.isFinite) || !Number.isFinite(r) || r < 0)
      throw new RangeError('Finite position/radius required');
    return (
      p[0] - r >= 0 && p[1] - r >= 0 && p[0] + r <= this.bounds.maxX && p[1] + r <= this.bounds.maxY
    );
  }
  wet(p: Point): boolean {
    for (const item of this.polygons) {
      this.validation.take();
      if (
        touches(item.box, [p[0], p[1], p[0], p[1]]) &&
        polygonLocation(p, item.polygon, this.meter) !== 'outside'
      )
        return true;
    }
    return false;
  }
  edgeCandidates(b: Box): number[] {
    const ids = new Set<number>();
    for (
      let y = Math.max(0, Math.floor(b[1] / this.binSize));
      y <= Math.floor(b[3] / this.binSize);
      y++
    )
      for (
        let x = Math.max(0, Math.floor(b[0] / this.binSize));
        x <= Math.floor(b[2] / this.binSize);
        x++
      ) {
        this.validation.take();
        for (const id of this.bins.get(y * this.binCols + x) ?? []) {
          this.validation.take();
          ids.add(id);
        }
      }
    return [...ids];
  }
  drySegment(a: Point, b: Point, r: number, knownDry = false): boolean {
    if (!knownDry && (this.wet(a) || this.wet(b))) return false;
    const rect: Box = [
      Math.min(a[0], b[0]) - r,
      Math.min(a[1], b[1]) - r,
      Math.max(a[0], b[0]) + r,
      Math.max(a[1], b[1]) + r,
    ];
    for (const id of this.edgeCandidates(rect)) {
      this.validation.take();
      const e = this.edges[id]!;
      if (touches(rect, e.box) && segmentDistance(a, b, e.a, e.b) <= r + 1e-9) return false;
    }
    return true;
  }
}
