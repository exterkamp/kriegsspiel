/**
 * The interpret task (#45): traits colour how an order is read, within limits the engine checks.
 * A weak, failing or hostile model never blocks the order or changes the outcome beyond them.
 */
import { holdTheBridge, loadScenario, createState } from '@kriegsspiel/engine';
import { describe, expect, it } from 'vitest';
import { applyLoggedOrder } from '../game/replay.js';
import { HOSTILE } from '../umpire/injection.corpus.js';
import { LeakProbe, ScriptedModel } from '../umpire/leakKit.testkit.js';
import { testReply } from '../umpire/providers/test.js';
import { UmpireError } from '../umpire/umpireClient.js';
import type { UmpireClient, UmpireRequest, UmpireResponse } from '../umpire/umpireClient.js';
import {
  INTERPRET_ORDERS_SCHEMA,
  INTERPRET_ORDERS_SYSTEM,
  InterpretingParser,
  type InterpretOutput,
} from './interpret.js';
import type { OrderParser, ParseContext, ParseResult } from './orderParser.js';

const at = (x: number, y: number) => ({ x: x * 1000, y: y * 1000 });
const ctx = (personality?: string[]): ParseContext => ({
  side: 'blue',
  map: { features: [{ id: 'bridge', kind: 'bridge', name: 'The bridge', anchor: at(2050, 1500) }] },
  units: [
    { id: 'blue-1', side: 'blue', name: '1st Battalion', center: at(1850, 2450), personality },
    { id: 'red-1', side: 'red', name: 'Vanguard Battalion', center: at(1950, 450) },
  ],
  hidden: ['Vanguard Battalion'],
});

const inner = (text: string): OrderParser => ({
  async parse(): Promise<ParseResult> {
    return {
      kind: 'intents',
      text,
      unitId: 'blue-1',
      intents: [{ kind: 'move', to: at(2050, 1500) }],
    };
  },
});

/** Answers the interpret task as the test provider does, and records each request. */
class CannedClient implements UmpireClient {
  calls: UmpireRequest[] = [];
  async call<T>(request: UmpireRequest): Promise<UmpireResponse<T>> {
    this.calls.push(request);
    const output = testReply(request.schema as never, request.input as never);
    return { output, record: {} } as UmpireResponse<T>;
  }
}

const run = async (
  text: string,
  personality?: string[],
  client: UmpireClient = new CannedClient(),
) => new InterpretingParser(inner(text), client).parse(text, ctx(personality));

describe('same order, different traits', () => {
  const text = 'Move to the bridge.';
  it('gives different, valid interpretations', async () => {
    const results = await Promise.all(
      [undefined, ['literal'], ['cautious'], ['aggressive'], ['initiative']].map((p) =>
        run(text, p),
      ),
    );
    const kinds = results.map((r) =>
      r.kind === 'intents' ? (r.interpretation?.action ?? 'none') : r.kind,
    );
    expect(kinds).toEqual(['none', 'none', 'halt_short', 'exceed', 'exceed']);
  });

  it('asks nothing of an officer with no traits', async () => {
    const client = new CannedClient();
    await run(text, undefined, client);
    expect(client.calls).toHaveLength(0);
  });

  it('shows the model the traits and the order as input, with the fixed system prompt', async () => {
    const client = new CannedClient();
    await run(text, ['cautious'], client);
    expect(client.calls[0]).toMatchObject({
      stage: 'parse',
      system: INTERPRET_ORDERS_SYSTEM,
      schema: INTERPRET_ORDERS_SCHEMA,
      input: { order: text, subordinate: { traits: ['cautious'] } },
    });
  });

  it('shows no legs when the move that runs now is behind a withdraw', async () => {
    const client = new CannedClient();
    const parser = new InterpretingParser(
      {
        async parse(): Promise<ParseResult> {
          return {
            kind: 'intents',
            text: 'Fall back, then advance.',
            unitId: 'blue-1',
            intents: [
              { kind: 'withdraw', toward: at(1850, 2900) },
              { kind: 'move', to: at(2050, 1500) },
            ],
          };
        },
      },
      client,
    );
    const r = await parser.parse('Fall back, then advance.', ctx(['aggressive']));
    expect(client.calls[0]!.input).toMatchObject({ legs: [] });
    expect(r).toMatchObject({ kind: 'intents' });
    expect((r as { interpretation?: unknown }).interpretation).toBeUndefined();
  });

  it('records a stated intent, which the engine uses to damp the deviation', async () => {
    const r = await run('Move to the bridge so that the guns can deploy.', ['aggressive']);
    expect(r).toMatchObject({ interpretation: { action: 'exceed', intentStated: true } });
  });
});

describe('a weak, failing or hostile model changes nothing', () => {
  const written = (r: ParseResult) => r.kind === 'intents' && r.interpretation === undefined;
  const scripted = (reply: () => unknown) => new ScriptedModel({ parse: reply as never });

  it.each([
    ['a transport error', new UmpireError('boom', 'transport', 1)],
    ['a spent budget', new UmpireError('budget', 'budget', 0)],
    ['a schema failure', new UmpireError('bad json', 'schema', 3)],
  ])('keeps the order as written after %s', async (_n, err) => {
    const fallbacks: string[] = [];
    const client: UmpireClient = {
      call: async () => {
        throw err;
      },
    };
    const r = await new InterpretingParser(inner('Move.'), client, {
      onFallback: (m) => fallbacks.push(m),
    }).parse('Move.', ctx(['aggressive']));
    expect(written(r)).toBe(true);
    expect(fallbacks).toHaveLength(1);
  });

  it.each([
    [{ action: 'exceed', intentStated: false }],
    [{ action: 'exceed', amount: 'lots', intentStated: false }],
    [{ action: 'exceed', amount: -3, intentStated: false }],
    [{ action: 'teleport', amount: 5, intentStated: false }],
    [{ action: 'exceed', amount: 100 }],
    [null],
  ])('refuses the malformed answer %j', async (reply) => {
    const probe = new LeakProbe();
    const r = await run(
      'Move.',
      ['aggressive'],
      probe.client(
        'blue',
        scripted(() => reply),
      ),
    );
    expect(written(r)).toBe(true);
  });

  it('passes a huge amount on for the engine to clamp, and never changes the unit or intents', async () => {
    const probe = new LeakProbe();
    const out: InterpretOutput = { action: 'exceed', amount: 1e9, intentStated: false };
    const r = await run(
      'Move.',
      ['aggressive'],
      probe.client(
        'blue',
        scripted(() => out),
      ),
    );
    expect(r).toMatchObject({ unitId: 'blue-1', intents: [{ kind: 'move', to: at(2050, 1500) }] });
  });
});

describe('clarification', () => {
  const ask =
    (question: string, intentStated = false) =>
    () => ({
      action: 'clarify',
      intentStated,
      question,
    });
  const go = (reply: () => unknown, personality = ['literal']) =>
    run(
      'Move.',
      personality,
      new LeakProbe().client('blue', new ScriptedModel({ parse: reply as never })),
    );

  it('lets a literal officer ask when the order gives no intent', async () => {
    expect(await go(ask('Which road, sir?'))).toMatchObject({
      kind: 'clarification',
      question: 'Which road, sir?',
    });
  });

  it('does not let him ask when the order explains itself, or let any other officer ask', async () => {
    expect((await go(ask('Which road, sir?', true))).kind).toBe('intents');
    expect((await go(ask('Which road, sir?'), ['cautious'])).kind).toBe('intents');
  });

  it('refuses a question that names the other side or gives away a trait', async () => {
    for (const q of [
      'Is the Vanguard Battalion at the bridge, sir?',
      'I am a literal man, sir. Which road?',
      'Cautious as I am, which road, sir? Red-1 is near.',
    ]) {
      expect((await go(ask(q))).kind).toBe('intents');
    }
  });
});

describe('hostile order text', () => {
  for (const h of HOSTILE) {
    it(`stays input, never system content: ${h.kind}`, async () => {
      const probe = new LeakProbe();
      const model = new ScriptedModel({
        parse: (() => ({ action: 'none', intentStated: false })) as never,
      });
      await run(h.text, ['aggressive'], probe.client('blue', model));
      const [ex] = probe.exchanges;
      expect(ex!.request.system).toBe(INTERPRET_ORDERS_SYSTEM);
      expect(ex!.request.input).toMatchObject({ order: h.text });
    });
  }
});

describe('replay', () => {
  it('carries the logged interpretation into the order with no model call', async () => {
    const world = loadScenario(holdTheBridge);
    const parsed = (await run('Move to the bridge.', ['aggressive'])) as ParseResult;
    const state = createState(1, world, 0);
    const res = applyLoggedOrder(state, 'g', 1, 'blue', parsed);
    expect('state' in res).toBe(true);
    if ('state' in res) {
      expect(JSON.stringify(res.state.queue)).toContain('"interpretation":{"action":"exceed"');
    }
  });
});
