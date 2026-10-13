/**
 * The engine's own resolution of a turn (D39, story 11.4): the courier pass, and the turn's start
 * from which the projection, a `rigid` turn and the fallback all run the ordinary handlers.
 *
 * Every courier riding in a turn is rolled once, by the **courier pass**: on a copy of the
 * start-of-turn state the turn's orders leave HQ at `T0` and the world is advanced, held, to `T1`
 * (units stand where they stood; only couriers move). Its results are fixed for the turn. The
 * engine's resolution then starts again from `T0`, with each ride forced to the pass's outcome (no
 * roll of its own) and the RNG where the pass left it, and advances under the ordinary handlers.
 * The projection does that on a copy; a `rigid` or fallback turn does it on the real world, so
 * both end in the same state.
 */
import type { EmittedEvent, EngineState, EventRegistry } from './events.js';
import { advanceTo } from './advance.js';
import {
  COURIER_LOST_EVENT,
  issueForcedOrder,
  issueOrder,
  type ForcedIssue,
  type Order,
} from './orders.js';
import { beginTurn } from './turn.js';
import type { RngState } from './rng.js';
import type { Courier, ForcedRide, GameState, GameTime, SideId, TurnFlag } from './types.js';

/** What became of one courier in a turn, as the courier pass rolled it. */
export interface TurnCourier {
  /** The engine order id (`Order.id`). */
  orderId: string;
  side: SideId;
  /** The addressee. */
  unitId: string;
  /**
   * `delivered`, `lost` or `intercepted` within the turn (at `atMs`); `riding` at the turn's end
   * (due at `dueMs`); `failed` when it could not set out at all (`reason`).
   */
  outcome: 'delivered' | 'riding' | 'lost' | 'intercepted' | 'failed';
  atMs?: GameTime;
  dueMs?: GameTime;
  /** The order reached its unit garbled (the destination is shifted, as in real time). */
  garbled?: boolean;
  /** The enemy unit that took it. */
  by?: string;
  reason?: string;
}

/** The courier pass: each ride's outcome, and what the engine's resolution needs to replay it. */
export interface CourierPass {
  /** Riding couriers first (as the world lists them), then the turn's new orders, in order. */
  couriers: TurnCourier[];
  /** The RNG where the pass left it: the engine's resolution of the turn draws on from here. */
  rng: RngState;
  /** Per engine order id: the forced ride (a new order's carries its loss and garbling too). */
  forced: Record<string, ForcedIssue>;
}

type Bounds = Pick<TurnFlag, 'n' | 'startMs' | 'endMs'>;

/** The turn flag for `turn` (only its bounds: callers may pass a whole turn record). */
const flag = (turn: Bounds, adjudicator: TurnFlag['adjudicator']): TurnFlag => ({
  n: turn.n,
  startMs: turn.startMs,
  endMs: turn.endMs,
  adjudicator,
});

const withoutForced = (c: Courier): Courier => {
  if (!c.forced) return c;
  const rest = { ...c };
  delete rest.forced;
  return rest;
};

/**
 * Roll every courier of the turn once (D39, "Couriers across turns"): `state` is the world at the
 * turn's start, `orders` the turn's new orders (they leave HQ at `T0`). Pure: `state` is a copy's
 * starting point and is not changed. Couriers already riding are continued against the units'
 * `T0` positions, as the new ones are.
 */
export function courierPass(
  state: EngineState<GameState>,
  orders: readonly Order[],
  turn: Bounds,
  registry: EventRegistry<GameState>,
): CourierPass {
  let s = beginTurn(state, flag(turn, 'umpire'));
  s = { ...s, world: { ...s.world, couriers: s.world.couriers.map(withoutForced) } };
  const riding = s.world.couriers.filter((c) => c.lostAt === undefined).map((c) => c.order.id);
  for (const o of orders) s = issueOrder(s, o, turn.startMs);
  // The new couriers set out (their loss and garbling are rolled now); then the turn rides.
  const out = advanceTo(s, turn.startMs, registry);
  const setOut = new Map(out.state.world.couriers.map((c) => [c.order.id, c]));
  const lostAt = new Map<string, GameTime>();
  for (const e of out.state.queue) {
    if (e.type !== COURIER_LOST_EVENT) continue;
    const id = (e.payload as { courierId?: string }).courierId;
    const c = out.state.world.couriers.find((x) => x.id === id);
    if (c) lostAt.set(c.order.id, e.time);
  }
  const end = advanceTo(out.state, turn.endMs, registry);
  const emitted: EmittedEvent[] = [...out.emitted, ...end.emitted];

  const fate = new Map<string, Pick<TurnCourier, 'outcome' | 'atMs' | 'by' | 'reason'>>();
  for (const e of emitted) {
    const p = e.payload as { orderId?: string; reason?: string; by?: string };
    if (!p || typeof p.orderId !== 'string' || fate.has(p.orderId)) continue;
    if (e.type === 'order_delivered') fate.set(p.orderId, { outcome: 'delivered', atMs: e.time });
    else if (e.type === 'courier_intercepted') {
      fate.set(p.orderId, { outcome: 'intercepted', atMs: e.time, ...(p.by ? { by: p.by } : {}) });
    } else if (e.type === 'order_failed') {
      fate.set(
        p.orderId,
        p.reason === 'courier lost'
          ? { outcome: 'lost', atMs: e.time }
          : { outcome: 'failed', atMs: e.time, reason: p.reason ?? 'failed' },
      );
    }
  }

  const couriers: TurnCourier[] = [];
  const forced: Record<string, ForcedIssue> = {};
  const fresh = new Set(orders.map((o) => o.id));
  const describe = (order: Order, c: Courier | undefined) => {
    const f = fate.get(order.id);
    const due = c?.legs.at(-1)?.arriveAt ?? turn.startMs;
    const tc: TurnCourier = {
      orderId: order.id,
      side: order.side,
      unitId: order.to,
      ...(f ?? { outcome: c ? ('riding' as const) : ('failed' as const), dueMs: due }),
      ...(c?.garbled ? { garbled: true } : {}),
    };
    if (!c && !f) tc.reason = 'did not set out';
    couriers.push(tc);
    if (!c) return;
    const ride: ForcedRide & ForcedIssue = { untilMs: turn.endMs };
    if (f?.outcome === 'intercepted') {
      ride.takenAt = f.atMs!;
      if (f.by) ride.takenBy = f.by;
    }
    if (fresh.has(order.id)) {
      const lost = lostAt.get(order.id);
      if (lost !== undefined) ride.lostAt = lost;
      if (c.garbled) ride.garbled = c.garbled;
    }
    forced[order.id] = ride;
  };
  for (const id of riding) {
    const c = setOut.get(id) ?? s.world.couriers.find((x) => x.order.id === id)!;
    describe(c.order, c);
  }
  for (const o of orders) describe(o, setOut.get(o.id));
  return { couriers, rng: end.state.rng, forced };
}

/**
 * The world at the turn's start, ready for the engine to resolve the turn under its ordinary
 * handlers (`advanceTo(T1)`): the turn flag set (not held), the riding couriers and the new orders
 * forced to the pass's outcomes, and the RNG where the pass left it. Pure.
 */
export function engineTurnStart(
  state: EngineState<GameState>,
  orders: readonly Order[],
  pass: CourierPass,
  turn: Bounds,
): EngineState<GameState> {
  let s = beginTurn(state, flag(turn, 'engine'));
  const couriers = s.world.couriers.map((c) => {
    const bare = withoutForced(c);
    const f = pass.forced[c.order.id];
    if (!f) return bare;
    const ride: ForcedRide = { untilMs: f.untilMs };
    if (f.takenAt !== undefined) ride.takenAt = f.takenAt;
    if (f.takenBy !== undefined) ride.takenBy = f.takenBy;
    return { ...bare, forced: ride };
  });
  s = { ...s, world: { ...s.world, couriers } };
  for (const o of orders) {
    const f = pass.forced[o.id];
    s = f ? issueForcedOrder(s, o, f, turn.startMs) : issueOrder(s, o, turn.startMs);
  }
  return { ...s, rng: pass.rng };
}
