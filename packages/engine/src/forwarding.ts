import { distance } from './geometry.js';
import { COURIER_MS_PER_METRE } from './orders.js';
import { MS_PER_MINUTE, type GameState, type GameTime, type SideId } from './types.js';

/**
 * Information forwarding (docs/gameplay.md, "Information sharing is gameplay"). Pure: it only
 * works out how long a forwarded paper takes and which forwards have arrived by a given game time.
 */

/** How a side's humans are organised (docs/gameplay.md, "Hierarchy styles"). */
export type Hierarchy = 'shared' | 'chain';

/** Time to write a paper out and hand it to a rider, before the ride itself. */
export const FORWARD_HANDLING_MS = 2 * MS_PER_MINUTE;

/**
 * A paper passed along the chain. `down` is HQ passing a paper from its own view to the
 * subordinate commanding `unit`; `up` is that subordinate passing a report their formation filed
 * up to HQ. `deliverAt` is when it arrives, in game time.
 */
export interface ForwardedPaper {
  side: SideId;
  dispatchId: string;
  unit: string;
  direction: 'down' | 'up';
  sentAt: GameTime;
  deliverAt: GameTime;
}

/**
 * Game time a paper takes between HQ and the formation `unitId`. Shared HQ is instant. In a chain
 * of command a rider covers the straight-line distance at courier pace, after a short handling
 * time. Zero for an unknown unit or one of another side.
 */
export function forwardDelayMs(
  world: GameState,
  side: SideId,
  hierarchy: Hierarchy,
  unitId: string,
): number {
  if (hierarchy === 'shared') return 0;
  const unit = world.units.find((u) => u.id === unitId);
  const hq = world.sides.find((s) => s.id === side)?.hq;
  if (!unit || unit.side !== side || !hq) return 0;
  const metres = distance(hq, unit.center) / 1000;
  return FORWARD_HANDLING_MS + Math.round(metres * COURIER_MS_PER_METRE);
}

/** Send a paper at `now`: when it arrives follows from the hierarchy and the distance. */
export function sendForward(
  world: GameState,
  side: SideId,
  hierarchy: Hierarchy,
  paper: Pick<ForwardedPaper, 'dispatchId' | 'unit' | 'direction'>,
  now: GameTime,
): ForwardedPaper {
  return {
    side,
    ...paper,
    sentAt: now,
    deliverAt: now + forwardDelayMs(world, side, hierarchy, paper.unit),
  };
}

/** Ids of the forwards of `direction` that have arrived by `now` (those matching `unitIds`, if given). */
export function arrivedForwards(
  forwards: readonly ForwardedPaper[],
  side: SideId,
  direction: ForwardedPaper['direction'],
  now: GameTime,
  unitIds?: readonly string[],
): string[] {
  return forwards
    .filter(
      (f) =>
        f.side === side &&
        f.direction === direction &&
        f.deliverAt <= now &&
        (!unitIds || unitIds.includes(f.unit)),
    )
    .map((f) => f.dispatchId);
}
