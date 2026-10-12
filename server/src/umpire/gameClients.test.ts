/** Per-game umpire clients are evicted (#263) and the parser wiring from main.ts is testable. */
import { describe, expect, it } from 'vitest';
import { CORPUS_CONTEXT } from '../orders/eval/corpus.js';
import { LlmOrderParser } from '../orders/llmParser.js';
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
    expect(clients.size).toBe(2);
    clients.evict('a');
    clients.evict('a');
    clients.evict('never');
    expect(clients.size).toBe(1);
    expect(clients.get('a')).not.toBe(a);
    expect(made).toBe(3);
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
    expect(make('g1')).toBeInstanceOf(LlmOrderParser);
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
    }) as (id: string) => LlmOrderParser;
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
    const r = await (make as (id: string) => LlmOrderParser)('g').parse('Advance', CORPUS_CONTEXT);
    expect(calls).toEqual(['Advance']);
    expect(r).toMatchObject({ kind: 'intents', unitId: 'blue-1' });
  });
});
