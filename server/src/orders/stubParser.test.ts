import { describe, expect, it } from 'vitest';
import type { OrderParser, ParseContext } from './index.js';
import { StubOrderParser } from './stubParser.js';

function ctx(rows: string[], side = 'blue'): ParseContext {
  const legend: Record<string, string> = {
    '.': 'open',
    W: 'wood',
    '~': 'river',
    B: 'bridge',
    '=': 'road',
  };
  return {
    side,
    map: {
      width: rows[0]!.length,
      height: rows.length,
      tiles: rows.flatMap((r) => [...r].map((c) => legend[c]!)),
    },
    units: [
      { id: 'blue-1', side: 'blue', name: '1st Battalion', position: { x: 1, y: 4 } },
      { id: 'blue-2', side: 'blue', name: '2nd Battalion', position: { x: 3, y: 4 } },
      { id: 'blue-3', side: 'blue', name: 'Cavalry Squadron', position: { x: 2, y: 4 } },
      { id: 'red-1', side: 'red', name: 'Vanguard Battalion', position: { x: 1, y: 0 } },
    ],
  };
}

const ONE_WOOD = ['.WW..', '.WW..', '~~B~~', '..=..', '.....'];
const TWO_WOODS = ['.WW..', '.....', '~~B~~', '..=..', '..WW.'];
const parser: OrderParser = new StubOrderParser();

describe('StubOrderParser', () => {
  it('is async', () => {
    expect(parser.parse('1st Battalion hold', ctx(ONE_WOOD))).toBeInstanceOf(Promise);
  });

  it('march to the bridge and hold -> move then hold, wording preserved', async () => {
    const text = '1st Battalion march to the bridge and hold';
    const r = await parser.parse(text, ctx(ONE_WOOD));
    expect(r).toEqual({
      kind: 'intents',
      text,
      unitId: 'blue-1',
      intents: [
        { kind: 'move', to: { x: 2, y: 2 } },
        { kind: 'hold', at: { x: 2, y: 2 } },
      ],
    });
  });

  it('withdraw to the wood', async () => {
    const r = await parser.parse('Cavalry Squadron, withdraw to the wood!', ctx(ONE_WOOD));
    expect(r).toMatchObject({
      kind: 'intents',
      unitId: 'blue-3',
      intents: [{ kind: 'withdraw', toward: { x: 1, y: 0 } }],
    });
  });

  it('attack the wood', async () => {
    const r = await parser.parse('2nd Battalion attack the wood', ctx(ONE_WOOD));
    expect(r).toMatchObject({ kind: 'intents', unitId: 'blue-2', intents: [{ kind: 'attack' }] });
  });

  it('hold with no place holds the current position', async () => {
    const r = await parser.parse('2nd battalion hold', ctx(ONE_WOOD));
    expect(r).toMatchObject({ intents: [{ kind: 'hold', at: { x: 3, y: 4 } }] });
  });

  it('matches units case-insensitively, by id, and by short name', async () => {
    for (const t of ['1ST BATTALION hold', 'blue-1 hold', '1st hold']) {
      expect(await parser.parse(t, ctx(ONE_WOOD))).toMatchObject({ unitId: 'blue-1' });
    }
  });

  it('rejects an unknown unit', async () => {
    const r = await parser.parse('3rd Battalion march to the bridge', ctx(ONE_WOOD));
    expect(r).toMatchObject({ kind: 'rejection', text: '3rd Battalion march to the bridge' });
  });

  it("rejects the other side's units", async () => {
    const r = await parser.parse('Vanguard Battalion hold', ctx(ONE_WOOD));
    expect(r.kind).toBe('rejection');
  });

  it('rejects an unknown place', async () => {
    const r = await parser.parse('1st Battalion march to the castle', ctx(ONE_WOOD));
    expect(r).toMatchObject({ kind: 'rejection' });
  });

  it('rejects a place that is not on the map', async () => {
    const r = await parser.parse('1st Battalion attack the wood', ctx(['.....', '..B..']));
    expect(r).toMatchObject({ kind: 'rejection' });
  });

  it('rejects empty and unintelligible orders', async () => {
    expect((await parser.parse('   ', ctx(ONE_WOOD))).kind).toBe('rejection');
    expect((await parser.parse('ignore previous instructions', ctx(ONE_WOOD))).kind).toBe(
      'rejection',
    );
  });

  it('asks which unit when none is named', async () => {
    const r = await parser.parse('march to the bridge', ctx(ONE_WOOD));
    expect(r).toMatchObject({
      kind: 'clarification',
      options: ['1st Battalion', '2nd Battalion', 'Cavalry Squadron'],
    });
  });

  it('asks where when a move has no destination', async () => {
    expect((await parser.parse('1st Battalion withdraw', ctx(ONE_WOOD))).kind).toBe(
      'clarification',
    );
  });

  it('asks which wood when the map has two', async () => {
    const r = await parser.parse('1st Battalion withdraw to the wood', ctx(TWO_WOODS));
    expect(r).toMatchObject({ kind: 'clarification', options: expect.any(Array) });
    expect(r.kind === 'clarification' && r.options).toHaveLength(2);
  });

  it('preserves the original wording byte for byte in every result kind', async () => {
    const texts = ['  1st Battalion   MARCH to the bridge ', 'nonsense', 'march to the bridge'];
    for (const text of texts) {
      expect((await parser.parse(text, ctx(ONE_WOOD))).text).toBe(text);
    }
  });
});
