import { refusalText } from './orders.js';
import type { ClockState, Dispatch } from '@kriegsspiel/protocol';
import { formatGameTime, type OrderOutcome, type PendingOrder } from '../net/state.js';

export type JournalKind = 'order' | 'dispatch' | 'pause' | 'note' | 'turn';

export const JOURNAL_KINDS: readonly { id: JournalKind; label: string }[] = [
  { id: 'order', label: 'Orders' },
  { id: 'dispatch', label: 'Dispatches' },
  { id: 'pause', label: 'Pauses' },
  { id: 'note', label: 'Notes' },
];

/** The filter for turn headings, offered only in a turn-mode game (D39). */
export const TURN_KIND: { id: JournalKind; label: string } = { id: 'turn', label: 'Turns' };

/** One line of the war diary. `at` is game ms; `id` is stable so a line is never recorded twice. */
export interface JournalEntry {
  id: string;
  kind: JournalKind;
  at: number;
  text: string;
}

export const orderEntry = (p: PendingOrder): JournalEntry => {
  const to = p.toName ? ` to ${p.toName}` : '';
  const how = p.courier ? ` by ${p.courier === 'fast' ? 'fast rider' : 'steady courier'}` : '';
  return {
    id: `order:${p.orderId}`,
    kind: 'order',
    at: p.sentAtGame,
    text: `Order sent${to}${how}: ${p.text}`,
  };
};

/** What became of an order the staff could not carry out. */
export const refusedEntry = (id: string, o: OrderOutcome, at: number): JournalEntry => ({
  id: `outcome:${id}`,
  kind: 'order',
  at,
  text: refusalText(o),
});

/** Word came back from the addressee, so the order arrived. */
export const arrivedEntry = (p: PendingOrder, d: Dispatch): JournalEntry => ({
  id: `outcome:${p.orderId}`,
  kind: 'order',
  at: d.receivedAtGame,
  text: `Order to ${p.toName} arrived: word came back at ${formatGameTime(d.receivedAtGame)}.`,
});

/** The staff gave the order's courier up for lost. */
export const lostEntry = (p: PendingOrder, d: Dispatch): JournalEntry => ({
  id: `outcome:${p.orderId}`,
  kind: 'order',
  at: d.receivedAtGame,
  text: `Order to ${p.toName} lost: the courier was given up at ${formatGameTime(d.receivedAtGame)}.`,
});

export const dispatchEntry = (d: Dispatch): JournalEntry => ({
  id: `dispatch:${d.id}`,
  kind: 'dispatch',
  at: d.receivedAtGame,
  text: `${d.from}: ${d.text}`,
});

/** A pause or resume the player saw, from a change in the clock's status; undefined when nothing to record. */
export function clockEntry(
  prev: ClockState['status'] | undefined,
  next: ClockState['status'],
  gameMs: number,
): JournalEntry | undefined {
  if (prev === undefined || prev === next) return undefined;
  const text =
    next === 'paused' ? 'Game paused.' : next === 'stopped' ? 'Game stopped.' : 'Game resumed.';
  return { id: `pause:${next}:${Math.round(gameMs)}:${prev}`, kind: 'pause', at: gameMs, text };
}

export const noteEntry = (id: string, at: number, text: string): JournalEntry => ({
  id: `note:${id}`,
  kind: 'note',
  at,
  text,
});

/** Add entries whose ids are new; the diary only ever grows, so the saved list is returned if nothing is new. */
export function addEntries(
  have: readonly JournalEntry[],
  more: readonly JournalEntry[],
): JournalEntry[] {
  const ids = new Set(have.map((e) => e.id));
  const fresh: JournalEntry[] = [];
  for (const e of more)
    if (!ids.has(e.id)) {
      ids.add(e.id);
      fresh.push(e);
    }
  return fresh.length === 0 ? (have as JournalEntry[]) : [...have, ...fresh];
}

export const removeEntry = (have: readonly JournalEntry[], id: string): JournalEntry[] =>
  have.some((e) => e.id === id) ? have.filter((e) => e.id !== id) : (have as JournalEntry[]);

/** Newest first; ties keep the order they were recorded in. */
export const chronological = (entries: readonly JournalEntry[]): JournalEntry[] =>
  entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => b.e.at - a.e.at || b.i - a.i)
    .map((x) => x.e);

export interface JournalFilter {
  query: string;
  /** Kinds to show; empty shows all of them. */
  kinds: ReadonlySet<JournalKind>;
}

export function filterEntries(entries: readonly JournalEntry[], f: JournalFilter): JournalEntry[] {
  const q = f.query.trim().toLowerCase();
  return entries.filter(
    (e) =>
      (f.kinds.size === 0 || f.kinds.has(e.kind)) &&
      (q === '' ||
        e.text.toLowerCase().includes(q) ||
        formatGameTime(e.at).toLowerCase().includes(q)),
  );
}

const LABEL: Record<JournalKind, string> = {
  order: 'ORDER',
  dispatch: 'DISPATCH',
  pause: 'PAUSE',
  note: 'NOTE',
  turn: 'TURN',
};

/** The diary as plain text, oldest first, one entry per paragraph. */
export function exportText(entries: readonly JournalEntry[], title = 'War diary'): string {
  const lines = [...chronological(entries)]
    .reverse()
    .map((e) => `[${formatGameTime(e.at)}] ${LABEL[e.kind]}: ${e.text}`);
  return `${title}\n${'='.repeat(title.length)}\n\n${lines.join('\n\n')}${lines.length ? '\n' : ''}`;
}

const key = (game: string): string => `kriegsspiel.journal.${game}`;

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

const KINDS = new Set<string>([...JOURNAL_KINDS, TURN_KIND].map((k) => k.id));

/** The saved diary for this game, or empty when there is none or storage is unavailable or damaged. */
export function loadJournal(game: string): JournalEntry[] {
  try {
    const raw = safeStorage()?.getItem(key(game));
    const o: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(o)) return [];
    return addEntries(
      [],
      o.filter(
        (e): e is JournalEntry =>
          typeof e === 'object' &&
          e !== null &&
          typeof e.id === 'string' &&
          KINDS.has(e.kind) &&
          typeof e.at === 'number' &&
          Number.isFinite(e.at) &&
          typeof e.text === 'string',
      ),
    );
  } catch {
    return [];
  }
}

export function saveJournal(game: string, entries: readonly JournalEntry[]): void {
  try {
    safeStorage()?.setItem(key(game), JSON.stringify(entries));
  } catch {
    // Private mode or a full quota: the diary lasts for this session only.
  }
}
