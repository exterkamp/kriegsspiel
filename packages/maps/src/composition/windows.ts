import clipping from 'polygon-clipping';
import { DEFAULT_CONSTRAINT_LIMITS, type ConstraintWater } from '@kriegsspiel/settlemaker';
import type { Polygon, Water } from '../contract.js';
import type { settlementFrame } from './frame.js';
import { CompositionFailure, type Meter } from './budget.js';

/** Conservative local context: intersect each complete polygon, retaining holes. */
export function clipLocalWater(
  water: Water[],
  frame: ReturnType<typeof settlementFrame>,
  window: Polygon,
  initialVertices: number,
  meter: Meter,
  siteId: string,
): ConstraintWater[] {
  const result: ConstraintWater[] = [];
  let inputVertices = initialVertices;
  if (inputVertices > DEFAULT_CONSTRAINT_LIMITS.maxInputVertices)
    throw new CompositionFailure(
      'SETTLEMENT_WINDOW_LIMIT',
      'aggregate local input vertices',
      'Permissible/entrance points exceed fork input cap.',
      siteId,
    );
  for (const w of water) {
    const polygons: ConstraintWater['polygons'] = [];
    for (const p of w.polygons) {
      const vertices = p.outer.length + p.holes.reduce((n, r) => n + r.length, 0);
      meter.take((vertices + window.outer.length) ** 2 + vertices * 3);
      const q = frame.localPolygon(p),
        rings = [q.outer, ...q.holes].map((r) => r.map((v) => [v.x, v.y] as [number, number]));
      for (const cut of clipping.intersection(rings, [window.outer])) {
        const outputVertices = cut.reduce((n, r) => n + r.length, 0);
        if (
          cut.some((r) => r.length > DEFAULT_CONSTRAINT_LIMITS.maxPolygonVertices) ||
          inputVertices + outputVertices > DEFAULT_CONSTRAINT_LIMITS.maxInputVertices
        )
          throw new CompositionFailure(
            'SETTLEMENT_WINDOW_LIMIT',
            'topology-preserving local water',
            'Clipped water exceeds accepted fork aggregate input caps.',
            siteId,
          );
        meter.take(outputVertices * 3 + 1);
        inputVertices += outputVertices;
        if (cut.length)
          polygons.push({
            outer: cut[0]!.map(([x, y]) => ({ x, y })),
            holes: cut.slice(1).map((r) => r.map(([x, y]) => ({ x, y }))),
          });
      }
    }
    if (polygons.length) result.push({ id: w.id, polygons });
  }
  return result;
}
