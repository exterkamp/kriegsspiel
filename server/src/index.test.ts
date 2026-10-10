import { describe, expect, it } from 'vitest';
import { SERVER_NAME } from './index.js';

describe('server', () => {
  it('has a name', () => {
    expect(SERVER_NAME).toBe('kriegsspiel-server');
  });
});
