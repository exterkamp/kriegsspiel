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
import { advanceUntilOver } from './advance.js';
import { headerPin } from './pinned-header.js';
import { nativeCanonicalJson } from './native-scenario-pin.js';
import { assertBattlefieldBudget } from '@kriegsspiel/protocol';
import { applyTurn } from './turns.js';

export { advanceUntilOver };

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
  courier?: Order['courier'],
  deputy?: boolean,
  ref?: string,
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
    ...(courier ? { courier } : {}),
    ...(deputy ? { deputy: true as const } : {}),
    ...(ref === undefined ? {} : { ref }),
    ...(parsed.interpretation ? { interpretation: parsed.interpretation } : {}),
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
  const pin = headerPin(header);
  if (pin) assertBattlefieldBudget(world, 1024 * 1024);
  if (pin && nativeCanonicalJson(world) !== nativeCanonicalJson(pin.initialWorld))
    throw new Error('Replay initial world contradicts pinned scenario');
  // The dial chosen at creation is part of the starting world, as the host built it.
  const start = structuredClone(world);
  if (header.settings) start.dial = header.settings.dial;
  const state0 = createState(header.seed, start, 0);
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
    const res = advanceUntilOver(state, t, registry);
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
      // An advance is logged at the game time it started from, and agents think (and log orders)
      // part way through it. So do not run to its target now: later entries catch the world up as
      // they come, and the settle at the end covers the rest.
      // A step is not here: it may have stalled at the barrier short of its target, and the
      // settle to `endGameMs` below already records where it really ended.
      if (command.kind === 'advanceTo') settled = Math.max(settled, command.gameMs);
      else if (command.kind === 'order' && entry.parse) {
        const res = applyLoggedOrder(
          state,
          gameId,
          entry.seq,
          command.side,
          entry.parse,
          command.courier,
          entry.deputy !== undefined,
          command.orderId,
        );
        if ('state' in res) state = res.state;
      } else if (command.kind === 'resolveTurn' && entry.turn && !state.world.outcome) {
        // Turn mode (D39): the logged resolution, applied at the turn's start by the adjudicator that
        // made it, with no model call; the settle below runs the world on to the turn's end.
        // A turn logged after the outcome (a log from before #429 had one) is not replayed: the game
        // was over, and its courier pass would not match the stopped world.
        state = applyTurn(state, entry.turn, { gameId, registry });
      }
    }
    settled = Math.max(settled, entry.endGameMs ?? state.time);
  }
  advance(untilGameMs === undefined ? settled : untilGameMs);
  return { state, emitted };
}
