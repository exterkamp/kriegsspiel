/**
 * The client side of shared order drafts (D6c): the pure logic behind the drafting desk.
 *
 * The server is the one sequencer of a draft's edits. `applyDraftEntry` keeps the client's copy of a draft in
 * step with the entries the server sends. `DraftSession` is the browser editor's half of the operational
 * transform: it keeps one edit in flight, folds what the player types in the meantime into the next edit, and
 * moves other players' edits past both so the text under the cursor does not jump. Framework-free, no clock.
 */
import {
  textOt,
  type DraftComment,
  type DraftEntry,
  type DraftSnapshot,
} from '@kriegsspiel/protocol';

type TextOp = textOt.TextOp;

/**
 * The draft after one more history entry, or undefined when the entry does not follow its rev (the client
 * missed one and must ask for a fresh snapshot). An entry at or below the draft's rev is old news: the draft
 * comes back as it was.
 */
export function applyDraftEntry(d: DraftSnapshot, e: DraftEntry): DraftSnapshot | undefined {
  if (e.rev <= d.rev) return d;
  if (e.rev !== d.rev + 1) return undefined;
  const history = [...d.history, e];
  switch (e.kind) {
    case 'edit': {
      if (!textOt.fits(e.op, d.text.length)) return undefined;
      return {
        ...d,
        rev: e.rev,
        text: textOt.apply(d.text, e.op),
        authors: textOt.reattribute(d.authors, e.op, e.author),
        comments: d.comments.map((c) => ({ ...c, ...textOt.transformRange(c, e.op) })),
        history,
      };
    }
    case 'comment':
      return { ...d, rev: e.rev, comments: [...d.comments, e.comment], history };
    case 'resolve':
      return {
        ...d,
        rev: e.rev,
        comments: d.comments.map((c) =>
          c.id === e.commentId ? { ...c, resolved: e.resolved } : c,
        ),
        history,
      };
  }
}

/** What to send for an edit: the server's `draftEdit` fields. */
export interface PendingEdit {
  baseRev: number;
  op: TextOp;
  opId: string;
}

/** One draft's editing state in this browser: the text the server has, what is in flight, and the player's own text. */
export class DraftSession {
  /** The newest rev of the server's history this session has taken in. */
  rev: number;
  /** The server's text at `rev`. */
  serverText: string;
  /** What the player sees and edits: the server text plus their unsaved changes. */
  text: string;
  private inflight: { sent: PendingEdit; tracked: TextOp } | undefined;
  private seq = 0;

  constructor(
    private readonly me: string,
    snapshot: Pick<DraftSnapshot, 'rev' | 'text'>,
    private readonly newOpId: (n: number) => string = (n) => `e${n}`,
  ) {
    this.rev = snapshot.rev;
    this.serverText = snapshot.text;
    this.text = snapshot.text;
  }

  /** True when everything the player typed has been taken by the server. */
  get saved(): boolean {
    return this.inflight === undefined && this.text === this.serverText;
  }

  /** The player typed: their text is now `text`. */
  input(text: string): void {
    this.text = text;
  }

  /** Throw the unsaved changes away and show the server's text. */
  discard(): void {
    this.inflight = undefined;
    this.text = this.serverText;
  }

  /**
   * The next edit to send, if there is one and none is still in flight. The edit is whatever differs between the
   * server's text and the player's, so a burst of typing goes as one edit.
   */
  flush(): PendingEdit | undefined {
    if (this.inflight || this.text === this.serverText) return undefined;
    const op = textOt.diff(this.serverText, this.text);
    const sent: PendingEdit = { baseRev: this.rev, op, opId: this.newOpId(++this.seq) };
    this.inflight = { sent, tracked: op };
    return sent;
  }

  /** The edit in flight, to send again after a reconnect; the server applies a repeated `opId` once. */
  resend(): PendingEdit | undefined {
    return this.inflight?.sent;
  }

  /**
   * Take in the server's next history entry. Returns the op to apply to `text` (the player's text already
   * holds their own changes), or undefined when the entry changed no text. Throws when the entry does not
   * follow `rev`; the caller then asks for a fresh snapshot.
   */
  receive(entry: DraftEntry): TextOp | undefined {
    if (entry.rev <= this.rev) return undefined;
    if (entry.rev !== this.rev + 1) throw new Error('missed a draft entry');
    if (entry.kind !== 'edit') {
      this.rev = entry.rev;
      return undefined;
    }
    const mine =
      this.inflight !== undefined &&
      entry.author === this.me &&
      entry.opId === this.inflight.sent.opId;
    if (mine) {
      this.serverText = textOt.apply(this.serverText, entry.op);
      this.rev = entry.rev;
      this.inflight = undefined;
      return undefined;
    }
    let remote = entry.op;
    // The remote edit and the edit in flight were made on the same text; each must be moved past the other.
    let afterInflight = this.serverText;
    if (this.inflight) {
      afterInflight = textOt.apply(this.serverText, this.inflight.tracked);
      const [r, i] = textOt.transform(remote, this.inflight.tracked);
      remote = r;
      this.inflight.tracked = i;
    }
    // Likewise the player's typing since: it sits on the text after the edit in flight.
    const typed = textOt.diff(afterInflight, this.text);
    const [onText] = textOt.transform(remote, typed);
    this.serverText = textOt.apply(this.serverText, entry.op);
    this.rev = entry.rev;
    this.text = textOt.apply(this.text, onText);
    return onText;
  }

  /**
   * Catch up from a full snapshot (after a reconnect or `bad_rev`): replay the history entries past `rev`.
   * Returns the ops applied to `text`, in order. A snapshot older than this session means the server lost
   * history; the session then restarts from the snapshot and the unsaved text is dropped.
   */
  sync(snapshot: DraftSnapshot): TextOp[] {
    if (snapshot.rev < this.rev) {
      this.rev = snapshot.rev;
      this.serverText = snapshot.text;
      this.discard();
      return [];
    }
    const ops: TextOp[] = [];
    for (const e of snapshot.history) {
      if (e.rev <= this.rev) continue;
      const op = this.receive(e);
      if (op) ops.push(op);
    }
    return ops;
  }
}

/** Where a cursor or selection end goes when `ops` are applied to the text it was in. */
export function moveIndex(index: number, ops: readonly TextOp[]): number {
  return ops.reduce((i, op) => textOt.transformIndex(i, op, 'after'), index);
}

/** A stretch of the text and who wrote it, for the tracked-changes view. */
export interface AuthoredSpan {
  author: string;
  text: string;
}

/** The draft text cut into runs by author. */
export function authoredSpans(d: Pick<DraftSnapshot, 'text' | 'authors'>): AuthoredSpan[] {
  const out: AuthoredSpan[] = [];
  let at = 0;
  for (const run of d.authors) {
    out.push({ author: run.author, text: d.text.slice(at, at + run.len) });
    at += run.len;
  }
  if (at < d.text.length) out.push({ author: '', text: d.text.slice(at) });
  return out;
}

/** One line of the change history, in words. */
export interface HistoryLine {
  rev: number;
  at: number;
  who: string;
  text: string;
  /** Set on an edit that came in from a merged fork. */
  viaFork?: string;
}

const clip = (s: string, n = 40): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * What an edit did, as "added “x”", "removed 5 characters" or both. The text a deletion took out is not kept
 * (the draft's first wording is not in its history), so only how much went is said.
 */
export function describeEdit(op: TextOp): string {
  const added: string[] = [];
  let removed = 0;
  for (const c of op) {
    if (typeof c === 'string') added.push(c);
    else if (c < 0) removed += -c;
  }
  const parts: string[] = [];
  if (added.length) parts.push(`added “${clip(added.join(' '))}”`);
  if (removed) parts.push(`removed ${removed} character${removed === 1 ? '' : 's'}`);
  return parts.join(' and ') || 'made no change';
}

/** The draft's history as lines, oldest first; `name` turns an author id into the name to show. */
export function historyLines(
  d: Pick<DraftSnapshot, 'history'>,
  name: (author: string) => string,
): HistoryLine[] {
  const lines: HistoryLine[] = [];
  for (const e of d.history) {
    if (e.kind === 'edit') {
      lines.push({
        rev: e.rev,
        at: e.at,
        who: name(e.author),
        text: describeEdit(e.op),
        ...(e.viaFork ? { viaFork: e.viaFork } : {}),
      });
    } else if (e.kind === 'comment') {
      lines.push({ rev: e.rev, at: e.at, who: name(e.comment.author), text: 'commented' });
    } else {
      lines.push({
        rev: e.rev,
        at: e.at,
        who: name(e.author),
        text: e.resolved ? 'resolved a comment' : 'reopened a comment',
      });
    }
  }
  return lines;
}

/** How many history steps `me` has not yet seen, from their read receipt. */
export function unreadCount(d: Pick<DraftSnapshot, 'rev' | 'receipts'>, me: string): number {
  return Math.max(0, d.rev - (d.receipts[me] ?? 0));
}

/** A comment thread: the opening comment and its replies in order. */
export interface Thread {
  root: DraftComment;
  replies: DraftComment[];
}

/** Comments grouped into threads, in the order their opening comments were made. */
export function threadsOf(comments: readonly DraftComment[]): Thread[] {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const rootOf = (c: DraftComment): DraftComment => {
    let cur = c;
    for (let i = 0; i < comments.length && cur.replyTo !== undefined; i++) {
      const up = byId.get(cur.replyTo);
      if (!up) break;
      cur = up;
    }
    return cur;
  };
  const threads = new Map<string, Thread>();
  for (const c of comments) {
    const root = rootOf(c);
    const t = threads.get(root.id) ?? { root, replies: [] };
    if (c.id !== root.id) t.replies.push(c);
    threads.set(root.id, t);
  }
  return [...threads.values()];
}

/** A draft in the list: forks sit under the draft they came from. */
export interface DraftRow {
  draft: DraftSnapshot;
  /** 0 for a draft, 1 for a fork shown under its parent, and so on. */
  depth: number;
}

export function draftRows(drafts: readonly DraftSnapshot[]): DraftRow[] {
  const ids = new Set(drafts.map((d) => d.id));
  const rows: DraftRow[] = [];
  const add = (d: DraftSnapshot, depth: number): void => {
    rows.push({ draft: d, depth });
    for (const f of drafts) if (f.forkOf?.draft === d.id) add(f, depth + 1);
  };
  for (const d of drafts) if (d.forkOf === undefined || !ids.has(d.forkOf.draft)) add(d, 0);
  return rows;
}

/** The name to show for a draft: its title, else a plain number. */
export function draftTitle(d: Pick<DraftSnapshot, 'title'>, index: number): string {
  return d.title.trim() || `Draft ${index + 1}`;
}
