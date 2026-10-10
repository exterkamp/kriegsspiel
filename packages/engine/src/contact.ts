import type { Point, Unit, UnitKind } from './types.js';

export const COMBAT_CHECK_EVENT = 'combat.check';
export const COMBAT_TICK_EVENT = 'combat.tick';
export const ATTACK_INTENT_EVENT = 'intent.attack';
export const VICTORY_DEADLINE_EVENT = 'victory.deadline';

/**
 * How far each kind can hurt an enemy, in tiles (a tile is 100 paces, see
 * `MS_PER_TILE`). Placeholder numbers: infantry fire at 100-200 paces,
 * cavalry only in a charge, guns much further. Real tables arrive with Epic #2.
 */
export const RANGE_TILES: Record<UnitKind, number> = {
  infantry: 2,
  cavalry: 1,
  artillery: 4,
};

export function distanceSq(a: Point, b: Point): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/** True if `shooter` can hit `target` from where they stand. */
export function canReach(shooter: Unit, target: Unit): boolean {
  return distanceSq(shooter.position, target.position) <= RANGE_TILES[shooter.kind] ** 2;
}
