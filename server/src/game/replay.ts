/**
 * Replay: rebuild a game's state from its input log. See docs/architecture.md (Determinism and
 * replay).
 *
 * The engine runs on a manual clock: for each logged input, advance to the game time it was
 * applied at, apply it, advance to where the world stood afterwards. No wall clock, no timers
 * and no parser: orders use the parse result recorded in the log. Clock changes (rate, pause,
 * mode) need no step of their own, because the log carries the game time of every input.
 */
import {
  advanceTo,
  createState,
  issueOrder,
  type EmittedEvent,
  type EngineState,
  type EventRegistry,
  type GameState,
  type Order,
  type OrderIntent as EngineIntent,
} from '@kriegsspiel/engine';
import type { ParseResult } from '../orders/index.js';
import type { InputLogEntry, InputLogHeader } from './store.js';

/** Maps a parsed intent to one the engine knows, or the reason it cannot. */
function toEngineIntents(intents: ParseResult & { kind: 'intents' }): EngineIntent[] | string {
  const out: EngineIntent[] = [];
  for (const i of intents.intents) {
    if (i.kind === 'attack') return 'attack orders are not modelled yet';
    out.push(i);
  }
  return out;
}

/**
 * Turn an order command's parse result into an engine order, or the reason it was refused.
 * Shared by the live actor and replay so both build exactly the same order.
 */
export function applyLoggedOrder(
  state: EngineState<GameState>,
  gameId: string,
  seq: number,
  side: string,
  parsed: ParseResult,
): { state: EngineState<GameState>; orderId: string } | { reason: string } {
  if (parsed.kind === 'clarification') return { reason: parsed.question };
  if (parsed.kind === 'rejection') return { reason: parsed.reason };
  const intents = toEngineIntents(parsed);
  if (typeof intents === 'string') return { reason: intents };
  const order: Order = {
    id: `${gameId}-o${seq}`,
    side: side as Order['side'],
    to: parsed.unitId,
    // The engine is not advanced during a parse, so it is still at the time of signing.
    issuedAt: state.time,
    text: parsed.text,
    intents,
  };
  return { state: issueOrder(state, order, state.time), orderId: order.id };
}

export interface ReplayResult {
  state: EngineState<GameState>;
  /** Every event the engine emitted, in firing order. */
  emitted: EmittedEvent[];
}

/**
 * Replay `entries` from the scenario `world` (the one named by `header.scenarioId`). Pass
 * `untilGameMs` to stop at that game time: inputs logged after it are not applied, and a time
 * past the last input runs the world on to it. By default it ends where the last logged input
 * left the world. `init` is applied to the fresh state first, the same hook `GameHost` was given
 * when it created the game (the server passes `startingState`).
 */
export function replayLog(
  header: InputLogHeader,
  world: GameState,
  entries: readonly InputLogEntry[],
  registry: EventRegistry<GameState>,
  untilGameMs?: number,
  init?: (state: EngineState<GameState>) => EngineState<GameState>,
): ReplayResult {
  if (world.scenarioId !== header.scenarioId) {
    throw new Error(`log is for scenario ${header.scenarioId}, got ${world.scenarioId}`);
  }
  const state0 = createState(header.seed, structuredClone(world), 0);
  return replayFrom(init?.(state0) ?? state0, header.gameId, entries, registry, untilGameMs);
}

/**
 * Replay `entries` on top of `start` (a fresh scenario state, or a stored snapshot whose later
 * log entries are being re-applied). The same rules as `replayLog`.
 */
export function replayFrom(
  start: EngineState<GameState>,
  gameId: string,
  entries: readonly InputLogEntry[],
  registry: EventRegistry<GameState>,
  untilGameMs?: number,
): ReplayResult {
  let state = start;
  const emitted: EmittedEvent[] = [];
  const advance = (t: number) => {
    if (t < state.time) return;
    const res = advanceTo(state, t, registry);
    state = res.state;
    emitted.push(...res.emitted);
  };

  // Agent orders are logged when the actor next flushes, which can be after a later command;
  // game time puts them back in order, an agent's first at the same instant (it thought on the
  // way to that instant, before the command was applied).
  const ordered = [...entries].sort(
    (a, b) => a.gameMs - b.gameMs || Number(b.agent ?? false) - Number(a.agent ?? false),
  );
  // Where the world stood after the latest input. The world only needs to be caught up to an
  // input's time when the next input arrives, so the settle is applied lazily, at the end.
  let settled = 0;
  for (const entry of ordered) {
    // Stop before the first input after the target, so an earlier `untilGameMs` leaves later
    // inputs out of the state.
    if (untilGameMs !== undefined && entry.gameMs > untilGameMs) break;
    advance(entry.gameMs);
    // A refused or failed command left the engine untouched (the order is queued last).
    if (!entry.error) {
      const { command } = entry;
      if (command.kind === 'advanceTo') advance(command.gameMs);
      else if (command.kind === 'order' && entry.parse) {
        const res = applyLoggedOrder(state, gameId, entry.seq, command.side, entry.parse);
        if ('state' in res) state = res.state;
      }
    }
    settled = Math.max(settled, entry.endGameMs ?? state.time);
  }
  advance(untilGameMs === undefined ? settled : untilGameMs);
  return { state, emitted };
}
