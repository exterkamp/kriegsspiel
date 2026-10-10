import { convexOverlap } from './geometry.js';
import type { Footprint, Formation, Point, Unit, UnitKind } from './types.js';

/**
 * Ground per man in square metres, by arm and formation, and the frontage-to-depth ratio of
 * the formation. A first pass, not the 1824 frontage tables (cavalry and artillery
 * frontages are still missing from docs/rules.md).
 */
const AREA_PER_MAN_M2: Record<UnitKind, number> = { infantry: 1.2, cavalry: 4, artillery: 10 };
const FORMATION_AREA: Record<Formation, number> = {
  line: 1,
  column: 1,
  square: 1.3,
  skirmish: 20,
  loose: 20,
};
const FORMATION_ASPECT: Record<Formation, number> = {
  line: 12,
  column: 0.15,
  square: 1,
  skirmish: 25,
  loose: 4,
};

/** The footprint a formation gives `strength` men of `kind`, in integer mm. */
export function defaultFootprint(
  kind: UnitKind,
  formation: Formation,
  strength: number,
): Footprint {
  const area = AREA_PER_MAN_M2[kind] * FORMATION_AREA[formation] * Math.max(1, strength);
  const frontage = Math.sqrt(area * FORMATION_ASPECT[formation]);
  return { frontage: Math.round(frontage * 1000), depth: Math.round((area / frontage) * 1000) };
}

/** Unit vectors for a compass bearing: `forward` is where the unit faces, `right` its right hand. */
export function axes(facing: number): { forward: Point; right: Point } {
  return {
    forward: { x: Math.sin(facing), y: -Math.cos(facing) },
    right: { x: Math.cos(facing), y: Math.sin(facing) },
  };
}

/** A point in a unit's own frame (x to its right, y to its front) as a world point, in whole mm. */
export function toWorld(center: Point, facing: number, local: Point): Point {
  const { forward, right } = axes(facing);
  return {
    x: Math.round(center.x + local.x * right.x + local.y * forward.x),
    y: Math.round(center.y + local.x * right.y + local.y * forward.y),
  };
}

/** Corners of the unit's oriented footprint: front-left, front-right, rear-right, rear-left. */
export function footprintCorners(u: Pick<Unit, 'center' | 'facing' | 'footprint'>): Point[] {
  const hx = u.footprint.frontage / 2;
  const hy = u.footprint.depth / 2;
  return [
    { x: -hx, y: hy },
    { x: hx, y: hy },
    { x: hx, y: -hy },
    { x: -hx, y: -hy },
  ].map((c) => toWorld(u.center, u.facing, c));
}

/** Where the unit's men are: its sub-positions if it has a loose shape, else just its centre. */
export function subPositions(u: Pick<Unit, 'center' | 'facing' | 'shape'>): Point[] {
  return u.shape && u.shape.length > 0
    ? u.shape.map((s) => toWorld(u.center, u.facing, s))
    : [{ ...u.center }];
}

/** Whether two units' footprints overlap by more than a shared edge. */
export function footprintsOverlap(
  a: Pick<Unit, 'center' | 'facing' | 'footprint'>,
  b: Pick<Unit, 'center' | 'facing' | 'footprint'>,
): boolean {
  return convexOverlap(footprintCorners(a), footprintCorners(b));
}
