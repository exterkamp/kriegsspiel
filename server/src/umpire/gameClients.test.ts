/** Per-game umpire clients are evicted (#263) and the parser wiring from main.ts is testable. */
import { describe, expect, it } from 'vitest';
import { CORPUS_CONTEXT } from '../orders/eval/corpus.js';
import { INTERPRET_ORDERS_PROMPT_VERSION, InterpretingParser } from '../orders/interpret.js';
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

  it("records an interpret note when the subordinate's reading is refused", async () => {
    const recorded: Array<{ kind: string; data: unknown }> = [];
    const trace = {
      enabled: true,
      record: (_id: string, kind: string, data: unknown) => recorded.push({ kind, data }),
    };
    const client: UmpireClient = {
      async call(req) {
        if (req.promptVersion === INTERPRET_ORDERS_PROMPT_VERSION) {
          return { output: { action: 'exceed', intentStated: false } } as never;
        }
        return {
          output: {
            result: 'intents',
            unitId: 'blue-1',
            intents: [{ kind: 'move', place: 'bridge' }],
          },
          record: {},
        } as never;
      },
    };
    const ctx = {
      ...CORPUS_CONTEXT,
      units: CORPUS_CONTEXT.units.map((u) =>
        u.id === 'blue-1' ? { ...u, personality: ['aggressive'] } : u,
      ),
    };
    const make = orderParserFor({ llm: true, clientFor: () => client, trace }) as (
      id: string,
    ) => OrderParser;
    const r = await make('g').parse('Take the bridge', ctx);
    expect(r).toMatchObject({ kind: 'intents', unitId: 'blue-1' });
    expect(r).not.toHaveProperty('interpretation');
    expect(recorded).toEqual([
      {
        kind: 'order',
        data: {
          step: 'interpret',
          text: 'Take the bridge',
          reason: 'bad amount',
          answeredBy: 'as-written',
        },
      },
    ]);
  });
});
