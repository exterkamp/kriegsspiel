/**
 * The LLM order parser as the order route uses it (#253): a mocked provider behind `LlmOrderParser`
 * with the stub as fallback, run inside a real game at rates 1, 4 and 12.
 */
import { holdTheBridge, loadScenario } from '@kriegsspiel/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { GameHost, MemoryGameStore, replayLog } from '../game/index.js';
import { createRegistry, startingState } from '../game/registry.js';
import { FakeTime } from '../game/testing.js';
import { MockUmpireClient } from '../umpire/mockUmpireClient.js';
import { UmpireError } from '../umpire/umpireClient.js';
import type { UmpireClient, UmpireRequest, UmpireResponse } from '../umpire/umpireClient.js';
import { CORPUS_CONTEXT } from './eval/corpus.js';
import { FALLBACK_QUESTION, LlmOrderParser } from './llmParser.js';
import type { ParseContext } from './orderParser.js';
import { StubOrderParser } from './stubParser.js';

const at = (x: number, y: number) => ({ x: x * 1000, y: y * 1000 });

/** The corpus world with the ford the sample order names. */
const WORLD: ParseContext = {
  ...CORPUS_CONTEXT,
  map: {
    features: [
      ...CORPUS_CONTEXT.map.features,
      { id: 'north-wood', kind: 'wood', name: 'Northern wood', anchor: at(250, 50) },
      { id: 'ford', kind: 'river', name: 'The ford', anchor: at(400, 250) },
    ],
  },
};

const SAMPLES = {
  battalion: 'Move the 1st Battalion to the bridge and hold it.',
  cavalry: 'Cavalry screen the northern wood, then fall back to the ford if pressed.',
  hold: 'Hold the bridge at all costs.',
};

/** What a sound model answers for each sample order. */
const FIXTURES = [
  {
    match: SAMPLES.battalion,
    output: {
      result: 'intents',
      unitId: 'blue-1',
      intents: [
        { kind: 'move', place: 'bridge' },
        { kind: 'hold', place: 'bridge' },
      ],
    },
  },
  {
    match: SAMPLES.cavalry,
    output: {
      result: 'intents',
      unitId: 'blue-3',
      intents: [
        { kind: 'move', place: 'north-wood' },
        { kind: 'withdraw', place: 'ford' },
      ],
    },
  },
  {
    match: SAMPLES.hold,
    output: { result: 'intents', unitId: 'blue-1', intents: [{ kind: 'hold', place: 'bridge' }] },
  },
];

/** Answers by order text, so a test does not depend on the exact input the parser builds. */
class ScriptedProvider implements UmpireClient {
  readonly calls: UmpireRequest[] = [];
  constructor(private readonly behave: (text: string) => unknown) {}
  async call<T>(request: UmpireRequest): Promise<UmpireResponse<T>> {
    this.calls.push(request);
    const out = this.behave((request.input as { order: string }).order);
    if (out instanceof Error) throw out;
    return {
      output: out as T,
      record: { usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0 },
    } as UmpireResponse<T>;
  }
}

const sound = () =>
  new ScriptedProvider(
    (text) =>
      FIXTURES.find((f) => f.match === text)?.output ?? { result: 'rejection', reason: 'No.' },
  );

describe('LLM parser with the stub as fallback', () => {
  it.each(Object.entries(SAMPLES))('parses the sample order %s into intents', async (_k, text) => {
    const parser = new LlmOrderParser(sound(), { fallbackParser: new StubOrderParser() });
    const r = await parser.parse(text, WORLD);
    expect(r.kind).toBe('intents');
    expect(r.text).toBe(text);
  });

  it('turns a clarification into a readable question with the options as written', async () => {
    const client = new MockUmpireClient([
      {
        stage: 'parse',
        output: {
          result: 'clarification',
          question: 'Which wood do you mean?',
          options: ['north-wood', 'Hollow wood'],
        },
      },
    ]);
    const r = await new LlmOrderParser(client).parse('Move to the wood', WORLD);
    expect(r).toMatchObject({ kind: 'clarification', question: 'Which wood do you mean?' });
  });

  it('keeps the wording and capitalisation of a rejected order', async () => {
    const client = new MockUmpireClient([
      { stage: 'parse', output: { result: 'rejection', reason: 'There is no Rhine here.' } },
    ]);
    const text = 'Cross the RHINE at Dawn';
    expect(await new LlmOrderParser(client).parse(text, WORLD)).toEqual({
      kind: 'rejection',
      text,
      reason: 'There is no Rhine here.',
    });
  });

  it.each([
    ['a provider error', new UmpireError('boom', 'transport', 0)],
    ['a spent budget', new UmpireError('over budget', 'budget', 0)],
  ])('uses the stub for a simple order after %s', async (_n, err) => {
    const fallbacks: string[] = [];
    const parser = new LlmOrderParser(new ScriptedProvider(() => err), {
      fallbackParser: new StubOrderParser(),
      onFallback: (f) => fallbacks.push(f.reason),
    });
    expect((await parser.parse('1st Battalion march to the bridge', WORLD)).kind).toBe('intents');
    expect(fallbacks).toHaveLength(1);
  });

  it('asks the player to restate an order the stub cannot read either', async () => {
    const parser = new LlmOrderParser(
      new ScriptedProvider(() => new UmpireError('boom', 'transport', 0)),
      { fallbackParser: new StubOrderParser() },
    );
    expect(await parser.parse(SAMPLES.cavalry, WORLD)).toEqual({
      kind: 'clarification',
      text: SAMPLES.cavalry,
      question: FALLBACK_QUESTION,
    });
  });
});

describe('in a game', () => {
  let host: GameHost | undefined;
  afterEach(async () => {
    await host?.shutdown();
    host = undefined;
  });

  async function play(rate: number, provider: ScriptedProvider, text: string) {
    const time = new FakeTime();
    const store = new MemoryGameStore();
    host = new GameHost({
      store,
      parser: () => new LlmOrderParser(provider, { fallbackParser: new StubOrderParser() }),
      registry: createRegistry(),
      wallNow: time.now,
      timers: time,
      init: startingState,
    });
    const game = await host.create('g1', loadScenario(holdTheBridge), { rate });
    await time.advance(60_000 / rate);
    const result = await game.submit({ kind: 'order', side: 'blue', text });
    await time.advance(120_000 / rate);
    return { game, store, result };
  }

  it.each([1, 4, 12])(
    'carries out a parsed order at rate %i and replays without a model call',
    async (rate) => {
      const provider = new ScriptedProvider(() => ({
        result: 'intents',
        unitId: 'blue-1',
        intents: [
          { kind: 'move', place: 'bridge' },
          { kind: 'hold', place: 'bridge' },
        ],
      }));
      const { game, store, result } = await play(rate, provider, SAMPLES.battalion);
      expect(result.ok).toBe(true);
      expect(provider.calls).toHaveLength(1);
      const entries = await store.inputLog('g1');
      expect(entries.find((e) => e.parse)?.parse?.kind).toBe('intents');

      const calls = provider.calls.length;
      const replayed = await replayLog(
        (await store.logHeader('g1'))!,
        loadScenario(holdTheBridge),
        entries,
        createRegistry(),
        game.state.time,
        startingState,
      );
      expect(replayed.state.world).toEqual(game.state.world);
      expect(provider.calls).toHaveLength(calls);
    },
  );

  it.each([1, 4, 12])(
    'refuses with a question, losing nothing, when the provider fails at rate %i',
    async (rate) => {
      const provider = new ScriptedProvider(() => new UmpireError('over budget', 'budget', 0));
      const { game, result } = await play(rate, provider, SAMPLES.cavalry);
      expect(result).toMatchObject({
        ok: false,
        kind: 'clarification',
        question: FALLBACK_QUESTION,
      });
      // The clock was not left held on the failed parse.
      expect(game.state.time).toBeGreaterThan(0);
      // Nothing is still held: a further order is parsed (and refused) rather than blocked.
      const again = await game.submit({ kind: 'order', side: 'blue', text: SAMPLES.cavalry });
      expect(again).toMatchObject({
        ok: false,
        kind: 'clarification',
        question: FALLBACK_QUESTION,
      });
    },
  );

  it('asks the parser factory for each game by its own id', async () => {
    const time = new FakeTime();
    const ids: string[] = [];
    host = new GameHost({
      store: new MemoryGameStore(),
      parser: (id) => {
        ids.push(id);
        return new StubOrderParser();
      },
      registry: createRegistry(),
      wallNow: time.now,
      timers: time,
      init: startingState,
    });
    await host.create('g1', loadScenario(holdTheBridge), { rate: 1 });
    await host.create('g2', loadScenario(holdTheBridge), { rate: 1 });
    expect(ids).toEqual(['g1', 'g2']);
  });
});
