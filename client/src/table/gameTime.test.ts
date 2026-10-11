import { describe, expect, it } from 'vitest';
import { formatGameAge, formatGameDuration, formatGameTime } from './gameTime';

describe('elapsed game-time presentation', () => {
  it.each([
    [0, '00:00:00'],
    [1, '00:00:00'],
    [999, '00:00:00'],
    [1000, '00:00:01'],
    [59999, '00:00:59'],
    [60000, '00:01:00'],
    [3599999, '00:59:59'],
    [3600000, '01:00:00'],
    [86399999, '23:59:59'],
    [86400000, '24:00:00'],
    [90061007, '25:01:01'],
    [Number.MAX_SAFE_INTEGER, '2501999792:59:00'],
  ] as const)('formats %s milliseconds as %s', (value, expected) => {
    expect(formatGameTime(value)).toBe(expected);
  });

  it.each([
    [0, 'current snapshot'],
    [1, 'less than 1s ago'],
    [999, 'less than 1s ago'],
    [1000, '1s ago'],
    [1999, '1s ago'],
    [59999, '59s ago'],
    [60000, '1m ago'],
    [300999, '5m ago'],
    [3599999, '59m ago'],
    [3600000, '1h ago'],
    [86399999, '23h ago'],
    [86400000, '1d ago'],
    [90061007, '1d ago'],
    [172800999, '2d ago'],
    [Number.MAX_SAFE_INTEGER, '104249991d ago'],
  ] as const)('formats age %s milliseconds as %s', (value, expected) => {
    expect(formatGameAge(value)).toBe(expected);
  });

  it.each([
    [0, 'PT0S'],
    [1, 'PT0.001S'],
    [10, 'PT0.01S'],
    [20, 'PT0.02S'],
    [100, 'PT0.1S'],
    [999, 'PT0.999S'],
    [1000, 'PT1S'],
    [1001, 'PT1.001S'],
    [1010, 'PT1.01S'],
    [1020, 'PT1.02S'],
    [90061007, 'PT90061.007S'],
    [Number.MAX_SAFE_INTEGER - 991, 'PT9007199254740S'],
    [Number.MAX_SAFE_INTEGER - 990, 'PT9007199254740.001S'],
    [Number.MAX_SAFE_INTEGER - 1, 'PT9007199254740.99S'],
    [Number.MAX_SAFE_INTEGER, 'PT9007199254740.991S'],
  ] as const)('preserves %s milliseconds in semantic duration %s', (value, expected) => {
    expect(formatGameDuration(value)).toBe(expected);
  });

  it('retains each millisecond around the largest safe-integer second boundary', () => {
    for (let value = Number.MAX_SAFE_INTEGER - 1000; value <= Number.MAX_SAFE_INTEGER; value++) {
      const duration = formatGameDuration(value)!;
      const match = /^PT(\d+)(?:\.(\d{1,3}))?S$/.exec(duration)!;
      const milliseconds = BigInt(match[1]!) * 1000n + BigInt((match[2] ?? '').padEnd(3, '0'));
      expect(milliseconds).toBe(BigInt(value));
    }
  });

  it.each([null, undefined, NaN, Infinity, -Infinity, -1, -0.5, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'keeps invalid input %s explicitly unavailable',
    (value) => {
      expect(formatGameTime(value)).toBe('Time unavailable');
      expect(formatGameAge(value)).toBe('Age unavailable');
      expect(formatGameDuration(value)).toBeUndefined();
    },
  );
});
