import { describe, expect, it } from 'vitest';
import { textOt, type DraftEntry, type DraftSnapshot } from '@kriegsspiel/protocol';
import {
  DraftSession,
  applyDraftEntry,
  authoredSpans,
  draftRows,
  historyLines,
  moveIndex,
  threadsOf,
  unreadCount,
  type PendingEdit,
} from './drafts';

const blank = (over: Partial<DraftSnapshot> = {}): DraftSnapshot => ({
  id: 'd1',
  title: '',
  createdBy: 'a',
  rev: 0,
  text: '',
  authors: [],
  comments: [],
  receipts: {},
  history: [],
  ...over,
});

const edit = (rev: number, author: string, op: textOt.TextOp, opId?: string): DraftEntry => ({
  kind: 'edit',
  rev,
  author,
  at: rev * 1000,
  op,
  ...(opId ? { opId } : {}),
});

describe('textOt.diff', () => {
  it('turns one text into another', () => {
    for (const [a, b] of [
      ['', 'abc'],
      ['abc', ''],
      ['abc', 'abc'],
      ['hold the bridge', 'hold the old bridge'],
      ['aaa', 'aa'],
      ['abcabc', 'abc'],
      ['x😀y', 'x😁y'],
    ] as const) {
      expect(textOt.apply(a, textOt.diff(a, b))).toBe(b);
    }
  });

  it('never cuts a surrogate pair in two', () => {
    const op = textOt.diff('😀', '😁');
    expect(textOt.apply('😀', op)).toBe('😁');
    expect(op).toEqual(['😁', -2]);
  });
});

describe('applyDraftEntry', () => {
  it('applies an edit, tracks the author and moves comments', () => {
    let d = blank({
      rev: 1,
      text: 'Hold the bridge',
      authors: [{ author: 'a', len: 15 }],
      comments: [{ id: 'c', author: 'b', at: 1, from: 9, to: 15, body: 'which?', resolved: false }],
    });
    d = applyDraftEntry(d, edit(2, 'b', ['Colonel: ', 15]))!;
    expect(d.text).toBe('Colonel: Hold the bridge');
    expect(d.authors).toEqual([
      { author: 'b', len: 9 },
      { author: 'a', len: 15 },
    ]);
    expect(d.comments[0]).toMatchObject({ from: 18, to: 24 });
    expect(d.rev).toBe(2);
  });

  it('ignores an old entry and refuses a gap', () => {
    const d = blank({ rev: 3, text: 'x', authors: [{ author: 'a', len: 1 }] });
    expect(applyDraftEntry(d, edit(3, 'a', [1]))).toBe(d);
    expect(applyDraftEntry(d, edit(5, 'a', [1]))).toBeUndefined();
    expect(applyDraftEntry(d, edit(4, 'a', [7]))).toBeUndefined();
  });

  it('adds and resolves comments', () => {
    let d = blank({ rev: 0, text: 'abc', authors: [{ author: 'a', len: 3 }] });
    const comment = { id: 'c1', author: 'b', at: 5, from: 0, to: 3, body: 'hm', resolved: false };
    d = applyDraftEntry(d, { kind: 'comment', rev: 1, at: 5, comment })!;
    d = applyDraftEntry(d, {
      kind: 'resolve',
      rev: 2,
      author: 'a',
      at: 6,
      commentId: 'c1',
      resolved: true,
    })!;
    expect(d.comments[0]!.resolved).toBe(true);
    expect(d.history.map((e) => e.rev)).toEqual([1, 2]);
  });
});

/** A server that numbers edits the way `DraftBook` does, and a pair of clients wired to it. */
class Room {
  rev = 0;
  text: string;
  history: Extract<DraftEntry, { kind: 'edit' }>[] = [];
  /** Entries on their way to each client. */
  inbox = new Map<string, DraftEntry[]>();
  sessions = new Map<string, DraftSession>();

  constructor(start: string, ...names: string[]) {
    this.text = start;
    for (const n of names) {
      this.inbox.set(n, []);
      this.sessions.set(n, new DraftSession(n, { rev: 0, text: start }, (i) => `${n}-${i}`));
    }
  }

  send(from: string, e: PendingEdit): void {
    const later = this.history.slice(e.baseRev).map((h) => h.op);
    const [op] = textOt.transformThrough(e.op, later);
    const entry: DraftEntry = {
      kind: 'edit',
      rev: ++this.rev,
      author: from,
      at: this.rev,
      opId: e.opId,
      op,
    };
    this.text = textOt.apply(this.text, op);
    this.history.push(entry);
    for (const q of this.inbox.values()) q.push(entry);
  }

  /** The client types: replaces `[from, to)` of its text. */
  type(who: string, from: number, to: number, ins: string): void {
    const s = this.sessions.get(who)!;
    s.input(s.text.slice(0, from) + ins + s.text.slice(to));
  }

  flush(who: string): void {
    const e = this.sessions.get(who)!.flush();
    if (e) this.send(who, e);
  }

  deliver(who: string, n = Infinity): void {
    const q = this.inbox.get(who)!;
    for (const e of q.splice(0, n)) this.sessions.get(who)!.receive(e);
  }
}

describe('DraftSession', () => {
  it('sends what was typed as one edit and clears it when the edit comes back', () => {
    const r = new Room('Hold the bridge', 'a');
    r.type('a', 0, 0, 'Colonel: ');
    r.type('a', 9, 9, '!');
    const s = r.sessions.get('a')!;
    expect(s.saved).toBe(false);
    r.flush('a');
    expect(r.flush('a')).toBeUndefined();
    r.deliver('a');
    expect(s.saved).toBe(true);
    expect(s.text).toBe('Colonel: !Hold the bridge');
    expect(r.text).toBe(s.text);
  });

  it('keeps typing made while an edit is in flight and sends it next', () => {
    const r = new Room('abc', 'a');
    const s = r.sessions.get('a')!;
    r.type('a', 3, 3, 'd');
    r.flush('a');
    r.type('a', 4, 4, 'e');
    expect(s.flush()).toBeUndefined();
    r.deliver('a');
    expect(s.text).toBe('abcde');
    r.flush('a');
    r.deliver('a');
    expect(r.text).toBe('abcde');
    expect(s.saved).toBe(true);
  });

  it('moves another player’s edit past the player’s own typing', () => {
    const r = new Room('Hold the bridge', 'a', 'b');
    r.type('a', 0, 0, 'Colonel: ');
    r.type('b', 15, 15, ' at all costs');
    r.flush('b');
    r.deliver('a');
    expect(r.sessions.get('a')!.text).toBe('Colonel: Hold the bridge at all costs');
    r.flush('a');
    r.deliver('a');
    r.deliver('b');
    expect(r.text).toBe('Colonel: Hold the bridge at all costs');
    expect(r.sessions.get('a')!.text).toBe(r.text);
    expect(r.sessions.get('b')!.text).toBe(r.text);
  });

  it('reports where the cursor goes', () => {
    const r = new Room('hello', 'a', 'b');
    r.type('b', 0, 0, '>> ');
    r.flush('b');
    const s = r.sessions.get('a')!;
    const op = s.receive(r.inbox.get('a')!.shift()!)!;
    expect(moveIndex(2, [op])).toBe(5);
  });

  it('applies a resent edit once: the ack of the first send is the one it waits for', () => {
    const s = new DraftSession('a', { rev: 0, text: 'x' }, () => 'op');
    s.input('xy');
    const e = s.flush()!;
    expect(s.resend()).toEqual(e);
    s.receive(edit(1, 'a', [1, 'y'], 'op'));
    expect(s.resend()).toBeUndefined();
    expect(s.saved).toBe(true);
  });

  it('catches up from a snapshot by replaying the entries past its rev', () => {
    const s = new DraftSession('a', { rev: 1, text: 'ab' });
    s.input('abX');
    const history = [edit(1, 'b', ['ab']), edit(2, 'b', ['Z', 2]), edit(3, 'b', [3, 'Q'])];
    const ops = s.sync(
      blank({ rev: 3, text: 'ZabQ', authors: [{ author: 'b', len: 4 }], history }),
    );
    expect(ops).toHaveLength(2);
    expect(s.rev).toBe(3);
    expect(s.serverText).toBe('ZabQ');
    // Text already in the draft stays ahead of the player's own typing at a tie.
    expect(s.text).toBe('ZabQX');
  });

  it('starts over from a snapshot that is behind the session', () => {
    const s = new DraftSession('a', { rev: 5, text: 'long' });
    s.input('longer');
    s.sync(blank({ rev: 2, text: 'short', authors: [{ author: 'a', len: 5 }] }));
    expect(s.rev).toBe(2);
    expect(s.text).toBe('short');
    expect(s.saved).toBe(true);
  });

  it('refuses an entry that skips a rev', () => {
    const s = new DraftSession('a', { rev: 0, text: '' });
    expect(() => s.receive(edit(2, 'b', ['x']))).toThrow();
  });

  it('discards unsaved text on request', () => {
    const s = new DraftSession('a', { rev: 0, text: 'a' });
    s.input('ab');
    s.flush();
    s.discard();
    expect(s.text).toBe('a');
    expect(s.saved).toBe(true);
  });

  it('converges under random typing and arbitrary delivery order', () => {
    // A small deterministic generator keeps the run repeatable.
    let seed = 12345;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let round = 0; round < 60; round++) {
      const names = ['a', 'b', 'c'];
      const r = new Room('The quick brown fox', ...names);
      for (let step = 0; step < 40; step++) {
        const who = names[rnd(3)]!;
        const s = r.sessions.get(who)!;
        switch (rnd(4)) {
          case 0: {
            const at = rnd(s.text.length + 1);
            r.type(who, at, at, 'xyz'.slice(0, 1 + rnd(3)));
            break;
          }
          case 1: {
            if (s.text.length === 0) break;
            const at = rnd(s.text.length);
            r.type(who, at, Math.min(s.text.length, at + 1 + rnd(4)), '');
            break;
          }
          case 2:
            r.flush(who);
            break;
          default:
            r.deliver(who, 1 + rnd(3));
        }
      }
      // Everyone catches up and sends what is left until nothing is pending.
      for (let i = 0; i < 6; i++) {
        for (const n of names) {
          r.deliver(n);
          r.flush(n);
        }
      }
      for (const n of names) r.deliver(n);
      for (const n of names) {
        expect(r.sessions.get(n)!.text, `round ${round} ${n}`).toBe(r.text);
        expect(r.sessions.get(n)!.saved).toBe(true);
      }
    }
  });
});

describe('views of a draft', () => {
  it('cuts the text into runs by author', () => {
    const d = blank({
      text: 'Colonel: Hold',
      authors: [
        { author: 'b', len: 9 },
        { author: 'a', len: 4 },
      ],
    });
    expect(authoredSpans(d)).toEqual([
      { author: 'b', text: 'Colonel: ' },
      { author: 'a', text: 'Hold' },
    ]);
  });

  it('describes the history in words', () => {
    const d = blank({
      history: [
        edit(1, 'a', ['Hold the bridge']),
        edit(2, 'b', [5, -3, 'a', 7]),
        {
          kind: 'comment',
          rev: 3,
          at: 3000,
          comment: { id: 'c', author: 'a', at: 3000, from: 0, to: 1, body: 'x', resolved: false },
        },
        { kind: 'resolve', rev: 4, author: 'b', at: 4000, commentId: 'c', resolved: true },
      ],
    });
    const lines = historyLines(d, (id) => id.toUpperCase());
    expect(lines.map((l) => `${l.who}: ${l.text}`)).toEqual([
      'A: added “Hold the bridge”',
      'B: added “a” and removed 3 characters',
      'A: commented',
      'B: resolved a comment',
    ]);
  });

  it('counts unread steps from the reader’s receipt', () => {
    expect(unreadCount({ rev: 7, receipts: { me: 4 } }, 'me')).toBe(3);
    expect(unreadCount({ rev: 7, receipts: {} }, 'me')).toBe(7);
    expect(unreadCount({ rev: 2, receipts: { me: 9 } }, 'me')).toBe(0);
  });

  it('groups replies under the comment they answer', () => {
    const c = (id: string, replyTo?: string) => ({
      id,
      author: 'a',
      at: 1,
      from: 0,
      to: 0,
      body: id,
      resolved: false,
      ...(replyTo ? { replyTo } : {}),
    });
    const t = threadsOf([c('1'), c('2'), c('3', '1'), c('4', '3')]);
    expect(t.map((x) => [x.root.id, x.replies.map((r) => r.id)])).toEqual([
      ['1', ['3', '4']],
      ['2', []],
    ]);
  });

  it('lists forks under the draft they came from', () => {
    const d1 = blank({ id: 'd1' });
    const f = blank({ id: 'f', forkOf: { draft: 'd1', rev: 0 } });
    const d2 = blank({ id: 'd2' });
    expect(draftRows([d1, d2, f]).map((r) => [r.draft.id, r.depth])).toEqual([
      ['d1', 0],
      ['f', 1],
      ['d2', 0],
    ]);
    // A fork whose parent is gone is shown on its own.
    expect(draftRows([f]).map((r) => r.depth)).toEqual([0]);
  });
});
