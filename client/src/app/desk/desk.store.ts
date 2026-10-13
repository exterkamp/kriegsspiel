import {
  Injectable,
  Injector,
  computed,
  effect,
  inject,
  signal,
  untracked,
  type EffectRef,
} from '@angular/core';
import type { Coord, Dispatch, WindowAt } from '@kriegsspiel/protocol';
import type { ClockState } from '@kriegsspiel/protocol';
import type { BeliefChoice } from '@legacy/window/model';
import { gameNowMs } from '@legacy/net/state';
import {
  orderOutcomes,
  emptyDraft,
  loadDraft,
  saveDraft,
  type OrderDraft,
} from '@legacy/desk/orders';
import {
  addEntries,
  arrivedEntry,
  lostEntry,
  clockEntry,
  dispatchEntry,
  loadJournal,
  noteEntry,
  orderEntry,
  refusedEntry,
  removeEntry,
  saveJournal,
  type JournalEntry,
} from '@legacy/desk/journal';
import { loadMarks, saveMarks, type TrayMarks } from '@legacy/desk/tray';
import { turnEntry, turnPhase } from '@legacy/desk/turn';
import {
  loadTurnRecord,
  papersOfTurn,
  saveTurnRecord,
  snapUnits,
  summaryId,
  turnFights,
  turnOfPaper,
  turnSummary,
  type TurnRecord,
} from '@legacy/desk/turnReport';
import type { ViewId } from '@legacy/desk/views';
import { fixtureClient, type ConferenceClient, type Exchange } from '@legacy/desk/conference';
import { GameService } from '../game/game.service';

/**
 * The desk's own state, as signals: the open view, the in-tray marks, the order draft, the war diary, the staff
 * conference and the umpire's window. Replaces the Svelte stores in `desk/store.ts`. The `persist*` methods tie
 * one piece to localStorage under a game key and return a function that stops.
 */
@Injectable({ providedIn: 'root' })
export class DeskStore {
  private readonly game = inject(GameService);
  private readonly injector = inject(Injector);

  readonly activeView = signal<ViewId>('table');
  /** Dispatches the player has filed (kept in the drawer) or discarded (gone from the desk). */
  readonly trayFiled = signal<ReadonlySet<string>>(new Set());
  readonly trayDiscarded = signal<ReadonlySet<string>>(new Set());
  /** The dispatch the in-tray viewer is showing, so the table's Plot report can pin it. */
  readonly viewedDispatch = signal<Dispatch | undefined>(undefined);
  /** Set by the desk to ask the table to show a place; the table clears it once it has panned. */
  readonly showOnTable = signal<Coord | undefined>(undefined);
  readonly trayMarks = computed<TrayMarks>(() => ({
    read: this.game.state().read,
    filed: this.trayFiled(),
    discarded: this.trayDiscarded(),
  }));

  /** Umpire's window (after the game). */
  readonly windowOpen = signal(false);
  readonly windowFrame = signal<WindowAt | undefined>(undefined);
  readonly windowBelief = signal<BeliefChoice>('none');
  readonly windowHover = signal<string | undefined>(undefined);

  /** The order form on the orders desk. */
  readonly orderDraft = signal<OrderDraft>(emptyDraft());
  /** Turn mode: the held order being rewritten in the order box, so holding it replaces it. */
  readonly editingTurnOrder = signal<string | undefined>(undefined);

  /** The staff conference: where answers come from (the fixture until the server endpoint exists) and what has been asked. */
  readonly conferenceClient = signal<ConferenceClient>(fixtureClient);
  readonly conferenceLog = signal<readonly Exchange[]>([]);

  /** The war diary: orders sent, dispatches received, pauses and the player's notes. */
  readonly journal = signal<JournalEntry[]>([]);

  /**
   * Turn mode (#439): the side's units as each turn opened, and the staff's summary of each decided turn, kept
   * for the game in localStorage so a reload keeps both.
   */
  readonly turnRecord = signal<TurnRecord>({ starts: {}, summaries: [] });
  /** Turn mode: game ms per turn, from the game's settings or the open turn; undefined in real time. */
  readonly turnMs = computed(() => {
    const s = this.game.state();
    if (!s.turnMode) return undefined;
    if (s.turnMinutes) return s.turnMinutes * 60_000;
    return s.turn ? s.turn.endsAt - s.turn.startsAt : undefined;
  });
  /** Every paper on the desk: the server's, and in a turn-mode game the staff's turn summaries (#439). */
  readonly papers = computed<readonly Dispatch[]>(() => {
    const own = this.game.state().dispatches;
    const summaries = this.turnRecord().summaries;
    return summaries.length === 0 ? own : [...summaries, ...own];
  });
  /** Turn mode: the latest decided turn and its papers, for the unit status and the table's fight markers. */
  readonly lastTurn = computed(() => {
    const ms = this.turnMs();
    const s = this.game.state();
    if (!ms) return undefined;
    const n = s.gameOver ? turnOfPaper(s.gameOver.atGame, ms) : (s.turn?.turn ?? 1) - 1;
    return n < 1 ? undefined : { turn: n, papers: papersOfTurn(s.dispatches, n, ms) };
  });
  /** Turn mode on the table (#439): the open turn's orders, and where the last turn's papers reported fighting. */
  readonly turnTable = computed(() => {
    const s = this.game.state();
    if (!s.turnMode) return undefined;
    const last = this.lastTurn();
    return { held: s.turn?.held ?? [], fights: last ? turnFights(last.papers, last.turn) : [] };
  });

  /** Which turn the side is writing, if any: a held order being rewritten belongs to that turn alone. */
  private readonly writingTurn = computed(() => {
    const s = this.game.state();
    return turnPhase(s) === 'writing' ? s.turn?.turn : undefined;
  });

  constructor() {
    // Once the side stops writing the turn (it sent, the deadline passed, or the next turn opened), the order being
    // rewritten is no longer the one a hold would replace. The words stay in the box; holding them makes a new order.
    let writing: number | undefined | null = null;
    effect(() => {
      const t = this.writingTurn();
      untracked(() => {
        // The first run only notes the turn; nothing has moved on yet.
        if (writing !== null && (t === undefined || t !== writing))
          this.editingTurnOrder.set(undefined);
        writing = t;
      });
    });
  }

  setFiled(id: string, on: boolean): void {
    toggle(this.trayFiled, id, on);
  }

  discard(id: string): void {
    toggle(this.trayDiscarded, id, true);
    toggle(this.trayFiled, id, false);
  }

  /** Write a note into the diary at the current game time. */
  addNote(text: string, wallMs = Date.now()): void {
    const t = text.trim();
    if (t === '') return;
    const clock = this.game.state().clock;
    const at = clock ? gameNowMs(clock, wallMs) : 0;
    this.journal.update((j) => addEntries(j, [noteEntry(`${wallMs}:${j.length}`, at, t)]));
  }

  /** Load this game's saved marks, then save on every change after that. */
  persistTray(key: string): () => void {
    const saved = loadMarks(key);
    this.game.mergeRead(saved.read);
    this.trayFiled.set(saved.filed);
    this.trayDiscarded.set(saved.discarded);
    let last: TrayMarks | undefined;
    return this.run(() => {
      const m = this.trayMarks();
      // The game state changes on every server message; only write when a mark set actually changed.
      if (last && last.read === m.read && last.filed === m.filed && last.discarded === m.discarded)
        return;
      last = m;
      untracked(() => saveMarks(key, m));
    });
  }

  /** Load this game's saved order draft, then save on every change after that. */
  persistDraft(key: string): () => void {
    this.orderDraft.set(loadDraft(key));
    return this.run(() => {
      const d = this.orderDraft();
      untracked(() => saveDraft(key, d));
    });
  }

  /** Load this game's diary, then record what happens in the game from now on and save on every change. */
  persistJournal(key: string): () => void {
    this.journal.set(loadJournal(key));
    // An effect runs once per tick, so game states applied within one tick are folded into one: a pause then resume
    // (or an order added then refused) inside a single tick leaves no entry. Each server message is its own task, so
    // this is rare; the Svelte `subscribe` saw every state.
    let prevStatus: ClockState['status'] | undefined;
    let prevOrders: ReadonlySet<string> = new Set();
    const stopGame = this.run(() => {
      const s = this.game.state();
      untracked(() => {
        const outcomes = orderOutcomes(s.pending, s.dispatches);
        const found: JournalEntry[] = [
          ...s.pending.map(orderEntry),
          ...s.dispatches.map(dispatchEntry),
          ...Object.entries(s.outcomes).map(([id, o]) =>
            refusedEntry(id, o, s.clock ? s.clock.gameMs : o.sentAtGame),
          ),
          ...s.pending.flatMap((p) => {
            const o = outcomes.get(p.orderId);
            return !o ? [] : 'lost' in o ? [lostEntry(p, o.lost)] : [arrivedEntry(p, o.arrived)];
          }),
        ];
        // A turn-mode game's clock never runs (D39): each turn's heading stands in for pauses and resumes.
        if (s.turn) found.push(turnEntry(s.turn));
        if (s.clock && !s.turnMode) {
          const c = clockEntry(prevStatus, s.clock.status, s.clock.gameMs);
          if (c) found.push(c);
          prevStatus = s.clock.status;
        }
        // An order the server turned down was never sent, so it leaves the diary.
        const now = new Set(s.pending.map((p) => p.orderId));
        const dropped = [...prevOrders].filter((id) => !now.has(id));
        prevOrders = now;
        this.journal.update((j) =>
          dropped.reduce((acc, id) => removeEntry(acc, `order:${id}`), addEntries(j, found)),
        );
      });
    });
    let first = true;
    const stopSave = this.run(() => {
      const j = this.journal();
      // The first run sees what was just loaded (plus anything recorded at once); saving starts with the next change.
      if (first) {
        first = false;
        return;
      }
      untracked(() => saveJournal(key, j));
    });
    return () => {
      stopGame();
      stopSave();
    };
  }

  /**
   * Turn mode (#439): note the side's units as each turn opens, and file the staff's summary of a turn once it is
   * decided (the view stands at its end and the next turn has opened, or the game is over). Loads what was saved
   * for this game and saves on every change.
   */
  persistTurns(key: string): () => void {
    this.turnRecord.set(loadTurnRecord(key));
    let first = true;
    const stopRecord = this.run(() => {
      const s = this.game.state();
      const ms = this.turnMs();
      untracked(() => {
        const view = s.view;
        if (!ms || !view) return;
        const rec = this.turnRecord();
        let next = rec;
        const t = s.turn;
        if (t && !t.resolving && view.atGame === t.startsAt && !rec.starts[t.turn]) {
          next = { ...next, starts: { ...next.starts, [t.turn]: snapUnits(view) } };
        }
        const decided = this.lastTurn()?.turn ?? 0;
        const have = new Set(next.summaries.map((d) => d.id));
        const fresh: Dispatch[] = [];
        for (let n = 1; n <= decided; n++) {
          if (have.has(summaryId(n))) continue;
          const startsAt = (n - 1) * ms;
          const endsAt = n === decided && s.gameOver ? s.gameOver.atGame : n * ms;
          // Only the turn just decided has the view at its end; an older one (a reload) is told from its papers.
          const atEnd = view.atGame === endsAt || (n === decided && !!s.gameOver);
          if (n === decided && !atEnd) continue;
          const before = atEnd ? next.starts[n] : undefined;
          fresh.push(
            turnSummary({
              turn: n,
              startsAt,
              endsAt,
              view: atEnd ? view : { ownUnits: [] },
              ...(before ? { before } : {}),
              papers: papersOfTurn(s.dispatches, n, ms),
            }),
          );
        }
        if (fresh.length) next = { ...next, summaries: [...next.summaries, ...fresh] };
        if (next !== rec) this.turnRecord.set(next);
      });
    });
    const stopSave = this.run(() => {
      const r = this.turnRecord();
      if (first) {
        first = false;
        return;
      }
      untracked(() => saveTurnRecord(key, r));
    });
    return () => {
      stopRecord();
      stopSave();
    };
  }

  private run(fn: () => void): () => void {
    const ref: EffectRef = effect(fn, { injector: this.injector });
    return () => ref.destroy();
  }
}

function toggle(
  s: { update(f: (v: ReadonlySet<string>) => ReadonlySet<string>): void },
  id: string,
  on: boolean,
): void {
  s.update((set) => {
    if (set.has(id) === on) return set;
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  });
}
