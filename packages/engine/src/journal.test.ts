import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  JOURNAL_FULL_TURNS,
  JOURNAL_MAX_TOKENS,
  JOURNAL_PRECEDENTS_MAX,
  JOURNAL_PRECEDENT_MAX,
  JOURNAL_SENTENCE_MAX,
  journalTokens,
  recordInJournal,
  sentences,
  type UmpireJournal,
} from './journal.js';

/** A summary of `n` sentences of about `len` characters each. */
const summary = (turn: number, n: number, len = 200) =>
  Array.from(
    { length: n },
    (_, i) => `Turn ${turn} sentence ${i + 1} ${'word '.repeat(len / 5)}`.trim() + '.',
  ).join(' ');

describe("the umpire's journal (D39, 11.8)", () => {
  it('keeps the first three sentences of a turn’s summary as its note', () => {
    const j = recordInJournal(
      undefined,
      1,
      'Blue held the bridge. Red’s hussars were checked at the ford. The wood is unoccupied. Rain later.',
    );
    expect(j.notes).toEqual([
      {
        turn: 1,
        note: 'Blue held the bridge. Red’s hussars were checked at the ford. The wood is unoccupied.',
      },
    ]);
    expect(j.precedents).toEqual([]);
  });

  it('cuts an over-long sentence at a word', () => {
    const [s] = sentences(`${'x'.repeat(10)} ${'longword '.repeat(60)}.`);
    expect(s!.length).toBeLessThanOrEqual(JOURNAL_SENTENCE_MAX);
    expect(s!.endsWith('…')).toBe(true);
  });

  it(`condenses every note but the newest ${JOURNAL_FULL_TURNS} to its first sentence`, () => {
    let j: UmpireJournal | undefined;
    for (let n = 1; n <= JOURNAL_FULL_TURNS + 2; n++) j = recordInJournal(j, n, summary(n, 3, 40));
    const notes = j!.notes;
    expect(notes.map((x) => x.turn)).toEqual([1, 2, 3, 4, 5]);
    for (const x of notes.slice(0, 2)) {
      expect(x.condensed).toBe(true);
      expect(sentences(x.note)).toHaveLength(1);
      expect(x.note.startsWith(`Turn ${x.turn} sentence 1`)).toBe(true);
    }
    for (const x of notes.slice(2)) {
      expect(x.condensed).toBeUndefined();
      expect(sentences(x.note)).toHaveLength(3);
    }
  });

  it('keeps the first ruling on a matter: no repeats, and no more than the cap', () => {
    let j = recordInJournal(undefined, 1, 'Quiet.', [
      'Cavalry cannot cross the river except at the bridge.',
      '  cavalry cannot cross the river   except at the bridge. ',
      `${'Long ruling '.repeat(40)}`,
    ]);
    expect(j.precedents.map((p) => p.ruling)).toHaveLength(2);
    expect(j.precedents[0]).toEqual({
      turn: 1,
      ruling: 'Cavalry cannot cross the river except at the bridge.',
    });
    expect(j.precedents[1]!.ruling.length).toBeLessThanOrEqual(JOURNAL_PRECEDENT_MAX);
    for (let n = 2; n <= 10; n++) {
      j = recordInJournal(j, n, 'Quiet.', [`Ruling ${n}a.`, `Ruling ${n}b.`, `Ruling ${n}c.`]);
    }
    expect(j.precedents).toHaveLength(JOURNAL_PRECEDENTS_MAX);
    // The first stand: later ones are not taken once the journal holds its maximum.
    expect(j.precedents[0]!.turn).toBe(1);
  });

  it('writes no note for an empty summary, and replaces a turn recorded twice', () => {
    const a = recordInJournal(undefined, 1, '   ');
    expect(a.notes).toEqual([]);
    const b = recordInJournal(recordInJournal(a, 2, 'First.'), 2, 'Second.');
    expect(b.notes).toEqual([{ turn: 2, note: 'Second.' }]);
  });

  it('is pure: the same journal and turn give the same result, and the input is not changed', () => {
    const j = recordInJournal(undefined, 1, summary(1, 3), ['A ruling.']);
    const copy = JSON.stringify(j);
    const x = recordInJournal(j, 2, summary(2, 5), ['Another ruling.']);
    const y = recordInJournal(j, 2, summary(2, 5), ['Another ruling.']);
    expect(JSON.stringify(j)).toBe(copy);
    expect(x).toEqual(y);
  });

  it(`stays under ${JOURNAL_MAX_TOKENS} tokens over a 12-turn game of the longest entries`, () => {
    let j: UmpireJournal | undefined;
    for (let n = 1; n <= 12; n++) {
      j = recordInJournal(j, n, summary(n, 10, 400).slice(0, 2000), [
        'x '.repeat(300),
        `Precedent ${n} ${'y '.repeat(300)}`,
        `Another ${n} ${'z '.repeat(300)}`,
      ]);
      expect(journalTokens(j)).toBeLessThanOrEqual(JOURNAL_MAX_TOKENS);
    }
    // The newest turn is always there; the oldest notes went first, the case law stayed.
    expect(j!.notes.at(-1)!.turn).toBe(12);
    expect(j!.dropped).toBeGreaterThan(0);
    expect(j!.notes[0]!.turn).toBe(1 + j!.dropped!);
    expect(j!.precedents).toHaveLength(JOURNAL_PRECEDENTS_MAX);
  });

  it('stays under the cap for any run of turns (property)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            summary: fc.string({ maxLength: 2000 }),
            precedents: fc.array(fc.string({ maxLength: 600 }), { maxLength: 8 }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (turns) => {
          let j: UmpireJournal | undefined;
          turns.forEach((t, i) => {
            j = recordInJournal(j, i + 1, t.summary, t.precedents);
            expect(journalTokens(j)).toBeLessThanOrEqual(JOURNAL_MAX_TOKENS);
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});
