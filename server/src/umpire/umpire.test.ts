import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_UMPIRE_CONFIG,
  PlaybackUmpireClient,
  ProviderUmpireClient,
  TransportError,
  UmpireError,
  umpireConfigFromEnv,
} from './index.js';
import type {
  LlmProvider,
  ProviderRequest,
  ProviderResponse,
  StructuredOutputSupport,
  UmpireCallRecord,
  UmpireConfig,
  UmpireRequest,
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
const good = (text = '{"verdict":"ok"}'): ProviderResponse => ({ text, usage });

const config = { ...DEFAULT_UMPIRE_CONFIG, timeoutMs: 20, maxAttempts: 3 };

/** A provider that plays back a script of results/errors, one per call. */
function scripted(...steps: (ProviderResponse | Error | 'hang')[]) {
  return scriptedWith('native', ...steps);
}

function scriptedWith(
  structuredOutput: StructuredOutputSupport,
  ...steps: (ProviderResponse | Error | 'hang')[]
) {
  const generate = vi.fn(async (_r: ProviderRequest, signal: AbortSignal) => {
    const step = steps.shift();
    if (step === 'hang') return new Promise<ProviderResponse>(() => {}); // ignores the signal
    if (!step) throw new Error('script exhausted');
    if (step instanceof Error) throw step;
    void signal;
    return step;
  });
  return { id: 'anthropic', capabilities: { structuredOutput, toolUse: true }, generate };
}

function client(
  provider: LlmProvider,
  recorded: UmpireCallRecord[] = [],
  cfg: UmpireConfig = config,
) {
  const sleeps: number[] = [];
  const c = new ProviderUmpireClient({
    providers: { anthropic: provider, other: provider },
    config: cfg,
    recorder: { record: (r) => recorded.push(r) },
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 1,
  });
  return { c, sleeps, recorded };
}

describe('ProviderUmpireClient', () => {
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
    expect(t.generate.mock.calls[0]![0]).toMatchObject({ model: 'claude-haiku-5-5' });
  });

  it('retries retryable transport errors with exponential backoff, then succeeds', async () => {
    const t = scripted(new TransportError('503', true), new TransportError('429', true), good());
    const { c, sleeps } = client(t);
    const res = await c.call(request);
    expect(res.record.attempts).toBe(3);
    expect(sleeps).toEqual([500, 1000]);
    // Cost covers the one successful attempt only: failed sends returned no usage.
    expect(t.generate).toHaveBeenCalledTimes(3);
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
    expect(t.generate).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-retryable error', async () => {
    const t = scripted(new TransportError('400 bad', false), good());
    await expect(client(t).c.call(request)).rejects.toMatchObject({
      kind: 'transport',
      attempts: 1,
    });
    expect(t.generate).toHaveBeenCalledTimes(1);
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
    const generate = vi.fn(async (_r: unknown, signal: AbortSignal) => {
      seen = signal;
      return new Promise<ProviderResponse>(() => {});
    });
    await expect(
      client({
        id: 'anthropic',
        capabilities: { structuredOutput: 'native', toolUse: true },
        generate,
      }).c.call(request),
    ).rejects.toMatchObject({ kind: 'timeout' });
    expect(seen?.aborted).toBe(true);
  });

  it('gives up at once when Retry-After is longer than the barrier can wait', async () => {
    const t = scripted(new TransportError('429', true, 3_600_000), good());
    const { c, sleeps } = client(t);
    await expect(c.call(request)).rejects.toMatchObject({ kind: 'transport', attempts: 1 });
    expect(sleeps).toEqual([]);
    expect(t.generate).toHaveBeenCalledTimes(1);
  });

  it('does not retry output truncated at max_tokens, and reports the spend', async () => {
    const t = scripted({ ...good('{"verdict":'), truncated: true }, good());
    const err = await client(t)
      .c.call(request)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UmpireError);
    expect(err).toMatchObject({ kind: 'schema', attempts: 1, usage });
    expect((err as UmpireError).costUsd).toBeCloseTo((1000 * 4 + 100 * 20) / 1e6);
    expect(t.generate).toHaveBeenCalledTimes(1);
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
    expect(t.generate).toHaveBeenCalledTimes(1);
  });

  it('reports null cost for a model with no known price', async () => {
    const t = scripted(good());
    const c = new ProviderUmpireClient({
      providers: { anthropic: t },
      config: {
        ...config,
        stages: { ...config.stages, judge: { provider: 'anthropic', model: 'mystery-model' } },
      },
    });
    expect((await c.call(request)).record.costUsd).toBeNull();
  });
});

describe('ProviderUmpireClient routing and repair', () => {
  it('swapping a stage to another provider and model is a config change only', async () => {
    const a = scripted(good());
    const b = scripted(good('{"verdict":"no"}'));
    const mk = (cfg: UmpireConfig) =>
      new ProviderUmpireClient({ providers: { anthropic: a, other: b }, config: cfg });
    await mk(config).call(request);
    expect(a.generate).toHaveBeenCalledTimes(1);

    const swapped: UmpireConfig = {
      ...config,
      stages: {
        ...config.stages,
        judge: { provider: 'other', model: 'gemma-x', params: { temperature: 0.2, maxTokens: 99 } },
      },
    };
    const res = await mk(swapped).call(request);
    expect(res.output).toEqual({ verdict: 'no' });
    expect(res.record).toMatchObject({ provider: 'other', model: 'gemma-x' });
    expect(a.generate).toHaveBeenCalledTimes(1);
    expect(b.generate.mock.calls[0]![0]).toMatchObject({
      model: 'gemma-x',
      temperature: 0.2,
      maxTokens: 99,
    });
  });

  it('fails at construction when a stage names a provider that was not built', () => {
    expect(() => new ProviderUmpireClient({ providers: {}, config })).toThrow(/anthropic/);
  });

  it('validates and repairs output from a model without native structured output', async () => {
    const t = scriptedWith(
      'json-mode',
      good('Sure! {"verdict":"maybe"}'),
      good('```json\n{"verdict":"ok"}\n```'),
    );
    const { c } = client(t);
    const res = await c.call<{ verdict: string }>(request);
    expect(res.output).toEqual({ verdict: 'ok' });
    expect(res.record.attempts).toBe(2);
    expect(res.record.rawOutput).toBe('{"verdict":"ok"}'); // fence stripped, replayable
    const [first, second] = t.generate.mock.calls.map((c) => c[0]);
    expect(first!.structured).toBe('json-mode');
    expect(first!.system).toContain('JSON Schema');
    expect(first!.messages).toHaveLength(1);
    expect(second!.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(second!.messages[2]!.content).toContain('rejected');
  });

  it('gives up after the bounded number of repairs so the caller can fall back', async () => {
    const t = scriptedWith('none', good('x'), good('y'), good('z'));
    await expect(client(t).c.call(request)).rejects.toMatchObject({ kind: 'schema', attempts: 3 });
    expect(t.generate).toHaveBeenCalledTimes(3);
  });

  it('does not send repair messages to a native provider', async () => {
    const t = scripted(good('nope'), good());
    await client(t).c.call(request);
    expect(t.generate.mock.calls[1]![0].messages).toHaveLength(1);
  });
});

describe('umpireConfigFromEnv', () => {
  it('overrides per-stage models and limits from env', () => {
    const cfg = umpireConfigFromEnv({
      UMPIRE_MODEL_PARSE: 'claude-haiku-5-5',
      UMPIRE_MAX_ATTEMPTS: '5',
    });
    expect(cfg.stages).toEqual({
      ...DEFAULT_UMPIRE_CONFIG.stages,
      parse: { provider: 'anthropic', model: 'claude-haiku-5-5' },
    });
    expect(cfg.maxAttempts).toBe(5);
    expect(cfg.timeoutMs).toBe(DEFAULT_UMPIRE_CONFIG.timeoutMs);
  });

  it('merges a file, then lets env override it', () => {
    const file = {
      providers: { local: { type: 'ollama', baseUrl: 'http://localhost:11434' } },
      stages: { parse: { provider: 'local', model: 'gemma-from-file' } },
      timeoutMs: 5000,
    };
    const cfg = umpireConfigFromEnv({ UMPIRE_MODEL_PARSE: 'gemma-from-env' }, file);
    expect(cfg.stages.parse).toEqual({ provider: 'local', model: 'gemma-from-env' });
    expect(cfg.stages.judge.provider).toBe('anthropic');
    expect(cfg.timeoutMs).toBe(5000);
  });

  it('rejects API keys in a file and stages that name an unknown provider', () => {
    const withKey = { providers: { x: { type: 'openai-compatible', apiKey: 'sk-1' } } };
    expect(() => umpireConfigFromEnv({}, withKey as never)).toThrow(/environment/);
    expect(() => umpireConfigFromEnv({ UMPIRE_PROVIDER_JUDGE: 'nope' })).toThrow(/not configured/);
  });

  it('rejects a bad number', () => {
    expect(() => umpireConfigFromEnv({ UMPIRE_TIMEOUT_MS: 'soon' })).toThrow(/UMPIRE_TIMEOUT_MS/);
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
