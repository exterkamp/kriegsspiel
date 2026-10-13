import { describe, expect, it } from 'vitest';
import { fieldNote, temperOf } from './fieldNotes.js';
import type { Report } from './types.js';

const KINDS = [
  'situation',
  'contact',
  'unitLost',
  'courierLost',
  'orderDelivered',
  'lowAmmo',
  'exhausted',
  'destroyed',
  'engaged',
  'heavyLosses',
  'broke',
] as const;

function report(kind: Report['kind'], id = 'blue-r1'): Report {
  return {
    id,
    kind,
    observedAt: 0,
    deliverAt: 3 * 60_000,
    from: '1st Battalion',
    location: { x: 0, y: 0 },
    place: 'at the bridge, on the High road',
    uncertainty: 0,
    confidence: 'medium',
    ...(kind === 'contact' || kind === 'destroyed' ? { sizeEstimate: 'about a battalion' } : {}),
  };
}

const ids = Array.from({ length: 200 }, (_, i) => `blue-r${i}`);

describe('field notes (#419)', () => {
  it('reads the manner from the public trait', () => {
    expect(temperOf('bold and impatient; apt to charge early')).toBe('bold');
    expect(temperOf('aggressive; presses the attack hard')).toBe('bold');
    expect(temperOf('dashing scout; prone to over-reach')).toBe('bold');
    expect(temperOf('cautious; slow to commit his reserve')).toBe('cautious');
    expect(temperOf('by the book; waits for orders')).toBe('cautious');
    expect(temperOf('steady and methodical; holds a line under fire')).toBe('steady');
    expect(temperOf(undefined)).toBe('plain');
  });

  it('has at least five wordings of every kind, in every manner', () => {
    for (const kind of KINDS) {
      for (const trait of [undefined, 'bold', 'cautious', 'steady']) {
        const texts = new Set(
          ids.map((id) => fieldNote(report(kind, id), 180_000, false, { trait }, 7)),
        );
        expect(texts.size, `${kind} ${trait}`).toBeGreaterThanOrEqual(5);
      }
    }
    const heard = new Set(ids.map((id) => fieldNote(report('courierLost', id), 0, true, {}, 7)));
    expect(heard.size).toBeGreaterThanOrEqual(5);
  });

  it('chooses the wording from the seed and the report id alone, so a replay reads the same', () => {
    for (const kind of KINDS) {
      const a = ids.map((id) => fieldNote(report(kind, id), 180_000, false, { trait: 'bold' }, 42));
      const b = ids.map((id) => fieldNote(report(kind, id), 180_000, false, { trait: 'bold' }, 42));
      expect(a).toEqual(b);
      const other = ids.map((id) =>
        fieldNote(report(kind, id), 180_000, false, { trait: 'bold' }, 43),
      );
      expect(other, kind).not.toEqual(a);
    }
  });

  it('flavours a unit’s note by its officer’s manner', () => {
    const closings = (trait: string) =>
      new Set(ids.map((id) => fieldNote(report('engaged', id), 180_000, false, { trait }, 1)));
    const bold = closings('bold and impatient');
    const cautious = closings('cautious');
    expect([...bold].some((t) => /drive them|press them hard/.test(t))).toBe(true);
    expect([...cautious].some((t) => /not certain we can hold|reserve be sent/.test(t))).toBe(true);
    expect([...bold].some((t) => cautious.has(t))).toBe(false);
  });

  it('keeps a contact note the same whatever the manner: intelligence is not told it', () => {
    for (const id of ids.slice(0, 20)) {
      const plain = fieldNote(report('contact', id), 180_000, false, {}, 3);
      expect(fieldNote(report('contact', id), 180_000, false, { trait: 'bold' }, 3)).toBe(plain);
    }
  });

  it('opens "Sir, ", gives the age one way, signs with the unit and adds no figure', () => {
    for (const kind of KINDS) {
      for (const id of ids.slice(0, 40)) {
        const text = fieldNote(report(kind, id), 180_000, false, { trait: 'steady' }, 9);
        expect(text, text).toMatch(/^Sir, /);
        expect(text, text).toContain('at the bridge, on the High road');
        if (kind !== 'situation' && kind !== 'courierLost') {
          expect(text, text).toContain('about 3 minutes ago');
        }
        if (!['situation', 'unitLost', 'courierLost'].includes(kind)) {
          expect(text, text).toMatch(/— 1st Battalion, about 3 minutes ago\.$/);
        }
        // The only figures are the unit's own name and the age.
        expect(text.replace('1st', '').match(/\d+/g) ?? [], text).toEqual(
          kind === 'situation' || kind === 'courierLost' ? [] : ['3'],
        );
      }
    }
    expect(fieldNote(report('engaged'), 0)).toContain('just now');
  });

  it('hedges a contact as its confidence calls for, and not when sure', () => {
    const sure = { ...report('contact'), confidence: 'high' as const };
    for (const id of ids.slice(0, 20)) {
      expect(fieldNote({ ...sure, id }, 0, false, {}, 5)).not.toMatch(/make out|can tell|swear/);
      expect(fieldNote({ ...report('contact'), id }, 0, false, {}, 5)).toMatch(/make out|can tell/);
    }
  });

  it('reads right for a side with one formation', () => {
    for (const id of ids) {
      const text = fieldNote(
        { ...report('situation', id), sizeEstimate: '1 formation' },
        0,
        false,
        {},
        7,
      );
      expect(text, text).toContain('1 formation');
      expect(text, text).not.toMatch(/1 formation are|all 1 formation/);
    }
  });

  it('leaves the umpire’s ruling as written', () => {
    expect(fieldNote({ ...report('battle'), text: 'The umpire rules.' }, 0, false, {}, 1)).toBe(
      'The umpire rules.',
    );
  });
});

describe('the order acknowledgement (#419)', () => {
  it('is the only note that says "your orders" in lower case', () => {
    for (const kind of KINDS) {
      for (const trait of [undefined, 'bold', 'cautious', 'steady']) {
        for (const id of ids.slice(0, 60)) {
          const text = fieldNote(report(kind, id), 60_000, false, { trait }, 2);
          expect(text.includes('your orders'), text).toBe(kind === 'orderDelivered');
        }
      }
    }
  });
});
