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
import {
  applyServerMessage,
  initialState,
  withTurnSettings,
  type ClientState,
} from '../net/state.js';

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

  it('stands at the final moment once the game is over, whatever the wall time', () => {
    let s = withClock(initialState, clock(12, 'running'));
    s = { ...s, gameOver: { winner: 'blue', reason: 'eliminated', atGame: 3_000_000 } };
    expect(clockView(s, 0).time).toBe('Day 1 00:50');
    expect(clockView(s, 600_000).time).toBe('Day 1 00:50');
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

  it('sums up a finished turn-mode game with no empty rate (D39)', () => {
    const s: ClientState = {
      ...initialState,
      turnMode: true,
      gameOver: { winner: 'blue', reason: 'eliminated', atGame: 3_000_000 },
    };
    expect(clockSummary(clockView(s, 0))).toBe('Day 1 00:50, game over');
  });

  it('shows a finished turn game reloaded from its settings as over, with its turn length (#429)', () => {
    // A reload after the end: the server sends no turnState, only the clock and the outcome.
    let s = withClock(initialState, clock(1, 'stopped'));
    s = applyServerMessage(
      s,
      { v, kind: 'gameOver', winner: 'red', reason: 'objective-taken', atGame: 2_400_000 },
      0,
    );
    // A finished real-time game says Game over too (#438).
    expect(clockView(s, 0)).toMatchObject({ rate: '1:1', status: 'stopped', label: 'Game over' });
    s = withTurnSettings(s, { dial: 'rigid', persona: 'dry', mode: 'turns', turnMinutes: 20 });
    const view = clockView(s, 0);
    expect(view).toMatchObject({
      time: 'Day 1 00:40',
      rate: '',
      turnLength: '20-min turns',
      status: 'stopped',
      label: 'Game over',
    });
    expect(clockSummary(view)).toBe('Day 1 00:40, game over, 20-min turns');
  });

  it('shows a live turn game as waiting, not over, before its first turnState (#429)', () => {
    // The settings can arrive before the socket's turnState, or while the socket is down.
    const s = withTurnSettings(withClock(initialState, clock(1, 'paused')), {
      dial: 'rigid',
      persona: 'dry',
      mode: 'turns',
      turnMinutes: 20,
    });
    const view = clockView(s, 0);
    expect(view).toMatchObject({
      rate: '',
      status: 'paused',
      label: 'Waiting for the turn',
      turnLength: '20-min turns',
    });
    expect(view.label).not.toBe('Game over');
  });

  it('leaves a real-time game as it was when its settings arrive', () => {
    const s = withClock(initialState, clock(4, 'running'));
    expect(withTurnSettings(s, { dial: 'standard', persona: 'dry' })).toBe(s);
    expect(withTurnSettings(s, undefined)).toBe(s);
  });

  it('drops turn mode left from an earlier turn game when a real-time game is opened', () => {
    const turns = withTurnSettings(withClock(initialState, clock(4, 'running')), {
      dial: 'rigid',
      persona: 'dry',
      mode: 'turns',
      turnMinutes: 20,
    });
    const s = withTurnSettings(turns, { dial: 'standard', persona: 'dry' });
    expect(s.turnMode).toBeUndefined();
    expect(s.turnMinutes).toBeUndefined();
    expect(clockView(s, 0)).toMatchObject({ rate: '4:1', label: 'Running' });
  });
});
