import { describe, expect, it } from 'vitest';
import {
  BREAKER_MIN_COOLDOWN_MS,
  breakerAllows,
  breakerAt,
  breakerCooldownMs,
  breakerSummary,
  closedBreaker,
  recordNarrateCall,
  type NarrateBreakerState,
} from './narrateBreaker.js';

const MIN = 60_000;
const COOL = 30 * MIN;

function record(outcomes: boolean[], now = 0, from = closedBreaker()): NarrateBreakerState {
  return outcomes.reduce((s, ok) => recordNarrateCall(s, ok, now, COOL), from);
}

describe('narrate circuit breaker (#419)', () => {
  it('stays closed while most recent calls pass', () => {
    const s = record([false, true, false, true, true, true, false]);
    expect(breakerAllows(s, 0)).toBe(true);
    expect(s.recent).toHaveLength(5);
  });

  it('opens on 3 failures among the last 5 calls, for the cooling-off in game time', () => {
    const s = record([true, false, true, false, false], 10 * MIN);
    expect(s.pausedUntil).toBe(10 * MIN + COOL);
    expect(breakerAllows(s, 10 * MIN)).toBe(false);
    expect(breakerAllows(s, 10 * MIN + COOL - 1)).toBe(false);
    expect(breakerSummary(s)).toBe('model narration paused: 3 of 5 failed');
  });

  it('closes with a clean slate once the cooling-off has run out', () => {
    const open = record([false, false, false], 0);
    const later = breakerAt(open, COOL);
    expect(breakerAllows(later, COOL)).toBe(true);
    expect(later).toEqual(closedBreaker());
    // One more failure after it does not reopen it at once.
    expect(breakerAllows(recordNarrateCall(open, false, COOL, COOL), COOL)).toBe(true);
  });

  it('counts every call since it last closed for the summary', () => {
    const s = record([true, false, true, false, true, false]);
    expect(breakerSummary(s)).toBe('model narration paused: 3 of 6 failed');
  });

  it('is a pure function of the outcomes and the game time: the same calls give the same state', () => {
    const outcomes = [true, false, false, true, false, true];
    expect(record(outcomes, 5 * MIN)).toEqual(record(outcomes, 5 * MIN));
    expect(JSON.parse(JSON.stringify(record(outcomes)))).toEqual(record(outcomes));
  });

  it('cools off for three windows, never less than the minimum', () => {
    expect(breakerCooldownMs(5 * MIN)).toBe(BREAKER_MIN_COOLDOWN_MS);
    expect(breakerCooldownMs(20 * MIN)).toBe(60 * MIN);
  });
});
