import { describe, expect, it } from 'vitest';
import { NotifyEvent } from '@kriegsspiel/protocol';
import { DEFAULT_PREFS, NOTICE, isQuiet, wanted, type NotifyPrefs } from './policy.js';

const prefs = (threshold: NotifyPrefs['threshold']): NotifyPrefs => ({
  ...DEFAULT_PREFS,
  threshold,
});
const passing = (p: NotifyPrefs) => NotifyEvent.options.filter((e) => wanted(p, e));

describe('thresholds', () => {
  it('all lets everything through', () => {
    expect(passing(prefs('all'))).toEqual(NotifyEvent.options);
  });
  it('urgent holds back routine dispatches and clock changes', () => {
    expect(passing(prefs('urgent'))).toEqual([
      'contact',
      'unitLost',
      'pauseProposed',
      'decision',
      'gameOver',
    ]);
  });
  it('contact lets contact reports only', () => {
    expect(passing(prefs('contact'))).toEqual(['contact']);
  });
  it('off lets nothing through', () => {
    expect(passing(prefs('off'))).toEqual([]);
  });
  it('defaults to urgent', () => {
    expect(DEFAULT_PREFS.threshold).toBe('urgent');
  });
});

describe('quiet hours', () => {
  const at = (h: number, m = 0) => Date.UTC(2026, 0, 1, h, m);
  it('is never quiet when unset or empty', () => {
    expect(isQuiet(undefined, at(3))).toBe(false);
    expect(isQuiet({ startMin: 60, endMin: 60, utcOffsetMin: 0 }, at(1))).toBe(false);
  });
  it('covers a same-day window, end exclusive', () => {
    const q = { startMin: 9 * 60, endMin: 17 * 60, utcOffsetMin: 0 };
    expect(isQuiet(q, at(9))).toBe(true);
    expect(isQuiet(q, at(16, 59))).toBe(true);
    expect(isQuiet(q, at(17))).toBe(false);
    expect(isQuiet(q, at(8, 59))).toBe(false);
  });
  it('wraps midnight', () => {
    const q = { startMin: 22 * 60, endMin: 7 * 60, utcOffsetMin: 0 };
    expect(isQuiet(q, at(23))).toBe(true);
    expect(isQuiet(q, at(3))).toBe(true);
    expect(isQuiet(q, at(7))).toBe(false);
    expect(isQuiet(q, at(12))).toBe(false);
  });
  it('reads the window in the player local time', () => {
    const q = { startMin: 22 * 60, endMin: 7 * 60, utcOffsetMin: -8 * 60 };
    expect(isQuiet(q, at(6))).toBe(true); // 22:00 local
    expect(isQuiet(q, at(15))).toBe(false); // 07:00 local
  });
});

describe('notice text', () => {
  it('is fixed words only: no digits, coordinates or unit names', () => {
    for (const { title, text } of Object.values(NOTICE)) {
      expect(`${title} ${text}`).not.toMatch(/\d/);
    }
  });
});
