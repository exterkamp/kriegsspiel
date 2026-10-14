import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BridgeError, checkRequest, promptOf, runClaude } from './claude.js';
import type { GenerateRequest, GenerateResponse } from './claude.js';
import { createBridgeHandler } from './handler.js';
import { bridgeConfigFromEnv } from './serve.js';

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const schema = {
  type: 'object',
  properties: { verdict: { type: 'string' } },
  required: ['verdict'],
};
const req: GenerateRequest = {
  model: 'sonnet',
  system: 'You are the umpire.',
  messages: [{ role: 'user', content: '{"a":1}' }],
  schema,
  structured: 'json-mode',
  maxTokens: 700,
};

let dir: string;
let logFile: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bridge-test-'));
  logFile = join(dir, 'calls.ndjson');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** What the fake CLI was given, one entry per run. */
const calls = (): {
  args: string[];
  cwd: string;
  cwdEntries: string[];
  pid: number;
  stdin: string;
  env: Record<string, string | null>;
}[] =>
  existsSync(logFile)
    ? readFileSync(logFile, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l))
    : [];

const run = (
  mode: string,
  over: Partial<GenerateRequest> = {},
  extra: {
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    billing?: 'api';
    signal?: AbortSignal;
    delayMs?: number;
  } = {},
) =>
  runClaude(
    { ...req, ...over },
    {
      bin: FAKE,
      timeoutMs: extra.timeoutMs ?? 10_000,
      killGraceMs: 200,
      ...(extra.billing ? { billing: extra.billing } : {}),
      env: {
        ...process.env,
        FAKE_CLAUDE: mode,
        FAKE_CLAUDE_LOG: logFile,
        FAKE_CLAUDE_DELAY_MS: String(extra.delayMs ?? 0),
        ...extra.env,
      },
    },
    extra.signal ?? new AbortController().signal,
  );

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('runClaude with a fake CLI', () => {
  it('runs claude -p with no tools, no session and an empty working directory', async () => {
    const res = await run(
      'ok',
      {},
      { env: { ANTHROPIC_API_KEY: 'sk-x', CLAUDE_BRIDGE_SECRET: 's' } },
    );
    expect(res.text).toBe('{"verdict":"ok"}');
    expect(res.usage).toEqual({
      inputTokens: 12,
      outputTokens: 5,
      cacheReadTokens: 100,
      cacheWriteTokens: 40,
    });
    // A subscription reports no cost, so budgets do not trip.
    expect(res.costUsd).toBeUndefined();
    const [call] = calls();
    const a = call!.args;
    expect(a.slice(0, 3)).toEqual(['-p', '--output-format', 'json']);
    expect(a[a.indexOf('--model') + 1]).toBe('sonnet');
    expect(a[a.indexOf('--tools') + 1]).toBe('');
    expect(a).toEqual(
      expect.arrayContaining([
        '--no-session-persistence',
        '--safe-mode',
        '--strict-mcp-config',
        '--disable-slash-commands',
      ]),
    );
    expect(a[a.indexOf('--permission-prompts') + 1]).toBe('none');
    expect(a).not.toContain('--json-schema');
    expect(a.some((x) => /dangerously|bypass/i.test(x))).toBe(false);
    // The system prompt is read from a file outside the (empty) working directory.
    expect(call!.cwdEntries).toEqual([]);
    expect(a[a.indexOf('--system-prompt-file') + 1]!.startsWith(call!.cwd)).toBe(false);
    expect(call!.stdin).toBe('{"a":1}');
    expect(call!.env).toEqual({
      ANTHROPIC_API_KEY: null,
      CLAUDE_BRIDGE_SECRET: null,
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '700',
    });
    // Each request is a fresh directory, removed afterwards.
    expect(existsSync(call!.cwd)).toBe(false);
  });

  it('reports the CLI cost and keeps the key when billing an API key', async () => {
    const res = await run('ok', {}, { billing: 'api', env: { ANTHROPIC_API_KEY: 'sk-x' } });
    expect(res.costUsd).toBeCloseTo(0.0123);
    expect(calls()[0]!.env.ANTHROPIC_API_KEY).toBe('sk-x');
  });

  it('reads the result from stream-json output', async () => {
    expect((await run('stream')).text).toBe('{"verdict":"no"}');
  });

  it('passes the schema to --json-schema and returns the structured output in native mode', async () => {
    const res = await run('native', { structured: 'native' });
    expect(JSON.parse(res.text)).toEqual({ verdict: 'ok' });
    const a = calls()[0]!.args;
    expect(JSON.parse(a[a.indexOf('--json-schema') + 1]!)).toEqual(schema);
  });

  it('flags a reply cut at the token limit as truncated', async () => {
    const res = await run('truncated');
    expect(res).toMatchObject({ truncated: true, text: '' });
  });

  it('maps not logged in, rate limits, bad models, crashes and bad JSON', async () => {
    await expect(run('not-logged-in')).rejects.toMatchObject({
      status: 424,
      code: 'not_logged_in',
    });
    await expect(run('rate-limited')).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
      retryAfterMs: 60_000,
    });
    await expect(run('bad-model')).rejects.toMatchObject({ status: 400, code: 'rejected' });
    await expect(run('error-exit')).rejects.toMatchObject({
      status: 502,
      code: 'cli_error',
      message: expect.stringContaining('something broke'),
    });
    await expect(run('bad-json')).rejects.toMatchObject({ status: 502, code: 'bad_output' });
  });

  it('reports a missing CLI', async () => {
    const res = runClaude(
      req,
      { bin: join(dir, 'no-such-claude'), timeoutMs: 1000 },
      new AbortController().signal,
    );
    await expect(res).rejects.toMatchObject({ status: 424, code: 'cli_missing' });
  });

  it('kills a hung CLI at the timeout, even one that ignores SIGTERM', async () => {
    await expect(run('hang', {}, { timeoutMs: 300 })).rejects.toMatchObject({
      status: 504,
      code: 'timeout',
    });
    const [call] = calls();
    expect(alive(call!.pid)).toBe(false);
    expect(existsSync(call!.cwd)).toBe(false);
  });

  it('kills the CLI when the request is aborted', async () => {
    const ctrl = new AbortController();
    const p = run('hang', {}, { signal: ctrl.signal });
    await vi.waitFor(() => expect(calls()).toHaveLength(1));
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
    expect(alive(calls()[0]!.pid)).toBe(false);
  });
});

describe('request checks', () => {
  it('rejects a malformed request and a model name that could be a flag', () => {
    expect(() => checkRequest({ ...req, model: '--dangerously-skip-permissions' })).toThrow(
      BridgeError,
    );
    expect(() => checkRequest({ ...req, messages: [] })).toThrow(/messages/);
    expect(() => checkRequest({ ...req, maxTokens: 0 })).toThrow(/maxTokens/);
    expect(
      checkRequest({ ...req, model: 'claude-sonnet-5-5', structured: 'weird' }).structured,
    ).toBe('json-mode');
  });

  it('writes a repair conversation out as one prompt', () => {
    const p = promptOf([
      { role: 'user', content: 'IN' },
      { role: 'assistant', content: 'BAD' },
      { role: 'user', content: 'FIX' },
    ]);
    expect(p).toBe(
      'IN\n\nYour previous reply was:\n<previous_reply>\nBAD\n</previous_reply>\n\nFIX',
    );
  });
});

describe('bridge config', () => {
  it('binds the docker0 gateway by default and needs a secret off the loopback', () => {
    expect(() => bridgeConfigFromEnv({})).toThrow(/CLAUDE_BRIDGE_SECRET is required/);
    const c = bridgeConfigFromEnv({ CLAUDE_BRIDGE_SECRET: 'a-long-enough-secret' });
    expect(c).toMatchObject({
      host: '172.17.0.1',
      port: 8790,
      maxConcurrent: 2,
      billing: 'subscription',
    });
    expect(bridgeConfigFromEnv({ CLAUDE_BRIDGE_HOST: '127.0.0.1' }).secret).toBeUndefined();
    expect(() =>
      bridgeConfigFromEnv({
        CLAUDE_BRIDGE_HOST: '0.0.0.0',
        CLAUDE_BRIDGE_SECRET: 'a-long-enough-secret',
      }),
    ).toThrow(/every interface/);
    expect(() =>
      bridgeConfigFromEnv({ CLAUDE_BRIDGE_HOST: '127.0.0.1', CLAUDE_BRIDGE_SECRET: 'short' }),
    ).toThrow(/16/);
  });
});

describe('HTTP handler', () => {
  let server: Server;
  let url: string;
  const answer: GenerateResponse = {
    text: '{"verdict":"ok"}',
    usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
    durationMs: 5,
  };

  async function start(opts: Partial<Parameters<typeof createBridgeHandler>[0]>) {
    const { handle } = createBridgeHandler({
      run: async () => answer,
      maxConcurrent: 2,
      maxQueue: 4,
      ...opts,
    });
    server = createServer((rq, rs) => void handle(rq, rs));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }
  afterEach(() => {
    server?.closeAllConnections();
    server?.close();
  });

  const post = (body: unknown, headers: Record<string, string> = {}, signal?: AbortSignal) =>
    fetch(`${url}/v1/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });

  it('answers with the run result and checks the secret', async () => {
    await start({ secret: 'a-long-enough-secret' });
    expect((await post(req)).status).toBe(401);
    expect((await post(req, { authorization: 'Bearer wrong-secret-of-length' })).status).toBe(401);
    const ok = await post(req, { authorization: 'Bearer a-long-enough-secret' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual(answer);
    expect((await fetch(`${url}/healthz`)).status).toBe(200);
  });

  it('maps run failures to statuses with Retry-After', async () => {
    await start({
      run: async () => Promise.reject(new BridgeError(429, 'rate_limited', 'slow down', 30_000)),
    });
    const res = await post(req);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('30');
    expect(await res.json()).toEqual({ error: { code: 'rate_limited', message: 'slow down' } });
    expect((await post({ ...req, model: '' })).status).toBe(400);
  });

  it('runs at most maxConcurrent requests and refuses beyond the queue', async () => {
    let active = 0;
    let peak = 0;
    const gates: (() => void)[] = [];
    await start({
      maxConcurrent: 1,
      maxQueue: 1,
      run: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise<void>((r) => gates.push(r));
        active--;
        return answer;
      },
    });
    const first = post(req);
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    const second = post(req); // queued
    await new Promise((r) => setTimeout(r, 50));
    expect((await post(req)).status).toBe(503); // queue full
    gates.shift()!();
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    gates.shift()!();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(peak).toBe(1);
  });

  it('aborts the run when the client goes away', async () => {
    let aborted = false;
    await start({
      run: (_r, signal) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(new BridgeError(499, 'aborted', 'gone'));
          }),
        ),
    });
    const ctrl = new AbortController();
    const p = post(req, {}, ctrl.signal).catch(() => 'aborted');
    await new Promise((r) => setTimeout(r, 50));
    ctrl.abort();
    expect(await p).toBe('aborted');
    await vi.waitFor(() => expect(aborted).toBe(true));
  });

  it('runs the fake CLI end to end', async () => {
    await start({
      run: (r, signal) =>
        runClaude(
          r,
          { bin: FAKE, timeoutMs: 5000, env: { ...process.env, FAKE_CLAUDE: 'not-logged-in' } },
          signal,
        ),
    });
    const res = await post(req);
    expect(res.status).toBe(424);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_logged_in');
  });
});
