import type { EngineState, EventRegistry, HandlerResult, Json } from './events.js';
import type { Pace } from './fatigue.js';
import { findPath } from './navigation.js';
import { schedule } from './queue.js';
import { REPORT_EVENT } from './visibility.js';
import { applyIntents, fireOnReceipt, registerStanding } from './standing.js';
import { MS_PER_MINUTE, type GameState, type GameTime, type Point, type Trigger } from './types.js';

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
}

/**
 * Game ms for a courier to ride one metre of cost-1 ground: 400 m a minute, about 24 km/h.
 * Roads cost half, so a courier on a road does 800 m a minute.
 */
export const COURIER_MS_PER_METRE = MS_PER_MINUTE / 400;

export const ORDER_ISSUE_EVENT = 'order.issue';
export const ORDER_DELIVER_EVENT = 'order.deliver';

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

/**
 * Register the order handlers. An order is issued at HQ, a courier rides to
 * the unit along the cheapest route (roads are fastest), and the unit adopts
 * the order's intent when the courier arrives. Until then it keeps its standing
 * intent. An order that cannot be delivered, because the unit is gone or
 * destroyed or the courier has no route, emits `order_failed` and changes nothing.
 * Delivery emits `order_delivered`.
 */
export function registerOrders(registry: EventRegistry<GameState>): void {
  registerStanding(registry);
  registry.register(ORDER_ISSUE_EVENT, (world, ev) => {
    const order = ev.payload as unknown as Order;
    const reason = undeliverable(world, order);
    if (reason) return failed(world, order, reason);
    const unit = world.units.find((u) => u.id === order.to)!;
    const hq = world.sides.find((s) => s.id === order.side)?.hq;
    const route = hq && findPath(world.map, hq, unit.center);
    if (!route) return failed(world, order, 'no route for courier');
    return {
      world,
      schedule: [
        {
          time: ev.time + Math.round((route.cost / 1000) * COURIER_MS_PER_METRE),
          type: ORDER_DELIVER_EVENT,
          payload: ev.payload,
        },
      ],
    };
  });

  registry.register(ORDER_DELIVER_EVENT, (world, ev) => {
    const order = ev.payload as unknown as Order;
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
    const res = applyIntents(world, unit, order.intents, ev.time, order.id);
    const fired = fireOnReceipt(res.world, unit.id, had, order.from ?? 'hq', ev.time);
    // The unit's courier rides back: HQ hears of the delivery after the usual report delay.
    const ack = {
      time: ev.time,
      type: REPORT_EVENT,
      payload: { kind: 'orderDelivered', unitId: unit.id },
    };
    return {
      ...res,
      world: fired.world,
      schedule: [ack, ...(res.schedule ?? []), ...(fired.schedule ?? [])],
      emit: [delivered, ...(res.emit ?? []), ...(fired.emit ?? [])],
    };
  });
}
