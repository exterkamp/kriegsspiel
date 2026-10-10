import { describe, expect, it } from 'vitest';
import { Dispatch } from '@kriegsspiel/protocol';
import type { ViewDocument } from '@kriegsspiel/engine';
import { documentToDispatch } from './sideView.js';

describe('documentToDispatch', () => {
  const doc: ViewDocument = {
    id: 'red-d1',
    kind: 'capturedDispatch',
    capturedAt: 600_000,
    deliveredAt: 1_200_000,
    ageMs: 600_000,
    issuedAt: 0,
    addressedTo: '1st Battalion',
    location: { x: 1950, y: 2700 },
    place: 'near the road',
    text: 'Advance at once.',
  };

  it('shows a captured enemy dispatch as an intelligence paper with the enemy wording', () => {
    const d = documentToDispatch(doc);
    expect(() => Dispatch.parse(d)).not.toThrow();
    expect(d).toMatchObject({
      category: 'intelligence',
      writtenAtGame: 0,
      receivedAtGame: 1_200_000,
      location: doc.location,
    });
    expect(d.text).toContain('"Advance at once."');
    expect(d.text).toContain('1st Battalion');
  });
});
