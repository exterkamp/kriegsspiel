// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeRenderer {
    setPixelRatio(): void {}
    setSize(): void {}
    render(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

import { PROTOCOL_VERSION, type ClockState } from '@kriegsspiel/protocol';
import { clockSummary, clockView } from './clock.js';
import { applyServerMessage, initialState, type ClientState } from '../net/state.js';

const v = PROTOCOL_VERSION;
const withClock = (s: ClientState, clock: ClockState, at = 0): ClientState =>
  applyServerMessage(s, { v, kind: 'clockState', clock }, at);
const clock = (rate: number, status: ClockState['status']): ClockState => ({
  gameMsAtAnchor: 3_600_000,
  wallMsAtAnchor: 0,
  rate,
  status,
});

describe('clockView', () => {
  it('has a placeholder before the server sends a clock', () => {
    expect(clockView(initialState, 0)).toMatchObject({ status: 'none', rate: '' });
    expect(clockSummary(clockView(initialState, 0))).toBe('No clock yet');
  });

  it('runs forward at the rate 1, 4 and 12', () => {
    for (const [rate, mins] of [
      [1, 1],
      [4, 4],
      [12, 12],
    ] as const) {
      const s = withClock(initialState, clock(rate, 'running'));
      expect(clockView(s, 60_000)).toMatchObject({
        time: `Day 1 01:${String(mins).padStart(2, '0')}`,
        rate: `${rate}:1`,
        status: 'running',
      });
    }
  });

  it('holds game time while paused or stopped', () => {
    for (const status of ['paused', 'stopped'] as const) {
      const s = withClock(initialState, clock(12, status));
      const view = clockView(s, 600_000);
      expect(view.time).toBe('Day 1 01:00');
      expect(view.status).toBe(status);
    }
  });

  it('shows staff at work only while the umpire is working and the game is on', () => {
    let s = withClock(initialState, clock(4, 'running'));
    expect(clockView(s, 0).staffAtWork).toBe(false);
    s = applyServerMessage(s, { v, kind: 'staffAtWork', working: true }, 0);
    expect(clockView(s, 0).staffAtWork).toBe(true);
    expect(clockSummary(clockView(s, 0))).toContain('staff at work');
    s = applyServerMessage(
      s,
      { v, kind: 'gameOver', winner: 'blue', reason: 'objective-held', atGame: 1 },
      0,
    );
    expect(clockView(s, 0).staffAtWork).toBe(false);
  });
});
