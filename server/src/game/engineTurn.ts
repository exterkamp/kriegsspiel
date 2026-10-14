/**
 * The engine adjudicator (D39, story 11.4): a turn resolved by the rigid rules, with no model.
 *
 * The turn's orders are read by the rules parser (`testParse`, the canned rules of #389) with two
 * turn-mode changes: the addressee is the one chosen on the desk, never guessed from the text, and
 * an order with a condition or a time is "no new order" rather than its plain verb. Its couriers
 * are rolled once by the engine's courier pass; the turn then runs from its start under the
 * ordinary handlers (movement, contact, combat, morale, rally, supply, visibility, victory) to its
 * end, with each ride forced to the pass's outcome, and the scripted sides thinking at their
 * interval as in real time (#430). That is:
 *
 * - `projectTurn`: the same on a copy, with a compact summary for the umpire (11.6). Pure.
 * - `EngineTurnResolver`: the `rigid` resolver; it logs the parsed orders, the couriers and the
 *   projection summary, and names the `engine` adjudicator.
 * - `engineAdjudicator`: applies a logged engine turn at its start (live play and replay alike); the
 *   actor's advance to the turn's end then reproduces the projection exactly.
 */
import {
  SUPPLY_TICK_EVENT,
  courierPass,
  describePlace,
  engineTurnStart,
  metres,
  positionAt,
  type CourierPass,
  type EmittedEvent,
  type EngineState,
  type EventRegistry,
  type GameState,
  type Order,
  type OrderIntent,
  type TurnCourier,
  type Unit,
  type UnitStatus,
} from '@kriegsspiel/engine';
import { parseOrdersInput, placeIntents } from '../orders/llmParser.js';
import { hasConditionOrTime, testParse } from '../umpire/providers/testParse.js';
import { parseContextOf } from './parseContext.js';
import { advanceUntilOver } from './advance.js';
import type { SentTurnOrder, TurnRecord } from './store.js';
import type {
  TurnAgent,
  TurnResolveContext,
  TurnInput,
  TurnResolution,
  TurnResolver,
} from './turns.js';

/** The name a resolver logs for a turn the engine resolved. */
export const ENGINE_ADJUDICATOR = 'engine';

/** One sent order as the rules read it: intents for the engine, or "no new order" and why. */
export interface RulesOrder {
  /** The order's id on the desk (`TurnOrder.orderId`). */
  orderId: string;
  side: string;
  to: string;
  /** The engine order's id, `<side>-<orderId>` (order ids are unique per side). */
  engineId: string;
  intents?: OrderIntent[];
  /** Set when the rules read it as "no new order". */
  none?: string;
}

/** What an engine turn logs on its `resolveTurn` entry. Replay needs `orders` and `couriers`. */
export interface EngineTurnOutput {
  orders: RulesOrder[];
  couriers: TurnCourier[];
  /** The projection summary the turn was resolved to (for the record; replay recomputes it). */
  projection: ProjectionSummary;
}

type Bounds = Pick<TurnInput, 'n' | 'startMs' | 'endMs'>;

/**
 * Read one turn order with the rules, in turn mode (D39, "Orders in turn mode"): only the addressee
 * is offered as the unit, so it is never guessed; a conditional or timed order, or one the rules
 * cannot read, is "no new order".
 */
export function rulesParseTurnOrder(world: GameState, order: SentTurnOrder): RulesOrder {
  const base = {
    orderId: order.orderId,
    side: order.side,
    to: order.to,
    engineId: `${order.side}-${order.orderId}`,
  };
  const unit = world.units.find((u) => u.id === order.to && u.side === order.side);
  if (!unit) return { ...base, none: 'no such unit of this side' };
  if (hasConditionOrTime(order.text)) {
    return { ...base, none: 'a condition or a time the rules cannot carry out' };
  }
  const ctx = parseContextOf(world, order.side);
  // An order that names no unit ("hold here") is for the addressee: the desk already chose it.
  const parsed = testParse({
    ...parseOrdersInput(order.text, { ...ctx, units: ctx.units.filter((u) => u.id === unit.id) }),
    addressee: unit.id,
  });
  if (parsed.result === 'rejection') return { ...base, none: parsed.reason ?? 'not understood' };
  if (parsed.result === 'clarification') return { ...base, none: parsed.question ?? 'unclear' };
  if (parsed.unitId !== unit.id || !parsed.intents?.length) {
    return { ...base, none: 'not understood' };
  }
  if (parsed.intents.some((i) => i.kind === 'attack')) {
    return { ...base, none: 'attack orders are not modelled yet' };
  }
  const intents = placeIntents(parsed.intents, unit, ctx);
  if (typeof intents === 'string') return { ...base, none: intents };
  return { ...base, intents: intents as OrderIntent[] };
}

/** The engine orders a turn's rules-read orders become: every one rides, "no new order" too. */
export function engineOrdersOf(
  parsed: readonly RulesOrder[],
  sent: readonly SentTurnOrder[],
  startMs: number,
): Order[] {
  return parsed.map((p) => {
    const o = sent.find((s) => s.side === p.side && s.orderId === p.orderId);
    return {
      id: p.engineId,
      side: p.side as Order['side'],
      to: p.to,
      issuedAt: startMs,
      text: o?.text ?? '',
      intents: p.intents ?? [],
      ...(p.intents ? {} : { textOnly: true as const }),
      ...(o?.courier ? { courier: o.courier } : {}),
      ref: p.orderId,
    };
  });
}

/** One unit in the projection, metres on the wire as elsewhere in the umpire's input. */
export interface ProjectedUnit {
  id: string;
  side: string;
  /** Where it stood and stands: the nearest named place, and the point in metres. */
  from: { at: string; x: number; y: number };
  to: { at: string; x: number; y: number };
  /** Where it was every 5 game minutes, when it moved, halts left out (metres). */
  path?: [number, number][];
  /** Enemy units it came into contact with. */
  contacts?: string[];
  /** Men lost, and the change in morale. */
  lost?: number;
  morale?: number;
  status: UnitStatus;
  /** Set when the status changed in the turn. */
  wasStatus?: UnitStatus;
}

/** The engine's projection of a turn, compact for the umpire (D39, "The projection"). */
export interface ProjectionSummary {
  turn: number;
  /** Game minutes the turn covers. */
  fromMin: number;
  toMin: number;
  units: ProjectedUnit[];
  /** The turn's events in order, each as "minute: what", combat fire summed into `lost`. */
  events: string[];
  /** Set when the game ended in the turn. */
  outcome?: { winner: string | null; reason: string; atMin: number };
}

/** The engine's projection of a turn: the state it ends in, what happened, and its summary. */
export interface Projection {
  state: EngineState<GameState>;
  /** Ammunition the supply rule gave each unit in the turn, by unit id (#436). */
  resupply: Record<string, number>;
  emitted: EmittedEvent[];
  couriers: TurnCourier[];
  orders: RulesOrder[];
  summary: ProjectionSummary;
}

const PATH_STEP_MS = 5 * 60_000;
/** Events summed elsewhere (into `lost` and `morale`), left out of the event list. */
const QUIET = new Set(['combat.fire', 'combat.morale']);

const m = (mm: number) => Math.round(metres(mm));
const minuteOf = (t: number) => Math.round(t / 60_000);

function placeOf(world: GameState, u: Unit, time: number) {
  const p = positionAt(world.map, u, time);
  return { at: describePlace(world.map, p), x: m(p.x), y: m(p.y) };
}

/** One emitted event as a short line for the umpire, or undefined to leave it out. */
function eventLine(e: EmittedEvent): string | undefined {
  if (QUIET.has(e.type)) return undefined;
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const bits: string[] = [];
  for (const k of ['unitId', 'orderId', 'by', 'reason', 'winner', 'formation']) {
    const v = p[k];
    if (typeof v === 'string') bits.push(k === 'unitId' ? v : `${k} ${v}`);
  }
  if (Array.isArray(p.pairs)) {
    bits.push((p.pairs as unknown[][]).map((pair) => pair.join(' v ')).join(', '));
  }
  return `${minuteOf(e.time)}: ${e.type}${bits.length ? ` ${bits.join(', ')}` : ''}`;
}

function summarize(
  start: EngineState<GameState>,
  end: EngineState<GameState>,
  emitted: readonly EmittedEvent[],
  paths: Map<string, [number, number][]>,
  turn: Bounds,
): ProjectionSummary {
  const contacts = new Map<string, Set<string>>();
  for (const e of emitted) {
    if (e.type !== 'contact.begin') continue;
    for (const [a, b] of ((e.payload as { pairs?: string[][] })?.pairs ?? []) as string[][]) {
      if (!a || !b) continue;
      (contacts.get(a) ?? contacts.set(a, new Set()).get(a)!).add(b);
      (contacts.get(b) ?? contacts.set(b, new Set()).get(b)!).add(a);
    }
  }
  const units: ProjectedUnit[] = [];
  for (const u0 of start.world.units) {
    if (u0.status === 'destroyed') continue;
    const u1 = end.world.units.find((u) => u.id === u0.id) ?? u0;
    const from = placeOf(start.world, u0, turn.startMs);
    const to = placeOf(end.world, u1, end.time);
    // Where it stood at each sample, with a halt (the same point again) left out.
    const path = (paths.get(u0.id) ?? []).filter(
      ([x, y], i, all) => i === 0 || x !== all[i - 1]![0] || y !== all[i - 1]![1],
    );
    const moved = path.length > 1;
    const lost = Math.round(u0.strength - u1.strength);
    const morale = Math.round(u1.morale - u0.morale);
    const met = [...(contacts.get(u0.id) ?? [])].sort();
    units.push({
      id: u0.id,
      side: u0.side,
      from,
      to,
      ...(moved ? { path } : {}),
      ...(met.length ? { contacts: met } : {}),
      ...(lost ? { lost } : {}),
      ...(morale ? { morale } : {}),
      status: u1.status,
      ...(u1.status !== u0.status ? { wasStatus: u0.status } : {}),
    });
  }
  const outcome = end.world.outcome;
  return {
    turn: turn.n,
    fromMin: minuteOf(turn.startMs),
    toMin: minuteOf(turn.endMs),
    units,
    events: emitted.flatMap((e) => eventLine(e) ?? []),
    ...(outcome && outcome.time >= turn.startMs
      ? {
          outcome: {
            winner: outcome.winner ?? null,
            reason: outcome.reason,
            atMin: minuteOf(outcome.time),
          },
        }
      : {}),
  };
}

/**
 * Resolve a turn by the engine from `state` (the world at the turn's start): the courier pass,
 * then the turn under the ordinary handlers from `T0` to `T1`. Returns the end state with nothing
 * written anywhere; `state` itself is not changed.
 */
function runEngineTurn(
  state: EngineState<GameState>,
  orders: readonly Order[],
  turn: Bounds,
  registry: EventRegistry<GameState>,
  agents: TurnAgent[] = [],
  pass: CourierPass = courierPass(state, orders, turn, registry),
) {
  // What the supply rule gives each unit in the run, for the validator's ammunition ceiling
  // (#436). The end values alone cannot say it (they mix the resupply with what the unit fired
  // away), so the run watches the supply tick's own work through a registry that differs from
  // the caller's only in that handler. The courier pass above already ran on the caller's
  // registry, and its held world takes no resupply anyway.
  const resupply = new Map<string, number>();
  const supplyTick = registry.get(SUPPLY_TICK_EVENT);
  const measured = registry.replaced(SUPPLY_TICK_EVENT, (world, ev, rng) => {
    const before = new Map(world.units.map((u) => [u.id, u.ammo]));
    const res = supplyTick(world, ev, rng);
    for (const u of res.world.units) {
      const gained = u.ammo - (before.get(u.id) ?? u.ammo);
      if (gained > 0) resupply.set(u.id, (resupply.get(u.id) ?? 0) + gained);
    }
    return res;
  });
  let s = engineTurnStart(state, orders, pass, turn);
  const emitted: EmittedEvent[] = [];
  const paths = new Map<string, [number, number][]>();
  const sample = () => {
    for (const u of s.world.units) {
      const p = positionAt(s.world.map, u, s.time);
      (paths.get(u.id) ?? paths.set(u.id, []).get(u.id)!).push([m(p.x), m(p.y)]);
    }
  };
  const step = (to: number) => {
    const res = advanceUntilOver(s, to, measured);
    s = res.state;
    emitted.push(...res.emitted);
    if (res.emitted.length > 0) for (const a of agents) a.idle = false;
  };
  // The scripted sides think at their interval, as the actor runs them (`advanceEngine` and
  // `nextAgent` in `actor.ts`): the one due soonest, leaving out idle ones while no event is queued
  // to wake them. Keep the two the same, or a rigid turn no longer ends as projected.
  const nextAgent = () =>
    agents.reduce<TurnAgent | undefined>(
      (best, a) =>
        (a.idle && s.queue.length === 0) || (best && best.nextAt <= a.nextAt) ? best : a,
      undefined,
    );
  // Chunked for the path samples; advancing in steps gives exactly the state of one advance.
  for (let t = turn.startMs; ; t = Math.min(turn.endMs, t + PATH_STEP_MS)) {
    for (let due = nextAgent(); due && due.nextAt <= t && !s.world.outcome; due = nextAgent()) {
      step(due.nextAt);
      due.nextAt += due.intervalMs;
      if (s.world.outcome) continue;
      const res = due.think(s);
      s = res.state;
      due.idle = res.idle;
    }
    step(t);
    sample();
    if (t >= turn.endMs || s.world.outcome) break;
  }
  return { state: s, emitted, paths, pass, resupply: Object.fromEntries(resupply) };
}

/**
 * The engine's projection of a turn (D39, 11.4): `input`'s orders read by the rules, their couriers
 * rolled by the courier pass, and the turn run on a copy of `state` to its end. Pure and
 * deterministic; it never touches the live world.
 */
export function projectTurn(
  state: EngineState<GameState>,
  input: Pick<TurnInput, 'n' | 'startMs' | 'endMs' | 'orders'>,
  registry: EventRegistry<GameState>,
  context: TurnResolveContext = {},
): Projection {
  const parsed = input.orders.map((o) => rulesParseTurnOrder(state.world, o));
  const orders = engineOrdersOf(parsed, input.orders, input.startMs);
  const run = runEngineTurn(state, orders, input, registry, context.agents?.());
  return {
    state: run.state,
    resupply: run.resupply,
    emitted: run.emitted,
    couriers: run.pass.couriers,
    orders: parsed,
    summary: summarize(state, run.state, run.emitted, run.paths, input),
  };
}

/** The `rigid` resolver (and, from 11.6, the umpire's fallback): the engine alone, no model. */
export class EngineTurnResolver implements TurnResolver {
  constructor(private readonly registry: EventRegistry<GameState>) {}

  async resolve(
    state: EngineState<GameState>,
    input: TurnInput,
    context?: TurnResolveContext,
  ): Promise<TurnResolution> {
    const p = projectTurn(state, input, this.registry, context);
    const output: EngineTurnOutput = {
      orders: p.orders,
      couriers: p.couriers,
      projection: p.summary,
    };
    return { adjudicator: ENGINE_ADJUDICATOR, output };
  }
}

/**
 * Apply a logged engine turn at its start: the courier pass again (it must give the logged
 * couriers, or the log and the world disagree), then the turn's start as the projection had it.
 * The caller's advance to `T1` then runs the turn under the ordinary handlers.
 */
export function engineAdjudicator(
  state: EngineState<GameState>,
  turn: TurnRecord,
  context: { registry: EventRegistry<GameState> },
): EngineState<GameState> {
  const out = turn.output as EngineTurnOutput | undefined;
  if (!out || !Array.isArray(out.orders) || !Array.isArray(out.couriers)) {
    throw new Error(`turn ${turn.n}: an engine turn with no orders or couriers logged`);
  }
  const orders = engineOrdersOf(out.orders, turn.orders, turn.startMs);
  const pass = courierPass(state, orders, turn, context.registry);
  if (JSON.stringify(pass.couriers) !== JSON.stringify(out.couriers)) {
    throw new Error(`turn ${turn.n}: the courier pass differs from the logged couriers`);
  }
  return engineTurnStart(state, orders, pass, turn);
}
