import { distSegmentSegment, distance, mm, pointInPolygon, polygonsIntersect } from './geometry.js';
import { footprintCorners } from './formation.js';
import type { Point, Unit, UnitKind } from './types.js';

export const COMBAT_CHECK_EVENT = 'combat.check';
export const COMBAT_TICK_EVENT = 'combat.tick';
export const ATTACK_INTENT_EVENT = 'intent.attack';
export const VICTORY_DEADLINE_EVENT = 'victory.deadline';

/**
 * How far each kind can hurt an enemy, in metres. Placeholder numbers: infantry
 * fire at 200 m, cavalry only in a charge, guns much further. Real tables
 * arrive with Epic #2.
 */
export const RANGE_M: Record<UnitKind, number> = {
  infantry: 200,
  cavalry: 100,
  artillery: 400,
};

/**
 * Fire loses strength with distance: full effect point-blank, falling linearly to this
 * fraction of it at the edge of the shooter's range. Placeholder, like `RANGE_M`.
 */
export const LONG_RANGE_FACTOR = 0.25;

/** Cavalry closes to melee from this far (metres between centres): the charge distance. */
export const CHARGE_M = 60;

/** Casualty multiplier for a melee blow against fire at the same target. */
export const MELEE_FACTOR = 2;

/** Casualty multipliers by the side of the target the blow comes from. */
export const FLANK_FACTOR = 1.5;
export const REAR_FACTOR = 2;

/** Distance in mm between two points. */
export function distanceMm(a: Point, b: Point): number {
  return distance(a, b);
}

/** True if `shooter` can hit `target` from where they stand. */
export function canReach(shooter: Unit, target: Unit): boolean {
  return distance(shooter.center, target.center) <= mm(RANGE_M[shooter.kind]);
}

/** Effect of range on fire: 1 at point-blank, `LONG_RANGE_FACTOR` at maximum range. */
export function rangeFactor(shooter: Unit, target: Unit): number {
  const frac = Math.min(1, distance(shooter.center, target.center) / mm(RANGE_M[shooter.kind]));
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
  return shooter.kind === 'cavalry' && distance(shooter.center, target.center) <= mm(CHARGE_M);
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
