import { describe, expect, it } from 'vitest';
import type { OrderParser, ParseContext, ParseFeature } from './index.js';
import { StubOrderParser } from './stubParser.js';

/** Anchor points are millimetres, as in the engine's state. */
const at = (x: number, y: number) => ({ x: x * 1000, y: y * 1000 });
const WOOD = { id: 'wood-a', kind: 'wood', anchor: at(150, 50) };
const BRIDGE = { id: 'bridge', kind: 'bridge', anchor: at(250, 250) };
const ROAD = { id: 'road', kind: 'road', anchor: at(250, 350) };

function ctx(features: ParseFeature[], side = 'blue'): ParseContext {
  return {
    side,
    map: { features },
    units: [
      { id: 'blue-1', side: 'blue', name: '1st Battalion', center: at(150, 450) },
      { id: 'blue-2', side: 'blue', name: '2nd Battalion', center: at(350, 450) },
      { id: 'blue-3', side: 'blue', name: 'Cavalry Squadron', center: at(250, 450) },
      { id: 'red-1', side: 'red', name: 'Vanguard Battalion', center: at(150, 50) },
    ],
  };
}

const ONE_WOOD = [WOOD, BRIDGE, ROAD];
const TWO_WOODS = [
  WOOD,
  { id: 'wood-b', kind: 'wood', name: 'Hollow wood', anchor: at(350, 480) },
  BRIDGE,
  ROAD,
];
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
        { kind: 'move', to: at(250, 250) },
        { kind: 'hold', at: at(250, 250) },
      ],
    });
  });

  it('withdraw to the wood', async () => {
    const r = await parser.parse('Cavalry Squadron, withdraw to the wood!', ctx(ONE_WOOD));
    expect(r).toMatchObject({
      kind: 'intents',
      unitId: 'blue-3',
      intents: [{ kind: 'withdraw', toward: at(150, 50) }],
    });
  });

  it('attack the wood', async () => {
    const r = await parser.parse('2nd Battalion attack the wood', ctx(ONE_WOOD));
    expect(r).toMatchObject({ kind: 'intents', unitId: 'blue-2', intents: [{ kind: 'attack' }] });
  });

  it('hold with no place holds the current position', async () => {
    const r = await parser.parse('2nd battalion hold', ctx(ONE_WOOD));
    expect(r).toMatchObject({ intents: [{ kind: 'hold', at: at(350, 450) }] });
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
    const r = await parser.parse('1st Battalion attack the wood', ctx([BRIDGE]));
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

  it('asks which wood when the map has two, naming a feature by its name', async () => {
    const r = await parser.parse('1st Battalion withdraw to the wood', ctx(TWO_WOODS));
    expect(r).toMatchObject({ kind: 'clarification', options: expect.any(Array) });
    expect(r.kind === 'clarification' && r.options).toEqual([
      'the wood at (150, 50) m',
      'the Hollow wood at (350, 480) m',
    ]);
  });

  it.each([
    'withdraw from the bridge to the wood',
    'march along the road to the bridge',
    'march to the bridge and attack the wood',
    'attack the wood and hold',
    'march to the wood or the bridge',
  ])('asks for one action at a time instead of dropping a clause: %s', async (phrase) => {
    const r = await parser.parse(`1st Battalion ${phrase}`, ctx(ONE_WOOD));
    expect(r.kind).toBe('clarification');
  });

  it('does not treat prototype keys as places', async () => {
    // Input is lowercased, so `constructor` is the only reachable prototype key.
    for (const w of ['constructor']) {
      const r = await parser.parse(`1st Battalion march to the ${w}`, ctx(ONE_WOOD));
      expect(r).toMatchObject({ kind: 'rejection', reason: `I don't know the place "${w}".` });
    }
  });

  it('prefers an exact unit name over a longer name sharing its prefix', async () => {
    const c = ctx(ONE_WOOD);
    c.units = [
      ...c.units,
      { id: 'blue-4', side: 'blue', name: '1st Battalion Reserve', center: at(50, 450) },
    ];
    expect(await parser.parse('1st Battalion hold', c)).toMatchObject({ unitId: 'blue-1' });
    expect(await parser.parse('1st Battalion Reserve hold', c)).toMatchObject({ unitId: 'blue-4' });
    const amb = await parser.parse('1st hold', c);
    expect(amb).toMatchObject({ kind: 'clarification' });
    expect(amb.kind === 'clarification' && amb.options).toEqual([
      '1st Battalion',
      '1st Battalion Reserve',
    ]);
  });

  it('addresses units whose names contain verb words', async () => {
    const c = ctx(ONE_WOOD);
    c.units = [
      ...c.units,
      { id: 'blue-5', side: 'blue', name: 'Advance Guard', center: at(50, 350) },
      { id: 'blue-6', side: 'blue', name: 'Hold Fast Regiment', center: at(450, 350) },
    ];
    expect(await parser.parse('Advance Guard march to the bridge', c)).toMatchObject({
      kind: 'intents',
      unitId: 'blue-5',
      intents: [{ kind: 'move', to: at(250, 250) }],
    });
    expect(await parser.parse('Hold Fast Regiment hold', c)).toMatchObject({
      kind: 'intents',
      unitId: 'blue-6',
      intents: [{ kind: 'hold', at: at(450, 350) }],
    });
  });

  it('preserves the original wording byte for byte in every result kind', async () => {
    const texts = ['  1st Battalion   MARCH to the bridge ', 'nonsense', 'march to the bridge'];
    for (const text of texts) {
      expect((await parser.parse(text, ctx(ONE_WOOD))).text).toBe(text);
    }
  });
});
