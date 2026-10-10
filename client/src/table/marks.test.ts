import { describe, expect, it } from 'vitest';
import type { Mark } from '@kriegsspiel/protocol';
import { Gesture, type GestureContext } from './markTools.js';
import {
  MARK_FADE_MS,
  distToMark,
  markAgeFactor,
  newMarkId,
  pickMark,
  simplifyPath,
  translateMark,
  withMark,
} from './marks.js';
import { applyServerMessage, initialState, withMarkDeleted, withMarkPut } from '../net/state.js';

const pin: Mark = {
  id: 'a',
  kind: 'pin',
  at: { x: 100, y: 100 },
  madeAtGame: 5000,
  sourceReport: 'd1',
};
const arrow: Mark = {
  id: 'b',
  kind: 'arrow',
  from: { x: 0, y: 0 },
  to: { x: 100, y: 0 },
  madeAtGame: 0,
};
const ring: Mark = { id: 'r', kind: 'ring', at: { x: 0, y: 0 }, radius: 50, madeAtGame: 0 };
const line: Mark = {
  id: 'l',
  kind: 'line',
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ],
  madeAtGame: 0,
};

describe('mark ageing', () => {
  it('is 0 when fresh, 1 when old, and moves in visible steps', () => {
    expect(markAgeFactor(1000, 1000)).toBe(0);
    expect(markAgeFactor(0, MARK_FADE_MS)).toBe(1);
    expect(markAgeFactor(0, MARK_FADE_MS * 10)).toBe(1);
    expect(markAgeFactor(0, MARK_FADE_MS / 2)).toBe(0.5);
    expect(markAgeFactor(5000, 0)).toBe(0);
    expect(markAgeFactor(0, 60_000)).toBe(0);
  });
});

describe('translateMark', () => {
  it('moves the geometry and keeps id, time and source report', () => {
    const moved = translateMark(pin, 5, -10);
    expect(moved).toEqual({ ...pin, at: { x: 105, y: 90 } });
    expect(translateMark(arrow, 1, 2)).toMatchObject({
      from: { x: 1, y: 2 },
      to: { x: 101, y: 2 },
    });
    expect(translateMark(line, 1, 1)).toMatchObject({
      points: [
        { x: 1, y: 1 },
        { x: 11, y: 1 },
        { x: 11, y: 11 },
      ],
    });
    expect(translateMark(ring, 3, 3)).toMatchObject({ at: { x: 3, y: 3 }, radius: 50 });
  });
});

describe('picking marks', () => {
  it('measures to the ink: along a line, on a ring’s edge, at a pin', () => {
    expect(distToMark(arrow, { x: 50, y: 7 })).toBeCloseTo(7);
    expect(distToMark(arrow, { x: 130, y: 0 })).toBeCloseTo(30);
    expect(distToMark(ring, { x: 0, y: 0 })).toBeCloseTo(50);
    expect(distToMark(ring, { x: 53, y: 0 })).toBeCloseTo(3);
    expect(distToMark(line, { x: 12, y: 5 })).toBeCloseTo(2);
    expect(distToMark(pin, { x: 103, y: 104 })).toBeCloseTo(5);
  });
  it('takes the nearest within tolerance, and nothing beyond it', () => {
    expect(pickMark([pin, arrow], { x: 99, y: 99 }, 10)?.id).toBe('a');
    expect(pickMark([pin, arrow], { x: 50, y: 2 }, 10)?.id).toBe('b');
    expect(pickMark([pin, arrow], { x: 300, y: 300 }, 10)).toBeUndefined();
  });
});

describe('simplifyPath', () => {
  it('drops close points and keeps both ends', () => {
    const pts = Array.from({ length: 101 }, (_, i) => ({ x: i, y: 0 }));
    const out = simplifyPath(pts, 10);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out.at(-1)).toEqual({ x: 100, y: 0 });
    expect(out.length).toBeLessThanOrEqual(12);
  });
});

describe('Gesture', () => {
  const ctx = (over: Partial<GestureContext> = {}): GestureContext => ({
    id: 'new',
    nowGame: 7000,
    marks: [],
    tolerance: 20,
    minStep: 10,
    ...over,
  });
  it('places a pin where the pointer lifts, stamped with game time and the note', () => {
    const g = new Gesture('pin', { x: 1, y: 1 }, ctx({ label: ' bridge ', sourceReport: 'd9' }));
    expect(g.finish({ x: 5, y: 6 })).toEqual({
      id: 'new',
      kind: 'pin',
      at: { x: 5, y: 6 },
      madeAtGame: 7000,
      label: 'bridge',
      sourceReport: 'd9',
    });
  });
  it('makes an arrow and a ring from a drag, and nothing from a tap', () => {
    expect(new Gesture('arrow', { x: 0, y: 0 }, ctx()).finish({ x: 30, y: 40 })).toMatchObject({
      kind: 'arrow',
      from: { x: 0, y: 0 },
      to: { x: 30, y: 40 },
    });
    expect(new Gesture('ring', { x: 0, y: 0 }, ctx()).finish({ x: 30, y: 40 })).toMatchObject({
      kind: 'ring',
      radius: 50,
    });
    expect(new Gesture('arrow', { x: 0, y: 0 }, ctx()).finish({ x: 1, y: 1 })).toBeUndefined();
    expect(new Gesture('ring', { x: 0, y: 0 }, ctx()).finish({ x: 1, y: 1 })).toBeUndefined();
  });
  it('draws a pencil line through the points it was fed, within the protocol’s limit', () => {
    const g = new Gesture('line', { x: 0, y: 0 }, ctx({ minStep: 4 }));
    for (let i = 1; i <= 5000; i++) g.update({ x: i * 0.5, y: Math.sin(i / 50) * 20 });
    const m = g.finish({ x: 2600, y: 0 });
    expect(m?.kind).toBe('line');
    if (m?.kind === 'line') {
      expect(m.points.length).toBeGreaterThanOrEqual(2);
      expect(m.points.length).toBeLessThanOrEqual(400);
    }
  });
  it('moves a grabbed mark and keeps its id and time; a click on empty ground grabs nothing', () => {
    const g = new Gesture('select', { x: 101, y: 100 }, ctx({ marks: [pin] }));
    expect(g.grabbed?.id).toBe('a');
    expect(g.finish({ x: 151, y: 100 })).toEqual({ ...pin, at: { x: 150, y: 100 } });
    const none = new Gesture('select', { x: 900, y: 900 }, ctx({ marks: [pin] }));
    expect(none.grabbed).toBeUndefined();
    expect(none.finish({ x: 950, y: 900 })).toBeUndefined();
    expect(
      new Gesture('select', { x: 100, y: 100 }, ctx({ marks: [pin] })).finish({ x: 100, y: 100 }),
    ).toBeUndefined();
  });
});

describe('client marks state', () => {
  it('replaces the list when the server sends marks, and applies local edits at once', () => {
    let s = applyServerMessage(initialState, { v: 1, kind: 'marks', marks: [pin] }, 0);
    expect(s.marks).toEqual([pin]);
    s = withMarkPut(s, { ...pin, at: { x: 1, y: 1 } });
    s = withMarkPut(s, arrow);
    expect(s.marks.map((m) => m.id)).toEqual(['a', 'b']);
    expect(withMarkDeleted(s, 'a').marks.map((m) => m.id)).toEqual(['b']);
    expect(withMark([pin], arrow)).toHaveLength(2);
  });
  it('makes ids that differ', () => {
    expect(newMarkId(1, 1000)).not.toBe(newMarkId(2, 1000));
  });
});
