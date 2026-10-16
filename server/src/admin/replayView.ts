/**
 * Admin replay (Epic #119, story 8.7): rebuild a game at a chosen game time from its input log.
 * Read-only diagnostics. It runs `replayLog` on a manual clock, so it makes no model calls and
 * waits on no wall clock: orders use the parse result recorded in the log.
 *
 * The per-side views come from the same visibility filter the live game uses, but they are only
 * ever returned by the admin API, never to a game client.
 */
import {
  viewFor,
  type EmittedEvent,
  type EngineState,
  type EventRegistry,
  type GameState,
  type SideId,
} from '@kriegsspiel/engine';
import type { SideView } from '@kriegsspiel/protocol';
import { toSideView } from '../api/sideView.js';
import { createRegistry, loadScenarioById, startingState } from '../game/registry.js';
import { replayLog } from '../game/replay.js';
import { turnNarrationsFromLog } from '../game/turns.js';
import type { GameStore, InputLogEntry, InputLogHeader } from '../game/store.js';

export type MarkKind = 'input' | 'event' | 'contact' | 'order' | 'llm' | 'turn';

/** A point on the scrubber's time line worth jumping to. */
export interface ReplayMark {
  ms: number;
  kind: MarkKind;
  label: string;
}

export interface ReplayTimeline {
  /** Last game time the scrubber can reach. */
  endMs: number;
  /** How the game ended, or null while it has not. */
  outcome: GameState['outcome'];
  marks: ReplayMark[];
}

export interface ReplayAt {
  gameMs: number;
  /** Unfiltered master state, as `GET /state` shows it for a live game. */
  engine: EngineState<GameState>;
  views: Record<string, SideView>;
  /** Events the engine emitted up to `gameMs`, in firing order. */
  events: EmittedEvent[];
  /** Always 0: replay has no model client to call. Reported so the admin page can say so. */
  llmCalls: 0;
}

export interface ReplayInput {
  header: InputLogHeader;
  world: GameState;
  entries: readonly InputLogEntry[];
  registry: EventRegistry<GameState>;
  init?: (state: EngineState<GameState>) => EngineState<GameState>;
}

/** The input log of a stored game, or undefined if it has none. Replay never touches a parser or umpire. */
export async function loadReplayInput(
  store: GameStore,
  id: string,
): Promise<ReplayInput | undefined> {
  const header = await store.logHeader(id);
  if (!header) return undefined;
  return {
    header,
    world: loadScenarioById(header.scenarioId),
    entries: await store.inputLog(id),
    registry: createRegistry(),
    init: startingState,
  };
}

const EVENT_KIND: Record<string, MarkKind> = {
  'contact.begin': 'contact',
  order_delivered: 'order',
};

function describeInput(e: InputLogEntry): string {
  const c = e.command;
  switch (c.kind) {
    case 'order':
      return `${c.side} order: ${c.text}`;
    case 'openTurn':
      return `turn ${c.turn} opens`;
    case 'sendTurn':
      return `${c.side} sends turn ${c.turn} (${c.orders.length} orders)`;
    case 'turnOrder':
      return `${c.side} holds an order for turn ${c.turn}`;
    case 'withdrawTurnOrder':
      return `${c.side} withdraws an order for turn ${c.turn}`;
    default:
      return `command ${c.kind}`;
  }
}

/** Who decided a turn, in words, for its marks. */
function decidedBy(t: NonNullable<InputLogEntry['turn']>): string {
  if (t.fallback) return 'the tables (the umpire fell back)';
  if (t.adjudicator === 'umpire') return 'the umpire';
  if (t.adjudicator === 'engine') return 'the tables';
  return 'no adjudicator';
}

/**
 * Turn mode (D39, 11.11): two marks per resolved turn, at its start and where it ended, so the
 * scrubber can step turn by turn. Inside a turn the umpire decided, the world is the turn's start
 * (units stand while the couriers ride) until its `umpire.turn` event at the end.
 */
function turnMarks(e: InputLogEntry, untilMs: number | undefined): ReplayMark[] {
  const t = e.turn;
  if (e.command.kind !== 'resolveTurn' || !t) return [];
  const end = e.endGameMs ?? t.endMs;
  const marks: ReplayMark[] = [{ ms: t.startMs, kind: 'turn', label: `turn ${t.n} begins` }];
  if (untilMs === undefined || end <= untilMs) {
    const failed = e.error ? `; not applied: ${e.error}` : '';
    marks.push({ ms: end, kind: 'turn', label: `turn ${t.n} decided by ${decidedBy(t)}${failed}` });
  }
  return marks;
}

/** Replay to `untilMs` (or to where the log ends) and list the moments worth stopping at. */
export function replayTimeline(input: ReplayInput, untilMs?: number): ReplayTimeline {
  const { state, emitted } = replayLog(
    input.header,
    input.world,
    input.entries,
    input.registry,
    untilMs,
    input.init,
  );
  const marks: ReplayMark[] = [];
  for (const e of input.entries) {
    if (untilMs !== undefined && e.gameMs > untilMs) continue;
    marks.push(...turnMarks(e, untilMs));
    // An umpire turn's model calls were made while the turn was open, at its start.
    if (e.command.kind === 'resolveTurn' && e.calls?.length) {
      const stages = [...new Set(e.calls.map((c) => c.stage))].join(', ');
      marks.push({
        ms: e.gameMs,
        kind: 'llm',
        label: `turn ${e.command.turn}: ${stages} (${e.calls.length} call${e.calls.length === 1 ? '' : 's'})`,
      });
    }
    if (e.error || e.command.kind === 'resolveTurn') continue;
    marks.push({ ms: e.gameMs, kind: 'input', label: describeInput(e) });
    // A parsed order is the one place a model was called while the game was played.
    if (e.command.kind === 'order' && e.parse && !e.agent) {
      marks.push({ ms: e.gameMs, kind: 'llm', label: `order parse: ${e.command.text}` });
    }
  }
  for (const ev of emitted) {
    marks.push({ ms: ev.time, kind: EVENT_KIND[ev.type] ?? 'event', label: ev.type });
  }
  marks.sort((a, b) => a.ms - b.ms);
  return { endMs: state.time, outcome: state.world.outcome, marks };
}

/** The game as it stood at `gameMs`: master state, each side's view and the events so far. */
export function replayAt(input: ReplayInput, gameMs: number): ReplayAt {
  const { state, emitted } = replayLog(
    input.header,
    input.world,
    input.entries,
    input.registry,
    gameMs,
    input.init,
  );
  const views: Record<string, SideView> = {};
  // Turn mode (11.9, 11.11): each turn's papers in the words the players read them (`turnReports`).
  const narrations = turnNarrationsFromLog(input.entries);
  for (const side of state.world.sides) {
    views[side.id] = toSideView(
      viewFor(state.world, side.id as SideId, state.time),
      {
        gameMsAtAnchor: state.time,
        wallMsAtAnchor: 0,
        rate: 1,
        status: 'stopped',
      },
      narrations.get(side.id),
    );
  }
  return { gameMs: state.time, engine: state, views, events: emitted, llmCalls: 0 };
}
