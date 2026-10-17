/**
 * The umpire's journal (D39, story 11.8): what the umpire of a turn-mode game remembers from one
 * turn to the next. Each `adjudicate` call is otherwise stateless: the world says where the units
 * stand, but not why the umpire ruled as it did. The journal keeps, in the world, a condensed note
 * of each umpire turn (from the proposal's private `summary`) and the precedents the umpire set
 * ("cavalry cannot cross the river except at the bridge"), and the next turn's call is given it.
 *
 * It is master state: the umpire's own. `viewFor` never reads it, so it never reaches a side.
 * `umpire.turn` writes it from the logged proposal, so replaying the log rebuilds it with no
 * model. It is bounded: the most recent turns keep a few sentences, older ones only their first,
 * and the oldest notes are dropped when the whole would exceed `JOURNAL_MAX_TOKENS`.
 */

/** Sentences kept from one turn's summary. */
export const JOURNAL_SENTENCES_PER_TURN = 3;
/** The longest sentence kept; a longer one is cut at a word and ends in an ellipsis. */
export const JOURNAL_SENTENCE_MAX = 240;
/** Turns whose notes are kept in full; an older turn's note is condensed to its first sentence. */
export const JOURNAL_FULL_TURNS = 3;
/** Precedents taken from one turn's proposal (the first listed). */
export const JOURNAL_PRECEDENTS_PER_TURN = 3;
/** The longest precedent kept, cut like a sentence. */
export const JOURNAL_PRECEDENT_MAX = 200;
/** Precedents kept for the game. The first stand, as with the judge stage's case law. */
export const JOURNAL_PRECEDENTS_MAX = 12;
/** The journal's size cap, in tokens estimated as its JSON length / 4 (as the projection's is). */
export const JOURNAL_MAX_TOKENS = 1500;

/** One umpire turn's note. */
export interface JournalNote {
  turn: number;
  note: string;
  /** Set once the note has been cut to its first sentence. */
  condensed?: true;
}

/** A ruling the umpire set as precedent, and the turn it was set in. */
export interface JournalPrecedent {
  turn: number;
  ruling: string;
}

/** The umpire's journal. Master state only: never sent to a client. */
export interface UmpireJournal {
  /** One note per umpire turn, oldest first. A turn the engine resolved has none. */
  notes: JournalNote[];
  /** How many of the oldest notes were dropped to keep the journal under its cap. */
  dropped?: number;
  precedents: JournalPrecedent[];
}

/** The journal's size in tokens, estimated as its JSON length / 4. */
export function journalTokens(journal: UmpireJournal): number {
  return Math.ceil(JSON.stringify(journal).length / 4);
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** `s` cut to at most `max` characters, at a word where there is one, ending in an ellipsis. */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The sentences of `text`, each squashed and clipped. Deterministic: no model, no locale. */
export function sentences(text: string): string[] {
  return squash(text)
    .split(/(?<=[.!?])\s+(?=[^a-z])/)
    .map((s) => clip(s.trim(), JOURNAL_SENTENCE_MAX))
    .filter((s) => s.length > 0);
}

/** Older notes cut to their first sentence; the newest `JOURNAL_FULL_TURNS` left whole. */
function condense(notes: JournalNote[]): JournalNote[] {
  const keepFrom = notes.length - JOURNAL_FULL_TURNS;
  return notes.map((n, i) => {
    if (i >= keepFrom || n.condensed) return n;
    return { turn: n.turn, note: sentences(n.note)[0] ?? '', condensed: true };
  });
}

/**
 * The journal after umpire turn `turn`: its summary's first sentences as the turn's note, older
 * notes condensed, the new precedents added (unless the game already has that ruling, or already
 * has `JOURNAL_PRECEDENTS_MAX`), and the oldest notes dropped while the whole is over the cap.
 * Pure: the same journal and proposal give the same result, live and in replay.
 */
export function recordInJournal(
  journal: UmpireJournal | undefined,
  turn: number,
  summary: string,
  precedents: readonly string[] = [],
): UmpireJournal {
  const note = sentences(summary).slice(0, JOURNAL_SENTENCES_PER_TURN).join(' ');
  let notes = (journal?.notes ?? []).filter((n) => n.turn !== turn);
  if (note) notes = condense([...notes, { turn, note }]);

  const kept = [...(journal?.precedents ?? [])];
  const known = new Set(kept.map((p) => p.ruling.toLowerCase()));
  for (const raw of precedents.slice(0, JOURNAL_PRECEDENTS_PER_TURN)) {
    if (kept.length >= JOURNAL_PRECEDENTS_MAX) break;
    const ruling = clip(squash(raw), JOURNAL_PRECEDENT_MAX);
    if (!ruling || known.has(ruling.toLowerCase())) continue;
    known.add(ruling.toLowerCase());
    kept.push({ turn, ruling });
  }

  let dropped = journal?.dropped ?? 0;
  let out: UmpireJournal = { notes, ...(dropped ? { dropped } : {}), precedents: kept };
  // The cap: the oldest notes go first; precedents are the case law and outlast them.
  while (journalTokens(out) > JOURNAL_MAX_TOKENS && out.notes.length > 1) {
    dropped += 1;
    out = { notes: out.notes.slice(1), dropped, precedents: out.precedents };
  }
  while (journalTokens(out) > JOURNAL_MAX_TOKENS && out.precedents.length > 0) {
    out = { ...out, precedents: out.precedents.slice(0, -1) };
  }
  return out;
}
