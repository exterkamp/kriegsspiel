import { describe, expect, it } from 'vitest';
import {
  apply,
  deleteAt,
  identity,
  insertAt,
  normalize,
  transform,
  transformIndex,
  transformRange,
  transformThrough,
  type TextOp,
} from './ot.js';

/** A small deterministic generator, so the property test is repeatable. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomOp(text: string, next: () => number): TextOp {
  const op: TextOp = [];
  let at = 0;
  while (at < text.length) {
    const n = Math.min(text.length - at, 1 + Math.floor(next() * 4));
    const r = next();
    if (r < 0.4) op.push(n);
    else if (r < 0.7) op.push(-n);
    else {
      op.push(n, 'xyz'.slice(0, 1 + Math.floor(next() * 3)));
    }
    at += n;
  }
  if (next() < 0.3) op.push('Q');
  return normalize(op);
}

describe('apply', () => {
  it('keeps, deletes and inserts', () => {
    expect(apply('hello world', [6, -5, 'there'])).toBe('hello there');
    expect(apply('', ['abc'])).toBe('abc');
    expect(apply('abc', identity(3))).toBe('abc');
  });

  it('refuses an op made on a text of another length', () => {
    expect(() => apply('abc', [2])).toThrow();
  });

  it('builds simple edits', () => {
    expect(apply('abcdef', insertAt(6, 3, 'X'))).toBe('abcXdef');
    expect(apply('abcdef', deleteAt(6, 1, 2))).toBe('adef');
  });
});

describe('normalize', () => {
  it('merges neighbours and puts inserts before deletes', () => {
    expect(normalize([1, 2, 'a', -1, 'b', -2])).toEqual([3, 'ab', -3]);
  });
});

describe('transform', () => {
  it('puts the first op first when both insert at one spot', () => {
    const [a2, b2] = transform(['A', 3], ['B', 3]);
    expect(apply(apply('abc', ['A', 3]), b2)).toBe('BAabc'.replace('BA', 'AB'));
    expect(apply(apply('abc', ['B', 3]), a2)).toBe('ABabc');
  });

  it('survives both sides deleting the same text', () => {
    const a: TextOp = [1, -3, 1];
    const b: TextOp = [2, -2, 1];
    const [a2, b2] = transform(a, b);
    expect(apply(apply('abcde', a), b2)).toBe('ae');
    expect(apply(apply('abcde', b), a2)).toBe('ae');
  });

  it('rejects ops on texts of different lengths', () => {
    expect(() => transform([2], [3])).toThrow();
  });

  it('converges for random pairs of edits', () => {
    const next = rng(7);
    for (let i = 0; i < 500; i++) {
      const len = Math.floor(next() * 12);
      const text = 'abcdefghijkl'.slice(0, len);
      const a = randomOp(text, next);
      const b = randomOp(text, next);
      const [a2, b2] = transform(a, b);
      expect(apply(apply(text, a), b2)).toBe(apply(apply(text, b), a2));
    }
  });
});

describe('transformThrough', () => {
  it('moves an op past a run of edits and returns the run as it reads after the op', () => {
    const base = 'abcdef';
    const run: TextOp[] = [insertAt(6, 0, '12'), deleteAt(8, 4, 2)];
    const op = insertAt(6, 5, 'Z');
    const [moved, runAfter] = transformThrough(op, run);
    const viaRun = run.reduce((t, r) => apply(t, r), base);
    const viaOp = runAfter.reduce((t, r) => apply(t, r), apply(base, op));
    expect(apply(viaRun, moved)).toBe(viaOp);
  });
});

describe('transformIndex and transformRange', () => {
  it('moves points and ranges with the text', () => {
    expect(transformIndex(4, insertAt(10, 2, 'ab'), 'before')).toBe(6);
    expect(transformIndex(4, deleteAt(10, 1, 5), 'before')).toBe(1);
    expect(transformIndex(2, insertAt(10, 2, 'ab'), 'before')).toBe(2);
    expect(transformIndex(2, insertAt(10, 2, 'ab'), 'after')).toBe(4);
    expect(transformRange({ from: 2, to: 6 }, insertAt(10, 4, 'xx'))).toEqual({ from: 2, to: 8 });
    expect(transformRange({ from: 2, to: 6 }, deleteAt(10, 0, 8))).toEqual({ from: 0, to: 0 });
  });
});
