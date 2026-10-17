import { describe, expect, it } from 'vitest';
import { clockTime, fieldNote, temperOf } from './fieldNotes.js';
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
  'turn',
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

describe('a broken unit in its notes (#438)', () => {
  const HOLDS = /\bwe (hold|stand)\b|will not give ground|hold our ground|the men stand well/i;
  const traits = ['bold and impatient', 'cautious', 'steady veteran', undefined];

  it('never says it holds while it is falling back', () => {
    for (const kind of ['engaged', 'heavyLosses'] as const) {
      for (const trait of traits) {
        for (const id of ids) {
          const text = fieldNote({ ...report(kind, id), routed: true }, 0, false, { trait }, 7);
          expect(text).not.toMatch(HOLDS);
          expect(text).toMatch(/fall(ing)? back|streaming back|go back/);
        }
      }
    }
  });

  it('says it has rallied in its first report after the rally', () => {
    for (const id of ids.slice(0, 20)) {
      const text = fieldNote({ ...report('engaged', id), rallied: true }, 0, false, {}, 7);
      expect(text).toMatch(/^Sir, we have rallied\. [A-Z]/);
    }
  });
});

describe('clock times in turn mode (#439)', () => {
  it('names the clock time the report was made, not its age', () => {
    // The opening situation and a lost courier give no time in either mode.
    for (const kind of KINDS.filter((k) => k !== 'situation' && k !== 'courierLost')) {
      for (const id of ids.slice(0, 20)) {
        const r = { ...report(kind, id), observedAt: 12 * 60_000, deliverAt: 20 * 60_000 };
        const text = fieldNote(r, 8 * 60_000, false, {}, 7, true);
        expect(text, text).not.toMatch(/\bago\b|just now/);
        expect(text, text).toContain('at 00:12');
      }
    }
  });

  it('keeps the age in real time', () => {
    const r = { ...report('engaged'), observedAt: 12 * 60_000, deliverAt: 15 * 60_000 };
    expect(fieldNote(r, 3 * 60_000)).toMatch(/about 3 minutes ago\.$/);
  });

  it('gives the day only after the first', () => {
    expect(clockTime(0)).toBe('00:00');
    expect(clockTime(65 * 60_000)).toBe('01:05');
    expect(clockTime((24 * 60 + 7) * 60_000)).toBe('Day 2 00:07');
  });
});

describe('a unit’s note on an umpire turn (11.9)', () => {
  const turn = (facts: NonNullable<Report['turn']>, id: string): Report => ({
    ...report('turn', id),
    deliverAt: 0,
    turn: facts,
  });
  const base = { n: 2, lost: 0, movedM: 0, orders: [] };

  it('says where it stands, what became of its orders and what it lost, from the facts alone', () => {
    for (const id of ids.slice(0, 40)) {
      const stayed = fieldNote(turn(base, id), 0, false, {}, 3);
      expect(stayed).toMatch(/^Sir, we (stand|have kept|are still|remain|have not moved)/);
      expect(stayed).toMatch(/— 1st Battalion, just now\.$/);
      const moved = fieldNote(
        turn({ ...base, movedM: 600, lost: 123, orders: [{ result: 'refused' }] }, id),
        0,
        false,
        {},
        3,
      );
      expect(moved).toMatch(/marched|moved|now in position|come up|after our march/);
      expect(moved).toMatch(/not carry out my orders|not done as ordered/);
      expect(moved).toContain('We lost about 120 men.');
      const misread = fieldNote(
        turn({ ...base, orders: [{ result: 'carried-out' }, { result: 'misread' }] }, id),
        0,
        false,
        {},
        3,
      );
      expect(misread).toMatch(/as I understood them|took my orders to mean/);
    }
  });

  it('never says it holds when it broke, and says first that it rallied', () => {
    const HOLDS = /\bwe (hold|stand|remain)\b|kept our ground|in good order/i;
    for (const trait of [undefined, 'bold', 'cautious', 'steady']) {
      for (const id of ids.slice(0, 40)) {
        const broke = fieldNote(turn({ ...base, broke: true }, id), 0, false, { trait }, 5);
        expect(broke).not.toMatch(HOLDS);
        expect(broke).toMatch(/back/);
        const rallied = fieldNote(turn({ ...base, rallied: true }, id), 0, false, { trait }, 5);
        expect(rallied).toMatch(/^Sir, we have rallied\. [A-Z]/);
      }
    }
  });
});
