/** Per-game umpire clients are evicted (#263) and the parser wiring from main.ts is testable. */
import { describe, expect, it } from 'vitest';
import { CORPUS_CONTEXT } from '../orders/eval/corpus.js';
import { InterpretingParser } from '../orders/interpret.js';
import type { OrderParser } from '../orders/index.js';
import { StubOrderParser } from '../orders/stubParser.js';
import { GameClients, orderParserFor } from './gameClients.js';
import { MockUmpireClient } from './mockUmpireClient.js';
import { UmpireError } from './umpireClient.js';
import type { UmpireClient } from './umpireClient.js';

describe('GameClients', () => {
  it('makes one client per game and drops it on evict', () => {
    let made = 0;
    const clients = new GameClients(() => (made++, new MockUmpireClient([])));
    const a = clients.get('a');
    expect(clients.get('a')).toBe(a);
    clients.get('b');
    expect(made).toBe(2);
    clients.evict('a');
    clients.evict('a');
    clients.evict('never');
    expect(made).toBe(2);
    expect(clients.get('a')).not.toBe(a);
    expect(made).toBe(3);
    clients.get('b');
    expect(made).toBe(3);
  });

  it('peek returns an existing client without making one', () => {
    let made = 0;
    const clients = new GameClients(() => (made++, new MockUmpireClient([])));
    expect(clients.peek('a')).toBeUndefined();
    expect(made).toBe(0);
    expect(clients.peek('a')).toBeUndefined();
    const a = clients.get('a');
    expect(clients.peek('a')).toBe(a);
  });
});

describe('orderParserFor', () => {
  it('is the stub parser when the LLM is off, and never asks for a client', () => {
    const parser = orderParserFor({
      llm: false,
      clientFor: () => {
        throw new Error('no client wanted');
      },
    });
    expect(parser).toBeInstanceOf(StubOrderParser);
  });

  it('builds an LLM parser per game from that game’s client', () => {
    const asked: string[] = [];
    const parser = orderParserFor({
      llm: true,
      clientFor: (id) => (asked.push(id), new MockUmpireClient([])),
    });
    expect(typeof parser).toBe('function');
    const make = parser as (id: string) => unknown;
    expect(make('g1')).toBeInstanceOf(InterpretingParser);
    make('g2');
    expect(asked).toEqual(['g1', 'g2']);
  });

  it('falls back to the stub and reports it when the model fails', async () => {
    const failing: UmpireClient = {
      async call() {
        throw new UmpireError('boom', 'transport', 0);
      },
    };
    const seen: Array<[string, string]> = [];
    const make = orderParserFor({
      llm: true,
      clientFor: () => failing,
      onFallback: (id, reason) => seen.push([id, reason]),
    }) as (id: string) => OrderParser;
    const r = await make('g1').parse('1st Battalion march to the bridge', CORPUS_CONTEXT);
    expect(r.kind).toBe('intents');
    expect(seen).toHaveLength(1);
    expect(seen[0]![0]).toBe('g1');
  });

  it('retries the canned parser before the stub when one is given', async () => {
    const failing: UmpireClient = {
      async call() {
        throw new UmpireError('boom', 'transport', 0);
      },
    };
    const calls: string[] = [];
    const canned = {
      async parse(text: string) {
        calls.push(text);
        return { kind: 'intents' as const, text, unitId: 'blue-1', intents: [] };
      },
    };
    const make = orderParserFor({ llm: true, clientFor: () => failing, cannedParser: canned });
    const r = await (make as (id: string) => OrderParser)('g').parse('Advance', CORPUS_CONTEXT);
    expect(calls).toEqual(['Advance']);
    expect(r).toMatchObject({ kind: 'intents', unitId: 'blue-1' });
  });

  it('with a canned parser, keeps a model answer only if it names what the order names (#389)', async () => {
    const model = new MockUmpireClient([
      {
        stage: 'parse',
        output: {
          result: 'intents',
          unitId: 'blue-3',
          intents: [{ kind: 'move', place: 'bridge' }],
        },
      },
    ]);
    const canned = {
      async parse(text: string) {
        return {
          kind: 'intents' as const,
          text,
          unitId: 'blue-1',
          intents: [{ kind: 'move' as const, to: { x: 250_000, y: 250_000 } }],
        };
      },
    };
    const seen: string[] = [];
    const make = orderParserFor({
      llm: true,
      clientFor: () => model,
      cannedParser: canned,
      onFallback: (_id, reason) => seen.push(reason),
    }) as (id: string) => OrderParser;
    const r = await make('g').parse('1st Battalion march to the bridge', CORPUS_CONTEXT);
    expect(r).toMatchObject({ kind: 'intents', unitId: 'blue-1' });
    expect(seen.some((x) => /not grounded/.test(x))).toBe(true);
  });
});
