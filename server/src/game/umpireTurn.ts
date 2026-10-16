/**
 * The umpire adjudicator (D39, story 11.6): a turn decided by the `adjudicate` umpire stage, with
 * the engine as the record, the limit and the fallback.
 *
 * - `UmpireTurnResolver` (`standard` and `free`): the engine projects the turn (11.4), the umpire is
 *   asked for a `TurnProposal` with the projection as reference (`standard`) or advice (`free`),
 *   and the proposal is checked (`adjudicate.ts`). If the umpire fails, is refused by the game's
 *   budget, runs past the turn's time limit or its answer fails the gate after the one resend, the
 *   turn is resolved by the engine exactly as `rigid` would (the projection already ran), and the
 *   fallback is logged on the turn's entry.
 * - `umpireAdjudicator`: applies a logged umpire turn at its start, live and in replay: the
 *   courier pass again (it must give the logged couriers), the held turn's start, and the
 *   `umpire.turn` event at its end with the logged proposal and the validator's context. No model
 *   call: replay needs only the log.
 * - Dice (11.7): the rolls the umpire asked for are made on the umpire's own stream, seeded from
 *   the world's RNG at `T0` (`rollTurnDice`), and logged in the context; applying the turn draws
 *   them again from the same state and refuses a turn whose rolls differ.
 */
import {
  canSee,
  courierPass,
  heldTurnStart,
  issueTurn,
  metres,
  positionAt,
  rollTurnDice,
  type EngineState,
  type EventRegistry,
  type GameState,
  type TurnContext,
  type TurnCourier,
  type Unit,
} from '@kriegsspiel/engine';
import type { TurnObservation, TurnProposal, UmpirePersona } from '@kriegsspiel/protocol';
import {
  adjudicateTurn,
  type AdjudicateTurn,
  type ProjectedUnitOutcome,
  type ShownOrder,
  type UmpireDial,
} from '../umpire/adjudicate.js';
import { deg } from '../umpire/eval/turnInput.js';
import type { UmpireCallRecord, UmpireClient } from '../umpire/umpireClient.js';
import {
  ENGINE_ADJUDICATOR,
  engineOrdersOf,
  projectTurn,
  type EngineTurnOutput,
  type Projection,
  type ProjectionSummary,
  type RulesOrder,
} from './engineTurn.js';
import type { TurnRecord } from './store.js';
import type { TurnInput, TurnResolution, TurnResolveContext, TurnResolver } from './turns.js';

/** The name a resolver logs for a turn the umpire decided. */
export const UMPIRE_ADJUDICATOR = 'umpire';

/** D39's `adjudicateTurnTimeoutMs`: every call, retry and resend of one turn together. */
export const ADJUDICATE_TURN_TIMEOUT_MS = 15 * 60_000;

/** What an umpire turn logs on its `resolveTurn` entry. Replay needs all but `projection`. */
export interface UmpireTurnOutput {
  /** The turn's orders as the rules read them: the courier pass rides these, as the projection's did. */
  orders: RulesOrder[];
  couriers: TurnCourier[];
  /** The umpire's final proposal, raw. */
  proposal: TurnProposal;
  /**
   * What the validator checks it against: the turn, the dial, every order shown with its arrival,
   * and the projection's units. Logged because the projection ran the scripted sides' copies,
   * which replay does not have.
   */
  context: TurnContext;
  /** The projection summary the umpire was shown (for the record). */
  projection: ProjectionSummary;
  /** The problems sent back with the resend, if there was one. */
  resent?: string[];
  /** Roll requests the engine refused (11.7), as the umpire was told; the rolls made are `context.rolls`. */
  refusedRolls?: string[];
}

export interface UmpireTurnResolverOptions {
  registry: EventRegistry<GameState>;
  /** The game's umpire client (`GameUmpireClient`, so the game's caps apply). */
  client: UmpireClient;
  dial: UmpireDial;
  persona?: UmpirePersona;
  /** Wall-clock limit on the whole adjudication of a turn. Default 15 minutes. */
  turnTimeoutMs?: number;
  /** Told each time a turn falls back to the engine, with the reason. */
  onFallback?: (turn: number, reason: string) => void;
}

const m = (millimetres: number) => Math.round(metres(millimetres));

/** `u` standing where it is at `time`, with no march under way: for a sight test at that instant. */
function standing(world: GameState, u: Unit, time: number): Unit {
  const placed: Unit = { ...u, center: positionAt(world.map, u, time) };
  delete placed.leg;
  return placed;
}

/** Each side's sightings at the turn's start and at the projection's end, one observer per enemy. */
function projectedObservations(
  start: GameState,
  end: GameState,
  turn: Pick<TurnInput, 'startMs' | 'endMs'>,
): TurnObservation[] {
  const out: TurnObservation[] = [];
  const live0 = new Set(start.units.filter((u) => u.status !== 'destroyed').map((u) => u.id));
  const sightings = (w: GameState, time: number, when: 'start' | 'end') => {
    const units = w.units
      .filter((u) => live0.has(u.id) && u.status !== 'destroyed')
      .map((u) => standing(w, u, time))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const sw: GameState = { ...w, units };
    for (const side of w.sides) {
      for (const target of units.filter((u) => u.side !== side.id)) {
        const by = units.find((u) => u.side === side.id && canSee(sw, u, target));
        if (by) out.push({ side: side.id, unitId: target.id, by: by.id, when });
      }
    }
  };
  sightings(start, turn.startMs, 'start');
  sightings(end, turn.endMs, 'end');
  return out;
}

/** The projection's units in the proposal's terms, with what the summary says of each. */
function projectedUnits(p: Projection, live: ReadonlySet<string>, endMs: number) {
  const world = p.state.world;
  return world.units
    .filter((u) => live.has(u.id))
    .map((u): ProjectedUnitOutcome => {
      const at = positionAt(world.map, u, endMs);
      const s = p.summary.units.find((x) => x.id === u.id);
      const intent = u.intent;
      const to =
        u.status === 'active' && (intent.kind === 'move' || intent.kind === 'attack')
          ? intent.to
          : undefined;
      return {
        unitId: u.id,
        x: m(at.x),
        y: m(at.y),
        facingDeg: deg(u.facing),
        formation: u.formation,
        strength: Math.round(u.strength),
        morale: Math.round(u.morale),
        fatigue: Math.round(u.fatigue),
        ammo: Math.round(u.ammo),
        status:
          u.status === 'destroyed' ? 'destroyed' : u.status === 'withdrawn' ? 'broken' : 'active',
        continuing: to
          ? { kind: 'move', x: m(to.x), y: m(to.y) }
          : intent.kind === 'hold'
            ? { kind: 'hold' }
            : { kind: 'idle' },
        ...(s ? { at: s.to.at } : {}),
        ...(s?.path ? { path: s.path } : {}),
        ...(s?.contacts ? { contacts: s.contacts } : {}),
        ...(s?.lost ? { lost: s.lost } : {}),
      };
    });
}

/**
 * The orders the umpire may act on (D39, "Couriers across turns"): those the courier pass has
 * reaching their unit in the turn or still riding at its end, new and old. A lost, intercepted or
 * failed order never reaches the umpire as an order.
 */
function shownOrders(
  state: EngineState<GameState>,
  input: TurnInput,
  couriers: readonly TurnCourier[],
): ShownOrder[] {
  const shown: ShownOrder[] = [];
  for (const c of couriers) {
    if (c.outcome !== 'delivered' && c.outcome !== 'riding') continue;
    const sent = input.orders.find((o) => `${o.side}-${o.orderId}` === c.orderId);
    const riding = sent ? undefined : state.world.couriers.find((r) => r.order.id === c.orderId);
    const text = sent?.text ?? riding?.order.text;
    if (text === undefined) continue;
    const courier = sent?.courier ?? riding?.order.courier;
    shown.push({
      orderId: c.orderId,
      side: c.side,
      to: c.unitId,
      text,
      ...(courier ? { courier } : {}),
      sentAtMinute: Math.round((sent ? input.startMs : riding!.order.issuedAt) / 60_000),
      ...(c.outcome === 'delivered' && c.atMs !== undefined ? { arrivedAtMs: c.atMs } : {}),
      ...(c.outcome === 'riding' && c.dueMs !== undefined ? { dueMs: c.dueMs } : {}),
      ...(c.garbled ? { garbled: true } : {}),
    });
  }
  return shown;
}

/** The umpire's resolver for `standard` and `free` turns; it always answers. */
export class UmpireTurnResolver implements TurnResolver {
  constructor(private readonly opts: UmpireTurnResolverOptions) {}

  async resolve(
    state: EngineState<GameState>,
    input: TurnInput,
    context?: TurnResolveContext,
  ): Promise<TurnResolution> {
    const { registry } = this.opts;
    const p = projectTurn(state, input, registry, context);
    const engine: EngineTurnOutput = {
      orders: p.orders,
      couriers: p.couriers,
      projection: p.summary,
    };
    // The projection is the engine's resolution: a turn the game had already ended has nothing
    // for the umpire to decide, and the engine's turn is exactly what it projected.
    if (state.world.outcome) return { adjudicator: ENGINE_ADJUDICATOR, output: engine };
    const fallBack = (
      reason: string,
      attempts: number,
      calls: UmpireCallRecord[] = [],
    ): TurnResolution => {
      const error = `umpire fell back to the engine: ${reason}`;
      this.opts.onFallback?.(input.n, error);
      return {
        adjudicator: ENGINE_ADJUDICATOR,
        output: engine,
        ...(calls.length > 0 ? { calls } : {}),
        fallback: { error, attempts },
      };
    };
    // Anything that throws from here on (building the input, checking an odd reply) falls back to
    // the engine's turn, already computed, rather than failing the turn and dropping its orders.
    try {
      return await this.adjudicate(state, input, p, engine, fallBack);
    } catch (e) {
      return fallBack(e instanceof Error ? e.message : String(e), 0);
    }
  }

  private async adjudicate(
    state: EngineState<GameState>,
    input: TurnInput,
    p: Projection,
    engine: EngineTurnOutput,
    fallBack: (reason: string, attempts: number, calls?: UmpireCallRecord[]) => TurnResolution,
  ): Promise<TurnResolution> {
    const { client, dial } = this.opts;
    const live = new Set(
      state.world.units.filter((u) => u.status !== 'destroyed').map((u) => u.id),
    );
    const orders = shownOrders(state, input, p.couriers);
    const turn: AdjudicateTurn = {
      n: input.n,
      startMs: input.startMs,
      endMs: input.endMs,
      dial,
      orders,
      projection: {
        units: projectedUnits(p, live, input.endMs),
        observations: projectedObservations(state.world, p.state.world, input),
        events: p.summary.events,
        ...(p.summary.outcome ? { outcome: p.summary.outcome } : {}),
      },
    };
    const turnContext: TurnContext = {
      turn: { n: input.n, startMs: input.startMs, endMs: input.endMs },
      dial,
      projection: p.state.world.units.filter((u) => live.has(u.id)),
      orders: orders.map((o) => ({
        orderId: o.orderId,
        unitId: o.to,
        ...(o.arrivedAtMs !== undefined ? { deliveredAt: o.arrivedAtMs } : {}),
      })),
    };

    // The time limit cancels the adjudication: the call in flight is abandoned and no resend
    // goes out after the turn has fallen back.
    const limitMs = this.opts.turnTimeoutMs ?? ADJUDICATE_TURN_TIMEOUT_MS;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), limitMs);
    let r: Awaited<ReturnType<typeof adjudicateTurn>>;
    try {
      r = await adjudicateTurn(client, state.world, turn, {
        context: turnContext,
        rngAtStart: state.rng,
        signal: ctrl.signal,
        ...(this.opts.persona ? { persona: this.opts.persona } : {}),
      });
    } finally {
      clearTimeout(timer);
      ctrl.abort();
    }
    if (!r.proposal && ctrl.signal.aborted && r.error?.startsWith('cancelled')) {
      r = { ...r, error: `the umpire took longer than ${Math.round(limitMs / 1000)} s` };
    }

    if (r.proposal) {
      const output: UmpireTurnOutput = {
        orders: p.orders,
        couriers: p.couriers,
        proposal: r.proposal,
        context: r.rolls ? { ...turnContext, rolls: r.rolls } : turnContext,
        projection: p.summary,
        ...(r.resent ? { resent: r.resent } : {}),
        ...(r.refusedRolls ? { refusedRolls: r.refusedRolls } : {}),
      };
      return { adjudicator: UMPIRE_ADJUDICATOR, output, calls: r.calls };
    }
    return fallBack(r.error ?? 'no proposal', r.attempts, r.calls);
  }
}

/**
 * Apply a logged umpire turn at its start: the courier pass again (it must give the logged
 * couriers), the umpire's dice again (they must give the logged rolls), the held turn's start on
 * the real world (couriers ride from `T0`, units stand), and
 * `umpire.turn` at `T1`, which validates and applies the proposal. The caller's advance to `T1`
 * runs it. Pure.
 */
export function umpireAdjudicator(
  state: EngineState<GameState>,
  turn: TurnRecord,
  context: { registry: EventRegistry<GameState> },
): EngineState<GameState> {
  const out = turn.output as UmpireTurnOutput | undefined;
  if (!out || !Array.isArray(out.orders) || !Array.isArray(out.couriers) || !out.proposal) {
    throw new Error(`turn ${turn.n}: an umpire turn with no orders, couriers or proposal logged`);
  }
  const orders = engineOrdersOf(out.orders, turn.orders, turn.startMs);
  const pass = courierPass(state, orders, turn, context.registry);
  if (JSON.stringify(pass.couriers) !== JSON.stringify(out.couriers)) {
    throw new Error(`turn ${turn.n}: the courier pass differs from the logged couriers`);
  }
  const rolls = out.context?.rolls;
  if (rolls && rolls.length > 0) {
    const asked = rolls.map(({ id, why, chance }) => ({ id, why, chance }));
    if (JSON.stringify(rollTurnDice(state.rng, turn.n, asked)) !== JSON.stringify(rolls)) {
      throw new Error(`turn ${turn.n}: the umpire's dice differ from the logged rolls`);
    }
  }
  const held = heldTurnStart(state, orders, turn);
  return issueTurn(held, { proposal: out.proposal, context: out.context });
}
