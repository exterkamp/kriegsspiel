import { distSegmentSegment, distance, mm, pointInPolygon, polygonsIntersect } from './geometry.js';
import { footprintCorners } from './formation.js';
import type { Point, Unit, UnitKind } from './types.js';
import { unitTypeOf } from './unitTypes.js';
import { FIRE_RULES } from './combatRules.js';

export const COMBAT_CHECK_EVENT = 'combat.check';
export const COMBAT_TICK_EVENT = 'combat.tick';
export const ATTACK_INTENT_EVENT = 'intent.attack';
export const VICTORY_DEADLINE_EVENT = 'victory.deadline';
export const RALLY_EVENT = 'combat.rally';

/**
 * How far each arm's default type can hurt an enemy, in metres. A unit's own range is its
 * type's `rangeM` (see `unitTypes.ts`); this table is a convenience for the default types.
 */
export const RANGE_M: Record<UnitKind, number> = {
  infantry: unitTypeOf('infantry').rangeM,
  cavalry: unitTypeOf('cavalry').rangeM,
  artillery: unitTypeOf('artillery').rangeM,
};

/**
 * Fire loses strength with distance: full effect point-blank, falling linearly to this
 * fraction of it at the edge of the shooter's range. Placeholder, like `RANGE_M`.
 */
export const LONG_RANGE_FACTOR = FIRE_RULES.longRangeFactor;

/** Cavalry closes to melee from this far (metres between centres): the default charge distance. */
export const CHARGE_M = unitTypeOf('cavalry').chargeM!;

/** Casualty multiplier for a melee blow against fire at the same target. */
export const MELEE_FACTOR = FIRE_RULES.meleeFactor;

/** Casualty multipliers by the side of the target the blow comes from. */
export const FLANK_FACTOR = FIRE_RULES.flankFactor;
export const REAR_FACTOR = FIRE_RULES.rearFactor;

/** Distance in mm between two points. */
export function distanceMm(a: Point, b: Point): number {
  return distance(a, b);
}

/** True if `shooter` can hit `target` from where they stand. */
export function canReach(shooter: Unit, target: Unit): boolean {
  return distance(shooter.center, target.center) <= mm(unitTypeOf(shooter).rangeM);
}

/** Effect of range on fire: 1 at point-blank, `LONG_RANGE_FACTOR` at maximum range. */
export function rangeFactor(shooter: Unit, target: Unit): number {
  const frac = Math.min(
    1,
    distance(shooter.center, target.center) / mm(unitTypeOf(shooter).rangeM),
  );
  return 1 - (1 - LONG_RANGE_FACTOR) * frac;
}

/** Shortest gap in mm between the two units' footprints; 0 if they touch or overlap. */
export function footprintGap(a: Unit, b: Unit): number {
  const p = footprintCorners(a);
  const q = footprintCorners(b);
  if (polygonsIntersect(p, q)) return 0;
  let best = Infinity;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    for (let k = 0, l = q.length - 1; k < q.length; l = k++) {
      best = Math.min(best, distSegmentSegment(p[j]!, p[i]!, q[l]!, q[k]!));
    }
  }
  return best;
}

/** True if `shooter` is in melee with `target`: footprints in contact, or a cavalry charge distance. */
export function inMelee(shooter: Unit, target: Unit): boolean {
  if (footprintGap(shooter, target) === 0) return true;
  const charge = unitTypeOf(shooter).chargeM;
  return charge !== undefined && distance(shooter.center, target.center) <= mm(charge);
}

/** A unit type that closes to melee on an attack order rather than halting at range: cavalry. */
export function closesToMelee(u: Pick<Unit, 'type' | 'kind'>): boolean {
  return unitTypeOf(u).chargeM !== undefined;
}

/**
 * Whether an attacker has closed far enough to stop marching (#446): a type with a charge
 * distance closes until it is in melee; any other attacker stops once its target is in range.
 */
export function hasClosed(u: Unit, foe: Unit): boolean {
  return closesToMelee(u) ? inMelee(u, foe) : canReach(u, foe);
}

/**
 * Where the straight run from `from` to `to` first comes within `radius` of `center`, or
 * undefined when it never does (or starts inside: callers handle that case themselves).
 * Pure geometry on whole-mm points, shared by the contact halt and the charge.
 */
export function crossingPoint(
  from: Point,
  to: Point,
  center: Point,
  radius: number,
): Point | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const fx = from.x - center.x;
  const fy = from.y - center.y;
  const a = dx * dx + dy * dy;
  if (a === 0) return undefined;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  if (c <= 0) return undefined;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return undefined;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t <= 0 || t > 1) return undefined;
  return { x: Math.round(from.x + dx * t), y: Math.round(from.y + dy * t) };
}

/** Where `shooter` is relative to `target`'s facing. A square has no flanks. */
export type Aspect = 'front' | 'flank' | 'rear';

export function aspectOf(shooter: Unit, target: Unit): Aspect {
  if (target.formation === 'square') return 'front';
  const bearing = Math.atan2(
    shooter.center.x - target.center.x,
    target.center.y - shooter.center.y,
  );
  let off = Math.abs(bearing - target.facing) % (2 * Math.PI);
  if (off > Math.PI) off = 2 * Math.PI - off;
  if (off <= Math.PI / 4) return 'front';
  return off <= (3 * Math.PI) / 4 ? 'flank' : 'rear';
}

export const ASPECT_FACTOR: Record<Aspect, number> = {
  front: 1,
  flank: FLANK_FACTOR,
  rear: REAR_FACTOR,
};

/** The compass bearing from `from` toward `to`. */
export function bearingTo(from: Point, to: Point): number {
  return Math.atan2(to.x - from.x, from.y - to.y);
}

/** True if the unit stands inside the objective area. */
export function onObjective(unit: Unit, objective: readonly Point[]): boolean {
  return pointInPolygon(unit.center, objective);
}

/** A pursuit is given up this long after the unit it chases broke. */
export const PURSUIT_MS = 20 * 60_000;

/** A unit that broke lately and is still running: it cannot fight back but can be run down. */
export function isRouted(u: Unit, time: number): boolean {
  return u.status === 'withdrawn' && u.brokenAt !== undefined && time - u.brokenAt <= PURSUIT_MS;
}

/** Whether an enemy can still be fought: standing, or running and not yet out of the pursuit. */
export function pursuable(u: Unit, time: number): boolean {
  return u.status === 'active' || isRouted(u, time);
}
