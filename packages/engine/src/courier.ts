import { distPointSegment, distance, mm, pointInPolygon } from './geometry.js';
import { findPath } from './navigation.js';
import type { OrderIntent } from './orders.js';
import { BLOCKS_SIGHT, profileAlong, terrainAt } from './terrain.js';
import { unitTypeOf } from './unitTypes.js';
import {
  MS_PER_MINUTE,
  interceptReach,
  type Courier,
  type FeatureGeometry,
  type GameState,
  type Point,
  type TerrainFeature,
  type TerrainMap,
  type Unit,
} from './types.js';

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

/**
 * A crossing (bridge or ford) is held against an interceptor while a standing unit of the other
 * side has its centre within this many metres of the crossing's edge (rules 4, #531): the ends of
 * the bridge in Hold the Bridge, as `CONTEST_RADIUS_M` is for the objective.
 */
export const CROSSING_HOLD_M = 100;

const CROSSINGS: ReadonlySet<string> = new Set(['bridge', 'ford']);

/** Distance in mm from `p` to the ground the geometry covers, 0 inside it. */
function distanceTo(g: FeatureGeometry, p: Point): number {
  switch (g.shape) {
    case 'point':
      return Math.max(0, distance(p, g.at) - g.radius);
    case 'polyline': {
      let d = g.points.length === 1 ? distance(p, g.points[0] as Point) : Infinity;
      for (let i = 1; i < g.points.length; i++) {
        d = Math.min(d, distPointSegment(p, g.points[i - 1] as Point, g.points[i] as Point));
      }
      return Math.max(0, d - g.width / 2);
    }
    case 'polygon': {
      if (pointInPolygon(p, g.points)) return 0;
      let d = Infinity;
      for (let i = 0; i < g.points.length; i++) {
        const a = g.points[i] as Point;
        const b = g.points[(i + 1) % g.points.length] as Point;
        d = Math.min(d, distPointSegment(p, a, b));
      }
      return d;
    }
  }
}

/** Distance in mm from `p` to the geometry's bounding box grown by its width or radius. */
function boxDistance(g: FeatureGeometry, p: Point): number {
  const pts = g.shape === 'point' ? [g.at] : g.points;
  const pad = g.shape === 'point' ? g.radius : g.shape === 'polyline' ? g.width / 2 : 0;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const q of pts) {
    x0 = Math.min(x0, q.x);
    y0 = Math.min(y0, q.y);
    x1 = Math.max(x1, q.x);
    y1 = Math.max(y1, q.y);
  }
  const dx = Math.max(x0 - pad - p.x, 0, p.x - x1 - pad);
  const dy = Math.max(y0 - pad - p.y, 0, p.y - y1 - pad);
  return Math.hypot(dx, dy);
}

/** The crossings held against `enemy`: a standing unit of another side near each (rules 4). */
function heldAgainst(world: GameState, enemy: Unit): Set<string> {
  const near = mm(CROSSING_HOLD_M);
  const holders = world.units.filter(
    (u) => u.side !== enemy.side && u.status === 'active' && u.strength > 0,
  );
  const held = new Set<string>();
  for (const f of world.map.features) {
    if (!CROSSINGS.has(f.kind)) continue;
    if (holders.some((u) => distanceTo(f.geometry, u.center) <= near)) held.add(f.id);
  }
  return held;
}

/**
 * Whether `enemy` could reach the courier at `at` within `reach` mm (rules 4, #531): straight over
 * passable ground, or along its cheapest route (D15) if that is no longer than `reach`, and in
 * neither case over a crossing the courier's side holds. Only the ground within `reach` of the
 * enemy is planned over, since no route within reach leaves it, so the cost is bounded by the
 * features near the enemy whatever the map's size. Deterministic: no dice.
 */
export function canReachCourier(world: GameState, enemy: Unit, at: Point, reach: number): boolean {
  const from = enemy.center;
  if (distance(from, at) > reach) return false;
  const held = heldAgainst(world, enemy);
  const straight = profileAlong(world.map, from, at).every(
    (p) => p.attrs.passable && (p.featureId === undefined || !held.has(p.featureId)),
  );
  if (straight) return true;
  const local: TerrainFeature[] = world.map.features.filter(
    (f) => !held.has(f.id) && boxDistance(f.geometry, from) <= reach,
  );
  const map: TerrainMap = { ...world.map, features: local };
  const path = findPath(map, from, at);
  if (!path) return false;
  let length = 0;
  for (let i = 1; i < path.waypoints.length; i++) {
    length += distance(path.waypoints[i - 1] as Point, path.waypoints[i] as Point);
  }
  return length <= reach;
}

/**
 * Chance that one enemy unit takes the courier at `at` on one check, 0 if out of reach. Under
 * rules 4 (#531) it must also be able to reach the courier (`canReachCourier`), so a river with
 * no crossing near, or one the courier's side holds, keeps the enemy's cavalry off it.
 */
export function interceptChance(world: GameState, enemy: Unit, at: Point): number {
  if (enemy.strength <= 0 || enemy.status !== 'active') return 0;
  const threat = INTERCEPT_BY_KIND[enemy.kind];
  if (distance(enemy.center, at) > threat.rangeM * 1000) return 0;
  if (threat.chance > 0 && interceptReach(world)) {
    if (!canReachCourier(world, enemy, at, mm(threat.rangeM))) return 0;
  }
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
