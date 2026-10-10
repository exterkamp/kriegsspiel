import { describe, expect, it } from 'vitest';
import { greeting } from './greeting.js';

describe('client', () => {
  it('greets', () => {
    expect(greeting()).toBe('Kriegsspiel');
  });
});
