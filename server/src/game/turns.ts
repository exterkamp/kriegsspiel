/**
 * Turn mode (D39, story 11.3): the turn clock's seams. See docs/architecture.md (Turn-based mode:
 * the turn pipeline).
 *
 * A turn-mode game's clock stays in manual mode. Each side holds orders for the open turn and sends
 * them once; when every human side has sent, or the wall-clock deadline passes, the actor closes
 * the turn and hands it to a `TurnResolver`. The resolver may take its time (a model call): it
 * returns an output, never a state. The actor then applies that output with the adjudicator it
 * names, the same pure function replay calls on the logged output, so a live turn and its replay
 * cannot differ. Only after that does the actor advance the clock to the turn's end.
 *
 * 11.4 (#400) registers the engine adjudicator and 11.6 (#402) the umpire's. Until then the
 * default resolver is `none`: the sent orders are logged but not carried out, and units go on with
 * their last orders through the turn.
 */
import {
  type EngineState,
  type EventRegistry,
  type GameState,
  type SideId,
} from '@kriegsspiel/engine';
import { MAX_TURN_ORDERS, type TurnCause, type TurnOrder } from '@kriegsspiel/protocol';
import type { UmpireCallRecord } from '../umpire/umpireClient.js';
import type { InputLogEntry, SentTurnOrder, TurnRecord } from './store.js';

/** What a resolver is given when a turn closes. */
export interface TurnInput {
  gameId: string;
  n: number;
  startMs: number;
  endMs: number;
  cause: TurnCause;
  orders: readonly SentTurnOrder[];
  /** The sides that sent, in send order. */
  sent: readonly string[];
}

/** A resolver's answer: what to log and apply. It never carries a state. */
export interface TurnResolution {
  /** The adjudicator that applies `output` (`registerTurnAdjudicator`). */
  adjudicator: string;
  output?: unknown;
  /** Model calls the resolver made, logged on the entry so replay needs no model. */
  calls?: UmpireCallRecord[];
  fallback?: { error: string; attempts: number };
}

/**
 * Decides a turn. `state` is the world at the turn's start (`T0`), which nothing moves while the
 * resolver works. It must always answer (a turn never hangs): an umpire resolver falls back to the
 * engine's own resolution on any failure (D39, "Fallback").
 */
export interface TurnResolver {
  resolve(state: EngineState<GameState>, input: TurnInput): Promise<TurnResolution>;
}

/**
 * Applies a resolved turn at `T0`: pure and deterministic, with no model call. The actor then
 * advances the result to `T1` under the ordinary handlers. Live play and replay both call it.
 */
export type TurnAdjudicator = (
  state: EngineState<GameState>,
  turn: TurnRecord,
  context: { gameId: string; registry: EventRegistry<GameState> },
) => EngineState<GameState>;

/** The adjudicator of the default resolver: orders are logged, not carried out (until 11.4). */
export const NO_ADJUDICATOR = 'none';

const adjudicators = new Map<string, TurnAdjudicator>([[NO_ADJUDICATOR, (state) => state]]);

/** Make an adjudicator known to live play and replay by the name a resolver logs. */
export function registerTurnAdjudicator(name: string, apply: TurnAdjudicator): void {
  adjudicators.set(name, apply);
}

/** Apply a logged turn at its start. Throws for an adjudicator this server does not know. */
export function applyTurn(
  state: EngineState<GameState>,
  turn: TurnRecord,
  context: { gameId: string; registry: EventRegistry<GameState> },
): EngineState<GameState> {
  const apply = adjudicators.get(turn.adjudicator);
  if (!apply) throw new Error(`turn ${turn.n}: unknown adjudicator "${turn.adjudicator}"`);
  return apply(state, turn, context);
}

/** The default resolver until 11.4: no model, no change; units carry on with their last orders. */
export const NO_ORDERS_RESOLVER: TurnResolver = {
  resolve: async () => ({ adjudicator: NO_ADJUDICATOR }),
};

/**
 * Where a turn starting at `startMs` ends: `turnMs` later, or at the scenario's time limit when that
 * comes first, so the game ends at the same minute at every dial (D39, "Clock"). From game time 0
 * turn `n` therefore covers `[(n - 1) x turnMs, n x turnMs)`.
 */
export function turnBounds(
  startMs: number,
  turnMs: number,
  world: GameState,
): { startMs: number; endMs: number } {
  const limit = world.victory.holdMs;
  const endMs = startMs + turnMs;
  return { startMs, endMs: limit > startMs ? Math.min(endMs, limit) : endMs };
}

/** The open turn as the actor keeps it. */
export interface OpenTurn {
  n: number;
  startMs: number;
  endMs: number;
  deadlineWallMs?: number;
  /** Each side's held orders, in the order first held. */
  held: Map<string, TurnOrder[]>;
  /** The sides that sent, in send order, with what they sent and who sent it. */
  sent: Map<string, { orders: TurnOrder[]; signer?: SentTurnOrder['signer'] }>;
  /** The turn has closed and its resolver is working. */
  resolving: boolean;
}

/** Hold `order` for `side`, replacing a held order with the same id. Throws a player-facing reason. */
export function holdOrder(turn: OpenTurn, side: string, order: TurnOrder): void {
  const list = turn.held.get(side) ?? [];
  const i = list.findIndex((o) => o.orderId === order.orderId);
  if (i < 0 && list.length >= MAX_TURN_ORDERS) {
    throw new Error(`a side may hold at most ${MAX_TURN_ORDERS} orders for a turn`);
  }
  if (i < 0) list.push(order);
  else list[i] = order;
  turn.held.set(side, list);
}

/** Take a held order back; false when the side holds no order with that id. */
export function withdrawOrder(turn: OpenTurn, side: string, orderId: string): boolean {
  const list = turn.held.get(side) ?? [];
  const i = list.findIndex((o) => o.orderId === orderId);
  if (i < 0) return false;
  list.splice(i, 1);
  turn.held.set(side, list);
  return true;
}

/**
 * The open turn of a reopened turn-mode game, from its whole input log: the last `openTurn` that no
 * `resolveTurn` closed, with the orders held, withdrawn and sent for it. Undefined when no turn was
 * ever opened (a new game) or the last opened turn was resolved and nothing opened after it.
 */
export function openTurnFromLog(log: readonly InputLogEntry[]): OpenTurn | undefined {
  let turn: OpenTurn | undefined;
  for (const e of log) {
    if (e.error) continue;
    const c = e.command;
    if (c.kind === 'openTurn') {
      turn = {
        n: c.turn,
        startMs: c.startMs,
        endMs: c.endMs,
        ...(c.deadlineWallMs === undefined ? {} : { deadlineWallMs: c.deadlineWallMs }),
        held: new Map(),
        sent: new Map(),
        resolving: false,
      };
    } else if (!turn) continue;
    else if (c.kind === 'resolveTurn' && c.turn === turn.n) turn = undefined;
    else if (c.kind === 'turnOrder' && c.turn === turn.n) holdOrder(turn, c.side, c.order);
    else if (c.kind === 'withdrawTurnOrder' && c.turn === turn.n)
      withdrawOrder(turn, c.side, c.orderId);
    else if (c.kind === 'sendTurn' && c.turn === turn.n) {
      turn.held.set(c.side, [...c.orders]);
      turn.sent.set(c.side, { orders: [...c.orders], ...(c.signer ? { signer: c.signer } : {}) });
    }
  }
  return turn;
}

/** Every side's sent orders, in send order, as the turn record carries them. */
export function sentOrdersOf(turn: OpenTurn): SentTurnOrder[] {
  return [...turn.sent].flatMap(([side, s]) =>
    s.orders.map((o) => ({ ...o, side, ...(s.signer ? { signer: s.signer } : {}) })),
  );
}

/** Which of `sides` must send before a turn closes without its deadline: those no agent plays. */
export function humanSides(sides: readonly { id: SideId }[], agentSides: ReadonlySet<string>) {
  return sides.map((s) => s.id as string).filter((id) => !agentSides.has(id));
}
