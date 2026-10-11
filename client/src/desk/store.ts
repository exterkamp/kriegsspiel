import { derived, get, writable } from 'svelte/store';
import type { ClockState, Coord, Dispatch } from '@kriegsspiel/protocol';
import { gameNowMs, initialState, withRead, type ClientState } from '../net/state.js';
import { emptyDraft, loadDraft, saveDraft, type Courier, type OrderDraft } from './orders.js';
import {
  addEntries,
  clockEntry,
  dispatchEntry,
  loadJournal,
  noteEntry,
  orderEntry,
  removeEntry,
  saveJournal,
  type JournalEntry,
} from './journal.js';
import { loadMarks, saveMarks, type TrayMarks } from './tray.js';
import type { ViewId } from './views.js';

/** The shared app store: both the Three.js table and the Svelte desk read from and write to these. */
export const gameState = writable<ClientState>(initialState);
export const activeView = writable<ViewId>('table');

/** What the pause panel can ask of the server; each returns false when the link is down. Set once connected. */
export interface PauseActions {
  proposePause(reason?: string): boolean;
  proposeResume(): boolean;
  vote(proposal: string, yes: boolean): boolean;
}
export const pauseActions = writable<PauseActions | undefined>(undefined);

/** Dispatches the player has filed (kept in the drawer) or discarded (gone from the desk). */
export const trayFiled = writable<ReadonlySet<string>>(new Set());
export const trayDiscarded = writable<ReadonlySet<string>>(new Set());

/** The dispatch the in-tray viewer is showing, so the table's Plot report can pin it. */
export const viewedDispatch = writable<Dispatch | undefined>(undefined);

/** Set by the desk to ask the table to show a place; the table clears it once it has panned. */
export const showOnTable = writable<Coord | undefined>(undefined);

export const trayMarks = derived(
  [gameState, trayFiled, trayDiscarded],
  ([$g, filed, discarded]): TrayMarks => ({ read: $g.read, filed, discarded }),
);

export function markRead(id: string): void {
  gameState.update((s) => withRead(s, id));
}

function toggle(store: typeof trayFiled, id: string, on: boolean): void {
  store.update((set) => {
    if (set.has(id) === on) return set;
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  });
}

export const setFiled = (id: string, on: boolean): void => toggle(trayFiled, id, on);
export const discard = (id: string): void => {
  toggle(trayDiscarded, id, true);
  toggle(trayFiled, id, false);
};

/**
 * Load this game's saved marks into the stores and save them on every change after that.
 * Returns a function that stops saving.
 */
export function persistTray(key: string): () => void {
  const saved = loadMarks(key);
  gameState.update((s) => ({ ...s, read: new Set([...s.read, ...saved.read]) }));
  trayFiled.set(saved.filed);
  trayDiscarded.set(saved.discarded);
  let last: TrayMarks | undefined;
  return trayMarks.subscribe((m) => {
    // gameState changes on every server message; only write when a mark set actually changed.
    if (last && last.read === m.read && last.filed === m.filed && last.discarded === m.discarded)
      return;
    last = m;
    saveMarks(key, m);
  });
}

export const currentMarks = (): TrayMarks => get(trayMarks);

/** The order form on the orders desk. Saved per game as it is written. */
export const orderDraft = writable<OrderDraft>(emptyDraft());

/**
 * What the orders desk needs to sign an order: set by the page once it has a connection.
 * `text` is the finished wording (addressee and annex included); `eta` is the staff's estimate in game ms.
 * Returns an error to show on the form, or undefined when the order has gone.
 */
export interface OrderSender {
  send(o: {
    text: string;
    toName: string;
    courier: Courier;
    eta: number | undefined;
  }): string | undefined;
}
export const orderSender = writable<OrderSender | undefined>(undefined);

/** Load this game's saved draft and save it on every change after that. Returns a function that stops. */
export function persistDraft(key: string): () => void {
  orderDraft.set(loadDraft(key));
  return orderDraft.subscribe((d) => saveDraft(key, d));
}

/** The war diary: orders sent, dispatches received, pauses and the player's notes, kept per game. */
export const journal = writable<JournalEntry[]>([]);

/** Write a note into the diary at the current game time. */
export function addNote(text: string, wallMs = Date.now()): void {
  const t = text.trim();
  if (t === '') return;
  const s = get(gameState);
  const at = s.clock ? gameNowMs(s.clock, wallMs) : 0;
  journal.update((j) => addEntries(j, [noteEntry(`${wallMs}:${j.length}`, at, t)]));
}

/**
 * Load this game's diary, then record what happens in the game from now on and save on every change.
 * Returns a function that stops.
 */
export function persistJournal(key: string): () => void {
  journal.set(loadJournal(key));
  let prevStatus: ClockState['status'] | undefined;
  let prevOrders: ReadonlySet<string> = new Set();
  const stopGame = gameState.subscribe((s) => {
    const found: JournalEntry[] = [
      ...s.pending.map(orderEntry),
      ...s.dispatches.map(dispatchEntry),
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
    journal.update((j) =>
      dropped.reduce((acc, id) => removeEntry(acc, `order:${id}`), addEntries(j, found)),
    );
  });
  let first = true;
  const stopSave = journal.subscribe((j) => {
    if (first) {
      first = false;
      return;
    }
    saveJournal(key, j);
  });
  return () => {
    stopGame();
    stopSave();
  };
}
