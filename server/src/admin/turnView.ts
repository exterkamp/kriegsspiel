/**
 * Turns of a turn-mode game, rebuilt from its input log (D39, story 11.11, #407). Read-only
 * diagnostics with no model call: each turn is replayed from the logged resolution, as live play
 * applied it.
 *
 * - `replayTurns`: the world just before each turn was applied and where the turn left it, with the
 *   events it emitted. Shared by the admin Turn panel and the post-game umpire's window.
 * - `adminTurns`: everything the Turn panel shows for each turn: the orders held and sent, the rules'
 *   reading, the couriers, the projection, every model call with its input and output, the proposal,
 *   the rolls made and refused, each clamp (`TurnRuling`) with its reason, the fallback, and the
 *   umpire's journal after the turn. Master state: only the admin API returns it, never a game client.
 */
import type {
  EmittedEvent,
  EngineState,
  GameState,
  TurnCourier,
  TurnProposal,
  TurnRoll,
  TurnRuling,
  UmpireJournal,
} from '@kriegsspiel/engine';
import type { TurnCause, TurnOrder } from '@kriegsspiel/protocol';
import type { ProjectionSummary, RulesOrder } from '../game/engineTurn.js';
import { replayFrom, replayLog } from '../game/replay.js';
import type { InputLogEntry, SentTurnOrder, TurnRecord } from '../game/store.js';
import { holdOrder, openTurnFromLog, withdrawOrder, type OpenTurn } from '../game/turns.js';
import type { UmpireTurnOutput } from '../game/umpireTurn.js';
import type { UmpireCallRecord } from '../umpire/umpireClient.js';
import type { ReplayInput } from './replayView.js';

/** One resolved turn, replayed. */
export interface ReplayedTurn {
  /** The turn's `resolveTurn` entry. */
  entry: InputLogEntry;
  turn: TurnRecord;
  /** The world at the turn's start, before the turn was applied. */
  before: EngineState<GameState>;
  /** The world at the turn's end, or where the game ended inside it. */
  after: EngineState<GameState>;
  /** What the engine emitted from the turn's start to its end. */
  emitted: EmittedEvent[];
}

/** Log order as replay applies it: game time, an agent's order first at the same instant. */
const replayOrder = (a: InputLogEntry, b: InputLogEntry) =>
  a.gameMs - b.gameMs || Number(b.agent ?? false) - Number(a.agent ?? false);

const isTurn = (e: InputLogEntry): e is InputLogEntry & { turn: TurnRecord } =>
  e.command.kind === 'resolveTurn' && e.turn !== undefined;

/**
 * Replay a game turn by turn: for each logged turn, the log up to its start (the turn itself left
 * out), then the turn and the log up to its end. The slices together are the whole log in replay's
 * order, so each turn ends exactly where a full replay to that time does (tested).
 */
export function replayTurns(input: ReplayInput): ReplayedTurn[] {
  const ordered = [...input.entries].sort(replayOrder);
  const turns = ordered.filter(isTurn);
  if (turns.length === 0) return [];
  const { header } = input;
  let state = replayLog(header, input.world, [], input.registry, 0, input.init).state;
  let i = 0;
  const out: ReplayedTurn[] = [];
  for (const entry of turns) {
    const t = entry.turn;
    const endMs = entry.endGameMs ?? t.endMs;
    const pre: InputLogEntry[] = [];
    for (; i < ordered.length && ordered[i]!.gameMs <= t.startMs; i++) {
      if (ordered[i] !== entry) pre.push(ordered[i]!);
    }
    const before = replayFrom(state, header.gameId, pre, input.registry, t.startMs).state;
    // Up to the turn's end, but not into the next turn: it is logged at this turn's end, its start.
    const post: InputLogEntry[] = [entry];
    for (; i < ordered.length && ordered[i]!.gameMs <= endMs; i++) {
      const next = ordered[i]!;
      if (next === entry) continue;
      if (isTurn(next)) break;
      post.push(next);
    }
    const r = replayFrom(before, header.gameId, post, input.registry, endMs);
    state = r.state;
    out.push({ entry, turn: t, before, after: r.state, emitted: r.emitted });
  }
  return out;
}

/** What the Turn panel shows of one turn. */
export interface AdminTurn {
  n: number;
  /** Seq of the `resolveTurn` entry. */
  seq: number;
  startMs: number;
  endMs: number;
  /** Where game time stood once the turn was applied: `endMs`, or the outcome's time if earlier. */
  endedAtMs: number;
  cause: TurnCause;
  /** `umpire`, `engine` (the rigid rules, or the fallback) or `none`. */
  adjudicator: string;
  /** The turn could not be applied (live and in replay); its output was skipped. */
  error?: string;
  /** The sides that sent, in send order. */
  sent: string[];
  /** Every side's sent orders. */
  orders: SentTurnOrder[];
  /** Orders a side still held, unsent, when the turn closed at its deadline. */
  unsent: Record<string, TurnOrder[]>;
  /** The orders as the rules read them (the projection's and the engine's reading). */
  read?: RulesOrder[];
  couriers?: TurnCourier[];
  /** The engine's projection summary, as the umpire was shown it. */
  projection?: ProjectionSummary;
  /** Every model call of the turn (adjudicate, roll answer, resend), with input and raw output. */
  calls: UmpireCallRecord[];
  /**
   * Each side's turn reports (11.9): the report call(s) and the notes that replaced the template
   * text, from the turn's `turnReports` entries. Empty for a turn the tables decided.
   */
  reports: TurnReportsRecord[];
  /** The umpire's final proposal, raw. */
  proposal?: TurnProposal;
  /** The problems sent back with the one resend. */
  resent?: string[];
  /** The rolls the engine made on the umpire's dice. */
  rolls?: TurnRoll[];
  /** Roll requests the engine refused, as the umpire was told. */
  refusedRolls?: string[];
  /** Every correction of the proposal, each with the limit it broke. */
  rulings: TurnRuling[];
  /** How many units' outcomes were clamped (the fallback threshold counts these). */
  clampedUnits?: number;
  /** The umpire failed and the engine resolved the turn. */
  fallback?: { error: string; attempts: number };
  /** The umpire's journal after the turn (absent until the first umpire turn). */
  journal?: UmpireJournal;
}

export interface AdminTurns {
  /** `turns` for a turn-mode game; a real-time game has no turns. */
  mode: 'turns' | 'realtime';
  turns: AdminTurn[];
  /** The turn open now, with each side's held orders. */
  open?: {
    n: number;
    startMs: number;
    endMs: number;
    held: Record<string, TurnOrder[]>;
    sent: string[];
  };
}

/** Each side's held orders for turn `n` when it closed, from the journal entries. */
function heldOf(entries: readonly InputLogEntry[], n: number): Map<string, TurnOrder[]> {
  const t: OpenTurn = {
    n,
    startMs: 0,
    endMs: 0,
    held: new Map(),
    sent: new Map(),
    resolving: false,
  };
  for (const e of entries) {
    const c = e.command;
    if (e.error || !('turn' in c) || c.turn !== n) continue;
    try {
      if (c.kind === 'turnOrder') holdOrder(t, c.side, c.order);
      else if (c.kind === 'withdrawTurnOrder') withdrawOrder(t, c.side, c.orderId);
    } catch {
      // The live game accepted it, so it fits; nothing to show if not.
    }
  }
  return t.held;
}

/** One side's turn reports as logged (11.9). */
export interface TurnReportsRecord {
  side: string;
  calls: UmpireCallRecord[];
  narrated: Array<{ reportId: string; text: string }>;
  error?: string;
}

/** The `turnReports` entries of turn `n`, one per side. */
function reportsOf(entries: readonly InputLogEntry[], n: number): TurnReportsRecord[] {
  return entries.flatMap((e) => {
    const c = e.command;
    if (c.kind !== 'turnReports' || c.turn !== n) return [];
    return [
      {
        side: c.side,
        calls: e.calls ?? [],
        narrated: e.narrated ?? [],
        ...(e.error ? { error: e.error } : {}),
      },
    ];
  });
}

const isUmpireOutput = (o: unknown): o is UmpireTurnOutput =>
  typeof o === 'object' && o !== null && 'proposal' in o && 'context' in o;

/** The Turn panel's data for a stored game: every resolved turn and the one open now. */
export function adminTurns(input: ReplayInput): AdminTurns {
  const mode = input.header.settings?.mode === 'turns' ? 'turns' : 'realtime';
  const turns = replayTurns(input).map((r): AdminTurn => {
    const { entry, turn: t } = r;
    const out = t.output as Partial<UmpireTurnOutput> | undefined;
    const umpire = isUmpireOutput(out) ? out : undefined;
    const held = heldOf(input.entries, t.n);
    const unsent: Record<string, TurnOrder[]> = {};
    for (const [side, orders] of held) {
      if (!t.sent.includes(side) && orders.length > 0) unsent[side] = orders;
    }
    const event = r.emitted.find(
      (e) => e.type === 'umpire.turn' && (e.payload as { turn?: number } | undefined)?.turn === t.n,
    );
    const clamped = (event?.payload as { clamped?: number } | undefined)?.clamped;
    const rulings = r.after.world.rulings.filter(
      (x): x is TurnRuling => 'kind' in x && x.kind === 'turn' && x.turn === t.n,
    );
    return {
      n: t.n,
      seq: entry.seq,
      startMs: t.startMs,
      endMs: t.endMs,
      endedAtMs: entry.endGameMs ?? t.endMs,
      cause: t.cause,
      adjudicator: t.adjudicator,
      ...(entry.error ? { error: entry.error } : {}),
      sent: t.sent,
      orders: t.orders,
      unsent,
      ...(Array.isArray(out?.orders) ? { read: out.orders } : {}),
      ...(Array.isArray(out?.couriers) ? { couriers: out.couriers } : {}),
      ...(out?.projection ? { projection: out.projection } : {}),
      calls: entry.calls ?? [],
      reports: reportsOf(input.entries, t.n),
      ...(umpire ? { proposal: umpire.proposal as unknown as TurnProposal } : {}),
      ...(umpire?.resent ? { resent: umpire.resent } : {}),
      ...(umpire?.context.rolls?.length ? { rolls: umpire.context.rolls } : {}),
      ...(umpire?.refusedRolls?.length ? { refusedRolls: umpire.refusedRolls } : {}),
      rulings,
      ...(typeof clamped === 'number' ? { clampedUnits: clamped } : {}),
      ...(t.fallback ? { fallback: t.fallback } : {}),
      ...(r.after.world.journal ? { journal: r.after.world.journal } : {}),
    };
  });
  const open = openTurnFromLog(input.entries);
  return {
    mode,
    turns,
    ...(open
      ? {
          open: {
            n: open.n,
            startMs: open.startMs,
            endMs: open.endMs,
            held: Object.fromEntries(open.held),
            sent: [...open.sent.keys()],
          },
        }
      : {}),
  };
}
