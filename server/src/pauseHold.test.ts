import { describe, expect, it } from 'vitest';
import { PauseVoting, type PauseConfig } from './pause.js';

const voters = ['a', 'b', 'c'];
const make = (c: Partial<PauseConfig> = {}, holdsUsed?: Record<string, number>) =>
  new PauseVoting(
    { voters, voteTimeoutMs: 1000, holdMs: 5000, ...c },
    { phase: 'running', nowMs: 0, ...(holdsUsed ? { holdsUsed } : {}) },
  );

describe('PauseVoting emergency hold', () => {
  it('opens a ratification vote that ends at the hold length', () => {
    const m = make();
    expect(m.callHold('h1', 'a', 100, 'fire alarm')).toMatchObject({
      from: 'running',
      to: 'pause_proposed',
      cause: 'proposed',
      hold: true,
      by: 'a',
    });
    expect(m.open).toMatchObject({ hold: true, reason: 'fire alarm', deadlineMs: 5100 });
    expect(m.deadlineMs).toBe(5100);
  });

  it('lapses at the deadline back to running', () => {
    const m = make();
    m.callHold('h1', 'a', 0);
    expect(m.expire(4999)).toBeUndefined();
    expect(m.expire(5000)).toMatchObject({ to: 'running', cause: 'timeout', hold: true });
    expect(m.phase).toBe('running');
  });

  it('is ratified into an ordinary pause by the votes', () => {
    const m = make();
    m.callHold('h1', 'a', 0);
    expect(m.vote('b', 'h1', true, 10)).toEqual([]);
    expect(m.vote('c', 'h1', true, 20)).toMatchObject([
      { to: 'paused', cause: 'all-yes', hold: true },
    ]);
    expect(m.phase).toBe('paused');
    // Once ratified it is a normal pause, so the hold deadline no longer applies.
    expect(m.deadlineMs).toBeUndefined();
  });

  it('a single no ends the hold', () => {
    const m = make();
    m.callHold('h1', 'a', 0);
    expect(m.vote('b', 'h1', false, 10)).toMatchObject([
      { to: 'running', cause: 'no-vote', hold: true },
    ]);
  });

  it('a lone voter ratifies at once', () => {
    const m = new PauseVoting({ voters: ['a'] }, { phase: 'running', nowMs: 0 });
    expect(m.callHold('h1', 'a', 0)).toMatchObject({ to: 'paused', cause: 'all-yes' });
  });

  it('limits each player and the game, and a lapsed hold still counts', () => {
    const m = make({ holdsPerPlayer: 2, holdsPerGame: 3 });
    expect(m.holdsLeft('a')).toBe(2);
    m.callHold('h1', 'a', 0);
    m.expire(5000);
    m.callHold('h2', 'a', 6000);
    m.expire(11_000);
    expect(m.holdsLeft('a')).toBe(0);
    expect(() => m.callHold('h3', 'a', 12_000)).toThrow(/hold limit reached for player/);
    m.callHold('h3', 'b', 12_000);
    m.expire(17_000);
    expect(m.holdsLeft('c')).toBe(0);
    expect(() => m.callHold('h4', 'c', 18_000)).toThrow(/hold limit reached for game/);
    expect(m.phase).toBe('running');
  });

  it('zero holds per game turns holds off', () => {
    const m = make({ holdsPerGame: 0 });
    expect(() => m.callHold('h1', 'a', 0)).toThrow(/hold limit/);
  });

  it('counts holds restored from the log', () => {
    const m = make({ holdsPerPlayer: 2 }, { a: 2 });
    expect(m.holdsLeft('a')).toBe(0);
    expect(m.holdsLeft('b')).toBe(2);
  });

  it('only a voter can call one, and not while a vote or pause is open', () => {
    const m = make();
    expect(() => m.callHold('h1', 'mallory', 0)).toThrow(/not a voter/);
    m.callHold('h1', 'a', 0);
    expect(() => m.callHold('h2', 'b', 1)).toThrow(/cannot hold/);
    const paused = new PauseVoting({ voters }, { phase: 'paused', nowMs: 0 });
    expect(() => paused.callHold('h1', 'a', 0)).toThrow(/cannot hold/);
  });
});
