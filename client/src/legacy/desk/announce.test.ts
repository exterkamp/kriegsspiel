import { describe, expect, it } from 'vitest';
import type { Dispatch } from '@kriegsspiel/protocol';
import type { Exchange } from './conference';
import { answerAnnouncement, dispatchAnnouncement } from './announce';

const d = (id: string, from = 'Lt. Marsh') => ({ id, from }) as Dispatch;
const x = (id: number, p: Partial<Exchange> = {}) => ({ id, ...p }) as Exchange;

describe('announcements', () => {
  it('names a single new dispatch and counts several', () => {
    expect(dispatchAnnouncement(new Set(['a']), [d('a'), d('b')])).toBe(
      'New dispatch from Lt. Marsh.',
    );
    expect(dispatchAnnouncement(new Set(), [d('a'), d('b')])).toBe('2 new dispatches.');
    expect(dispatchAnnouncement(new Set(['a']), [d('a')])).toBe('');
  });

  it('announces answers and failures once, and not pending questions', () => {
    const answer = { text: 'ok', basedOnGame: 0 };
    expect(answerAnnouncement(new Set(), [x(1, { answer })])).toMatch(/has answered/);
    expect(answerAnnouncement(new Set(), [x(1, { failed: true })])).toMatch(/could not be reached/);
    expect(answerAnnouncement(new Set(), [x(1)])).toBe('');
    expect(answerAnnouncement(new Set([1]), [x(1, { answer })])).toBe('');
  });
});
