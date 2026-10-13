import { describe, expect, it } from 'vitest';
import { GameClock } from './clock.js';

function fakeWall(start = 1_000_000) {
  let t = start;
  const fn = () => t;
  fn.advance = (ms: number) => {
    t += ms;
  };
  return fn;
}

describe('GameClock realtime', () => {
  it.each([1, 4, 12, 2.5])('runs at rate %d', (rate) => {
    const wall = fakeWall();
    const clock = new GameClock(wall, { rate });
    expect(clock.now()).toBe(0);
    wall.advance(1000);
    expect(clock.now()).toBe(1000 * rate);
  });

  it('honours an initial game time', () => {
    const wall = fakeWall();
    const clock = new GameClock(wall, { gameMs: 5000, rate: 4 });
    wall.advance(100);
    expect(clock.now()).toBe(5400);
  });

  it('does not jump when the rate changes mid-run', () => {
    const wall = fakeWall();
    const clock = new GameClock(wall, { rate: 1 });
    wall.advance(1000);
    expect(clock.now()).toBe(1000);
    clock.setRate(12);
    expect(clock.now()).toBe(1000);
    wall.advance(1000);
    expect(clock.now()).toBe(1000 + 12_000);
    clock.setRate(4);
    expect(clock.now()).toBe(13_000);
    wall.advance(500);
    expect(clock.now()).toBe(15_000);
  });

  it('rejects invalid rates', () => {
    const wall = fakeWall();
    expect(() => new GameClock(wall, { rate: 0 })).toThrow(RangeError);
    const clock = new GameClock(wall);
    for (const bad of [0, -1, NaN, Infinity]) expect(() => clock.setRate(bad)).toThrow(RangeError);
    expect(clock.rate).toBe(1);
  });

  it('pause and resume leave game time exactly unchanged', () => {
    const wall = fakeWall();
    const clock = new GameClock(wall, { rate: 12 });
    wall.advance(777);
    const before = clock.now();
    clock.pause();
    expect(clock.status).toBe('paused');
    expect(clock.now()).toBe(before);
    wall.advance(1_000_000);
    expect(clock.now()).toBe(before);
    clock.resume();
    expect(clock.now()).toBe(before);
    wall.advance(10);
    expect(clock.now()).toBe(before + 120);
  });

  it('changing rate while paused takes effect on resume', () => {
    const wall = fakeWall();
    const clock = new GameClock(wall, { rate: 1 });
    wall.advance(1000);
    clock.pause();
    clock.setRate(4);
    wall.advance(5000);
    expect(clock.now()).toBe(1000);
    clock.resume();
    wall.advance(1000);
    expect(clock.now()).toBe(5000);
  });

  it('pause and resume are idempotent', () => {
    const wall = fakeWall();
    const clock = new GameClock(wall);
    clock.resume();
    clock.pause();
    clock.pause();
    wall.advance(50);
    clock.resume();
    clock.resume();
    wall.advance(50);
    expect(clock.now()).toBe(50);
  });

  it('stop freezes the clock for good', () => {
    const wall = fakeWall();
    const clock = new GameClock(wall);
    wall.advance(100);
    clock.stop();
    wall.advance(100);
    expect(clock.now()).toBe(100);
    expect(() => clock.resume()).toThrow();
  });

  it('stop can freeze at a given game time earlier than the current reading', () => {
    const wall = fakeWall();
    const clock = new GameClock(wall);
    wall.advance(1000);
    // The tick that notices the outcome runs late: the reading has moved past the end.
    expect(clock.now()).toBe(1000);
    clock.stop(400);
    expect(clock.now()).toBe(400);
    wall.advance(1000);
    expect(clock.now()).toBe(400);
    expect(clock.history().at(-1)).toMatchObject({ kind: 'stop', gameMs: 400, status: 'stopped' });
    // A given time in the future clamps to the current reading instead of jumping forward.
    const wall2 = fakeWall();
    const clock2 = new GameClock(wall2);
    wall2.advance(100);
    clock2.stop(500);
    expect(clock2.now()).toBe(100);
  });

  it('converts wall time to game time and back', () => {
    const wall = fakeWall(0);
    const clock = new GameClock(wall, { rate: 4 });
    wall.advance(1000);
    clock.setRate(12);
    // anchor: game 4000 @ wall 1000
    expect(clock.wallDueFor(4000 + 12_000)).toBe(2000);
    expect(clock.gameMsAtWall(2000)).toBe(16_000);
    expect(clock.wallDueFor(clock.gameMsAtWall(3500))).toBe(3500);
    expect(clock.wallDueFor(1000)).toBeLessThan(wall()); // already due
  });

  it('wallDueFor is Infinity while paused, unless already reached', () => {
    const wall = fakeWall(0);
    const clock = new GameClock(wall);
    wall.advance(1000);
    clock.pause();
    expect(clock.wallDueFor(2000)).toBe(Infinity);
    expect(clock.wallDueFor(500)).toBeLessThanOrEqual(wall());
  });

  it('wallDueFor predicts the actual wake time across a rate change', () => {
    const wall = fakeWall(0);
    const clock = new GameClock(wall, { rate: 1 });
    const due = clock.wallDueFor(10_000);
    expect(due).toBe(10_000);
    wall.advance(5000);
    clock.setRate(5); // 5000 game ms left at 5x => 1000 wall ms
    expect(clock.wallDueFor(10_000)).toBe(6000);
  });

  it('logs every change with its wall time', () => {
    const wall = fakeWall(0);
    const clock = new GameClock(wall);
    wall.advance(1000);
    clock.setRate(4);
    wall.advance(1000);
    clock.pause();
    wall.advance(1000);
    clock.resume();
    expect(clock.history().map((c) => [c.kind, c.wallMs, c.gameMs, c.rate, c.status])).toEqual([
      ['rate', 1000, 1000, 4, 'running'],
      ['pause', 2000, 5000, 4, 'paused'],
      ['resume', 3000, 5000, 4, 'running'],
    ]);
  });
});

describe('GameClock robustness', () => {
  it('never moves game time backwards when the wall source steps back', () => {
    const wall = fakeWall();
    const clock = new GameClock(wall, { rate: 4 });
    wall.advance(1000);
    expect(clock.now()).toBe(4000);
    wall.advance(-500);
    expect(clock.now()).toBe(4000);
    expect(clock.gameMsAtWall(999_000)).toBe(0);
  });

  it('rejects a non-finite initial game time', () => {
    expect(() => new GameClock(fakeWall(), { gameMs: NaN })).toThrow(RangeError);
    expect(() => new GameClock(fakeWall(), { gameMs: Infinity })).toThrow(RangeError);
  });

  it('history returns a copy that callers cannot use to change the log', () => {
    const clock = new GameClock(fakeWall());
    clock.setRate(2);
    const h = clock.history();
    (h[0] as { rate: number }).rate = 99;
    clock.pause();
    expect(clock.history()).toHaveLength(2);
    expect(clock.history()[0]!.rate).toBe(2);
  });

  it('logs mode, advance and stop entries', () => {
    const wall = fakeWall();
    const clock = new GameClock(wall, { rate: 2 });
    wall.advance(1000);
    clock.setMode('manual');
    clock.advanceTo(5000);
    clock.setMode('fast-forward');
    clock.stop();
    expect(
      clock.history().map((c) => [c.kind, c.wallMs, c.gameMs, c.rate, c.status, c.mode]),
    ).toEqual([
      ['mode', 1_001_000, 2000, 2, 'running', 'manual'],
      ['advance', 1_001_000, 5000, 2, 'running', 'manual'],
      ['mode', 1_001_000, 5000, 2, 'running', 'fast-forward'],
      ['stop', 1_001_000, 5000, 2, 'stopped', 'fast-forward'],
    ]);
  });
});

describe('GameClock manual', () => {
  it('ignores wall time and moves only when told', () => {
    const wall = fakeWall();
    const clock = new GameClock(wall, { mode: 'manual', rate: 12 });
    wall.advance(1_000_000);
    expect(clock.now()).toBe(0);
    clock.advanceTo(5000);
    expect(clock.now()).toBe(5000);
    clock.step(250);
    expect(clock.now()).toBe(5250);
    wall.advance(1_000_000);
    expect(clock.now()).toBe(5250);
  });

  it('never moves backwards and rejects bad input', () => {
    const clock = new GameClock(fakeWall(), { mode: 'manual', gameMs: 100 });
    expect(() => clock.advanceTo(50)).toThrow(RangeError);
    expect(() => clock.step(-1)).toThrow(RangeError);
    expect(() => clock.advanceTo(NaN)).toThrow(RangeError);
    expect(clock.now()).toBe(100);
  });

  it('refuses to advance while paused', () => {
    const clock = new GameClock(fakeWall(), { mode: 'manual' });
    clock.pause();
    expect(() => clock.step(1)).toThrow();
    clock.resume();
    clock.step(1);
    expect(clock.now()).toBe(1);
  });

  it('is never due by wall time until reached', () => {
    const wall = fakeWall();
    const clock = new GameClock(wall, { mode: 'manual' });
    expect(clock.wallDueFor(1000)).toBe(Infinity);
    clock.advanceTo(1000);
    expect(clock.wallDueFor(1000)).toBe(wall());
  });

  it('advanceTo is not available in realtime mode', () => {
    const clock = new GameClock(fakeWall());
    expect(() => clock.advanceTo(10)).toThrow();
  });
});

describe('GameClock fast-forward', () => {
  it('is due immediately, with no waiting', () => {
    const wall = fakeWall();
    const clock = new GameClock(wall, { mode: 'fast-forward' });
    expect(clock.wallDueFor(10 ** 12)).toBe(wall());
    clock.advanceTo(10 ** 12);
    expect(clock.now()).toBe(10 ** 12);
    wall.advance(1000);
    expect(clock.now()).toBe(10 ** 12);
  });

  it('switching modes re-anchors without a jump', () => {
    const wall = fakeWall();
    const clock = new GameClock(wall, { rate: 4 });
    wall.advance(1000);
    clock.setMode('manual');
    wall.advance(1000);
    expect(clock.now()).toBe(4000);
    clock.step(500);
    clock.setMode('realtime');
    wall.advance(1000);
    expect(clock.now()).toBe(4500 + 4000);
  });
});

describe('GameClock barrier', () => {
  it.each([1, 4, 12])('stalls at the barrier and resumes without jumping at rate %d', (rate) => {
    const wall = fakeWall();
    const clock = new GameClock(wall, { rate });
    wall.advance(1000);
    const at = clock.now();
    clock.setBarrier(at);
    wall.advance(60_000);
    expect(clock.now()).toBe(at);
    expect(clock.wallDueFor(at + 1)).toBe(Infinity);
    expect(clock.wallDueFor(at)).toBeLessThanOrEqual(wall());

    clock.setBarrier(undefined);
    expect(clock.now()).toBe(at);
    wall.advance(1000);
    expect(clock.now()).toBe(at + 1000 * rate);
  });

  it('lets time run up to a later barrier', () => {
    const wall = fakeWall();
    const clock = new GameClock(wall, { rate: 1 });
    clock.setBarrier(5000);
    wall.advance(3000);
    expect(clock.now()).toBe(3000);
    wall.advance(10_000);
    expect(clock.now()).toBe(5000);
  });

  it('holds a manual advance at the barrier and rejects a barrier in the past', () => {
    const wall = fakeWall();
    const clock = new GameClock(wall, { mode: 'manual' });
    clock.advanceTo(100);
    clock.setBarrier(500);
    clock.advanceTo(9000);
    expect(clock.now()).toBe(500);
    expect(() => clock.setBarrier(10)).toThrow(RangeError);
  });

  it('keeps the barrier through rate changes', () => {
    const wall = fakeWall();
    const clock = new GameClock(wall, { rate: 1 });
    clock.setBarrier(0);
    clock.setRate(12);
    wall.advance(1000);
    expect(clock.now()).toBe(0);
  });
});

describe('GameClock.skipTo (admin step, #128)', () => {
  it.each([
    ['realtime', 'running'],
    ['realtime', 'paused'],
    ['manual', 'running'],
    ['fast-forward', 'paused'],
  ] as const)('moves %s %s time forward in one change and keeps both', (mode, status) => {
    const wall = fakeWall();
    const clock = new GameClock(wall, { rate: 4, mode, status });
    clock.skipTo(60_000);
    expect(clock.now()).toBe(60_000);
    expect(clock.mode).toBe(mode);
    expect(clock.status).toBe(status);
    expect(clock.history().map((c) => c.kind)).toEqual(['advance']);
  });

  it('stalls at the barrier, never goes back, and refuses a stopped clock', () => {
    const wall = fakeWall();
    const clock = new GameClock(wall, { status: 'paused' });
    clock.skipTo(1000);
    clock.setBarrier(1500);
    clock.skipTo(9000);
    expect(clock.now()).toBe(1500);
    // The anchor and the audit entry are capped too, not just the reading.
    expect(clock.snapshot().gameMsAtAnchor).toBe(1500);
    expect(clock.history().at(-1)).toMatchObject({ kind: 'advance', gameMs: 1500 });
    clock.skipTo(10);
    expect(clock.now()).toBe(1500);
    clock.stop();
    expect(() => clock.skipTo(2000)).toThrow('clock is stopped');
  });
});
