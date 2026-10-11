import { Injectable, Injector, computed, effect, inject, signal, untracked, type EffectRef } from '@angular/core';
import type { Coord, Dispatch, WindowAt } from '@kriegsspiel/protocol';
import type { ClockState } from '@kriegsspiel/protocol';
import type { BeliefChoice } from '@legacy/window/model';
import { gameNowMs } from '@legacy/net/state';
import { deliveredBy, emptyDraft, loadDraft, saveDraft, type OrderDraft } from '@legacy/desk/orders';
import {
  addEntries,
  arrivedEntry,
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

  /** The staff conference: where answers come from (the fixture until the server endpoint exists) and what has been asked. */
  readonly conferenceClient = signal<ConferenceClient>(fixtureClient);
  readonly conferenceLog = signal<readonly Exchange[]>([]);

  /** The war diary: orders sent, dispatches received, pauses and the player's notes. */
  readonly journal = signal<JournalEntry[]>([]);

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
      if (last && last.read === m.read && last.filed === m.filed && last.discarded === m.discarded) return;
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
    let prevStatus: ClockState['status'] | undefined;
    let prevOrders: ReadonlySet<string> = new Set();
    const stopGame = this.run(() => {
      const s = this.game.state();
      untracked(() => {
        const found: JournalEntry[] = [
          ...s.pending.map(orderEntry),
          ...s.dispatches.map(dispatchEntry),
          ...Object.entries(s.outcomes).map(([id, o]) =>
            refusedEntry(id, o, s.clock ? s.clock.gameMs : o.sentAtGame),
          ),
          ...s.pending.flatMap((p) => {
            const d = deliveredBy(p, s.dispatches);
            return d ? [arrivedEntry(p, d)] : [];
          }),
        ];
        if (s.clock) {
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

  private run(fn: () => void): () => void {
    const ref: EffectRef = effect(fn, { injector: this.injector });
    return () => ref.destroy();
  }
}

function toggle(s: { update(f: (v: ReadonlySet<string>) => ReadonlySet<string>): void }, id: string, on: boolean): void {
  s.update((set) => {
    if (set.has(id) === on) return set;
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  });
}
