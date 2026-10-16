import type { Dispatch } from '@kriegsspiel/protocol';
import { isSummary, sightings, turnOfPaper } from './turnReport.js';

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

/** One row of a turn's papers: a paper, or several merged sightings of the same enemy (newest last). */
export interface TrayRow {
  /** The paper the row opens: the newest of a merged sighting. */
  d: Dispatch;
  /** Every paper in the row, in written order; one unless sightings were merged. */
  papers: Dispatch[];
}

/** One turn's papers on a pile, for a turn-mode game (D39). */
export interface TurnGroup {
  turn: number;
  rows: TrayRow[];
}

/**
 * A pile's papers in a turn-mode game, grouped under the turn they came in with, newest turn first (#439). Within
 * a turn the staff's summary comes first, then the papers in the order they were written, with repeated
 * sightings of one enemy (same strength, same place) merged into one row, and the umpire's ruling or notice last.
 * An umpire turn's papers (11.9) are all handed in at its end, so they come with that turn.
 */
export function byTurn(items: readonly Dispatch[], turnMs: number): TurnGroup[] {
  const turns = new Map<number, Dispatch[]>();
  for (const d of items) {
    const n = turnOfPaper(d.receivedAtGame, turnMs);
    turns.set(n, [...(turns.get(n) ?? []), d]);
  }
  return [...turns]
    .sort(([a], [b]) => b - a)
    .map(([turn, papers]) => {
      const merged = sightings(papers).filter((s) => s.papers.length > 1);
      const inMerge = new Map(merged.flatMap((s) => s.papers.map((d) => [d.id, s] as const)));
      const rows: TrayRow[] = [];
      for (const d of [...papers].sort(
        (a, b) => a.writtenAtGame - b.writtenAtGame || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )) {
        const s = inMerge.get(d.id);
        if (!s) rows.push({ d, papers: [d] });
        // A merged sighting stands where it was first seen, and opens on its newest paper.
        else if (s.papers[0] === d) rows.push({ d: s.papers.at(-1)!, papers: s.papers });
      }
      // The staff's summary first; the umpire's ruling and notices (11.9) last, as the server sends them (#438).
      const first = rows.filter((r) => isSummary(r.d));
      const last = rows.filter((r) => r.d.kind === 'battle' || r.d.kind === 'notice');
      const middle = rows.filter((r) => !first.includes(r) && !last.includes(r));
      return { turn, rows: [...first, ...middle, ...last] };
    });
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
