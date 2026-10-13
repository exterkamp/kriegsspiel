import { describe, expect, it } from 'vitest';
import { apply, diff, reattribute } from './ot.js';

describe('diff', () => {
  it.each([
    ['', 'abc'],
    ['abc', ''],
    ['abc', 'abc'],
    ['hold the bridge', 'hold the old bridge'],
    ['aaa', 'aa'],
    ['abab', 'ab'],
    ['x😀y', 'x😁y'],
  ])('turns %j into %j', (a, b) => {
    expect(apply(a, diff(a, b))).toBe(b);
  });

  it('keeps the start and end and replaces the middle', () => {
    expect(diff('Hold the bridge', 'Hold a bridge')).toEqual([5, 'a', -3, 7]);
  });

  it('never cuts a surrogate pair in two', () => {
    expect(diff('😀', '😁')).toEqual(['😁', -2]);
  });
});

describe('reattribute', () => {
  it('gives inserted text to the editor and drops deleted runs', () => {
    expect(
      reattribute(
        [
          { author: 'a', len: 5 },
          { author: 'b', len: 5 },
        ],
        [3, -4, 'XY', 3],
        'c',
      ),
    ).toEqual([
      { author: 'a', len: 3 },
      { author: 'c', len: 2 },
      { author: 'b', len: 3 },
    ]);
  });

  it('refuses an op longer than the runs', () => {
    expect(() => reattribute([{ author: 'a', len: 2 }], [5], 'b')).toThrow();
  });
});
