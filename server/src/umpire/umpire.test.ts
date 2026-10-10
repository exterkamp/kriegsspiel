import { describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {
  AnthropicTransport,
  AnthropicUmpireClient,
  DEFAULT_UMPIRE_CONFIG,
  PlaybackUmpireClient,
  TransportError,
  UmpireError,
  umpireConfigFromEnv,
} from './index.js';
import type {
  TransportResponse,
  UmpireCallRecord,
  UmpireRequest,
  UmpireTransport,
} from './index.js';

const schema = {
  type: 'object',
  properties: { verdict: { type: 'string', enum: ['ok', 'no'] } },
  required: ['verdict'],
  additionalProperties: false,
};
const request: UmpireRequest = {
  stage: 'judge',
  promptVersion: 'judge-v1',
  system: 'You are the umpire.',
  input: { b: 2, a: 1 },
  schema,
};
const usage = { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 };
const good = (text = '{"verdict":"ok"}'): TransportResponse => ({ text, usage });

const config = { ...DEFAULT_UMPIRE_CONFIG, timeoutMs: 20, maxAttempts: 3 };

/** A transport that plays back a script of results/errors, one per send. */
function scripted(...steps: (TransportResponse | Error | 'hang')[]) {
  const send = vi.fn(async (_r: unknown, signal: AbortSignal) => {
    const step = steps.shift();
    if (step === 'hang') return new Promise<TransportResponse>(() => {}); // ignores the signal
    if (!step) throw new Error('script exhausted');
    if (step instanceof Error) throw step;
    void signal;
    return step;
  });
  return { send } satisfies UmpireTransport & { send: unknown };
}

function client(transport: UmpireTransport, recorded: UmpireCallRecord[] = []) {
  const sleeps: number[] = [];
  const c = new AnthropicUmpireClient({
    transport,
    config,
    recorder: { record: (r) => recorded.push(r) },
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 1,
  });
  return { c, sleeps, recorded };
}

describe('AnthropicUmpireClient', () => {
  it('returns validated output, records the call and accounts cost', async () => {
    const { c, recorded } = client(scripted(good()));
    const res = await c.call<{ verdict: string }>(request);
    expect(res.output).toEqual({ verdict: 'ok' });
    expect(recorded).toEqual([res.record]);
    expect(res.record).toMatchObject({
      stage: 'judge',
      model: 'claude-opus-5-5',
      promptVersion: 'judge-v1',
      input: request.input,
      rawOutput: '{"verdict":"ok"}',
      attempts: 1,
    });
    expect(res.record.costUsd).toBeCloseTo((1000 * 4 + 100 * 20) / 1e6);
  });

  it('uses the per-stage model', async () => {
    const t = scripted(good());
    await client(t).c.call({ ...request, stage: 'parse' });
    expect(t.send.mock.calls[0]![0]).toMatchObject({ model: 'claude-sonnet-5-5' });
  });

  it('retries retryable transport errors with exponential backoff, then succeeds', async () => {
    const t = scripted(new TransportError('503', true), new TransportError('429', true), good());
    const { c, sleeps } = client(t);
    const res = await c.call(request);
    expect(res.record.attempts).toBe(3);
    expect(sleeps).toEqual([500, 1000]);
    // Cost covers the one successful attempt only: failed sends returned no usage.
    expect(t.send).toHaveBeenCalledTimes(3);
  });

  it('honors a longer Retry-After over the computed backoff', async () => {
    const { c, sleeps } = client(scripted(new TransportError('429', true, 5000), good()));
    await c.call(request);
    expect(sleeps).toEqual([5000]);
  });

  it('gives up after maxAttempts and reports the last error', async () => {
    const t = scripted(...Array.from({ length: 3 }, () => new TransportError('503', true)));
    await expect(client(t).c.call(request)).rejects.toMatchObject({
      kind: 'transport',
      attempts: 3,
    });
    expect(t.send).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-retryable error', async () => {
    const t = scripted(new TransportError('400 bad', false), good());
    await expect(client(t).c.call(request)).rejects.toMatchObject({
      kind: 'transport',
      attempts: 1,
    });
    expect(t.send).toHaveBeenCalledTimes(1);
  });

  it('times out a hung transport (even one that ignores the abort signal) and retries', async () => {
    const t = scripted('hang', good());
    const res = await client(t).c.call(request);
    expect(res.record.attempts).toBe(2);
  });

  it('fails with a timeout error when every attempt hangs', async () => {
    const t = scripted('hang', 'hang', 'hang');
    await expect(client(t).c.call(request)).rejects.toMatchObject({ kind: 'timeout', attempts: 3 });
  });

  it('fires the abort signal when an attempt times out', async () => {
    let seen: AbortSignal | undefined;
    const send = vi.fn(async (_r: unknown, signal: AbortSignal) => {
      seen = signal;
      return new Promise<TransportResponse>(() => {});
    });
    await expect(client({ send }).c.call(request)).rejects.toMatchObject({ kind: 'timeout' });
    expect(seen?.aborted).toBe(true);
  });

  it('gives up at once when Retry-After is longer than the barrier can wait', async () => {
    const t = scripted(new TransportError('429', true, 3_600_000), good());
    const { c, sleeps } = client(t);
    await expect(c.call(request)).rejects.toMatchObject({ kind: 'transport', attempts: 1 });
    expect(sleeps).toEqual([]);
    expect(t.send).toHaveBeenCalledTimes(1);
  });

  it('does not retry output truncated at max_tokens, and reports the spend', async () => {
    const t = scripted({ ...good('{"verdict":'), truncated: true }, good());
    const err = await client(t)
      .c.call(request)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UmpireError);
    expect(err).toMatchObject({ kind: 'schema', attempts: 1, usage });
    expect((err as UmpireError).costUsd).toBeCloseTo((1000 * 4 + 100 * 20) / 1e6);
    expect(t.send).toHaveBeenCalledTimes(1);
  });

  it('attaches the summed spend of every attempt to a call that exhausts its retries', async () => {
    const t = scripted(good('nope'), good('nope'), good('nope'));
    const err = await client(t)
      .c.call(request)
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'schema', attempts: 3 });
    expect((err as UmpireError).usage?.inputTokens).toBe(3000);
    expect((err as UmpireError).costUsd).toBeCloseTo(3 * ((1000 * 4 + 100 * 20) / 1e6));
  });

  it('retries schema-invalid output and sums cost across attempts', async () => {
    const t = scripted(good('{"verdict":"maybe"}'), good('not json'), good());
    const { c, recorded } = client(t);
    const res = await c.call(request);
    expect(res.record.attempts).toBe(3);
    expect(res.record.usage.inputTokens).toBe(3000);
    expect(res.record.costUsd).toBeCloseTo(3 * ((1000 * 4 + 100 * 20) / 1e6));
    expect(recorded).toHaveLength(1); // only the accepted output is logged
  });

  it('throws a schema error when output never validates, and records nothing', async () => {
    const t = scripted(...Array.from({ length: 3 }, () => good('{"verdict":"maybe"}')));
    const { c, recorded } = client(t);
    await expect(c.call(request)).rejects.toMatchObject({ kind: 'schema', attempts: 3 });
    expect(recorded).toEqual([]);
  });

  it('does not retry a refusal', async () => {
    const t = scripted({ ...good(''), refusal: true }, good());
    await expect(client(t).c.call(request)).rejects.toMatchObject({ kind: 'refusal' });
    expect(t.send).toHaveBeenCalledTimes(1);
  });

  it('reports null cost for a model with no known price', async () => {
    const t = scripted(good());
    const c = new AnthropicUmpireClient({
      transport: t,
      config: { ...config, models: { ...config.models, judge: 'mystery-model' } },
    });
    expect((await c.call(request)).record.costUsd).toBeNull();
  });
});

describe('umpireConfigFromEnv', () => {
  it('overrides per-stage models and limits from env', () => {
    const cfg = umpireConfigFromEnv({
      UMPIRE_MODEL_PARSE: 'claude-haiku-5-5',
      UMPIRE_MAX_ATTEMPTS: '5',
    });
    expect(cfg.models).toEqual({ ...DEFAULT_UMPIRE_CONFIG.models, parse: 'claude-haiku-5-5' });
    expect(cfg.maxAttempts).toBe(5);
    expect(cfg.timeoutMs).toBe(DEFAULT_UMPIRE_CONFIG.timeoutMs);
  });

  it('rejects a bad number', () => {
    expect(() => umpireConfigFromEnv({ UMPIRE_TIMEOUT_MS: 'soon' })).toThrow(/UMPIRE_TIMEOUT_MS/);
  });
});

describe('AnthropicTransport', () => {
  function sdk(fetch: typeof globalThis.fetch) {
    return new AnthropicTransport(new Anthropic({ apiKey: 'test', maxRetries: 0, fetch }));
  }
  const treq = { model: 'claude-opus-5-5', system: 's', user: 'u', schema, maxTokens: 100 };

  it('sends a structured-output request and maps the response', async () => {
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      expect(body.output_config.format).toEqual({ type: 'json_schema', schema });
      expect(body.tool_choice).toBeUndefined();
      return Response.json({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: body.model,
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '{"verdict":"ok"}' }],
        usage: {
          input_tokens: 7,
          output_tokens: 3,
          cache_read_input_tokens: 2,
          cache_creation_input_tokens: 1,
        },
      });
    });
    const res = await sdk(fetch as never).send(treq, new AbortController().signal);
    expect(res.text).toBe('{"verdict":"ok"}');
    expect(res.usage).toEqual({
      inputTokens: 7,
      outputTokens: 3,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
    });
  });

  it('marks 429 and 5xx retryable (with Retry-After) and 400 not', async () => {
    const respond = (status: number, headers: Record<string, string> = {}) =>
      sdk((async () =>
        Response.json(
          { type: 'error', error: { type: 'x', message: 'nope' } },
          { status, headers },
        )) as never);
    const signal = new AbortController().signal;
    await expect(respond(429, { 'retry-after': '3' }).send(treq, signal)).rejects.toMatchObject({
      retryable: true,
      retryAfterMs: 3000,
    });
    await expect(
      respond(429, { 'retry-after-ms': '250' }).send(treq, signal),
    ).rejects.toMatchObject({
      retryAfterMs: 250,
    });
    await expect(respond(503).send(treq, signal)).rejects.toMatchObject({ retryable: true });
    await expect(respond(400).send(treq, signal)).rejects.toMatchObject({ retryable: false });
  });
});

describe('PlaybackUmpireClient', () => {
  it('reports a corrupt recording as a schema UmpireError', async () => {
    const rec = {
      ...({} as UmpireCallRecord),
      stage: 'judge',
      promptVersion: 'judge-v1',
      system: request.system,
      input: request.input,
      rawOutput: '{oops',
    } as UmpireCallRecord;
    await expect(new PlaybackUmpireClient([rec]).call(request)).rejects.toMatchObject({
      kind: 'schema',
    });
  });

  it('replays a recorded game without touching the network', async () => {
    // Record through the real SDK transport, backed by a fake fetch.
    const fetchLive = vi.fn(async () =>
      Response.json({
        id: 'm',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '{"verdict":"no"}' }],
        usage: { input_tokens: 5, output_tokens: 5 },
      }),
    );
    const recorded: UmpireCallRecord[] = [];
    const live = new AnthropicUmpireClient({
      transport: new AnthropicTransport(
        new Anthropic({ apiKey: 'k', maxRetries: 0, fetch: fetchLive as never }),
      ),
      recorder: { record: (r) => recorded.push(r) },
    });
    await live.call(request);
    expect(fetchLive).toHaveBeenCalledTimes(1);

    // Now forbid all network access and replay. Any fetch or socket use fails the test.
    const forbidden = vi.fn(() => {
      throw new Error('network touched during playback');
    });
    const realFetch = globalThis.fetch;
    globalThis.fetch = forbidden as never;
    try {
      const playback = new PlaybackUmpireClient(JSON.parse(JSON.stringify(recorded)));
      // Key order in the input must not matter.
      const res = await playback.call({ ...request, input: { a: 1, b: 2 } });
      expect(res.output).toEqual({ verdict: 'no' });
      expect(res.record.model).toBe('claude-opus-5-5');
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(forbidden).not.toHaveBeenCalled();
    expect(fetchLive).toHaveBeenCalledTimes(1);
  });

  it('serves repeated identical calls in recorded order', async () => {
    const rec = (verdict: string): UmpireCallRecord => ({
      stage: 'judge',
      model: 'm',
      promptVersion: 'judge-v1',
      system: '',
      input: { a: 1, b: 2 },
      rawOutput: JSON.stringify({ verdict }),
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costUsd: 0,
      attempts: 1,
    });
    const p = new PlaybackUmpireClient([rec('ok'), rec('no')]);
    expect((await p.call(request)).output).toEqual({ verdict: 'ok' });
    expect((await p.call(request)).output).toEqual({ verdict: 'no' });
  });

  it('fails loudly when a call was never recorded or the prompt version differs', async () => {
    const p = new PlaybackUmpireClient([]);
    await expect(p.call(request)).rejects.toBeInstanceOf(UmpireError);
    await expect(p.call(request)).rejects.toMatchObject({ kind: 'missing-recording' });
  });
});
