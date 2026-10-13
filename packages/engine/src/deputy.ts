import { distance } from './geometry.js';
import { maySign } from './roles.js';
import type { Seat } from './roles.js';
import type { OrderIntent } from './orders.js';
import type { GameState, SideId } from './types.js';

/**
 * How much latitude a player gives their deputy (docs/gameplay.md, "When you are away"), least
 * first. Each level allows what the one before it does, and more:
 * - `hold`: stand fast or fall back. No order may send a unit more than `HOLD_RANGE_M` from where
 *   it stands now, except a withdrawal toward the side's own HQ.
 * - `adjust`: also reposition a unit by up to `ADJUST_RANGE_M` at the ordinary pace.
 * - `act`: any order the player could sign themselves, a forced march included.
 */
export const DISCRETIONS = ['hold', 'adjust', 'act'] as const;
export type Discretion = (typeof DISCRETIONS)[number];

/** Furthest (metres) a `hold` deputy may have a unit stand from where it is. */
export const HOLD_RANGE_M = 300;
/** Furthest (metres) an `adjust` deputy may move a unit. */
export const ADJUST_RANGE_M = 1500;

/**
 * Whether `intents` (an order to `unitId`) are within a deputy's discretion. Empty when they are.
 * Otherwise one reason each, in words the player can read on their return. Pure.
 *
 * The deputy never has more authority than the player it stands for: `seat` is the player's seat,
 * and the order is refused unless that seat could sign it (`maySign`). A conditional order
 * (`when`, `at`) is allowed only if everything it would do is allowed, since it fires later with no
 * one to look at it.
 */
export function deputyProblems(
  world: GameState,
  side: SideId,
  seat: Seat,
  discretion: Discretion,
  unitId: string,
  intents: readonly OrderIntent[],
): string[] {
  const unit = world.units.find((u) => u.id === unitId);
  if (!unit || unit.side !== side || unit.strength <= 0) {
    return [`${unitId} is not a living formation of this side`];
  }
  if (!maySign(world, side, seat, unitId)) {
    return [`the player could not sign an order to ${unit.name}`];
  }
  const problems: string[] = [];
  const check = (list: readonly OrderIntent[]): void => {
    for (const i of list) {
      switch (i.kind) {
        case 'withdraw': {
          // Falling back means toward our own HQ; a "withdrawal" toward the enemy is a move.
          const hq = world.sides.find((s) => s.id === side)?.hq;
          if (discretion !== 'act' && hq && distance(i.toward, hq) >= distance(unit.center, hq)) {
            problems.push('a withdrawal must fall back toward our own HQ');
          }
          break;
        }
        case 'hold': {
          if (discretion === 'hold' && distance(unit.center, i.at) > HOLD_RANGE_M) {
            problems.push(`holding ${Math.round(distance(unit.center, i.at))} m away is a move`);
          }
          if (discretion === 'adjust' && distance(unit.center, i.at) > ADJUST_RANGE_M) {
            problems.push(`${Math.round(distance(unit.center, i.at))} m is beyond an adjustment`);
          }
          break;
        }
        case 'move': {
          const far = distance(unit.center, i.to);
          if (discretion === 'hold') problems.push('a move is beyond a deputy told to hold');
          else if (discretion === 'adjust') {
            if (far > ADJUST_RANGE_M) {
              problems.push(`${Math.round(far)} m is beyond an adjustment`);
            }
            if (i.pace === 'forced') problems.push('a forced march needs the full discretion');
          }
          break;
        }
        case 'when':
        case 'at':
          check(i.then);
          break;
      }
    }
  };
  check(intents);
  return [...new Set(problems)];
}
