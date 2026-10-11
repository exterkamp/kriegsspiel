import { describe, expect, it } from 'vitest';
import { DraftBook, DraftError } from './book.js';
import { apply, deleteAt, insertAt } from './ot.js';

const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e instanceof DraftError ? e.code : 'other';
  }
  return 'none';
};

function bookWith(text: string) {
  const b = new DraftBook();
  b.create('d1', 'ann', { text, title: 'Order 1' });
  return b;
}

describe('concurrent edits', () => {
  it('gives two clients editing the same rev one consistent text', () => {
    const b = bookWith('Advance to the bridge.');
    const len = b.get('d1')!.text.length;
    const ann = b.edit('d1', 'ann', 10, { baseRev: 0, op: insertAt(len, 0, 'At dawn: ') });
    const bob = b.edit('d1', 'bob', 11, { baseRev: 0, op: deleteAt(len, len - 1, 1), opId: 'b1' });
    const d = b.get('d1')!;
    expect(d.text).toBe('At dawn: Advance to the bridge');
    expect([ann.rev, bob.rev, d.rev]).toEqual([1, 2, 2]);
    expect(bob.opId).toBe('b1');
    // Replaying the history on the first text rebuilds the current one: it is what clients receive.
    expect(
      d.history.reduce(
        (t, e) => (e.kind === 'edit' ? apply(t, e.op) : t),
        'Advance to the bridge.',
      ),
    ).toBe(d.text);
  });

  it('is the same whichever edit reaches the server first', () => {
    const run = (first: 'a' | 'b') => {
      const b = bookWith('0123456789');
      const a = { baseRev: 0, op: insertAt(10, 5, 'AA') };
      const c = { baseRev: 0, op: deleteAt(10, 3, 4) };
      if (first === 'a') {
        b.edit('d1', 'ann', 1, a);
        b.edit('d1', 'bob', 2, c);
      } else {
        b.edit('d1', 'bob', 2, c);
        b.edit('d1', 'ann', 1, a);
      }
      return b.get('d1')!.text;
    };
    expect(run('a')).toBe(run('b'));
  });

  it('takes an edit from a player who was away for many revs', () => {
    const b = bookWith('abc');
    for (let i = 0; i < 5; i++) {
      const t = b.get('d1')!;
      b.edit('d1', 'ann', i, { baseRev: t.rev, op: insertAt(t.text.length, t.text.length, '!') });
    }
    b.edit('d1', 'bob', 99, { baseRev: 0, op: insertAt(3, 0, '>') });
    expect(b.get('d1')!.text).toBe('>abc!!!!!');
  });

  it('refuses edits that do not fit, from a rev that does not exist, or past the size limit', () => {
    const b = bookWith('abc');
    expect(code(() => b.edit('d1', 'x', 1, { baseRev: 0, op: [5] }))).toBe('bad_op');
    expect(code(() => b.edit('d1', 'x', 1, { baseRev: 3, op: [3] }))).toBe('bad_rev');
    expect(code(() => b.edit('d1', 'x', 1, { baseRev: 0, op: [3, 'x'.repeat(2000)] }))).toBe(
      'bad_op',
    );
    expect(code(() => b.edit('nope', 'x', 1, { baseRev: 0, op: [] }))).toBe('draft_unknown');
    expect(b.get('d1')!.rev).toBe(0);
  });
});

describe('tracked edits', () => {
  it('records who wrote each stretch of the text, and who changed what and when', () => {
    const b = bookWith('Hold the bridge');
    b.edit('d1', 'bob', 50, { baseRev: 0, op: insertAt(15, 4, ' firmly') });
    b.edit('d1', 'cy', 60, { baseRev: 1, op: deleteAt(22, 0, 5) });
    const d = b.get('d1')!;
    expect(d.text).toBe('firmly the bridge');
    expect(d.authors).toEqual([
      { author: 'bob', len: 6 },
      { author: 'ann', len: 11 },
    ]);
    expect(d.history.map((e) => [e.kind, e.rev, 'author' in e ? e.author : '', e.at])).toEqual([
      ['edit', 1, 'bob', 50],
      ['edit', 2, 'cy', 60],
    ]);
  });
});

describe('comments and receipts', () => {
  it('keeps a comment on its words as the text moves, even when it was made on an old rev', () => {
    const b = bookWith('Hold the bridge at all costs');
    b.edit('d1', 'bob', 1, { baseRev: 0, op: insertAt(28, 0, 'Colonel: ') });
    // Ann comments on "bridge" as she saw it at rev 0.
    b.comment('d1', 'ann', 2, { baseRev: 0, id: 'c1', from: 9, to: 15, body: 'which bridge?' });
    const c = b.get('d1')!.comments[0]!;
    expect(b.get('d1')!.text.slice(c.from, c.to)).toBe('bridge');
    b.edit('d1', 'bob', 3, { baseRev: 2, op: insertAt(37, 0, '>> ') });
    const moved = b.get('d1')!.comments[0]!;
    expect(b.get('d1')!.text.slice(moved.from, moved.to)).toBe('bridge');
  });

  it('threads replies, resolves, and refuses bad comments', () => {
    const b = bookWith('abc');
    b.comment('d1', 'ann', 1, { baseRev: 0, id: 'c1', from: 0, to: 3, body: 'hm' });
    b.comment('d1', 'bob', 2, {
      baseRev: 1,
      id: 'c2',
      from: 0,
      to: 3,
      body: 'agreed',
      replyTo: 'c1',
    });
    b.resolve('d1', 'ann', 3, 'c1', true);
    const d = b.get('d1')!;
    expect(d.comments.map((c) => [c.id, c.replyTo, c.resolved])).toEqual([
      ['c1', undefined, true],
      ['c2', 'c1', false],
    ]);
    expect(d.rev).toBe(3);
    expect(
      code(() => b.comment('d1', 'a', 1, { baseRev: 3, id: 'c1', from: 0, to: 1, body: 'x' })),
    ).toBe('bad_comment');
    expect(
      code(() => b.comment('d1', 'a', 1, { baseRev: 3, id: 'c3', from: 0, to: 9, body: 'x' })),
    ).toBe('bad_comment');
    expect(
      code(() => b.comment('d1', 'a', 1, { baseRev: 3, id: 'c3', from: 2, to: 1, body: 'x' })),
    ).toBe('bad_comment');
    expect(
      code(() =>
        b.comment('d1', 'a', 1, { baseRev: 3, id: 'c3', from: 0, to: 1, body: 'x', replyTo: 'zz' }),
      ),
    ).toBe('bad_comment');
    expect(code(() => b.resolve('d1', 'a', 1, 'zz', true))).toBe('bad_comment');
  });

  it('keeps read receipts, never backwards and never past the draft', () => {
    const b = bookWith('abc');
    b.edit('d1', 'ann', 1, { baseRev: 0, op: insertAt(3, 0, 'x') });
    b.edit('d1', 'ann', 2, { baseRev: 1, op: insertAt(4, 0, 'y') });
    expect(b.read('d1', 'bob', 1)).toBe(1);
    expect(b.read('d1', 'bob', 1)).toBeUndefined();
    expect(b.read('d1', 'bob', 0)).toBeUndefined();
    expect(b.read('d1', 'bob', 99)).toBe(2);
    expect(b.get('d1')!.receipts).toEqual({ bob: 2 });
  });
});

describe('forks and merge', () => {
  it('forks the current wording, edits apart, and merges back past changes in the parent', () => {
    const b = bookWith('Cross the river at noon sharp');
    const at = (t: string, w: string) => t.indexOf(w);
    b.edit('d1', 'ann', 1, { baseRev: 0, op: insertAt(29, 0, 'Colonel: ') });
    const fork = b.fork('d1', 'd2', 'bob');
    expect(fork.text).toBe('Colonel: Cross the river at noon sharp');
    expect(fork.forkOf).toEqual({ draft: 'd1', rev: 1 });
    // Plan B in the fork: go at dawn.
    const n = at(fork.text, 'noon');
    b.edit('d2', 'bob', 5, { baseRev: 0, op: deleteAt(38, n, 4) });
    b.edit('d2', 'bob', 6, { baseRev: 1, op: insertAt(34, n, 'dawn') });
    // Meanwhile the parent moves on.
    b.edit('d1', 'ann', 7, { baseRev: 1, op: insertAt(38, 38, ', sir') });
    b.edit('d1', 'cy', 8, { baseRev: 2, op: insertAt(43, 18, ' wide') });
    expect(b.get('d1')!.text).toBe('Colonel: Cross the wide river at noon sharp, sir');
    const merged = b.merge('d2', 20);
    expect(merged.parent).toBe('d1');
    const d = b.get('d1')!;
    expect(d.text).toBe('Colonel: Cross the wide river at dawn sharp, sir');
    expect(merged.entries.every((e) => e.author === 'bob' && e.viaFork === 'd2')).toBe(true);
    expect(d.rev).toBe(5);
    expect(b.get('d2')!.mergedInto).toBe('d1');
    // A merged fork is closed.
    expect(code(() => b.edit('d2', 'bob', 1, { baseRev: 2, op: [] }))).toBe('draft_closed');
    expect(code(() => b.merge('d2', 1))).toBe('draft_closed');
    expect(code(() => b.fork('d2', 'd3', 'bob'))).toBe('draft_closed');
  });

  it('keeps parent and fork independent until merged, and a fork may be forked again', () => {
    const b = bookWith('abc');
    b.fork('d1', 'd2', 'bob');
    b.fork('d2', 'd3', 'cy');
    b.edit('d3', 'cy', 1, { baseRev: 0, op: insertAt(3, 3, '!') });
    expect(b.get('d1')!.text).toBe('abc');
    expect(b.get('d2')!.text).toBe('abc');
    b.merge('d3', 2);
    expect(b.get('d2')!.text).toBe('abc!');
    expect(b.get('d1')!.text).toBe('abc');
    b.merge('d2', 3);
    expect(b.get('d1')!.text).toBe('abc!');
    expect(b.get('d1')!.authors).toEqual([
      { author: 'ann', len: 3 },
      { author: 'cy', len: 1 },
    ]);
  });

  it('refuses to merge a draft that is not a fork, or a merge that would overflow, changing nothing', () => {
    const b = bookWith('a'.repeat(1500));
    expect(code(() => b.merge('d1', 1))).toBe('not_a_fork');
    b.fork('d1', 'd2', 'bob');
    b.edit('d2', 'bob', 1, { baseRev: 0, op: insertAt(1500, 1500, 'b'.repeat(400)) });
    b.edit('d1', 'ann', 2, { baseRev: 0, op: insertAt(1500, 0, 'c'.repeat(400)) });
    expect(code(() => b.merge('d2', 3))).toBe('bad_op');
    expect(b.get('d1')!.text.length).toBe(1900);
    expect(b.get('d2')!.mergedInto).toBeUndefined();
  });

  it('limits how many drafts a side keeps', () => {
    const b = new DraftBook();
    for (let i = 0; i < 50; i++) b.create(`d${i}`, 'ann');
    expect(code(() => b.create('more', 'ann'))).toBe('too_many_drafts');
    expect(code(() => b.create('d3', 'ann'))).toBe('draft_exists');
  });
});

describe('persistence', () => {
  it('round-trips through JSON', () => {
    const b = bookWith('abc');
    b.edit('d1', 'bob', 1, { baseRev: 0, op: insertAt(3, 1, 'X') });
    b.comment('d1', 'ann', 2, { baseRev: 1, id: 'c', from: 0, to: 2, body: 'hi' });
    b.read('d1', 'bob', 2);
    const again = DraftBook.from(JSON.parse(JSON.stringify(b.toJSON())));
    expect(again.toJSON()).toEqual(b.toJSON());
    again.edit('d1', 'cy', 3, { baseRev: 0, op: insertAt(3, 0, '>') });
    expect(again.get('d1')!.text).toBe('>aXbc');
  });
});
