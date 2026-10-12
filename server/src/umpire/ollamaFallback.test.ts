import { describe, expect, it, vi } from 'vitest';
import { MS_PER_MINUTE, holdTheBridge, loadScenario } from '@kriegsspiel/engine';
import type { ViewReport } from '@kriegsspiel/engine';
import { llmOrderParserEnabled, usesTestUmpire } from '../config.js';
import { CORPUS_CONTEXT } from '../orders/eval/corpus.js';
import { LlmOrderParser } from '../orders/llmParser.js';
import { umpireConfigFromEnv } from './config.js';
import { createUmpireClient } from './createUmpireClient.js';
import type { UmpireFallback } from './fallbackUmpireClient.js';
import { NARRATE_SCHEMA, narrateInput, narrateReports } from './narrate.js';
import { PlaybackUmpireClient } from './playbackUmpireClient.js';
import { StaffRoster, runStaff } from './staff.js';
import type { UmpireCallRecord } from './umpireClient.js';

const ENV = { UMPIRE_KEYLESS_PROVIDER: 'ollama', OLLAMA_URL: 'http://ollama:11434' };
const ORDER = 'Move the 1st Battalion to the bridge and hold it.';

const chat = (content: string) =>
  new Response(JSON.stringify({ message: { content }, prompt_eval_count: 30, eval_count: 9 }));

function setup(fetch: typeof globalThis.fetch, env: Record<string, string> = {}) {
  const fallbacks: UmpireFallback[] = [];
  const records: UmpireCallRecord[] = [];
  const config = umpireConfigFromEnv({
    ...ENV,
    UMPIRE_BASE_BACKOFF_MS: '1',
    UMPIRE_MAX_BACKOFF_MS: '1',
    ...env,
  });
  const client = createUmpireClient({
    config,
    env: {},
    fetch,
    recorder: { record: (r) => records.push(r) },
    onFallback: (f) => fallbacks.push(f),
  });
  return { client, fallbacks, records, config };
}

function reports(): ViewReport[] {
  return [
    {
      id: 'blue-r1',
      kind: 'contact',
      from: '2nd Hussars',
      sizeEstimate: 'about 400 men',
      confidence: 'medium',
      observedAt: 10 * MS_PER_MINUTE,
      deliveredAt: 14 * MS_PER_MINUTE,
      ageMs: 6 * MS_PER_MINUTE,
      location: { x: 2100, y: 900 },
      place: 'near the mill',
      uncertaintyRadius: 120,
      text: 'template',
    },
  ];
}

describe('keyless Ollama configuration', () => {
  it('serves parse, narrate and staff from the local model, with a generous timeout and one call at a time', () => {
    const { config } = setup(fetch, { OLLAMA_MODEL: 'tiny:1b' });
    for (const s of ['parse', 'narrate', 'staff'] as const) {
      expect(config.stages[s]).toMatchObject({ provider: 'ollama', model: 'tiny:1b' });
      expect(config.stages[s].params?.temperature).toBeLessThanOrEqual(0.3);
    }
    expect(config.stages.judge.provider).toBe('test');
    expect(config.providers.ollama).toMatchObject({
      type: 'ollama',
      baseUrl: 'http://ollama:11434',
      numCtx: 4096,
    });
    expect(config.timeoutMs).toBe(120_000);
    expect(config.rateLimit).toEqual({ maxConcurrent: 1 });
    expect(config.fallbackProvider).toBe('test');
    expect(llmOrderParserEnabled(ENV, config)).toBe(true);
    expect(usesTestUmpire(config)).toBe(false);
  });

  it('is configurable and an API key switches back to Anthropic', () => {
    const c = umpireConfigFromEnv({
      ...ENV,
      OLLAMA_NUM_CTX: '2048',
      OLLAMA_TIMEOUT_MS: '5000',
    });
    expect(c.providers.ollama!.numCtx).toBe(2048);
    expect(c.timeoutMs).toBe(5000);
    const keyed = umpireConfigFromEnv({ ...ENV, ANTHROPIC_API_KEY: 'sk-ant-x' });
    expect(keyed.stages.parse.provider).toBe('anthropic');
    expect(keyed.fallbackProvider).toBeUndefined();
  });
});

describe('Ollama answers', () => {
  it('parses an order with the model, with no fallback', async () => {
    const answer = JSON.stringify({
      result: 'intents',
      unitId: 'blue-1',
      intents: [{ kind: 'hold', place: 'bridge' }],
    });
    const fetch = vi.fn(async () => chat(answer));
    const { client, fallbacks, records } = setup(fetch as never);
    await new LlmOrderParser(client).parse(ORDER, CORPUS_CONTEXT);
    expect(fetch).toHaveBeenCalled();
    expect(fallbacks).toEqual([]);
    expect(records[0]).toMatchObject({ provider: 'ollama' });
    expect(records[0]!.fallbackFor).toBeUndefined();
  });
});

describe('Ollama failures fall back to the test provider', () => {
  const down = () => Promise.reject(new TypeError('fetch failed'));

  it('Ollama down: the order is still parsed, narrated and answered by staff', async () => {
    const { client, fallbacks, records } = setup(down as never);
    const r = await new LlmOrderParser(client).parse(ORDER, CORPUS_CONTEXT);
    expect(r.kind).toBe('intents');
    const n = await narrateReports(client, 'blue', reports());
    expect(n.dispatches[0]!.text).toContain('2nd Hussars');
    const w = loadScenario(holdTheBridge);
    const turns = await runStaff(client, w, new StaffRoster('blue'), {
      rate: 1,
      now: w.time + 60 * MS_PER_MINUTE,
    });
    expect(turns.every((t) => t.messages.length > 0)).toBe(true);
    expect(fallbacks.map((f) => f.stage).sort()).toEqual(expect.arrayContaining(['parse']));
    expect(fallbacks[0]).toMatchObject({ kind: 'transport', provider: 'ollama' });
    expect(records.every((x) => x.provider === 'test' || x.provider === 'ollama')).toBe(true);
    // The recorded call is the one that answered, so replay never needs the model.
    expect(records[0]).toMatchObject({ provider: 'test', model: 'test' });
    const res = await client.call({
      stage: 'narrate',
      promptVersion: 'x',
      system: 'x',
      input: narrateInput('blue', reports()),
      schema: NARRATE_SCHEMA,
    });
    expect(res.record.fallbackFor).toMatchObject({ provider: 'ollama' });
  });

  it('the model is still being pulled (404): falls back, and skips the model for a while', async () => {
    const fetch = vi.fn(async () => new Response('{"error":"model not found"}', { status: 404 }));
    const { client, fallbacks } = setup(fetch as never);
    const p = new LlmOrderParser(client);
    expect((await p.parse(ORDER, CORPUS_CONTEXT)).kind).toBe('intents');
    const calls = fetch.mock.calls.length;
    expect((await p.parse(ORDER, CORPUS_CONTEXT)).kind).toBe('intents');
    // The second order did not wait on the model again.
    expect(fetch.mock.calls.length).toBe(calls);
    expect(fallbacks).toHaveLength(2);
  });

  it('a slow model times out and the order is answered from the fallback', async () => {
    const slow = (_url: unknown, init: { signal?: AbortSignal }) =>
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const { client, fallbacks } = setup(slow as never, {
      UMPIRE_TIMEOUT_MS: '30',
      UMPIRE_MAX_ATTEMPTS: '1',
    });
    const started = Date.now();
    const r = await new LlmOrderParser(client).parse(ORDER, CORPUS_CONTEXT);
    expect(r.kind).toBe('intents');
    expect(Date.now() - started).toBeLessThan(2000);
    expect(fallbacks[0]).toMatchObject({ kind: 'timeout' });
  });

  it.each([
    ['not JSON', 'Sure! I will move the battalion.'],
    ['schema-violating JSON', '{"result":"banana"}'],
  ])('malformed output (%s) falls back after the allowed attempts', async (_n, bad) => {
    const fetch = vi.fn(async () => chat(bad));
    const { client, fallbacks } = setup(fetch as never);
    const r = await new LlmOrderParser(client).parse(ORDER, CORPUS_CONTEXT);
    expect(r.kind).toBe('intents');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fallbacks[0]).toMatchObject({ kind: 'schema' });
  });

  it('a fallback answer is recorded, and replay needs no model', async () => {
    const { client, records } = setup(down as never);
    const original = await new LlmOrderParser(client).parse(ORDER, CORPUS_CONTEXT);
    const noNetwork = vi.fn();
    vi.stubGlobal('fetch', noNetwork);
    const replayed = await new LlmOrderParser(new PlaybackUmpireClient(records)).parse(
      ORDER,
      CORPUS_CONTEXT,
    );
    vi.unstubAllGlobals();
    expect(replayed).toEqual(original);
    expect(noNetwork).not.toHaveBeenCalled();
  });
});
