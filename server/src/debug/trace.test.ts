import {
  COURIER_MS_PER_METRE,
  findPath,
  EventRegistry,
  holdTheBridge,
  loadScenario,
  registerCombat,
  registerMovement,
  registerOrders,
  registerVisibility,
  type GameState,
} from '@kriegsspiel/engine';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GameHost, MemoryGameStore } from '../game/index.js';
import { FakeTime } from '../game/testing.js';
import type { OrderParser, ParseResult } from '../orders/index.js';
import {
  UmpireError,
  type UmpireClient,
  type UmpireRequest,
  type UmpireResponse,
} from '../umpire/index.js';
import {
  MAX_STRING_LENGTH,
  Redactor,
  TraceStore,
  traceRequest,
  traceUmpire,
  type TraceSink,
} from './index.js';

// Blue HQ to blue-1 courier travel time along the planned route.
const START = loadScenario(holdTheBridge);
const ROUTE = findPath(
  START.map,
  START.sides.find((s) => s.id === 'blue')!.hq,
  START.units.find((u) => u.id === 'blue-1')!.center,
)!;
const DELIVERY_MS = Math.round((ROUTE.cost / 1000) * COURIER_MS_PER_METRE);
// The bridge, in state units (mm).
const BRIDGE = { x: 2_050_000, y: 1_500_000 };

const API_KEY = 'sk-ant-api03-SUPERSECRETKEYVALUE1234567890';

function registry() {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerCombat(r);
  registerOrders(r);
  registerVisibility(r);
  return r;
}

/** A fake model that echoes secrets back, the way a leaky prompt or error would. */
const fakeUmpire: UmpireClient = {
  async call<T>(request: UmpireRequest): Promise<UmpireResponse<T>> {
    const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 };
    return {
      output: { ok: true } as T,
      record: {
        stage: request.stage,
        provider: 'local',
        model: 'test-model',
        promptVersion: request.promptVersion,
        system: `${request.system} key=${API_KEY}`,
        input: request.input,
        rawOutput: '{"ok":true}',
        usage,
        costUsd: 0.01,
        attempts: 2,
      },
    };
  },
};

function setup(trace: Parameters<typeof traceUmpire>[1]['trace']) {
  const time = new FakeTime();
  const umpire = traceUmpire(fakeUmpire, { trace, gameId: 'g1', mode: 'live', now: time.now });
  const parser: OrderParser = {
    async parse(text: string): Promise<ParseResult> {
      await umpire.call({
        stage: 'parse',
        promptVersion: 'p1',
        system: 'parse orders',
        input: { text, apiKey: API_KEY },
        schema: { type: 'object' },
      });
      return {
        kind: 'intents',
        text,
        unitId: 'blue-1',
        intents: [{ kind: 'move', to: BRIDGE }],
      };
    },
  };
  const host = new GameHost({
    store: new MemoryGameStore(),
    parser,
    registry: registry(),
    wallNow: time.now,
    timers: time,
    trace,
  });
  return { time, host };
}

let host: GameHost | undefined;
afterEach(async () => {
  await host?.shutdown();
  host = undefined;
});

const order = { kind: 'order', side: 'blue', text: 'blue-1 march' } as const;

describe('debug trace store', () => {
  it('links requests, commands, engine events and LLM calls by correlation id', async () => {
    const trace = new TraceStore({ secrets: [API_KEY] });
    const s = setup(trace);
    host = s.host;
    const game = await host.create('g1', loadScenario(holdTheBridge));

    let correlation = '';
    await traceRequest(
      trace,
      'g1',
      { transport: 'http', method: 'POST', path: '/games/g1/orders', bytes: 42 },
      async (id) => {
        correlation = id;
        return game.submit(order);
      },
      { now: s.time.now },
    );
    await game.submit({ kind: 'pause' });
    await game.submit({ kind: 'resume' });
    await s.time.advance(DELIVERY_MS);

    const kinds = new Set(trace.entries('g1').map((e) => e.kind));
    for (const k of ['request', 'command', 'engine', 'clock', 'llm'] as const) {
      expect(kinds.has(k), k).toBe(true);
    }

    const linked = trace.entries('g1', { correlationId: correlation });
    expect(new Set(linked.map((e) => e.kind))).toEqual(new Set(['request', 'command', 'llm']));
    const llm = linked.find((e) => e.kind === 'llm')!.data as Record<string, unknown>;
    expect(llm).toMatchObject({
      provider: 'local',
      model: 'test-model',
      stage: 'parse',
      mode: 'live',
      retries: 1,
      costUsd: 0.01,
      ok: true,
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    expect(typeof llm.latencyMs).toBe('number');
    expect(llm.schema).toEqual({ type: 'object' });
    expect(linked.find((e) => e.kind === 'request')!.data).toMatchObject({
      method: 'POST',
      bytes: 42,
      ok: true,
    });

    // Scheduler-fired engine events carry their own id, distinct from the request's.
    const engine = trace.entries('g1', { kind: 'engine' });
    expect(engine.length).toBeGreaterThan(0);
    expect(engine.every((e) => e.correlationId !== 'none')).toBe(true);
  });

  it('never stores API keys', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trace-'));
    const filePath = join(dir, 'trace.jsonl');
    // Pattern redaction alone (no registered secret) must catch a key-shaped value too.
    const trace = new TraceStore({ filePath });
    const s = setup(trace);
    host = s.host;
    const game = await host.create('g1', loadScenario(holdTheBridge));
    await traceRequest(
      trace,
      'g1',
      { transport: 'ws', method: 'order', path: `/ws?key=${API_KEY}` },
      () => game.submit(order),
    );
    trace.record('g1', 'error', {
      error: new Error(`401 invalid x-api-key ${API_KEY}`),
      headers: { 'x-api-key': API_KEY, Authorization: `Bearer ${API_KEY}` },
    });
    await trace.close();

    const stored = JSON.stringify(trace.entries('g1')) + readFileSync(filePath, 'utf8');
    expect(stored).not.toContain('SUPERSECRETKEYVALUE');
    expect(stored).toContain('[REDACTED]');
    // Token counts are not secrets and survive.
    expect(stored).toContain('"inputTokens":10');
    rmSync(dir, { recursive: true });
  });

  it('scrubs exact registered secrets that match no pattern', () => {
    const r = new Redactor(['hunter2-plain-secret']);
    expect(r.value({ note: 'pw is hunter2-plain-secret ok', n: 3 })).toEqual({
      note: 'pw is [REDACTED] ok',
      n: 3,
    });
  });

  it('stores nothing when disabled', async () => {
    const calls: unknown[][] = [];
    const spy: TraceSink = {
      enabled: false,
      record: (...args) => {
        calls.push(args);
      },
    };
    // A real store that is built but never handed to the host.
    const unused = new TraceStore();
    const s = setup(spy);
    host = s.host;
    const game = await host.create('g1', loadScenario(holdTheBridge));
    const ran = await traceRequest(
      spy,
      'g1',
      { transport: 'http', method: 'POST', path: '/x' },
      async () => game.submit(order),
    );
    expect(ran).toMatchObject({ ok: true });
    await game.submit({ kind: 'pause' });
    await game.submit({ kind: 'resume' });
    await s.time.advance(60_000);
    expect(calls).toEqual([]);
    expect(unused.entries('g1')).toEqual([]);
    // The umpire is not even wrapped.
    expect(traceUmpire(fakeUmpire, { trace: spy, gameId: 'g1', mode: 'live' })).toBe(fakeUmpire);
  });

  it('redacts bare token and cookie keys', () => {
    const r = new Redactor();
    expect(
      r.value({
        cookie: 'sid=abc',
        token: 'xyz',
        'set-cookie': 'a=b',
        'x-auth-token': 't',
        inputTokens: 10,
        outputTokens: 5,
      }),
    ).toEqual({
      cookie: '[REDACTED]',
      token: '[REDACTED]',
      'set-cookie': '[REDACTED]',
      'x-auth-token': '[REDACTED]',
      inputTokens: 10,
      outputTokens: 5,
    });
  });

  it('keeps prose that merely starts with Basic or Bearer', () => {
    const r = new Redactor();
    expect(r.string('Basic movement orders')).toBe('Basic movement orders');
    expect(r.string('Authorization: Basic dXNlcjpwYXNzd29yZA==')).toContain('[REDACTED]');
    expect(r.string('Bearer abcdefgh12345')).toBe('[REDACTED]');
  });

  it('serialises Date, Map and Set, and truncates huge strings', () => {
    const r = new Redactor();
    expect(r.value({ d: new Date(0), m: new Map([['a', 1]]), s: new Set([1]) })).toEqual({
      d: '1970-01-01T00:00:00.000Z',
      m: [['a', 1]],
      s: [1],
    });
    const big = r.string('x'.repeat(MAX_STRING_LENGTH + 50));
    expect(big.length).toBeLessThan(MAX_STRING_LENGTH + 60);
    expect(big).toContain('[truncated 50 chars]');
  });

  it('never throws on a throwing getter or Proxy, and record survives it', () => {
    const errors: unknown[] = [];
    const trace = new TraceStore({ onFileError: (e) => errors.push(e) });
    const bad = {
      ok: 1,
      get x(): number {
        throw new Error('boom');
      },
    };
    expect(new Redactor().value(bad)).toEqual({ ok: 1, x: '[unserializable]' });
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('trap');
        },
      },
    );
    expect(() => trace.record('g1', 'engine', { bad, proxy })).not.toThrow();
    expect(trace.entries('g1')).toHaveLength(1);
    expect(new Redactor().value(proxy)).toBe('[unserializable]');
    expect(errors).toEqual([]);
  });

  it('labels LLM entries with the provider that served the call, with fallbacks', async () => {
    const trace = new TraceStore();
    const noProvider: UmpireClient = {
      async call<T>(request: UmpireRequest): Promise<UmpireResponse<T>> {
        const res = await fakeUmpire.call<T>(request);
        return { ...res, record: { ...res.record, provider: undefined } };
      },
    };
    const request = {
      stage: 'parse',
      promptVersion: 'p1',
      system: 's',
      input: {},
      schema: {},
    } as const;
    await traceUmpire(noProvider, { trace, gameId: 'g1', mode: 'live' }).call(request);
    await traceUmpire(noProvider, { trace, gameId: 'g1', mode: 'live', provider: 'ollama' }).call(
      request,
    );
    await traceUmpire(fakeUmpire, { trace, gameId: 'g1', mode: 'live', provider: 'ollama' }).call(
      request,
    );
    const failing: UmpireClient = {
      async call() {
        throw new UmpireError('down', 'transport', 1);
      },
    };
    await traceUmpire(failing, { trace, gameId: 'g1', mode: 'live', provider: 'ollama' })
      .call(request)
      .catch(() => undefined);
    const providers = trace
      .entries('g1', { kind: 'llm' })
      .map((e) => (e.data as { provider: string }).provider);
    // Record provider wins; then the option; then 'unknown'.
    expect(providers).toEqual(['unknown', 'ollama', 'local', 'ollama']);
  });

  it('bounds the ring buffer per game', () => {
    const trace = new TraceStore({ maxEntriesPerGame: 3 });
    for (let i = 0; i < 10; i++) trace.record('g1', 'engine', { i }, 'c');
    trace.record('g2', 'engine', { i: 0 }, 'c');
    expect(trace.entries('g1').map((e) => (e.data as { i: number }).i)).toEqual([7, 8, 9]);
    expect(trace.entries('g2')).toHaveLength(1);
  });
});
