import type { EventRegistry, HandlerResult, NewEvent } from './events.js';
import { pointInPolygon } from './geometry.js';
import { beginMarch, updateUnit } from './movement.js';
import type { OrderIntent } from './orders.js';
import { canSee } from './visibility.js';
import type { GameState, GameTime, StandingOrder, Trigger, Unit } from './types.js';

/** Fires when a `timeReached` trigger's moment comes; judges every standing order then. */
export const STANDING_EVENT = 'standing.check';

type Conditional = Extract<OrderIntent, { kind: 'when' | 'at' }>;

const isConditional = (i: OrderIntent): i is Conditional => i.kind === 'when' || i.kind === 'at';

const triggerOf = (i: Conditional): Trigger =>
  i.kind === 'at' ? { kind: 'timeReached', gameTime: i.gameTime } : i.trigger;

/**
 * Whether `trigger` holds for `unit` now. Only the unit's own knowledge counts: an enemy is
 * sighted if this unit's own `canSee` finds it, never because it stands there in master
 * state. `orderReceived` is an event, not a state, so it never holds here (see `fireOnReceipt`).
 */
export function triggerHolds(
  world: GameState,
  unit: Unit,
  trigger: Trigger,
  time: GameTime,
): boolean {
  switch (trigger.kind) {
    case 'enemySighted':
      return world.units.some(
        (e) =>
          e.side !== unit.side &&
          e.strength > 0 &&
          pointInPolygon(e.center, trigger.area) &&
          canSee(world, unit, e),
      );
    case 'strengthBelow':
      return unit.strength < trigger.strength;
    case 'timeReached':
      return time >= trigger.gameTime;
    case 'orderReceived':
      return false;
  }
}

/**
 * Give `unit` the intents at `time`: the first immediate one (move, hold, withdraw) is
 * adopted and each `when` / `at` is kept as a standing order. A `timeReached` one gets a check
 * event at its moment (now, if that has passed); the others are judged at each scan.
 */
export function applyIntents(
  world: GameState,
  unit: Unit,
  intents: readonly OrderIntent[],
  time: GameTime,
  orderId: string,
): HandlerResult<GameState> {
  if (world.outcome) return { world }; // the game is over: nothing moves
  const carried = unit.standing ?? [];
  const added: StandingOrder[] = intents.filter(isConditional).map((i, n) => ({
    id: `${orderId}#${carried.length + n}`,
    orderId,
    trigger: triggerOf(i),
    then: i.then,
  }));
  const checks: NewEvent[] = added.flatMap((s) =>
    s.trigger.kind === 'timeReached'
      ? [{ time: Math.max(time, s.trigger.gameTime), type: STANDING_EVENT }]
      : [],
  );
  const w =
    added.length === 0
      ? world
      : updateUnit(world, unit.id, { standing: [...carried, ...added] }, time);
  const now = w.units.find((u) => u.id === unit.id)!;
  const imm = intents.find((i) => !isConditional(i));
  if (!imm) return { world: w, schedule: checks };
  const res =
    imm.kind === 'move'
      ? beginMarch(w, now, imm.to, time, 'move', undefined, imm.pace)
      : imm.kind === 'withdraw'
        ? beginMarch(w, now, imm.toward, time, 'withdraw')
        : beginMarch(w, now, (imm as { at: Unit['center'] }).at, time, 'hold');
  return { ...res, schedule: [...checks, ...(res.schedule ?? [])] };
}

function merge(a: HandlerResult<GameState>, b: HandlerResult<GameState>): HandlerResult<GameState> {
  return {
    world: b.world,
    schedule: [...(a.schedule ?? []), ...(b.schedule ?? [])],
    emit: [...(a.emit ?? []), ...(b.emit ?? [])],
  };
}

/** Drop `s` from the unit (it fires once) and carry out its `then`. */
function fire(
  world: GameState,
  unitId: string,
  s: StandingOrder,
  time: GameTime,
): HandlerResult<GameState> {
  const unit = world.units.find((u) => u.id === unitId)!;
  const rest = (unit.standing ?? []).filter((x) => x.id !== s.id);
  const cleared = updateUnit(world, unitId, { standing: rest.length ? rest : undefined }, time);
  const res = applyIntents(
    cleared,
    cleared.units.find((u) => u.id === unitId)!,
    s.then,
    time,
    s.id,
  );
  return {
    ...res,
    emit: [
      { type: 'standing_fired', payload: { unitId, standingId: s.id, orderId: s.orderId } },
      ...(res.emit ?? []),
    ],
  };
}

/**
 * Fire every standing order on an active unit whose trigger now holds, units in list order.
 * Run after each scan and when a `timeReached` check comes due. Pure.
 */
export function evaluateStanding(world: GameState, time: GameTime): HandlerResult<GameState> {
  let res: HandlerResult<GameState> = { world };
  for (const id of world.units.map((u) => u.id)) {
    // Re-read the unit each round: a fired order may add standing orders that hold already.
    // Orders nest finitely, so this ends; the cap is a backstop.
    for (let guard = 0; guard < 64; guard++) {
      const unit = res.world.units.find((u) => u.id === id)!;
      if (unit.status !== 'active' || unit.strength <= 0) break;
      const hit = (unit.standing ?? []).find((s) => triggerHolds(res.world, unit, s.trigger, time));
      if (!hit) break;
      res = merge(res, fire(res.world, id, hit, time));
    }
  }
  return res;
}

/**
 * An order from `from` has just reached `unitId`. Fire those of the standing orders it carried
 * before (`had`) with an `orderReceived` trigger naming `from`; the order's own are not
 * set off by it.
 */
export function fireOnReceipt(
  world: GameState,
  unitId: string,
  had: readonly StandingOrder[],
  from: string,
  time: GameTime,
): HandlerResult<GameState> {
  let res: HandlerResult<GameState> = { world };
  for (const s of had) {
    if (s.trigger.kind !== 'orderReceived' || s.trigger.from !== from) continue;
    const unit = res.world.units.find((u) => u.id === unitId)!;
    if (unit.status !== 'active' || unit.strength <= 0) break;
    if (!(unit.standing ?? []).some((x) => x.id === s.id)) continue;
    res = merge(res, fire(res.world, unitId, s, time));
  }
  return res;
}

/** Register the `timeReached` check. Called from `registerOrders`, which schedules it. */
export function registerStanding(registry: EventRegistry<GameState>): void {
  registry.register(STANDING_EVENT, (world, ev) => evaluateStanding(world, ev.time));
}
