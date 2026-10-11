/**
 * A side's shared order drafts (D6c): the document model behind "drafting orders together".
 *
 * The server is the one place edits are put in order, so sync is operational transform with a
 * central sequencer (see `ot.ts` and docs/decisions.md D6c). A client sends an edit with the `rev`
 * it was made on; the book moves it past everything that landed since, applies it, and gives it the
 * next rev. A player who was away comes back with an old `rev` and is handled the same way.
 *
 * Every step (edit, comment, resolve) takes the next rev and is kept, so the history shows who
 * changed what and when ("tracked edits"), and a read receipt is just the highest rev a reader has
 * seen. Pure: the caller passes the wall time, and nothing here reads a clock.
 */
import {
  MAX_COMMENT,
  MAX_DRAFTS,
  MAX_DRAFT_REVS,
  MAX_DRAFT_TEXT,
  type AuthorRun,
  type DraftComment,
  type DraftEntry,
  type DraftSnapshot,
} from '@kriegsspiel/protocol';
import {
  apply,
  baseLength,
  fits,
  normalize,
  targetLength,
  transformRange,
  transformThrough,
  type TextOp,
} from './ot.js';

export type DraftErrorCode =
  | 'draft_unknown'
  | 'draft_exists'
  | 'draft_closed'
  | 'draft_full'
  | 'too_many_drafts'
  | 'bad_op'
  | 'bad_rev'
  | 'bad_comment'
  | 'not_a_fork';

export class DraftError extends Error {
  constructor(
    readonly code: DraftErrorCode,
    message: string,
  ) {
    super(message);
  }
}

type EditEntry = Extract<DraftEntry, { kind: 'edit' }>;

const isEdit = (e: DraftEntry): e is EditEntry => e.kind === 'edit';

/** Move author runs across an op: kept text keeps its author, inserted text is `author`'s, deleted text goes. */
function reattribute(runs: readonly AuthorRun[], op: TextOp, author: string): AuthorRun[] {
  const out: AuthorRun[] = [];
  const add = (a: string, len: number) => {
    if (len <= 0) return;
    const last = out[out.length - 1];
    if (last && last.author === a) last.len += len;
    else out.push({ author: a, len });
  };
  const queue = runs.map((r) => ({ ...r }));
  let q = 0;
  for (const c of op) {
    if (typeof c === 'string') {
      add(author, c.length);
      continue;
    }
    let left = Math.abs(c);
    while (left > 0) {
      const run = queue[q];
      if (!run) throw new Error('author runs do not cover the text');
      const n = Math.min(left, run.len);
      if (c > 0) add(run.author, n);
      run.len -= n;
      left -= n;
      if (run.len === 0) q++;
    }
  }
  return out;
}

export class DraftBook {
  private readonly drafts = new Map<string, DraftSnapshot>();

  /** Rebuild a book from what `toJSON` gave. */
  static from(snapshots: readonly DraftSnapshot[]): DraftBook {
    const book = new DraftBook();
    for (const s of snapshots) book.drafts.set(s.id, structuredClone(s));
    return book;
  }

  toJSON(): DraftSnapshot[] {
    return [...this.drafts.values()];
  }

  get(id: string): DraftSnapshot | undefined {
    return this.drafts.get(id);
  }

  list(): DraftSnapshot[] {
    return this.toJSON();
  }

  private need(id: string): DraftSnapshot {
    const d = this.drafts.get(id);
    if (!d) throw new DraftError('draft_unknown', `no draft ${id}`);
    return d;
  }

  private open(id: string): DraftSnapshot {
    const d = this.need(id);
    if (d.mergedInto !== undefined)
      throw new DraftError('draft_closed', `draft ${id} was merged into ${d.mergedInto}`);
    if (d.history.length >= MAX_DRAFT_REVS)
      throw new DraftError('draft_full', `draft ${id} has too much history; fork it`);
    return d;
  }

  private add(d: DraftSnapshot): DraftSnapshot {
    if (this.drafts.has(d.id)) throw new DraftError('draft_exists', `draft ${d.id} already exists`);
    if (this.drafts.size >= MAX_DRAFTS)
      throw new DraftError('too_many_drafts', `a side may keep at most ${MAX_DRAFTS} drafts`);
    this.drafts.set(d.id, d);
    return d;
  }

  /** Start a draft. `text` is its first wording, written by `by`. */
  create(id: string, by: string, input: { text?: string; title?: string } = {}): DraftSnapshot {
    const text = input.text ?? '';
    if (text.length > MAX_DRAFT_TEXT)
      throw new DraftError('bad_op', `a draft holds at most ${MAX_DRAFT_TEXT} characters`);
    return this.add({
      id,
      title: (input.title ?? '').slice(0, 80),
      createdBy: by,
      rev: 0,
      text,
      authors: text ? [{ author: by, len: text.length }] : [],
      comments: [],
      receipts: {},
      history: [],
    });
  }

  /** Check `baseRev` and return the edits that landed after it. */
  private since(d: DraftSnapshot, baseRev: number): EditEntry[] {
    if (!Number.isInteger(baseRev) || baseRev < 0 || baseRev > d.rev)
      throw new DraftError('bad_rev', `rev ${baseRev} is not one of draft ${d.id}'s (0..${d.rev})`);
    return d.history.slice(baseRev).filter(isEdit);
  }

  private commit(d: DraftSnapshot, op: TextOp, author: string): void {
    d.text = apply(d.text, op);
    d.authors = reattribute(d.authors, op, author);
  }

  /**
   * The edit `by` already sent with `opId`, if the draft has it. A client that resends an edit it
   * never saw acknowledged (after a reconnect) gets this back instead of a second application.
   */
  sentOp(id: string, by: string, opId: string | undefined): EditEntry | undefined {
    if (opId === undefined) return undefined;
    return this.need(id)
      .history.filter(isEdit)
      .find((e) => e.opId === opId && e.author === by && e.viaFork === undefined);
  }

  /** Apply an edit made on `baseRev`; a repeat of an `opId` `by` already sent returns the first result. Returns the entry as applied (its op moved past later edits). */
  edit(
    id: string,
    by: string,
    now: number,
    input: { baseRev: number; op: TextOp; opId?: string },
  ): EditEntry {
    const done = this.sentOp(id, by, input.opId);
    if (done) return done;
    const d = this.open(id);
    const later = this.since(d, input.baseRev);
    let moved: TextOp;
    try {
      moved = transformThrough(
        normalize(input.op),
        later.map((e) => e.op),
      )[0];
    } catch {
      throw new DraftError('bad_op', 'the edit does not fit the text it was made on');
    }
    if (!fits(moved, d.text.length))
      throw new DraftError('bad_op', 'the edit does not fit the text it was made on');
    if (targetLength(moved) > MAX_DRAFT_TEXT)
      throw new DraftError('bad_op', `a draft holds at most ${MAX_DRAFT_TEXT} characters`);
    return this.record(d, by, now, moved, input.opId);
  }

  private record(
    d: DraftSnapshot,
    by: string,
    now: number,
    op: TextOp,
    opId?: string,
    viaFork?: string,
  ): EditEntry {
    this.commit(d, op, by);
    // Comments move with the text they are about.
    d.comments = d.comments.map((c) => ({ ...c, ...transformRange(c, op) }));
    const entry: EditEntry = {
      kind: 'edit',
      rev: d.rev + 1,
      author: by,
      at: now,
      ...(opId === undefined ? {} : { opId }),
      op,
      ...(viaFork === undefined ? {} : { viaFork }),
    };
    d.rev = entry.rev;
    d.history.push(entry);
    return entry;
  }

  /** Add a comment on a range of the text as it was at `baseRev`; `replyTo` makes it a reply. */
  comment(
    id: string,
    by: string,
    now: number,
    input: {
      baseRev: number;
      id: string;
      from: number;
      to: number;
      body: string;
      replyTo?: string;
    },
  ): Extract<DraftEntry, { kind: 'comment' }> {
    const d = this.open(id);
    if (input.body.length === 0 || input.body.length > MAX_COMMENT)
      throw new DraftError('bad_comment', `a comment is 1 to ${MAX_COMMENT} characters`);
    if (d.comments.some((c) => c.id === input.id))
      throw new DraftError('bad_comment', `comment ${input.id} already exists`);
    if (input.replyTo !== undefined && !d.comments.some((c) => c.id === input.replyTo))
      throw new DraftError('bad_comment', `no comment ${input.replyTo} to reply to`);
    if (input.from > input.to)
      throw new DraftError('bad_comment', 'a comment range runs from low to high');
    // The anchor must fit the text the commenter saw, not the text as it is now.
    const later = this.since(d, input.baseRev);
    let lengthThen = d.text.length;
    for (const e of later) lengthThen -= targetLength(e.op) - baseLength(e.op);
    if (input.to > lengthThen)
      throw new DraftError('bad_comment', 'the comment range is past the end of the text');
    let range = { from: input.from, to: input.to };
    for (const e of later) range = transformRange(range, e.op);
    if (range.to > d.text.length)
      throw new DraftError('bad_comment', 'the comment range is past the end of the text');
    const comment: DraftComment = {
      id: input.id,
      author: by,
      at: now,
      ...range,
      body: input.body,
      ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
      resolved: false,
    };
    const entry = { kind: 'comment' as const, rev: d.rev + 1, at: now, comment };
    d.comments.push(comment);
    d.rev = entry.rev;
    d.history.push(entry);
    return entry;
  }

  /** Mark a comment resolved, or open it again. */
  resolve(
    id: string,
    by: string,
    now: number,
    commentId: string,
    resolved: boolean,
  ): Extract<DraftEntry, { kind: 'resolve' }> {
    const d = this.open(id);
    const c = d.comments.find((x) => x.id === commentId);
    if (!c) throw new DraftError('bad_comment', `no comment ${commentId}`);
    c.resolved = resolved;
    const entry = {
      kind: 'resolve' as const,
      rev: d.rev + 1,
      author: by,
      at: now,
      commentId,
      resolved,
    };
    d.rev = entry.rev;
    d.history.push(entry);
    return entry;
  }

  /** Record that `by` has seen the draft up to `rev`. Returns the receipt, or undefined when it was no news. */
  read(id: string, by: string, rev: number): number | undefined {
    const d = this.need(id);
    const seen = Math.min(Math.max(0, Math.floor(rev)), d.rev);
    if (seen <= (d.receipts[by] ?? 0)) return undefined;
    d.receipts[by] = seen;
    return seen;
  }

  /** Copy a draft's current wording into a new draft, to write an alternative plan. */
  fork(id: string, newId: string, by: string): DraftSnapshot {
    const parent = this.need(id);
    if (parent.mergedInto !== undefined)
      throw new DraftError('draft_closed', `draft ${id} was merged into ${parent.mergedInto}`);
    return this.add({
      id: newId,
      title: `${parent.title || parent.id} (fork)`.slice(0, 80),
      createdBy: by,
      rev: 0,
      text: parent.text,
      authors: structuredClone(parent.authors),
      comments: [],
      receipts: {},
      forkOf: { draft: id, rev: parent.rev },
      history: [],
    });
  }

  /**
   * Fold a fork's edits back into the draft it came from. Each edit is moved past whatever the
   * parent gained since the fork, then applied to the parent under its original author. Comments
   * stay on the fork. The fork is closed afterwards. Returns the entries now in the parent.
   */
  merge(id: string, now: number): { parent: string; entries: EditEntry[] } {
    const fork = this.need(id);
    if (!fork.forkOf) throw new DraftError('not_a_fork', `draft ${id} is not a fork`);
    if (fork.mergedInto !== undefined)
      throw new DraftError('draft_closed', `draft ${id} was already merged`);
    const parent = this.open(fork.forkOf.draft);
    let run = this.since(parent, fork.forkOf.rev).map((e) => e.op);
    const plan: { op: TextOp; author: string; opId?: string }[] = [];
    try {
      for (const e of fork.history.filter(isEdit)) {
        const [op, rest] = transformThrough(e.op, run);
        run = rest;
        plan.push({ op, author: e.author });
      }
    } catch {
      throw new DraftError('bad_op', 'the fork does not fit its parent');
    }
    // Try it on a copy first, so a merge that would overflow changes nothing.
    const trial = structuredClone(parent);
    if (trial.history.length + plan.length > MAX_DRAFT_REVS)
      throw new DraftError('draft_full', `draft ${parent.id} has too much history; fork it`);
    try {
      for (const p of plan) {
        trial.text = apply(trial.text, p.op);
        if (trial.text.length > MAX_DRAFT_TEXT) throw new Error('too long');
      }
    } catch {
      throw new DraftError('bad_op', `the merged draft would pass ${MAX_DRAFT_TEXT} characters`);
    }
    const entries = plan.map((p) => this.record(parent, p.author, now, p.op, undefined, id));
    fork.mergedInto = parent.id;
    return { parent: parent.id, entries };
  }
}
