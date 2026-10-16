/**
 * Builds a benchmark case's turn as a game would (#398, #440): the world at the turn's start, the
 * engine's projection (`engineTurn.projectTurn`, 11.4: the rules parse of each order, the server's
 * registry, `advanceUntilOver`) with a courier pass forced to the case's courier results, and the
 * `adjudicate` stage's input and context exactly as `UmpireTurnResolver` builds them
 * (`adjudicationOf`, `adjudicateInput`). The cases are played as a two-player game (both sides send
 * orders), so no scripted side thinks in the projection. Pure and deterministic.
 */
import {
  MS_PER_MINUTE,
  ORDER_DELIVER_EVENT,
  RALLY_EVENT,
  RALLY_RULES,
  beginMarch,
  courierPass,
  createState,
  defaultFootprint,
  holdTheBridge,
  loadScenario,
  mm,
  schedule,
  unitTypeOf,
} from '@kriegsspiel/engine';
import type {
  CourierPass,
  EngineState,
  GameState,
  NewEvent,
  Order,
  OrderIntent,
  Point,
  TurnContext,
  TurnCourier,
  Unit,
} from '@kriegsspiel/engine';
import { engineOrdersOf, projectTurn, rulesParseTurnOrder } from '../../game/engineTurn.js';
import type { Projection } from '../../game/engineTurn.js';
import { createRegistry, startingState } from '../../game/registry.js';
import type { SentTurnOrder } from '../../game/store.js';
import type { TurnInput } from '../../game/turns.js';
import { adjudicationOf } from '../../game/umpireTurn.js';
import {
  ADJUDICATE_SCHEMA,
  adjudicateInput,
  adjudicateSystem,
  checkContext,
  type AdjudicateTurn,
} from '../adjudicate.js';
import { withPersona } from '../persona.js';
import { testReply } from '../providers/test.js';
import { checkTurnProposal, type CheckResult } from './turnChecks.js';
import type { TurnProposal } from './turnProposal.js';
import { CASE_RULES_VERSION, TURN_MINUTES, type CaseOrder, type TurnCase } from './turnCases.js';

export { ADJUDICATE_PROMPT_VERSION } from '../adjudicate.js';

/** The dial every case is adjudicated under: the projection is the reference. */
export const CASE_DIAL = 'standard' as const;

/** The `adjudicate` system prompt as a `standard` game with the default umpire's voice sends it. */
export const ADJUDICATE_SYSTEM = withPersona(adjudicateSystem(CASE_DIAL));

const rad = (deg: number) => (deg * Math.PI) / 180;
const at = (p: { x: number; y: number }): Point => ({ x: mm(p.x), y: mm(p.y) });

export const turnStartMs = (c: TurnCase) => (c.turn - 1) * TURN_MINUTES * MS_PER_MINUTE;
export const turnEndMs = (c: TurnCase) =>
  Math.min(
    turnStartMs(c) + TURN_MINUTES * MS_PER_MINUTE,
    loadScenario(holdTheBridge).victory.holdMs,
  );
/** The game time a case's courier result names: a minute of this turn, or of a later one. */
const minuteMs = (c: TurnCase, turn: number, minute: number) =>
  turnStartMs(c) + ((turn - c.turn) * TURN_MINUTES + minute) * MS_PER_MINUTE;
const arrivalMs = (c: TurnCase, o: CaseOrder) =>
  o.courierStatus.kind === 'arrived'
    ? minuteMs(c, c.turn, o.courierStatus.minute)
    : minuteMs(c, o.courierStatus.dueTurn, o.courierStatus.dueMinute);
const sentTurnOf = (c: TurnCase, o: CaseOrder) => o.sentTurn ?? c.turn;

/**
 * The world at the turn's start, before anything is scheduled: the scenario with the case's units
 * placed (standing, holding where they are), at the cases' rules version, under `standard`, with
 * the previous turn's summary as the umpire's journal note (11.8).
 */
export function caseWorld(c: TurnCase): GameState {
  const w = loadScenario(holdTheBridge);
  const t0 = turnStartMs(c);
  const units = w.units.map((u): Unit => {
    const p = c.units[u.id];
    if (!p) return u;
    const formation = p.formation ?? u.formation;
    const strength = p.strength ?? u.strength;
    const placed: Unit = {
      ...u,
      center: at(p),
      facing: p.facingDeg !== undefined ? rad(p.facingDeg) : u.facing,
      formation,
      footprint: defaultFootprint(unitTypeOf(u), formation, strength),
      strength,
      morale: p.morale ?? u.morale,
      fatigue: p.fatigue ?? u.fatigue,
      ammo: p.ammo ?? u.ammo,
      intent: p.intent?.kind === 'idle' ? { kind: 'idle' } : { kind: 'hold', at: at(p) },
      status: p.status === 'broken' ? 'withdrawn' : (p.status ?? 'active'),
    };
    delete placed.shape;
    delete placed.leg;
    if (p.status === 'broken') placed.brokenAt = t0 - (p.brokenMinutesAgo ?? 0) * MS_PER_MINUTE;
    if (p.status === 'destroyed') placed.strength = 0;
    return placed;
  });
  return {
    ...w,
    time: t0,
    units,
    rules: CASE_RULES_VERSION,
    dial: CASE_DIAL,
    ...(c.previous
      ? { journal: { notes: [{ turn: c.turn - 1, note: c.previous }], precedents: [] } }
      : {}),
  };
}

/** An order of the case as its side sent it on the desk. */
const sentOrder = (o: CaseOrder): SentTurnOrder => ({
  orderId: o.orderId,
  side: o.side,
  to: o.to,
  text: o.text,
  courier: o.courier,
});

/**
 * The engine state at the turn's start, as the previous turn would have left it: the scenario's
 * first events queued, each marching unit on its march, each broken unit falling back with its
 * rally due, and each order sent in an earlier turn riding to its unit.
 */
export function caseState(c: TurnCase): EngineState<GameState> {
  let world = caseWorld(c);
  const t0 = turnStartMs(c);
  const later: NewEvent[] = [];
  for (const [unitId, p] of Object.entries(c.units)) {
    if (p.intent?.kind !== 'move') continue;
    const unit = world.units.find((u) => u.id === unitId)!;
    const how = unit.status === 'withdrawn' ? 'withdraw' : 'move';
    const res = beginMarch(world, unit, at(p.intent), t0, how);
    world = res.world;
    later.push(...(res.schedule ?? []));
  }
  for (const u of world.units) {
    if (u.status !== 'withdrawn' || u.brokenAt === undefined) continue;
    later.push({
      time: Math.max(t0, u.brokenAt + RALLY_RULES.firstTryMs),
      type: RALLY_EVENT,
      payload: { unitId: u.id },
    });
  }
  // An order sent in an earlier turn is a courier on the road at `T0`, due when the case says.
  const couriers = c.orders
    .filter((o) => sentTurnOf(c, o) < c.turn)
    .map((o) => {
      const issuedAt = minuteMs(c, sentTurnOf(c, o), 0);
      const [order] = engineOrdersOf(
        [rulesParseTurnOrder(world, sentOrder(o))],
        [sentOrder(o)],
        issuedAt,
      );
      const hq = world.sides.find((s) => s.id === o.side)!.hq;
      const unit = world.units.find((u) => u.id === o.to)!;
      const arriveAt = arrivalMs(c, o);
      later.push({
        time: arriveAt,
        type: ORDER_DELIVER_EVENT,
        payload: { courierId: `courier-${order!.id}` },
      });
      return {
        id: `courier-${order!.id}`,
        side: o.side,
        order: { ...order!, issuedAt },
        origin: hq,
        legs: [{ from: hq, to: unit.center, startedAt: issuedAt, arriveAt }],
      };
    });
  world = { ...world, couriers: [...world.couriers, ...couriers] };
  return schedule(startingState(createState(world.seed + c.turn, world, t0)), later);
}

/** The turn's input as the desk sends it: the orders written in this turn. */
export function caseTurnInput(c: TurnCase): TurnInput {
  const sent = c.orders.filter((o) => sentTurnOf(c, o) === c.turn);
  return {
    gameId: `bench-${c.id}`,
    n: c.turn,
    startMs: turnStartMs(c),
    endMs: turnEndMs(c),
    cause: 'all-sent',
    orders: sent.map(sentOrder),
    sent: [...new Set(sent.map((o) => o.side))],
  };
}

/** `intents` with the first destination misread as `to` (a garbled ride, as the engine garbles). */
function misread(intents: readonly OrderIntent[], to: Point): OrderIntent[] {
  let done = false;
  return intents.map((i) => {
    if (done) return i;
    if (i.kind === 'move') return ((done = true), { ...i, to });
    if (i.kind === 'hold') return ((done = true), { ...i, at: to });
    if (i.kind === 'withdraw') return ((done = true), { ...i, toward: to });
    return i;
  });
}

/**
 * The courier pass forced to the case's courier results: each ride arrives at the minute the case
 * gives (or is still riding, due when it says), none is lost or taken, and a garbled one is misread
 * as the case says. The RNG and each new courier's dice are the real pass's, so the turn draws on
 * as a game's would.
 */
export function forcedPass(
  c: TurnCase,
  state: EngineState<GameState>,
  input: TurnInput,
): (orders: readonly Order[]) => CourierPass {
  return (orders) => {
    const real = courierPass(state, orders, input, createRegistry());
    const byEngineId = new Map(c.orders.map((o) => [`${o.side}-${o.orderId}`, o]));
    const couriers: TurnCourier[] = [];
    const forced: CourierPass['forced'] = {};
    const ride = (order: Order) => {
      const o = byEngineId.get(order.id)!;
      const t = arrivalMs(c, o);
      couriers.push({
        orderId: order.id,
        side: order.side,
        unitId: order.to,
        ...(o.courierStatus.kind === 'arrived'
          ? { outcome: 'delivered' as const, atMs: t }
          : { outcome: 'riding' as const, dueMs: t }),
        ...(o.garbled && order.intents.length > 0 ? { garbled: true } : {}),
      });
      const dice = real.forced[order.id]?.dice;
      forced[order.id] = {
        untilMs: input.endMs,
        ...(sentTurnOf(c, o) === c.turn ? { arriveAt: t } : {}),
        ...(o.garbled && order.intents.length > 0
          ? { garbled: misread(order.intents, at(o.garbled)) }
          : {}),
        ...(dice !== undefined ? { dice } : {}),
      };
    };
    for (const r of state.world.couriers) ride(r.order);
    for (const o of orders) ride(o);
    return { couriers, rng: real.rng, forced };
  };
}

/** Everything about a case's turn: its start, the projection, and what the stage is given. */
export interface CaseTurn {
  state: EngineState<GameState>;
  input: TurnInput;
  projection: Projection;
  turn: AdjudicateTurn;
  context: TurnContext;
}

const built = new Map<TurnCase, CaseTurn>();

/** The case's turn, built once per case object (the projection runs the engine). */
export function caseTurn(c: TurnCase): CaseTurn {
  const hit = built.get(c);
  if (hit) return hit;
  const state = caseState(c);
  const input = caseTurnInput(c);
  const projection = projectTurn(state, input, createRegistry(), {}, forcedPass(c, state, input));
  const { turn, context } = adjudicationOf(state, input, projection, CASE_DIAL);
  const out = { state, input, projection, turn, context };
  built.set(c, out);
  return out;
}

/** What the umpire is given (D39 "The umpire's input"): the live stage's input for the case. */
export function turnInput(c: TurnCase) {
  const { state, turn } = caseTurn(c);
  return adjudicateInput(state.world, turn);
}

/** The automatic checks on a reply, with the context the live stage's gate uses. */
export function checkProposal(c: TurnCase, raw: unknown): CheckResult {
  const { state, turn } = caseTurn(c);
  return checkTurnProposal(raw, {
    ...checkContext(state.world, turn),
    ...(c.canary ? { canary: c.canary } : {}),
    ...(c.expectsRoll ? { expectsRoll: true } : {}),
  });
}

/** The canned adjudicator (the `test` provider, D39 "Keyless demo"): the projection as the proposal. */
export function cannedProposal(c: TurnCase): TurnProposal {
  return testReply(ADJUDICATE_SCHEMA, turnInput(c) as never) as TurnProposal;
}

export { ADJUDICATE_SCHEMA };
