import { describe, expect, it } from 'vitest';
import { advance } from './index.js';

describe('engine', () => {
  it('advances game time deterministically', () => {
    expect(advance(10, 5)).toBe(15);
  });
});
