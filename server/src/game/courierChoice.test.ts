import { describe, expect, it } from 'vitest';
import { createState, holdTheBridge, loadScenario } from '@kriegsspiel/engine';
import { applyLoggedOrder } from './replay.js';

const parsed = {
  kind: 'order',
  unitId: 'blue-1',
  text: 'Guards, hold',
  intents: [{ kind: 'hold' }],
} as never;

describe('applyLoggedOrder courier', () => {
  const start = () => {
    const g = loadScenario(holdTheBridge);
    return createState(g.seed, g, 0);
  };
  const queued = (courier?: 'fast' | 'safe') => {
    const r = applyLoggedOrder(start(), 'g', 1, 'blue', parsed, courier);
    if ('reason' in r) throw new Error(r.reason);
    return r.state.queue.map((e) => e.payload as { courier?: string });
  };
  it('carries the chosen courier on the signed order, and nothing when none was chosen', () => {
    expect(queued('fast')[0]?.courier).toBe('fast');
    expect(queued()[0]).not.toHaveProperty('courier');
  });
});
