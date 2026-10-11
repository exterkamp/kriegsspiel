import type { Dispatch } from '@kriegsspiel/protocol';

export type Pile = Dispatch['category'];

/** Pile order on the desk, urgent first. */
export const PILES: readonly { id: Pile; label: string }[] = [
  { id: 'urgent', label: 'Urgent' },
  { id: 'scouts', label: 'Scouts' },
  { id: 'subordinates', label: 'Subordinates' },
  { id: 'staff', label: 'Staff' },
  { id: 'intelligence', label: 'Intelligence' },
  { id: 'rumour', label: 'Rumour' },
];

/** What the player has done with dispatches. Local to this client, like `read`. */
export interface TrayMarks {
  read: ReadonlySet<string>;
  filed: ReadonlySet<string>;
  discarded: ReadonlySet<string>;
}

export interface PileView {
  id: Pile;
  label: string;
  /** Unfiled, undiscarded dispatches, newest arrival first. */
  items: Dispatch[];
  unread: number;
}

/** Newest arrival first; ties fall back to written time, then id so the order is stable. */
export function byArrival(a: Dispatch, b: Dispatch): number {
  return (
    b.receivedAtGame - a.receivedAtGame ||
    b.writtenAtGame - a.writtenAtGame ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** One pass over the dispatches: the six piles, the filed drawer, and the total unread count. */
export function sortTray(
  dispatches: readonly Dispatch[],
  marks: TrayMarks,
): { piles: PileView[]; filed: Dispatch[]; unread: number } {
  const piles = new Map<Pile, PileView>(PILES.map((p) => [p.id, { ...p, items: [], unread: 0 }]));
  const filed: Dispatch[] = [];
  let unread = 0;
  for (const d of [...dispatches].sort(byArrival)) {
    if (marks.discarded.has(d.id)) continue;
    if (marks.filed.has(d.id)) {
      filed.push(d);
      continue;
    }
    const pile = piles.get(d.category)!;
    pile.items.push(d);
    if (!marks.read.has(d.id)) {
      pile.unread++;
      unread++;
    }
  }
  return { piles: [...piles.values()], filed, unread };
}

/** Dispatches still on the desk (not discarded) that are unread; filed papers count too. */
export function unreadCount(dispatches: readonly Dispatch[], marks: TrayMarks): number {
  let n = 0;
  for (const d of dispatches) if (!marks.read.has(d.id) && !marks.discarded.has(d.id)) n++;
  return n;
}

const PREFIX = 'kriegsspiel.tray.';

interface Stored {
  read: string[];
  filed: string[];
  discarded: string[];
}

export const emptyMarks = (): TrayMarks => ({
  read: new Set(),
  filed: new Set(),
  discarded: new Set(),
});

type Store = Pick<Storage, 'getItem' | 'setItem'>;

const strings = (v: unknown): Set<string> =>
  new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Marks saved for this game, or empty when there are none or storage is unavailable or damaged. */
export function loadMarks(key: string, store: Store | undefined = safeStorage()): TrayMarks {
  try {
    const raw = store?.getItem(PREFIX + key);
    if (!raw) return emptyMarks();
    const o = JSON.parse(raw) as Partial<Stored>;
    return { read: strings(o.read), filed: strings(o.filed), discarded: strings(o.discarded) };
  } catch {
    return emptyMarks();
  }
}

export function saveMarks(
  key: string,
  marks: TrayMarks,
  store: Store | undefined = safeStorage(),
): void {
  try {
    const out: Stored = {
      read: [...marks.read],
      filed: [...marks.filed],
      discarded: [...marks.discarded],
    };
    store?.setItem(PREFIX + key, JSON.stringify(out));
  } catch {
    // Private mode or a full quota: the marks last for this session only.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
