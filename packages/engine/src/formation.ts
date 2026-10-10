import { convexOverlap } from './geometry.js';
import type { Footprint, Formation, Point, Unit, UnitKind } from './types.js';
import { FORMATION_RULES, unitTypeOf, type UnitType } from './unitTypes.js';

/**
 * The footprint a formation gives `strength` men of a unit type (or of an arm's default
 * type), in integer mm. The numbers come from the unit data (`unitTypes.ts`).
 */
export function defaultFootprint(
  type: UnitType | UnitKind,
  formation: Formation,
  strength: number,
): Footprint {
  const t = typeof type === 'string' ? unitTypeOf(type) : type;
  const rules = FORMATION_RULES[formation];
  const area = t.areaPerMan * rules.areaFactor * Math.max(1, strength);
  const frontage = Math.sqrt(area * rules.aspect);
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
