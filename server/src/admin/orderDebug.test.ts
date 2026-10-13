/**
 * #395: the order interpretation debug routes. A real game whose orders go through the LLM parser
 * wiring (a fake model, the test provider as the canned parser), then the history, the detail and the
 * dry-run playground through the admin API.
 */
import { serialize } from '@kriegsspiel/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../api/app.js';
import { hashToken } from '../auth/store.js';
import { TraceStore, traceUmpire, type TraceEntry } from '../debug/index.js';
import { MemoryGameStore } from '../game/index.js';
import type { InputLogEntry } from '../game/store.js';
import { LlmOrderParser, PARSE_ORDERS_PROMPT_VERSION } from '../orders/llmParser.js';
import { StubOrderParser } from '../orders/stubParser.js';
import { umpireConfigFromEnv } from '../umpire/config.js';
import { createUmpireClient } from '../umpire/createUmpireClient.js';
import { orderParserFor } from '../umpire/gameClients.js';
import type { UmpireClient, UmpireRequest, UmpireResponse } from '../umpire/umpireClient.js';
import {
  OrderPlayground,
  orderAttempts,
  type DryRunResult,
  type OrderAttempt,
  type OrderAttemptDetail,
} from './orderDebug.js';

const RATE = 3600;
const GOOD = 'Move the 1st Battalion to the bridge and hold it.';
const BAD = 'Hold the bridge at all costs.';

/** A model that places GOOD on the side's first unit and answers BAD with a unit the side does not own. */
class FakeModel implements UmpireClient {
  readonly calls: UmpireRequest[] = [];
  constructor(private readonly id = 'fake-1') {}
  async call<T>(request: UmpireRequest): Promise<UmpireResponse<T>> {
    this.calls.push(request);
    const input = request.input as {
      order?: string;
      units?: { id: string }[];
      places?: { id: string; kind: string }[];
    };
    const bridge = input.places?.find((p) => p.kind === 'bridge')?.id ?? 'nowhere';
    const output = request.promptVersion.startsWith('interpret')
      ? { action: 'none', intentStated: false }
      : input.order === BAD
        ? { result: 'intents', unitId: 'no-such-unit', intents: [{ kind: 'hold', place: bridge }] }
        : {
            result: 'intents',
            unitId: input.units?.[0]?.id,
            intents: [{ kind: 'move', place: bridge }],
          };
    return {
      output: output as T,
      record: {
        stage: request.stage,
        provider: 'fake',
        model: this.id,
        promptVersion: request.promptVersion,
        system: request.system,
        input: request.input,
        rawOutput: JSON.stringify(output),
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
        costUsd: null,
        attempts: 1,
      },
    };
  }
}

const cannedClient = () =>
  createUmpireClient({ config: umpireConfigFromEnv({ UMPIRE_PROVIDER: 'test' }), env: {} });

let app: App | undefined;
afterEach(async () => {
  await app?.server.close();
  app = undefined;
});

async function start(opts: { playground?: OrderPlayground; token?: string } = {}) {
  const trace = new TraceStore();
  const store = new MemoryGameStore();
  const model = new FakeModel();
  const canned = cannedClient();
  app = await buildApp({
    parser: orderParserFor({
      llm: true,
      clientFor: (gameId) => traceUmpire(model, { trace, gameId, mode: 'live' }),
      cannedParser: (gameId) =>
        new LlmOrderParser(traceUmpire(canned, { trace, gameId, mode: 'live' }), {
          fallbackParser: new StubOrderParser(),
        }),
      trace,
    }),
    store,
    admin: {
      enabled: true,
      trace,
      token: opts.token,
      playground: opts.playground,
    },
  });
  const base = await app.server.listen({ port: 0, host: '127.0.0.1' });
  const user = app.authStore.upsertUser('orders-test@example.test', Date.now());
  app.authStore.putSession(hashToken('test-session'), user.id, Date.now() + 3_600_000);
  const res = await fetch(`${base}/games`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'ks_session=test-session' },
    body: JSON.stringify({ rate: RATE }),
  });
  const { id } = (await res.json()) as { id: string };
  return { id, trace, store, model };
}

const get = (url: string, remoteAddress = '127.0.0.1') =>
  app!.server.inject({ method: 'GET', url, remoteAddress });
const post = (url: string, payload: unknown, remoteAddress = '127.0.0.1') =>
  app!.server.inject({ method: 'POST', url, payload: payload as object, remoteAddress });

describe('order history (#395)', () => {
  it('lists real attempts newest first, with the fallback reason and who answered', async () => {
    const { id } = await start();
    const actor = app!.host.get(id)!;
    expect((await actor.submit({ kind: 'order', side: 'blue', text: GOOD })).ok).toBe(true);
    await actor.submit({ kind: 'order', side: 'blue', text: BAD });

    const res = await get(`/admin/api/games/${id}/orders`);
    expect(res.statusCode).toBe(200);
    const { attempts } = res.json() as { attempts: OrderAttempt[] };
    expect(attempts.map((a) => a.text)).toEqual([BAD, GOOD]);
    const [bad, good] = attempts as [OrderAttempt, OrderAttempt];
    expect(good).toMatchObject({
      side: 'blue',
      outcome: 'intents',
      answeredBy: 'model',
      fallbacks: [],
    });
    expect(good.llmCalls).toBeGreaterThan(0);
    expect(bad.answeredBy).toBe('canned');
    expect(bad.fallbacks).toEqual([expect.stringContaining('"no-such-unit" is not one of')]);
    expect(bad.correlationId).toBeDefined();
  });

  it('shows the input, prompt, schema, raw reply, checks and final intents of one attempt', async () => {
    const { id } = await start();
    await app!.host.get(id)!.submit({ kind: 'order', side: 'blue', text: BAD });
    const { attempts } = (await get(`/admin/api/games/${id}/orders`)).json() as {
      attempts: OrderAttempt[];
    };
    const res = await get(`/admin/api/games/${id}/orders/${attempts[0]!.key}`);
    expect(res.statusCode).toBe(200);
    const d = res.json() as OrderAttemptDetail;
    const model = d.calls.find((c) => (c.data as { provider?: string }).provider === 'fake')!;
    expect(model.data).toMatchObject({
      stage: 'parse',
      promptVersion: PARSE_ORDERS_PROMPT_VERSION,
      system: expect.stringContaining('staff officer'),
      input: { order: BAD },
      schema: { type: 'object' },
      response: expect.stringContaining('no-such-unit'),
      model: 'fake-1',
      latencyMs: expect.any(Number),
    });
    // The canned parser answered after the check refused the model's unit.
    expect(d.calls.some((c) => (c.data as { mode?: string }).mode === 'test')).toBe(true);
    expect(d.notes.map((n) => n.data)).toEqual([
      expect.objectContaining({ step: 'parse', answeredBy: 'fallback' }),
    ]);
    expect(d.result).toMatchObject({ kind: 'intents', intents: [expect.anything()] });
    expect(d.chain.some((e) => e.kind === 'command')).toBe(true);
    expect((await get(`/admin/api/games/${id}/orders/log-999`)).statusCode).toBe(404);
  });

  it('is behind the admin gating', async () => {
    const { id } = await start({ token: 'tok-1234567890' });
    expect((await get(`/admin/api/games/${id}/orders`, '203.0.113.9')).statusCode).toBe(401);
    expect(
      (
        await post(
          `/admin/api/games/${id}/orders/dry-run`,
          { side: 'blue', text: GOOD },
          '203.0.113.9',
        )
      ).statusCode,
    ).toBe(401);
  });
});

describe('orderAttempts', () => {
  const entry = (seq: number, text: string, extra: Partial<InputLogEntry> = {}): InputLogEntry => ({
    seq,
    wallMs: seq * 1000,
    gameMs: seq,
    command: { kind: 'order', side: 'blue', text },
    ...extra,
  });
  const t = (
    seq: number,
    kind: TraceEntry['kind'],
    correlationId: string,
    data: unknown,
  ): TraceEntry => ({
    seq,
    ts: seq,
    gameId: 'g',
    correlationId,
    kind,
    data,
  });

  it('labels each source of the answer', () => {
    const log = [
      entry(1, 'a', { parse: { kind: 'rejection', text: 'a', reason: 'no' } }),
      entry(2, 'b', {
        fallback: { attempts: 2, error: 'parse timed out' },
        parse: { kind: 'clarification', text: 'b', question: '?' },
      }),
      entry(3, 'c', { parse: { kind: 'clarification', text: 'c', question: 'restate' } }),
      entry(4, 'd'),
    ];
    const trace = [
      t(1, 'command', 'c1', { seq: 1, command: log[0]!.command }),
      t(2, 'llm', 'c1', { mode: 'live', ok: true }),
      t(3, 'command', 'c2', { seq: 2, command: log[1]!.command }),
      t(4, 'command', 'c3', { seq: 3, command: log[2]!.command }),
      t(5, 'order', 'c3', { step: 'parse', reason: 'unknown place "x"', answeredBy: 'none' }),
      t(6, 'command', 'c5', { seq: 5, command: { kind: 'order', side: 'red', text: 'e' } }),
    ];
    const byText = Object.fromEntries(orderAttempts(log, trace).map((a) => [a.text, a]));
    expect(byText.a).toMatchObject({ answeredBy: 'model', outcome: 'rejection', summary: 'no' });
    expect(byText.b).toMatchObject({
      answeredBy: 'none',
      fallbacks: [expect.stringContaining('parse timed out')],
    });
    expect(byText.c).toMatchObject({ answeredBy: 'none', fallbacks: ['parse: unknown place "x"'] });
    expect(byText.d).toMatchObject({ answeredBy: 'unknown', outcome: 'pending', llmCalls: 0 });
    expect(byText.e).toMatchObject({ key: 'trace-6', outcome: 'pending', side: 'red' });
  });

  it('gives each order of a shared correlation id only its own calls and notes', () => {
    const log = [
      entry(1, 'first', { parse: { kind: 'rejection', text: 'first', reason: 'no' } }),
      entry(2, 'second', { parse: { kind: 'rejection', text: 'second', reason: 'no' } }),
      entry(3, 'scripted', {
        agent: true,
        parse: { kind: 'intents', text: 'scripted', unitId: 'r', intents: [] },
      }),
    ];
    const trace = [
      t(1, 'command', 'tick', { seq: 1, command: log[0]!.command }),
      t(2, 'command', 'tick', { seq: 2, command: log[1]!.command }),
      t(3, 'command', 'tick', { seq: 3, command: log[2]!.command }),
      t(4, 'llm', 'tick', { stage: 'parse', mode: 'live', ok: true, input: { order: 'first' } }),
      t(5, 'llm', 'tick', { stage: 'parse', mode: 'test', ok: true, input: { order: 'second' } }),
      t(6, 'order', 'tick', {
        step: 'parse',
        text: 'second',
        reason: 'bad',
        answeredBy: 'fallback',
      }),
      t(7, 'llm', 'tick', { stage: 'narrate', mode: 'live', ok: true, input: { reports: [] } }),
    ];
    const byText = Object.fromEntries(orderAttempts(log, trace).map((a) => [a.text, a]));
    expect(byText.first).toMatchObject({ answeredBy: 'model', llmCalls: 1, fallbacks: [] });
    expect(byText.second).toMatchObject({
      answeredBy: 'canned',
      llmCalls: 1,
      fallbacks: ['parse: bad'],
    });
    expect(byText.scripted).toMatchObject({ answeredBy: 'agent', llmCalls: 0 });
  });
});

describe('playground (#395)', () => {
  it('runs an edited order and prompt, shows the canned answer, and never touches the game', async () => {
    const dry = new FakeModel('dry-model');
    const seen: unknown[] = [];
    const playground = new OrderPlayground({
      config: umpireConfigFromEnv({ UMPIRE_PROVIDER: 'test' }),
      makeClient: (config) => {
        seen.push(config);
        return dry;
      },
      cannedClient: cannedClient(),
    });
    const { id, store, model, trace } = await start({ playground });
    const actor = app!.host.get(id)!;
    await actor.submit({ kind: 'order', side: 'blue', text: GOOD });
    await actor.submit({ kind: 'pause' });
    const state = serialize(actor.state);
    const log = (await store.inputLog(id)).length;
    const traced = trace.entries(id).length;
    const modelCalls = model.calls.length;

    const ctx = (await get(`/admin/api/games/${id}/orders-context?side=blue`)).json() as {
      units: { side: string }[];
    };
    expect(ctx.units.length).toBeGreaterThan(0);
    const res = await post(`/admin/api/games/${id}/orders/dry-run`, {
      side: 'blue',
      text: BAD,
      prompts: { parse: 'EDITED PROMPT' },
      route: { provider: 'test', model: 'tiny', temperature: 0.3 },
    });
    expect(res.statusCode).toBe(200);
    const r = res.json() as DryRunResult;
    expect(r.route).toMatchObject({ provider: 'test', model: 'tiny', temperature: 0.3 });
    expect(seen[0]).toMatchObject({ stages: { parse: { model: 'tiny' } }, budget: undefined });
    expect(dry.calls[0]).toMatchObject({
      system: 'EDITED PROMPT',
      promptVersion: `${PARSE_ORDERS_PROMPT_VERSION}+edited`,
      temperature: 0.3,
    });
    // No fallback parser on the model side: the checks' refusal is shown, not hidden.
    expect(r.model!.problems).toEqual([expect.stringContaining('"no-such-unit"')]);
    expect(r.model!.result.kind).toBe('clarification');
    expect(r.model!.calls[0]).toMatchObject({
      ok: true,
      response: expect.stringContaining('no-such-unit'),
    });
    expect(r.canned.result.kind).toBe('intents');
    expect(r.usage).toMatchObject({ runs: 1, calls: 1, inputTokens: 10 });

    expect(serialize(actor.state)).toBe(state);
    expect((await store.inputLog(id)).length).toBe(log);
    expect(trace.entries(id).length).toBe(traced);
    expect(model.calls.length).toBe(modelCalls);
  });

  it('rate limits dry runs and refuses a provider the server does not have', async () => {
    let now = 0;
    const playground = new OrderPlayground({
      config: umpireConfigFromEnv({ UMPIRE_PROVIDER: 'test' }),
      makeClient: () => new FakeModel(),
      perMinute: 2,
      now: () => now,
    });
    const { id } = await start({ playground });
    const run = (body: object = {}) =>
      post(`/admin/api/games/${id}/orders/dry-run`, { side: 'blue', text: GOOD, ...body });
    expect((await run({ route: { provider: 'http://evil.example' } })).statusCode).toBe(400);
    expect((await run()).statusCode).toBe(200);
    expect((await run()).statusCode).toBe(200);
    const limited = await run();
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: 'rate_limited' });
    now = 61_000;
    expect((await run()).statusCode).toBe(200);
    expect((await run({ unknown: 1 })).statusCode).toBe(400);
  });

  it('describes the prompts, providers and route for the form', async () => {
    await start({
      playground: new OrderPlayground({ config: umpireConfigFromEnv({ UMPIRE_PROVIDER: 'test' }) }),
    });
    const body = (await get('/admin/api/orders/playground')).json() as {
      prompts: Record<string, { version: string; system: string }>;
      providers: { id: string }[];
      route: { provider: string };
    };
    expect(body.prompts.parse!.version).toBe(PARSE_ORDERS_PROMPT_VERSION);
    expect(body.prompts.interpret!.system).toContain('subordinate');
    expect(body.providers.map((p) => p.id)).toContain('test');
    expect(body.route.provider).toBe('test');
  });
});
