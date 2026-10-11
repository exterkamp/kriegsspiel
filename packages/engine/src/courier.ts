import { distance } from './geometry.js';
import type { OrderIntent } from './orders.js';
import { BLOCKS_SIGHT, terrainAt } from './terrain.js';
import { unitTypeOf } from './unitTypes.js';
import { MS_PER_MINUTE, type Courier, type GameState, type Point, type Unit } from './types.js';

/**
 * Courier hazards (docs/design.md, "Courier and signal layer"). All chances are per ride or per
 * check and are rolled on the game RNG by the order handlers, so a ride is fixed by the seed.
 * The figures are placeholders until the first scenario is playtested.
 */

/** How often (game time) a riding courier is checked for interception. */
export const INTERCEPT_CHECK_MS = MS_PER_MINUTE;

/** Chance of losing the courier outright (thrown, lost, killed) per km of ride, on open ground. */
export const LOSS_PER_KM = 0.01;
/** Chance the order is misunderstood per km of ride, for a unit of training 0.5. */
export const GARBLE_PER_KM = 0.02;
/** Caps, so no ride is certain to fail. */
export const MAX_LOSS = 0.5;
export const MAX_GARBLE = 0.6;
/** A garbled order's destination is off by this much (metres), in a random direction. */
export const GARBLE_MIN_M = 300;
export const GARBLE_MAX_M = 1200;

/** How an arm of the enemy threatens a courier: from how far, and the chance per check. */
export const INTERCEPT_BY_KIND = {
  cavalry: { rangeM: 800, chance: 0.3 },
  infantry: { rangeM: 300, chance: 0.1 },
  artillery: { rangeM: 0, chance: 0 },
} as const;

/** Where the courier is at `time`, along its legs. At its origin before it sets out. */
export function courierPosition(c: Courier, time: number): Point {
  let at = c.origin;
  for (const leg of c.legs) {
    if (time >= leg.arriveAt) {
      at = leg.to;
      continue;
    }
    if (time <= leg.startedAt) return leg.from;
    const f = (time - leg.startedAt) / (leg.arriveAt - leg.startedAt);
    return {
      x: Math.round(leg.from.x + (leg.to.x - leg.from.x) * f),
      y: Math.round(leg.from.y + (leg.to.y - leg.from.y) * f),
    };
  }
  return at;
}

/** Weather makes every ride riskier: fog (sight factor 0.5) doubles the hazard. */
const weatherFactor = (world: GameState) => 1 / Math.min(1, Math.max(0.25, world.sightFactor ?? 1));

/**
 * Chances that a ride of `lengthMm` straight-line length and `cost` (ground-weighted mm) is lost
 * or garbled. Longer rides and rougher ground (road cost 0.5, open 1, wood more) and bad weather
 * raise both; a better-trained addressee lowers the chance of garbling.
 */
export function rideRisk(
  world: GameState,
  to: Unit,
  lengthMm: number,
  cost: number,
): { loss: number; garble: number } {
  const km = lengthMm / 1_000_000;
  const terrain = lengthMm > 0 ? cost / lengthMm : 1;
  const wx = weatherFactor(world);
  const training = unitTypeOf(to).training;
  return {
    loss: Math.min(MAX_LOSS, LOSS_PER_KM * km * terrain * wx),
    garble: Math.min(MAX_GARBLE, GARBLE_PER_KM * km * terrain * wx * (1.5 - training)),
  };
}

/** Chance that one enemy unit takes the courier at `at` on one check, 0 if out of reach. */
export function interceptChance(world: GameState, enemy: Unit, at: Point): number {
  if (enemy.strength <= 0 || enemy.status !== 'active') return 0;
  const threat = INTERCEPT_BY_KIND[enemy.kind];
  if (distance(enemy.center, at) > threat.rangeM * 1000) return 0;
  const hidden = (terrainAt(world.map, at)?.attrs.concealment ?? 0) >= BLOCKS_SIGHT;
  return threat.chance * (hidden ? 0.5 : 1) * Math.min(1, world.sightFactor ?? 1);
}

/** The `intent` with its destination moved to `to`; a conditional intent has its nested ones moved. */
export function redirect(intent: OrderIntent, to: Point): OrderIntent {
  switch (intent.kind) {
    case 'move':
      return { kind: 'move', to };
    case 'hold':
      return { kind: 'hold', at: to };
    case 'withdraw':
      return { kind: 'withdraw', toward: to };
    case 'when':
      return { ...intent, then: intent.then.map((i) => redirect(i, to)) };
    case 'at':
      return { ...intent, then: intent.then.map((i) => redirect(i, to)) };
  }
}

/** Where the intent sends the unit: for a conditional one, the first nested destination, if any. */
export function destinationOf(intent: OrderIntent): Point | undefined {
  switch (intent.kind) {
    case 'move':
      return intent.to;
    case 'hold':
      return intent.at;
    case 'withdraw':
      return intent.toward;
    default:
      for (const i of intent.then) {
        const d = destinationOf(i);
        if (d) return d;
      }
      return undefined;
  }
}
