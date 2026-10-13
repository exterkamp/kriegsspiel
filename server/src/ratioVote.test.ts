import { describe, expect, it } from 'vitest';
import { RatioVoting } from './ratioVote.js';

const cfg = { voters: ['a', 'b', 'c'], voteTimeoutMs: 1000 };

describe('RatioVoting', () => {
  it('unanimous: needs every yes, and passes with the proposed ratio', () => {
    const v = new RatioVoting(cfg);
    expect(v.propose('r1', 'a', 12, 1, 0)).toMatchObject({ outcome: 'proposed', rate: 12 });
    expect(v.vote('b', 'r1', true, 10)).toEqual([]);
    expect(v.vote('c', 'r1', true, 20)).toMatchObject([
      { outcome: 'passed', rate: 12, cause: 'all-yes' },
    ]);
    expect(v.open).toBeUndefined();
  });

  it('unanimous: one no fails it', () => {
    const v = new RatioVoting(cfg);
    v.propose('r1', 'a', 4, 1, 0);
    expect(v.vote('b', 'r1', false, 10)).toMatchObject([{ outcome: 'failed', cause: 'no-vote' }]);
    expect(v.open).toBeUndefined();
  });

  it('majority: two of three pass', () => {
    const v = new RatioVoting({ ...cfg, rule: 'majority' });
    v.propose('r1', 'a', 4, 1, 0);
    expect(v.vote('b', 'r1', true, 10)).toMatchObject([
      { outcome: 'passed', cause: 'majority-yes' },
    ]);
  });

  it('a lone voter decides at once', () => {
    const v = new RatioVoting({ voters: ['a'] });
    expect(v.propose('r1', 'a', 4, 1, 0)).toMatchObject({ outcome: 'passed', rate: 4 });
  });

  it('times out, and a late vote finds it timed out', () => {
    const v = new RatioVoting(cfg);
    v.propose('r1', 'a', 4, 1, 0);
    expect(v.deadlineMs).toBe(1000);
    expect(v.isDue(999)).toBe(false);
    expect(v.vote('b', 'r1', true, 1000)).toMatchObject([{ outcome: 'timeout' }]);
    expect(v.open).toBeUndefined();
    v.propose('r2', 'a', 4, 1, 2000);
    expect(v.expire(3000)).toMatchObject({ outcome: 'timeout', proposal: 'r2' });
  });

  it('refuses bad proposals and votes', () => {
    const v = new RatioVoting(cfg);
    expect(() => v.propose('r1', 'x', 4, 1, 0)).toThrow(/not a voter/);
    expect(() => v.propose('r1', 'a', 0, 1, 0)).toThrow(RangeError);
    expect(() => v.propose('r1', 'a', NaN, 1, 0)).toThrow(RangeError);
    expect(() => v.propose('r1', 'a', 1, 1, 0)).toThrow(/already/);
    v.propose('r1', 'a', 4, 1, 0);
    expect(() => v.propose('r2', 'b', 8, 1, 0)).toThrow(/already open/);
    expect(() => v.vote('a', 'r1', true, 1)).toThrow(/already voted/);
    expect(() => v.vote('b', 'nope', true, 1)).toThrow(/no open/);
  });
});

describe('RatioVoting.setVoters', () => {
  it('lets a joiner vote, and drops the vote of one who left', () => {
    const v = new RatioVoting(cfg);
    v.propose('r1', 'a', 4, 1, 0);
    v.vote('b', 'r1', true, 1);
    v.setVoters(['a', 'c', 'd']);
    expect(v.open?.votes).toEqual({ a: true });
    expect(() => v.vote('b', 'r1', true, 2)).toThrow(/not a voter/);
    v.vote('d', 'r1', true, 3);
    expect(v.vote('c', 'r1', true, 4)).toMatchObject([{ outcome: 'passed' }]);
  });
});
