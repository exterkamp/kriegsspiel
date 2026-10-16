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
  viewFor,
  type EngineSideView,
  type EngineState,
  type EventRegistry,
  type GameState,
  type SideId,
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
import { deg } from '../umpire/eval/turnProposal.js';
import { observationKey, sideSight } from '../umpire/accountSight.js';
import { hiddenTerms } from '../umpire/leakGuard.js';
import { reportsOfTurn, writeTurnReports, type TurnReportsContext } from '../umpire/turnReports.js';
import type { UmpireCallRecord, UmpireClient, UmpireRequest } from '../umpire/umpireClient.js';
import { advanceUntilOver } from './advance.js';
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
import type {
  TurnInput,
  TurnReports,
  TurnResolution,
  TurnResolveContext,
  TurnResolver,
} from './turns.js';

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
  /**
   * The client that writes each side's papers after an umpire turn (11.9, the `narrate` stage
   * route; the app passes the game's client, so its caps apply). Unset: the papers keep the
   * engine's template text and no report call is made.
   */
  reporter?: UmpireClient;
  /** Wall-clock limit on writing all the sides' papers of one turn. Default 5 minutes. */
  reportTimeoutMs?: number;
}

/** How long the papers of one turn may take to write before the rest keep their template text. */
export const TURN_REPORTS_TIMEOUT_MS = 5 * 60_000;

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

/**
 * What the `adjudicate` stage is given for a turn, from the world at its start and the engine's
 * projection: the orders the umpire may act on, the projection in the proposal's terms with the
 * engine's sightings, and the validator's context. The umpire benchmark builds its cases' inputs
 * with it too (#440), so it measures what a game sends.
 */
export function adjudicationOf(
  state: EngineState<GameState>,
  input: TurnInput,
  p: Projection,
  dial: UmpireDial,
): { turn: AdjudicateTurn; context: TurnContext } {
  const live = new Set(state.world.units.filter((u) => u.status !== 'destroyed').map((u) => u.id));
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
  const context: TurnContext = {
    turn: { n: input.n, startMs: input.startMs, endMs: input.endMs },
    dial,
    projection: p.state.world.units.filter((u) => live.has(u.id)),
    orders: orders.map((o) => ({
      orderId: o.orderId,
      unitId: o.to,
      ...(o.arrivedAtMs !== undefined ? { deliveredAt: o.arrivedAtMs } : {}),
    })),
  };
  return { turn, context };
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
      return await this.adjudicate(state, input, p, engine, fallBack, context);
    } catch (e) {
      return fallBack(e instanceof Error ? e.message : String(e), 0);
    }
  }

  /**
   * Each side's papers of the turn (11.9): the turn applied on a copy exactly as the actor will
   * apply it (an umpire turn holds the units and runs no agent, so the copy's end is the live
   * end), then one call per side from that side's own view at the turn's end and its own units'
   * accounts. Never the summary, the journal, the rolls or another side's accounts. Any failure
   * leaves the papers their template text; it never fails the turn.
   */
  private async writeReports(
    state: EngineState<GameState>,
    input: TurnInput,
    output: UmpireTurnOutput,
    context?: TurnResolveContext,
  ): Promise<TurnReports[]> {
    const reporter = this.opts.reporter;
    if (!reporter) return [];
    const { registry } = this.opts;
    let end: EngineState<GameState>;
    try {
      const start = umpireAdjudicator(state, umpireRecord(input, output), { registry });
      end = advanceUntilOver(start, input.endMs, registry).state;
    } catch {
      // The actor's apply will fail the same way and log why; there are no papers to write.
      return [];
    }
    const world = end.world;
    const sides = context?.reportSides ?? world.sides.map((s) => s.id);
    const places = [...new Set(world.map.features.flatMap((f) => (f.name ? [f.name] : [])))];
    const ctrl = new AbortController();
    const timer = setTimeout(
      () => ctrl.abort(),
      this.opts.reportTimeoutMs ?? TURN_REPORTS_TIMEOUT_MS,
    );
    const out: TurnReports[] = [];
    try {
      for (const sideId of sides) {
        const side = sideId as SideId;
        if (!world.sides.some((s) => s.id === side)) continue;
        const view = viewFor(world, side, end.time);
        const due = reportsOfTurn(view.reports, input.startMs, end.time);
        if (due.length === 0) continue;
        const calls: UmpireCallRecord[] = [];
        const client: UmpireClient = {
          call: async <T>(request: UmpireRequest) => {
            const res = await reporter.call<T>(request);
            calls.push(res.record);
            return res;
          },
        };
        const result = await writeTurnReports(
          client,
          side,
          input.n,
          due,
          turnReportsContext(world, view, input, output.proposal, places),
          {
            signal: ctrl.signal,
            ...(this.opts.persona ? { persona: this.opts.persona } : {}),
          },
        );
        const notes = [
          ...result.withheld.map((w) => `${w.reportId}: ${w.reason}`),
          ...result.fallbacks.map((f) => `${f.reportId}: ${f.reason}`),
        ];
        out.push({
          side,
          turn: input.n,
          narrated: result.dispatches.map((d) => ({ reportId: d.reportIds[0]!, text: d.text })),
          calls,
          ...(notes.length > 0
            ? { error: `turn reports kept template text: ${notes.join('; ')}` }
            : {}),
        });
      }
    } finally {
      clearTimeout(timer);
    }
    return out;
  }

  private async adjudicate(
    state: EngineState<GameState>,
    input: TurnInput,
    p: Projection,
    engine: EngineTurnOutput,
    fallBack: (reason: string, attempts: number, calls?: UmpireCallRecord[]) => TurnResolution,
    context?: TurnResolveContext,
  ): Promise<TurnResolution> {
    const { client, dial } = this.opts;
    const { turn, context: turnContext } = adjudicationOf(state, input, p, dial);

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
      const reports = await this.writeReports(state, input, output, context);
      return {
        adjudicator: UMPIRE_ADJUDICATOR,
        output,
        calls: r.calls,
        ...(reports.length > 0 ? { reports } : {}),
      };
    }
    return fallBack(r.error ?? 'no proposal', r.attempts, r.calls);
  }
}

/**
 * The turn as the actor will log it: what `umpireAdjudicator` applies.
 */
/**
 * What side `view.side`'s papers of umpire turn `input.n` may be written from (11.9): its own
 * units, their accounts in `proposal`, its own words for its orders, the map's places, the names it
 * must not read, and what its units saw as the sight check let it stand (#533: the proposal's
 * observations less this turn's observation rulings in `world`, the turn's applied end).
 */
export function turnReportsContext(
  world: GameState,
  view: EngineSideView,
  input: Pick<TurnInput, 'n' | 'orders'>,
  proposal: TurnProposal,
  places: readonly string[],
): TurnReportsContext {
  const side = view.side;
  const own = new Set(view.ownUnits.map((u) => u.id));
  const refused = new Set(
    world.rulings.flatMap((r) =>
      'kind' in r && r.kind === 'turn' && r.turn === input.n && r.field === 'observation'
        ? [observationKey(r.proposed as unknown as TurnObservation)]
        : [],
    ),
  );
  return {
    ownUnits: view.ownUnits,
    accounts: proposal.units
      .filter((u) => own.has(u.unitId) && typeof u.account === 'string')
      .map((u) => ({ unitId: u.unitId, account: u.account })),
    orderTexts: new Map(
      input.orders.filter((o) => o.side === side).map((o) => [o.orderId, o.text]),
    ),
    places,
    hidden: hiddenTerms(world, side),
    sight: sideSight(
      side,
      proposal.observations,
      proposal.observations.filter((o) => !refused.has(observationKey(o))),
      view.visibleEnemies.length > 0 || view.lastKnownContacts.length > 0,
    ),
  };
}

function umpireRecord(input: TurnInput, output: UmpireTurnOutput): TurnRecord {
  return {
    n: input.n,
    startMs: input.startMs,
    endMs: input.endMs,
    cause: input.cause,
    orders: [...input.orders],
    sent: [...input.sent],
    adjudicator: UMPIRE_ADJUDICATOR,
    output,
  };
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
