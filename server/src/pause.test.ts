import { describe, expect, it } from 'vitest';
import { PauseVoting, type PauseConfig } from './pause.js';

const voters = ['a', 'b', 'c'];
const make = (c: Partial<PauseConfig> = {}, phase: 'running' | 'paused' = 'running') =>
  new PauseVoting({ voters, voteTimeoutMs: 1000, ...c }, { phase, nowMs: 0 });

describe('PauseVoting', () => {
  it('pauses when every voter says yes', () => {
    const m = make();
    expect(m.propose('p1', 'a', 0, 'door')).toMatchObject({
      from: 'running',
      to: 'pause_proposed',
    });
    expect(m.open).toMatchObject({ by: 'a', reason: 'door', votes: { a: true } });
    expect(m.vote('b', 'p1', true, 10)).toEqual([]);
    expect(m.vote('c', 'p1', true, 20)).toMatchObject([
      { from: 'pause_proposed', to: 'paused', cause: 'all-yes', proposal: 'p1', by: 'c' },
    ]);
    expect(m.open).toBeUndefined();
  });

  it('a single no cancels', () => {
    const m = make();
    m.propose('p1', 'a', 0);
    expect(m.vote('b', 'p1', false, 5)).toMatchObject([{ to: 'running', cause: 'no-vote' }]);
    expect(m.phase).toBe('running');
  });

  it('times out and cancels', () => {
    const m = make();
    m.propose('p1', 'a', 0);
    expect(m.deadlineMs).toBe(1000);
    expect(m.expire(999)).toBeUndefined();
    expect(m.expire(1000)).toMatchObject({ to: 'running', cause: 'timeout' });
    expect(m.deadlineMs).toBeUndefined();
  });

  it('a late vote finds the proposal timed out instead of passing it', () => {
    const m = make();
    m.propose('p1', 'a', 0);
    m.vote('b', 'p1', true, 10);
    expect(m.vote('c', 'p1', true, 1000)).toMatchObject([{ to: 'running', cause: 'timeout' }]);
    expect(m.phase).toBe('running');
  });

  it('with the majority rule, more than half decide', () => {
    const m = make({ rule: 'majority' });
    m.propose('p1', 'a', 0);
    expect(m.vote('b', 'p1', true, 1)).toMatchObject([{ to: 'paused', cause: 'majority-yes' }]);
    const n = make({ rule: 'majority' });
    n.propose('p1', 'a', 0);
    // One no does not cancel while a majority is still possible; a second one does.
    expect(n.vote('b', 'p1', false, 1)).toEqual([]);
    expect(n.vote('c', 'p1', false, 2)).toMatchObject([{ to: 'running', cause: 'no-vote' }]);
  });

  it('a lone voter pauses at once', () => {
    const m = new PauseVoting({ voters: ['a'] }, { phase: 'running', nowMs: 0 });
    expect(m.propose('p1', 'a', 0)).toMatchObject({ from: 'pause_proposed', to: 'paused' });
  });

  it('resumes by vote; a no or a timeout leaves it paused', () => {
    const m = make({}, 'paused');
    m.propose('p2', 'a', 0);
    expect(m.phase).toBe('resume_proposed');
    expect(m.vote('b', 'p2', false, 1)).toMatchObject([{ to: 'paused', cause: 'no-vote' }]);
    m.propose('p3', 'b', 2);
    expect(m.expire(2000)).toMatchObject({ to: 'paused', cause: 'timeout' });
    m.propose('p4', 'c', 3000);
    m.vote('a', 'p4', true, 3001);
    expect(m.vote('b', 'p4', true, 3002)).toMatchObject([{ to: 'running', cause: 'all-yes' }]);
  });

  it('resumes by itself at the maximum pause length, even mid-vote', () => {
    const m = make({ maxPauseMs: 5000 }, 'paused');
    expect(m.deadlineMs).toBe(5000);
    m.propose('p2', 'a', 4500);
    expect(m.deadlineMs).toBe(5000);
    expect(m.expire(5000)).toMatchObject({
      from: 'resume_proposed',
      to: 'running',
      cause: 'max-pause',
    });
    expect(m.open).toBeUndefined();
  });

  it('counts the maximum pause from when the pause began', () => {
    const m = make({ maxPauseMs: 5000 });
    m.propose('p1', 'a', 0);
    m.vote('b', 'p1', true, 100);
    m.vote('c', 'p1', true, 200);
    expect(m.deadlineMs).toBe(5200);
  });

  it('refuses non-voters, stale proposals, double votes and bad phases', () => {
    const m = make();
    expect(() => m.propose('p1', 'zed', 0)).toThrow(/not a voter/);
    m.propose('p1', 'a', 0);
    expect(() => m.propose('p2', 'b', 0)).toThrow(/cannot propose/);
    expect(() => m.vote('b', 'nope', true, 0)).toThrow(/no open proposal/);
    expect(() => m.vote('a', 'p1', true, 0)).toThrow(/already voted/);
    expect(() => m.vote('zed', 'p1', true, 0)).toThrow(/not a voter/);
  });
});
