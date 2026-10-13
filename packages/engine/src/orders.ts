import type { EngineState, EventRegistry, HandlerResult, Json, NewEvent } from './events.js';
import {
  GARBLE_MAX_M,
  GARBLE_MIN_M,
  INTERCEPT_CHECK_MS,
  MAX_GARBLE,
  MAX_LOSS,
  courierPosition,
  destinationOf,
  interceptChance,
  redirect,
  rideRisk,
} from './courier.js';
import { distance } from './geometry.js';
import { shapeIntents, type Interpretation } from './personality.js';
import type { Pace } from './fatigue.js';
import { findPath, legCost } from './navigation.js';
import { describePlace } from './place.js';
import { schedule } from './queue.js';
import { applyIntents, fireOnReceipt, registerStanding } from './standing.js';
import { COURIER_DELAY_MS, REPORT_EVENT, fileReport } from './visibility.js';
import {
  MS_PER_MINUTE,
  type Courier,
  type GameState,
  type GameTime,
  type Leg,
  type Point,
  type TerrainMap,
  type Trigger,
} from './types.js';

/** What an order asks a unit to do, as parsed. The engine turns it into an `Intent` on delivery. */
export type OrderIntent =
  | { kind: 'move'; to: Point; pace?: Pace }
  | { kind: 'hold'; at: Point }
  | { kind: 'withdraw'; toward: Point }
  /** Do `then` once `trigger` fires, judged from what the unit itself knows. */
  | { kind: 'when'; trigger: Trigger; then: OrderIntent[] }
  /** Do `then` at game time `gameTime`. */
  | { kind: 'at'; gameTime: GameTime; then: OrderIntent[] };

/** A signed order. Plain JSON so it can ride in event payloads and replay logs. */
export interface Order {
  id: string;
  side: 'blue' | 'red';
  /** Id of the unit the order is addressed to. */
  to: string;
  /** Game time of signing. `issueOrder` overwrites it with the time the order leaves HQ. */
  issuedAt: number;
  /** Who sent it, for `orderReceived` triggers. Absent means 'hq'. */
  from?: string;
  /** Original wording, preserved. */
  text: string;
  /**
   * Parsed by the umpire service. On delivery the unit adopts the first immediate intent
   * (move, hold, withdraw) and keeps each `when` / `at` as a standing order until it fires.
   */
  intents: OrderIntent[];
  /** The courier the sender chose. Absent means the ordinary ride. */
  courier?: CourierChoice;
  /** How the addressee's commander read the order (personality.ts). Absent: as written. */
  interpretation?: Interpretation;
}

/** A fast courier rides hard and is more likely to be lost or to garble; a safe one takes the quiet way. */
export type CourierChoice = 'fast' | 'safe';

/** Ride speed and hazard, as multiples of the ordinary courier's. */
export const COURIER_CHOICES: Record<CourierChoice, { speed: number; risk: number }> = {
  fast: { speed: 1.5, risk: 2 },
  safe: { speed: 0.75, risk: 0.5 },
};

/** The ride's loss and garble chances scaled by the courier's hazard, still held under the caps. */
export function choiceRisk(
  base: { loss: number; garble: number },
  hazard: number,
): { loss: number; garble: number } {
  return {
    loss: Math.min(MAX_LOSS, base.loss * hazard),
    garble: Math.min(MAX_GARBLE, base.garble * hazard),
  };
}

/**
 * Game ms for a courier to ride one metre of cost-1 ground: 400 m a minute, about 24 km/h.
 * Roads cost half, so a courier on a road does 800 m a minute.
 */
export const COURIER_MS_PER_METRE = MS_PER_MINUTE / 400;

export const ORDER_ISSUE_EVENT = 'order.issue';
export const ORDER_DELIVER_EVENT = 'order.deliver';
/** A riding courier is checked for interception. */
export const COURIER_STEP_EVENT = 'courier.step';
/** A courier is lost on the road. */
export const COURIER_LOST_EVENT = 'courier.lost';

/**
 * Queue `order` to leave HQ at `time` (default: now). The order is stamped
 * `issuedAt = time`, whatever the caller put there. The courier's route and
 * delivery time are worked out when the order fires, from where the unit then is.
 */
export function issueOrder(
  state: EngineState<GameState>,
  order: Order,
  time = state.time,
): EngineState<GameState> {
  return schedule(state, [
    { time, type: ORDER_ISSUE_EVENT, payload: { ...order, issuedAt: time } as unknown as Json },
  ]);
}

function failed(world: GameState, order: Order, reason: string): HandlerResult<GameState> {
  return {
    world,
    emit: [{ type: 'order_failed', payload: { orderId: order.id, unitId: order.to, reason } }],
  };
}

/** Why `order` cannot reach its unit, or undefined if it can. */
function undeliverable(world: GameState, order: Order): string | undefined {
  const unit = world.units.find((u) => u.id === order.to);
  if (!unit) return 'unit does not exist';
  if (unit.strength <= 0) return 'unit destroyed';
  if (unit.side !== order.side) return 'unit belongs to another side';
  if (order.intents.length === 0) return 'order has no intents';
  return undefined;
}

/** The courier's ride as legs, timed so the last one ends when the whole route's cost is ridden. */
function ridesAlong(
  map: TerrainMap,
  waypoints: Point[],
  cost: number,
  start: number,
  speed = 1,
): Leg[] {
  const costs = waypoints.slice(1).map((p, i) => legCost(map, waypoints[i]!, p) ?? 0);
  const total = costs.reduce((a, b) => a + b, 0) || 1;
  const legs: Leg[] = [];
  let ridden = 0;
  let from = start;
  for (const [i, c] of costs.entries()) {
    ridden += c;
    const arriveAt =
      start + Math.round((((cost * (ridden / total)) / 1000) * COURIER_MS_PER_METRE) / speed);
    legs.push({ from: waypoints[i]!, to: waypoints[i + 1]!, startedAt: from, arriveAt });
    from = arriveAt;
  }
  return legs;
}

const courierOf = (world: GameState, id: unknown) => world.couriers.find((c) => c.id === id);
const without = (world: GameState, id: string): GameState => ({
  ...world,
  couriers: world.couriers.filter((c) => c.id !== id),
});
/** A lost or taken courier is kept (see `Courier.lostAt`) so the sender's table does not show it go. */
const markLost = (world: GameState, id: string, time: number): GameState => ({
  ...world,
  couriers: world.couriers.map((c) => (c.id === id ? { ...c, lostAt: time } : c)),
});
/** HQ's wait past a courier's due arrival, and the ride back with the news, before it is called lost. */
export const COURIER_OVERDUE_MS = 15 * MS_PER_MINUTE;

/**
 * The sender hears of a lost or taken courier once its order is overdue, not when it is lost.
 * The report is stamped with that moment (HQ giving the courier up), never the loss, so its
 * written time is no tell either.
 */
function reportOverdue(world: GameState, c: Courier, time: number): GameState {
  const unit = world.units.find((u) => u.id === c.order.to && u.side === c.side);
  if (!unit || unit.strength <= 0) return world;
  const due = Math.max(time, arrivalOf(c, c.order.issuedAt) + COURIER_OVERDUE_MS);
  return fileReport(world, 'courierLost', unit, due, 0);
}
const arrivalOf = (c: Courier, issuedAt: number) => c.legs.at(-1)?.arriveAt ?? issuedAt;

/**
 * Register the order handlers. An order is issued at HQ and a courier rides to the unit along
 * the cheapest route (roads are fastest). The courier is a map entity: every minute enemy units
 * in reach may take it, and over the ride it may be lost or garble the order, all rolled on the
 * game RNG when it sets out. A taken order is never executed; its text becomes a document in
 * the captor's intel (see `viewFor`). On arrival the unit adopts the order's intent (as garbled,
 * if it was). Until then it keeps its standing intent. An order that cannot be delivered, because
 * the unit is gone or destroyed, the courier has no route or was lost, emits `order_failed` and
 * changes nothing. Delivery emits `order_delivered`; a garbled one also `order_garbled`; a
 * taken one `courier_intercepted` (master log only).
 */
export function registerOrders(registry: EventRegistry<GameState>): void {
  registerStanding(registry);
  registry.register(ORDER_ISSUE_EVENT, (world, ev, rng) => {
    const order = ev.payload as unknown as Order;
    const reason = undeliverable(world, order);
    if (reason) return failed(world, order, reason);
    const unit = world.units.find((u) => u.id === order.to)!;
    const hq = world.sides.find((s) => s.id === order.side)?.hq;
    const route = hq && findPath(world.map, hq, unit.center);
    if (!hq || !route) return failed(world, order, 'no route for courier');

    const choice = order.courier ? COURIER_CHOICES[order.courier] : { speed: 1, risk: 1 };
    const legs = ridesAlong(world.map, route.waypoints, route.cost, ev.time, choice.speed);
    const length = route.waypoints
      .slice(1)
      .reduce((a, p, i) => a + distance(route.waypoints[i]!, p), 0);
    const base = rideRisk(world, unit, length, route.cost);
    const risk = choiceRisk(base, choice.risk);
    const courier: Courier = {
      id: `courier-${order.id}`,
      side: order.side,
      order,
      origin: hq,
      legs,
    };
    const arrival = arrivalOf(courier, ev.time);

    const later: NewEvent[] = [];
    // Lost on the road: the point is drawn along the ride, so the loss can be before or after a check.
    if (rng.next() < risk.loss) {
      const at = ev.time + Math.floor(rng.next() * (arrival - ev.time));
      later.push({ time: at, type: COURIER_LOST_EVENT, payload: { courierId: courier.id } });
    }
    if (rng.next() < risk.garble) {
      // All draws are taken whatever the order holds, so the RNG stream does not depend on it.
      const angle = rng.next() * 2 * Math.PI;
      const away = (GARBLE_MIN_M + rng.next() * (GARBLE_MAX_M - GARBLE_MIN_M)) * 1000;
      // The intent the unit adopts is the first immediate one (see `applyIntents`); an order of
      // conditionals only garbles the first that names a destination, and none if none does.
      const at = order.intents.findIndex((i) => i.kind !== 'when' && i.kind !== 'at');
      const i = at >= 0 ? at : order.intents.findIndex((x) => destinationOf(x) !== undefined);
      const d = i >= 0 ? destinationOf(order.intents[i]!) : undefined;
      if (d) {
        const to = {
          x: Math.min(world.map.width, Math.max(0, Math.round(d.x + Math.cos(angle) * away))),
          y: Math.min(world.map.height, Math.max(0, Math.round(d.y + Math.sin(angle) * away))),
        };
        courier.garbled = order.intents.map((x, n) => (n === i ? redirect(x, to) : x));
      }
    }
    for (let t = ev.time + INTERCEPT_CHECK_MS; t < arrival; t += INTERCEPT_CHECK_MS) {
      later.push({ time: t, type: COURIER_STEP_EVENT, payload: { courierId: courier.id } });
    }
    later.push({ time: arrival, type: ORDER_DELIVER_EVENT, payload: { courierId: courier.id } });
    return { world: { ...world, couriers: [...world.couriers, courier] }, schedule: later };
  });

  registry.register(COURIER_LOST_EVENT, (world, ev) => {
    const c = courierOf(world, (ev.payload as { courierId?: unknown }).courierId);
    // Already taken or delivered: nothing left to lose.
    if (!c || c.lostAt !== undefined) return { world };
    return failed(
      reportOverdue(markLost(world, c.id, ev.time), c, ev.time),
      c.order,
      'courier lost',
    );
  });

  registry.register(COURIER_STEP_EVENT, (world, ev, rng) => {
    const c = courierOf(world, (ev.payload as { courierId?: unknown }).courierId);
    if (!c || c.lostAt !== undefined) return { world };
    const at = courierPosition(c, ev.time);
    // One roll per enemy unit in reach, in unit order; the first to succeed takes the courier.
    // Rolls stop at the first success, so draws per step depend on who captured: still fixed by
    // the seed, but keep every roll inside this handler or the clock-invariance rule breaks.
    const captor = world.units.find((u) => {
      if (u.side === c.side) return false;
      const chance = interceptChance(world, u, at);
      return chance > 0 && rng.next() < chance;
    });
    if (!captor) return { world };
    const doc = {
      id: `${captor.side}-d${world.intel[captor.side].documents.length + 1}`,
      kind: 'capturedDispatch' as const,
      capturedAt: ev.time,
      deliverAt: ev.time + COURIER_DELAY_MS,
      issuedAt: c.order.issuedAt,
      fromSide: c.side,
      addressedTo: world.units.find((u) => u.id === c.order.to)?.name ?? c.order.to,
      location: at,
      place: describePlace(world.map, at),
      text: c.order.text,
    };
    const w = reportOverdue(markLost(world, c.id, ev.time), c, ev.time);
    return {
      world: {
        ...w,
        intel: {
          ...w.intel,
          [captor.side]: {
            ...w.intel[captor.side],
            documents: [...w.intel[captor.side].documents, doc],
          },
        } as GameState['intel'],
      },
      emit: [
        {
          type: 'courier_intercepted',
          payload: { orderId: c.order.id, unitId: c.order.to, by: captor.id, documentId: doc.id },
        },
      ],
    };
  });

  registry.register(ORDER_DELIVER_EVENT, (world, ev, rng) => {
    const c = courierOf(world, (ev.payload as { courierId?: unknown }).courierId);
    // Lost or taken on the way: this arrival never happens.
    if (!c) return { world };
    const order = c.order;
    world = without(world, c.id);
    // Lost or taken on the way: its paper ride ends here; the sender was told when it fell overdue.
    if (c.lostAt !== undefined) return { world };
    // The unit may have been destroyed while the courier rode.
    const reason = undeliverable(world, order);
    if (reason) return failed(world, order, reason);
    const unit = world.units.find((u) => u.id === order.to)!;
    const delivered = {
      type: 'order_delivered',
      payload: { orderId: order.id, unitId: unit.id, issuedAt: order.issuedAt },
    };
    // Standing orders already carried may fire on this arrival; the new order's own may not.
    const had = unit.standing ?? [];
    // One draw whenever the umpire proposed a deviation, whatever the traits, so the RNG stream
    // does not depend on them.
    const interp = order.interpretation;
    const shaped = shapeIntents(
      unit,
      c.garbled ?? order.intents,
      interp,
      interp && interp.action !== 'none' ? rng.next() : 1,
      world.map,
    );
    const res = applyIntents(world, unit, shaped.intents, ev.time, order.id);
    const fired = fireOnReceipt(res.world, unit.id, had, order.from ?? 'hq', ev.time);
    // The unit's courier rides back: HQ hears of the delivery after the usual report delay.
    const ack = {
      time: ev.time,
      type: REPORT_EVENT,
      payload: { kind: 'orderDelivered', unitId: unit.id },
    };
    const interpreted = shaped.deviation
      ? [
          {
            type: 'order_interpreted',
            payload: { orderId: order.id, unitId: unit.id, ...shaped.deviation },
          },
        ]
      : [];
    const garbled = c.garbled
      ? [{ type: 'order_garbled', payload: { orderId: order.id, unitId: unit.id } }]
      : [];
    return {
      ...res,
      world: fired.world,
      schedule: [ack, ...(res.schedule ?? []), ...(fired.schedule ?? [])],
      emit: [delivered, ...garbled, ...interpreted, ...(res.emit ?? []), ...(fired.emit ?? [])],
    };
  });
}
