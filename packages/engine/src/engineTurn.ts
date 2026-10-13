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
import { EventRegistry, type EmittedEvent, type EngineState, type Handler } from './events.js';
import { advanceTo } from './advance.js';
import {
  COURIER_LOST_EVENT,
  ORDER_ISSUE_EVENT,
  issueForcedOrder,
  issueOrder,
  type ForcedIssue,
  type Order,
} from './orders.js';
import { beginTurn } from './turn.js';
import type { RngState } from './rng.js';
import type { Courier, ForcedRide, GameState, GameTime, SideId, TurnFlag } from './types.js';

/**
 * What became of one courier in a turn, as the courier pass rolled it: the ride's outcome, with the
 * units held at `T0`. The turn itself may still end a ride otherwise, and says so in what it emits:
 * a ride `delivered` to a unit destroyed before `atMs` fails there (`order_failed`), and one
 * `intercepted` by a unit destroyed before `atMs` is not taken and rides on.
 */
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

/** How a new order's courier set out: the courier, and the loss time it drew (if it is lost). */
interface SetOut {
  courier: Courier;
  lostAt?: GameTime;
}

/**
 * `registry`, with each courier noted as it sets out. A ride decided at its first instant (a loss
 * drawn at `T0`, a 0 ms ride delivered at once) is gone from the queue and the world by the time
 * `advanceTo` returns, so it is read here, where the ride is rolled.
 */
class SetOutRegistry extends EventRegistry<GameState> {
  readonly setOut = new Map<string, SetOut>();

  constructor(private readonly inner: EventRegistry<GameState>) {
    super();
  }

  override get(type: string): Handler<GameState> {
    const h = this.inner.get(type);
    if (type !== ORDER_ISSUE_EVENT) return h;
    return (world, ev, rng) => {
      const res = h(world, ev, rng);
      const orderId = (ev.payload as { id?: unknown }).id;
      const courier = res.world.couriers.find(
        (c) => c.order.id === orderId && !world.couriers.includes(c),
      );
      if (courier && typeof orderId === 'string') {
        const lost = res.schedule?.find((e) => e.type === COURIER_LOST_EVENT);
        this.setOut.set(orderId, { courier, ...(lost ? { lostAt: lost.time } : {}) });
      }
      return res;
    };
  }
}

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
  const riding = s.world.couriers.filter((c) => c.lostAt === undefined);
  for (const o of orders) s = issueOrder(s, o, turn.startMs);
  // The new couriers set out at `T0` (their loss and garbling are rolled then) and the turn rides.
  const recording = new SetOutRegistry(registry);
  const end = advanceTo(s, turn.endMs, recording);
  const emitted: EmittedEvent[] = end.emitted;

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
      const lost = recording.setOut.get(order.id)?.lostAt;
      if (lost !== undefined) ride.lostAt = lost;
      if (c.garbled) ride.garbled = c.garbled;
    }
    forced[order.id] = ride;
  };
  for (const c of riding) describe(c.order, c);
  for (const o of orders) describe(o, recording.setOut.get(o.id)?.courier);
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
