/* eslint-disable @typescript-eslint/no-explicit-any -- fake-server request bodies are untyped JSON */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AnthropicProvider,
  BudgetedUmpireClient,
  DEFAULT_UMPIRE_CONFIG,
  OllamaProvider,
  OpenAiCompatibleProvider,
  PlaybackUmpireClient,
  ProviderRegistry,
  ProviderUmpireClient,
  RateLimitedUmpireClient,
  createUmpireClient,
  defaultProviderRegistry,
  umpireConfigFromEnv,
} from './index.js';
import type { LlmProvider, ProviderRequest, UmpireCallRecord, UmpireConfig } from './index.js';
import Anthropic from '@anthropic-ai/sdk';

const schema = {
  type: 'object',
  properties: { verdict: { type: 'string', enum: ['ok', 'no'] } },
  required: ['verdict'],
  additionalProperties: false,
};
const treq: ProviderRequest = {
  model: 'claude-opus-5-5',
  system: 'You are the umpire.',
  messages: [{ role: 'user', content: '{"a":1}' }],
  schema,
  structured: 'native',
  maxTokens: 100,
};
const request = {
  stage: 'judge' as const,
  promptVersion: 'judge-v1',
  system: 'You are the umpire.',
  input: { a: 1 },
  schema,
};

/** What the fake server does with the next request. */
interface Reply {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  hang?: boolean;
}

let server: Server;
let baseUrl: string;
let replies: Reply[] = [];
let seen: { path: string; headers: IncomingMessage['headers']; body: any }[] = [];

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push({ path: req.url ?? '', headers: req.headers, body: JSON.parse(raw || '{}') });
      const r = replies.shift() ?? { status: 500, body: { error: 'script exhausted' } };
      if (r.hang) return; // never answer; the client must give up
      res.writeHead(r.status ?? 200, { 'content-type': 'application/json', ...r.headers });
      res.end(JSON.stringify(r.body ?? {}));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});
beforeEach(() => {
  replies = [];
  seen = [];
});

/** How each adapter's server speaks, so the same contract runs against all three. */
interface Wire {
  name: string;
  path: string;
  make(): LlmProvider;
  ok(text: string, tokens?: { in: number; out: number }): unknown;
  truncated(text: string): unknown;
  /** Asserts the request body carried model, system, messages and the schema. */
  expectNative(body: any): void;
  expectJsonMode(body: any): void;
}

const wires: Wire[] = [
  {
    name: 'anthropic',
    path: '/v1/messages',
    make: () =>
      new AnthropicProvider(new Anthropic({ apiKey: 'test', maxRetries: 0, baseURL: baseUrl })),
    ok: (text, t = { in: 7, out: 3 }) => ({
      id: 'm',
      type: 'message',
      role: 'assistant',
      model: 'x',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text }],
      usage: { input_tokens: t.in, output_tokens: t.out },
    }),
    truncated: (text) => ({
      id: 'm',
      type: 'message',
      role: 'assistant',
      model: 'x',
      stop_reason: 'max_tokens',
      content: [{ type: 'text', text }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    expectNative: (b) => {
      expect(b.system).toBe(treq.system);
      expect(b.messages).toEqual(treq.messages);
      expect(b.output_config.format).toEqual({ type: 'json_schema', schema });
    },
    expectJsonMode: () => {},
  },
  {
    name: 'openai-compatible',
    path: '/v1/chat/completions',
    make: () => new OpenAiCompatibleProvider({ baseUrl: `${baseUrl}/v1`, apiKey: 'k' }),
    ok: (text, t = { in: 7, out: 3 }) => ({
      choices: [{ message: { content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: t.in, completion_tokens: t.out },
    }),
    truncated: (text) => ({
      choices: [{ message: { content: text }, finish_reason: 'length' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
    expectNative: (b) => {
      expect(b.messages).toEqual([{ role: 'system', content: treq.system }, ...treq.messages]);
      expect(b.response_format.json_schema.schema).toEqual(schema);
    },
    expectJsonMode: (b) => expect(b.response_format).toEqual({ type: 'json_object' }),
  },
  {
    name: 'ollama',
    path: '/api/chat',
    make: () => new OllamaProvider({ baseUrl, numCtx: 8192 }),
    ok: (text, t = { in: 7, out: 3 }) => ({
      message: { role: 'assistant', content: text },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: t.in,
      eval_count: t.out,
    }),
    truncated: (text) => ({
      message: { role: 'assistant', content: text },
      done: true,
      done_reason: 'length',
      prompt_eval_count: 1,
      eval_count: 1,
    }),
    expectNative: (b) => {
      expect(b.messages).toEqual([{ role: 'system', content: treq.system }, ...treq.messages]);
      expect(b.format).toEqual(schema);
      expect(b.options).toMatchObject({ num_ctx: 8192, num_predict: 100 });
      expect(b.stream).toBe(false);
    },
    expectJsonMode: (b) => expect(b.format).toBe('json'),
  },
];

function clientFor(provider: LlmProvider, extra: Partial<UmpireConfig> = {}) {
  const recorded: UmpireCallRecord[] = [];
  const sleeps: number[] = [];
  const config: UmpireConfig = { ...DEFAULT_UMPIRE_CONFIG, timeoutMs: 300, ...extra };
  const client = new ProviderUmpireClient({
    providers: { anthropic: provider },
    config,
    recorder: { record: (r) => recorded.push(r) },
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 1,
  });
  return { client, recorded, sleeps };
}

describe.each(wires)('provider contract: $name', (wire) => {
  it('sends the request and maps text and usage', async () => {
    replies = [{ body: wire.ok('{"verdict":"ok"}') }];
    const res = await wire
      .make()
      .generate({ ...treq, temperature: 0.3 }, new AbortController().signal);
    expect(res.text).toBe('{"verdict":"ok"}');
    expect(res.usage).toMatchObject({ inputTokens: 7, outputTokens: 3 });
    expect(res.refusal).toBeFalsy();
    expect(res.truncated).toBeFalsy();
    expect(seen[0]!.path).toBe(wire.path);
    expect(seen[0]!.body.model).toBe(treq.model);
    wire.expectNative(seen[0]!.body);
  });

  it('asks for plain JSON mode when the request says so', async () => {
    if (wire.name === 'anthropic') return; // always native
    replies = [{ body: wire.ok('{}') }];
    await wire.make().generate({ ...treq, structured: 'json-mode' }, new AbortController().signal);
    wire.expectJsonMode(seen[0]!.body);
  });

  it('flags output truncated at the token limit', async () => {
    replies = [{ body: wire.truncated('{"verd') }];
    const res = await wire.make().generate(treq, new AbortController().signal);
    expect(res.truncated).toBe(true);
  });

  it('classifies HTTP errors and reads Retry-After', async () => {
    const p = wire.make();
    const signal = new AbortController().signal;
    replies = [{ status: 429, headers: { 'retry-after': '3' }, body: { error: 'slow' } }];
    await expect(p.generate(treq, signal)).rejects.toMatchObject({
      retryable: true,
      retryAfterMs: 3000,
    });
    replies = [{ status: 503, body: { error: 'down' } }];
    await expect(p.generate(treq, signal)).rejects.toMatchObject({ retryable: true });
    replies = [{ status: 400, body: { error: 'bad' } }];
    await expect(p.generate(treq, signal)).rejects.toMatchObject({ retryable: false });
  });

  it('treats a refused connection as retryable', async () => {
    const dead = createServer();
    await new Promise<void>((r) => dead.listen(0, '127.0.0.1', r));
    const addr = dead.address() as { port: number };
    dead.close();
    const url = `http://127.0.0.1:${addr.port}`;
    const p =
      wire.name === 'ollama'
        ? new OllamaProvider({ baseUrl: url })
        : wire.name === 'openai-compatible'
          ? new OpenAiCompatibleProvider({ baseUrl: `${url}/v1` })
          : new AnthropicProvider(new Anthropic({ apiKey: 't', maxRetries: 0, baseURL: url }));
    await expect(p.generate(treq, new AbortController().signal)).rejects.toMatchObject({
      retryable: true,
    });
  });

  it('stops when the signal aborts', async () => {
    replies = [{ hang: true }];
    const ctrl = new AbortController();
    const p = wire.make().generate(treq, ctrl.signal);
    setTimeout(() => ctrl.abort(), 20);
    await expect(p).rejects.toBeInstanceOf(Error);
  });

  describe('wrapped by the client and decorators', () => {
    it('retries a 503 with backoff and then succeeds', async () => {
      replies = [{ status: 503, body: {} }, { body: wire.ok('{"verdict":"ok"}') }];
      const { client, sleeps } = clientFor(wire.make());
      const res = await client.call<{ verdict: string }>(request);
      expect(res.output.verdict).toBe('ok');
      expect(res.record.attempts).toBe(2);
      expect(sleeps).toEqual([500]);
    });

    it('times out a hung server and retries', async () => {
      replies = [{ hang: true }, { body: wire.ok('{"verdict":"ok"}') }];
      const { client } = clientFor(wire.make(), { timeoutMs: 50 });
      expect((await client.call(request)).record.attempts).toBe(2);
    });

    it('records a call and replays it with no network', async () => {
      replies = [{ body: wire.ok('{"verdict":"no"}') }];
      const { client, recorded } = clientFor(wire.make());
      await client.call(request);
      expect(recorded).toHaveLength(1);
      const hits = seen.length;

      const realFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(() => {
        throw new Error('network touched during playback');
      }) as never;
      try {
        const playback = new PlaybackUmpireClient(JSON.parse(JSON.stringify(recorded)));
        expect((await playback.call(request)).output).toEqual({ verdict: 'no' });
      } finally {
        globalThis.fetch = realFetch;
      }
      expect(seen).toHaveLength(hits);
    });

    it('rate limiter spaces call starts', async () => {
      replies = [{ body: wire.ok('{"verdict":"ok"}') }, { body: wire.ok('{"verdict":"ok"}') }];
      const { client } = clientFor(wire.make());
      const sleeps: number[] = [];
      let t = 1000;
      const limited = new RateLimitedUmpireClient(client, {
        minIntervalMs: 500,
        now: () => t,
        sleep: async (ms) => void sleeps.push(ms),
      });
      await limited.call(request);
      await limited.call(request);
      expect(sleeps).toEqual([500]);
      t += 1000;
    });

    it('budget stops further calls once the token cap is spent', async () => {
      replies = [{ body: wire.ok('{"verdict":"ok"}', { in: 60, out: 50 }) }];
      const { client } = clientFor(wire.make());
      const budgeted = new BudgetedUmpireClient(client, { maxTotalTokens: 100 });
      await budgeted.call(request);
      expect(budgeted.spent.totalTokens).toBe(110);
      await expect(budgeted.call(request)).rejects.toMatchObject({ kind: 'budget' });
      expect(seen).toHaveLength(1);
    });

    it('budget counts spend from a call that failed every attempt', async () => {
      // Schema-invalid on all three attempts: the call throws, but the tokens were still spent.
      replies = Array.from({ length: 3 }, () => ({
        body: wire.ok('{"verdict":"maybe"}', { in: 60, out: 50 }),
      }));
      const { client } = clientFor(wire.make());
      const budgeted = new BudgetedUmpireClient(client, { maxTotalTokens: 300 });
      await expect(budgeted.call(request)).rejects.toMatchObject({ kind: 'schema', attempts: 3 });
      expect(budgeted.spent.totalTokens).toBe(330);
      await expect(budgeted.call(request)).rejects.toMatchObject({ kind: 'budget' });
      expect(seen).toHaveLength(3);
    });

    it('budget counts dollars for a priced model', async () => {
      replies = [{ body: wire.ok('{"verdict":"ok"}', { in: 1_000_000, out: 0 }) }];
      const { client } = clientFor(wire.make());
      const budgeted = new BudgetedUmpireClient(client, { maxCostUsd: 3 });
      await budgeted.call(request); // opus: $4 per million input tokens
      expect(budgeted.spent.costUsd).toBeCloseTo(4);
      await expect(budgeted.call(request)).rejects.toMatchObject({ kind: 'budget' });
    });
  });
});

describe('openai-compatible usage', () => {
  it('splits cached prompt tokens out of the input count', async () => {
    replies = [
      {
        body: {
          choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 5,
            prompt_tokens_details: { cached_tokens: 40 },
          },
        },
      },
    ];
    const provider = new OpenAiCompatibleProvider({ baseUrl: `${baseUrl}/v1` });
    const res = await provider.generate(treq, new AbortController().signal);
    expect(res.usage).toEqual({
      inputTokens: 60,
      outputTokens: 5,
      cacheReadTokens: 40,
      cacheWriteTokens: 0,
    });
  });
});

describe('rate limiter concurrency', () => {
  it('runs at most maxConcurrent calls at once', async () => {
    let active = 0;
    let peak = 0;
    const inner = {
      call: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
        return {} as never;
      },
    };
    const limited = new RateLimitedUmpireClient(inner, { maxConcurrent: 2 });
    await Promise.all(Array.from({ length: 6 }, () => limited.call(request)));
    expect(peak).toBe(2);
  });
});

describe('registry and factory', () => {
  it('builds a provider from config and routes a stage to it', async () => {
    const config = umpireConfigFromEnv(
      { UMPIRE_PROVIDER_PARSE: 'local', UMPIRE_MODEL_PARSE: 'gemma4-any-tag' },
      { providers: { local: { type: 'ollama', baseUrl } } },
    );
    replies = [{ body: wires[2]!.ok('{"verdict":"ok"}') }];
    const client = createUmpireClient({ config, env: {} });
    const res = await client.call({ ...request, stage: 'parse' });
    expect(res.record).toMatchObject({ provider: 'local', model: 'gemma4-any-tag' });
    expect(seen[0]!.path).toBe('/api/chat');
    expect(seen[0]!.body.model).toBe('gemma4-any-tag');
  });

  it('new providers register without changing existing code', async () => {
    const registry = defaultProviderRegistry().register('fake', ({ id }) => ({
      id,
      capabilities: { structuredOutput: 'native', toolUse: false },
      generate: async () => ({
        text: '{"verdict":"no"}',
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      }),
    }));
    const config = umpireConfigFromEnv(
      { UMPIRE_PROVIDER_JUDGE: 'f' },
      { providers: { f: { type: 'fake' } } },
    );
    const res = await createUmpireClient({ config, registry, env: {} }).call(request);
    expect(res.output).toEqual({ verdict: 'no' });
    expect(() => registry.register('fake', () => null as never)).toThrow(/already/);
  });

  it('reports an unknown provider type', () => {
    expect(() =>
      new ProviderRegistry().create({ id: 'x', spec: { type: 'nope' }, env: {} }),
    ).toThrow(/unknown type "nope"/);
  });

  it('reads API keys from the named env var and sends none to a keyless local server', async () => {
    const config = umpireConfigFromEnv(
      { UMPIRE_PROVIDER_JUDGE: 'cloud', UMPIRE_PROVIDER_PARSE: 'lan' },
      {
        providers: {
          cloud: { type: 'openai-compatible', baseUrl, apiKeyEnv: 'MY_KEY' },
          lan: { type: 'openai-compatible', baseUrl },
        },
      },
    );
    const client = createUmpireClient({
      config,
      env: { MY_KEY: 'secret', OPENAI_API_KEY: 'must-not-leak' },
    });
    replies = [
      { body: wires[1]!.ok('{"verdict":"ok"}') },
      { body: wires[1]!.ok('{"verdict":"ok"}') },
    ];
    await client.call(request);
    await client.call({ ...request, stage: 'parse' });
    expect(seen[0]!.headers.authorization).toBe('Bearer secret');
    expect(seen[1]!.headers.authorization).toBeUndefined();
  });

  it('applies the configured budget', async () => {
    const config = umpireConfigFromEnv(
      { UMPIRE_BUDGET_TOKENS: '5' },
      {
        providers: { anthropic: { type: 'anthropic', baseUrl } },
      },
    );
    replies = [{ body: wires[0]!.ok('{"verdict":"ok"}') }];
    const client = createUmpireClient({ config, env: { ANTHROPIC_API_KEY: 'k' } });
    await client.call(request);
    await expect(client.call(request)).rejects.toMatchObject({ kind: 'budget' });
  });
});

describe('model without native structured output, over a real adapter', () => {
  it('validates and repairs via JSON mode', async () => {
    const config = umpireConfigFromEnv(
      { UMPIRE_PROVIDER_JUDGE: 'old' },
      {
        providers: {
          old: {
            type: 'openai-compatible',
            baseUrl: `${baseUrl}/v1`,
            structuredOutput: 'json-mode',
          },
        },
      },
    );
    replies = [
      { body: wires[1]!.ok('I think {"verdict":"maybe"}') },
      { body: wires[1]!.ok('{"verdict":"ok"}') },
    ];
    const res = await createUmpireClient({ config, env: {}, sleep: async () => {} }).call(request);
    expect(res.output).toEqual({ verdict: 'ok' });
    expect(seen[0]!.body.response_format).toEqual({ type: 'json_object' });
    expect(seen[1]!.body.messages.map((m: { role: string }) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
  });
});

describe('no SDK outside the adapters', () => {
  it('only providers/anthropic.ts and its registration import an SDK', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..');
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) {
          if (/from '@anthropic-ai\/sdk'/.test(readFileSync(p, 'utf8')))
            offenders.push(p.slice(dir.length + 1));
        }
      }
    };
    walk(dir);
    expect(offenders.sort()).toEqual([
      'umpire/providers/anthropic.ts',
      'umpire/providers/index.ts',
    ]);
  });
});

// Opt-in: OLLAMA_LIVE=1 [OLLAMA_URL=http://localhost:11434] OLLAMA_MODEL=<tag> npm test
describe.skipIf(!process.env.OLLAMA_LIVE)('live Ollama', () => {
  it('returns schema-valid output from a local model', async () => {
    const model = process.env.OLLAMA_MODEL;
    if (!model) throw new Error('set OLLAMA_MODEL to a tag the local server has pulled');
    const provider = new OllamaProvider({
      baseUrl: process.env.OLLAMA_URL ?? 'http://localhost:11434',
      numCtx: 8192,
    });
    const config: UmpireConfig = {
      ...DEFAULT_UMPIRE_CONFIG,
      timeoutMs: 300_000,
      stages: { ...DEFAULT_UMPIRE_CONFIG.stages, judge: { provider: 'anthropic', model } },
    };
    const client = new ProviderUmpireClient({ providers: { anthropic: provider }, config });
    const res = await client.call<{ verdict: string }>({
      ...request,
      system: 'You are an umpire. Answer ok if the order is possible, otherwise no.',
      input: { order: 'March one tile north along the road.' },
    });
    expect(['ok', 'no']).toContain(res.output.verdict);
  }, 320_000);
});
