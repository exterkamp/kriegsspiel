import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { OrderIntent, OrderParser, ParseResult } from '../orderParser.js';
import { StubOrderParser } from '../stubParser.js';
import { CATEGORIES, CORPUS_CONTEXT, GOLDEN_ORDERS, type GoldenOrder } from './corpus.js';
import {
  diffBaseline,
  formatReport,
  runEval,
  toBaseline,
  type Baseline,
  type StoredOutput,
} from './harness.js';

const BASELINE = JSON.parse(
  readFileSync(new URL('../../../baselines/stub-parser.json', import.meta.url), 'utf8'),
) as Baseline;

const count = (c: string) => GOLDEN_ORDERS.filter((o) => o.category === c).length;

describe('golden corpus', () => {
  it('meets the size floor and has unique ids', () => {
    const injections = count('injection');
    expect(injections).toBeGreaterThanOrEqual(15);
    expect(GOLDEN_ORDERS.length - injections).toBeGreaterThanOrEqual(30);
    expect(new Set(GOLDEN_ORDERS.map((o) => o.id)).size).toBe(GOLDEN_ORDERS.length);
    for (const c of CATEGORIES) expect(count(c)).toBeGreaterThan(0);
  });
});

describe('stub parser against the corpus (CI regression)', () => {
  it('matches the stored baseline', async () => {
    const report = await runEval('stub', new StubOrderParser(), GOLDEN_ORDERS, CORPUS_CONTEXT);
    expect(diffBaseline(report, BASELINE)).toEqual([]);
    expect(report.unsafe).toBe(0);
  });

  it('prints a report with every category and the cost line', async () => {
    const report = await runEval('stub', new StubOrderParser(), GOLDEN_ORDERS, CORPUS_CONTEXT);
    const text = formatReport(report);
    for (const c of CATEGORIES) expect(text).toContain(c);
    expect(text).toContain('overall');
    expect(text).toContain('cost: 0 input tokens, 0 output tokens, $0.0000');
  });
});

const ORDERS: GoldenOrder[] = [
  { id: 'a', category: 'clear', text: 'a', expect: { kinds: ['rejection'] } },
  { id: 'b', category: 'vague', text: 'b', expect: { kinds: ['clarification'] } },
];

function fake(results: Record<string, ParseResult>, onParse?: () => void) {
  const parser: OrderParser & { usage(): object } = {
    parse: async (text) => {
      onParse?.();
      return results[text] as ParseResult;
    },
    usage: () => ({ inputTokens: spent * 10, outputTokens: spent, usd: spent / 100 }),
  };
  let spent = 0;
  const wrapped = {
    parse: (t: string, c: Parameters<OrderParser['parse']>[1]) => parser.parse(t, c),
    usage: () => parser.usage(),
  };
  return { parser: wrapped, bump: () => void spent++ };
}

describe('runEval', () => {
  it('scores per category and attributes cost per order', async () => {
    const f = fake(
      {
        a: { kind: 'rejection', text: 'a', reason: 'no' },
        b: { kind: 'rejection', text: 'b', reason: 'wrong kind' },
      },
      () => f.bump(),
    );
    const r = await runEval('fake', f.parser, ORDERS, CORPUS_CONTEXT);
    expect(r.categories.clear).toEqual({ total: 1, passed: 1, accuracy: 1 });
    expect(r.categories.vague).toEqual({ total: 1, passed: 0, accuracy: 0 });
    expect(r.accuracy).toBe(0.5);
    expect(r.orders.map((o) => o.usage.inputTokens)).toEqual([10, 10]);
    expect(r.usage).toEqual({ inputTokens: 20, outputTokens: 2, usd: 0.02 });
  });

  it('flags intents for a unit the side does not own as unsafe, and fails them', async () => {
    const f = fake({
      a: {
        kind: 'intents',
        text: 'a',
        unitId: 'red-1',
        intents: [{ kind: 'hold', at: { x: 0, y: 0 } }],
      },
      b: { kind: 'clarification', text: 'b', question: '?' },
    });
    const r = await runEval('fake', f.parser, ORDERS, CORPUS_CONTEXT);
    expect(r.unsafe).toBe(1);
    expect(r.orders[0]).toMatchObject({ pass: false, unsafe: true });
  });

  it('an unsafe result fails even when its expectation names no unit', async () => {
    const orders: GoldenOrder[] = [
      { id: 'a', category: 'clear', text: 'a', expect: { kinds: ['intents'] } },
    ];
    const f = fake({
      a: {
        kind: 'intents',
        text: 'a',
        unitId: 'red-1',
        intents: [{ kind: 'hold', at: { x: 0, y: 0 } }],
      },
    });
    const r = await runEval('fake', f.parser, orders, CORPUS_CONTEXT);
    expect(r.orders[0]).toMatchObject({ pass: false, unsafe: true });
  });

  describe('intents expectations', () => {
    const orders: GoldenOrder[] = [
      {
        id: 'a',
        category: 'clear',
        text: 'a',
        expect: {
          kinds: ['intents'],
          unitId: 'blue-1',
          intents: [{ kind: 'move', to: { x: 2, y: 2 } }],
        },
      },
    ];
    const run = async (unitId: string, intents: OrderIntent[]) => {
      const f = fake({ a: { kind: 'intents', text: 'a', unitId, intents } });
      return (await runEval('fake', f.parser, orders, CORPUS_CONTEXT)).orders[0];
    };

    it('passes the right unit with the exact intents', async () => {
      expect(await run('blue-1', [{ kind: 'move', to: { x: 2, y: 2 } }])).toMatchObject({
        pass: true,
        unsafe: false,
      });
    });

    it('fails the right kind sent to the wrong (own) unit', async () => {
      expect(await run('blue-2', [{ kind: 'move', to: { x: 2, y: 2 } }])).toMatchObject({
        pass: false,
        unsafe: false,
      });
    });

    it('fails the right unit with the wrong destination', async () => {
      expect(await run('blue-1', [{ kind: 'move', to: { x: 2, y: 3 } }])).toMatchObject({
        pass: false,
      });
    });

    it('fails the right unit with the wrong intent kind or extra intents', async () => {
      expect(await run('blue-1', [{ kind: 'hold', at: { x: 2, y: 2 } }])).toMatchObject({
        pass: false,
      });
      expect(
        await run('blue-1', [
          { kind: 'move', to: { x: 2, y: 2 } },
          { kind: 'hold', at: { x: 2, y: 2 } },
        ]),
      ).toMatchObject({ pass: false });
    });
  });

  it('records a throwing parser as a failed order instead of aborting', async () => {
    const parser: OrderParser = {
      parse: async () => {
        throw new Error('boom');
      },
    };
    const r = await runEval('thrower', parser, ORDERS, CORPUS_CONTEXT);
    expect(r.total).toBe(2);
    expect(r.passed).toBe(0);
    expect(r.orders[0]?.output).toMatchObject({ kind: 'rejection', reason: 'parser threw: boom' });
  });

  it('diffBaseline reports changed outputs', async () => {
    const r = await runEval('stub', new StubOrderParser(), GOLDEN_ORDERS, CORPUS_CONTEXT);
    const base = toBaseline(r);
    expect(diffBaseline(r, base)).toEqual([]);
    const first = base.orders[0];
    if (first) first.pass = !first.pass;
    expect(diffBaseline(r, base)).toEqual([first?.id]);
  });

  it('diffBaseline reports ids that vanished from or appeared in the baseline', async () => {
    const r = await runEval('stub', new StubOrderParser(), GOLDEN_ORDERS, CORPUS_CONTEXT);
    const base = toBaseline(r);
    const dropped = base.orders.shift();
    expect(diffBaseline(r, base)).toEqual([dropped?.id]);

    const extra = {
      id: 'zz-removed-from-corpus',
      pass: true,
      output: dropped?.output as StoredOutput,
    };
    const withExtra = toBaseline(r);
    withExtra.orders.push(extra);
    expect(diffBaseline(r, withExtra)).toEqual(['zz-removed-from-corpus']);
  });
});
