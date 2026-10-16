import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** What the game server sends: its `ProviderRequest` (`server/src/umpire/provider.ts`) less temperature. */
export interface GenerateRequest {
  model: string;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  schema: object;
  /** `native` passes the schema to `--json-schema`; anything else relies on the prompt, as the server asks. */
  structured: 'native' | 'json-mode' | 'none';
  maxTokens: number;
}

/** What the bridge answers: the server's `ProviderResponse` fields. */
export interface GenerateResponse {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  /** Only with `billing: 'api'`: on a subscription the CLI's cost is notional and must not trip budgets. */
  costUsd?: number;
  truncated?: boolean;
  refusal?: boolean;
  /** Wall time of the CLI run, for the log. */
  durationMs: number;
}

/** A failed run, as the HTTP status and code the bridge answers with. */
export class BridgeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

/** Default wait between SIGTERM and SIGKILL. */
export const KILL_GRACE_MS = 2_000;

export interface RunOptions {
  /** The `claude` executable. */
  bin: string;
  /** Kills the run after this long. */
  timeoutMs: number;
  /** `subscription` (default) reports no cost; `api` reports the CLI's `total_cost_usd`. */
  billing?: 'subscription' | 'api';
  /** The child's environment, before the bridge's own changes. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Wait between SIGTERM and SIGKILL. */
  killGraceMs?: number;
}

/** The CLI's final `result` event (`--output-format json`, or the last line of `stream-json`). */
interface ResultEvent {
  type: 'result';
  subtype?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  stop_reason?: string;
  api_error_status?: number | null;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/;

/** Throws a 400 `BridgeError` unless `body` is a well-formed request. */
export function checkRequest(body: unknown): GenerateRequest {
  const bad = (why: string) => new BridgeError(400, 'bad_request', why);
  if (!body || typeof body !== 'object') throw bad('body must be a JSON object');
  const b = body as Record<string, unknown>;
  if (typeof b.model !== 'string' || !MODEL_NAME.test(b.model))
    throw bad('model must be a model name');
  if (typeof b.system !== 'string') throw bad('system must be a string');
  if (
    !Array.isArray(b.messages) ||
    b.messages.length === 0 ||
    !b.messages.every(
      (m: unknown) =>
        !!m &&
        typeof m === 'object' &&
        ((m as { role?: unknown }).role === 'user' ||
          (m as { role?: unknown }).role === 'assistant') &&
        typeof (m as { content?: unknown }).content === 'string',
    )
  ) {
    throw bad('messages must be a non-empty list of {role, content}');
  }
  if (!b.schema || typeof b.schema !== 'object') throw bad('schema must be a JSON schema object');
  if (!Number.isInteger(b.maxTokens) || (b.maxTokens as number) <= 0)
    throw bad('maxTokens must be a positive integer');
  const structured =
    b.structured === 'native' || b.structured === 'none' ? b.structured : 'json-mode';
  return {
    model: b.model,
    system: b.system,
    messages: b.messages as GenerateRequest['messages'],
    schema: b.schema,
    structured,
    maxTokens: b.maxTokens as number,
  };
}

/**
 * One prompt for `-p`. A single user message goes as it is; a conversation (the client's repair turn
 * quotes the rejected reply) is written out in order, since the CLI takes no assistant turns on input.
 */
export function promptOf(messages: GenerateRequest['messages']): string {
  if (messages.length === 1) return messages[0]!.content;
  return messages
    .map((m) =>
      m.role === 'user'
        ? m.content
        : `Your previous reply was:\n<previous_reply>\n${m.content}\n</previous_reply>`,
    )
    .join('\n\n');
}

/**
 * The CLI's arguments. Everything that could reach the host is off: no tools (`--tools ""`), no MCP
 * servers, no hooks, plugins, skills or CLAUDE.md (`--safe-mode`), nothing that could prompt for a
 * permission, and no session written to disk. The system prompt replaces Claude Code's own.
 */
export function claudeArgs(req: GenerateRequest, systemFile: string): string[] {
  return [
    '-p',
    '--output-format',
    'json',
    '--model',
    req.model,
    '--system-prompt-file',
    systemFile,
    '--tools',
    '',
    '--strict-mcp-config',
    '--safe-mode',
    '--disable-slash-commands',
    '--permission-mode',
    'dontAsk',
    '--permission-prompts',
    'none',
    '--no-session-persistence',
    ...(req.structured === 'native' ? ['--json-schema', JSON.stringify(req.schema)] : []),
  ];
}

/** The child's environment: no API key unless the CLI is meant to bill one, and the reply limit. */
export function childEnv(
  base: NodeJS.ProcessEnv,
  req: GenerateRequest,
  billing: RunOptions['billing'],
): NodeJS.ProcessEnv {
  const env = { ...base };
  if (billing !== 'api') {
    // A key in the bridge's env (from a shared .env) would silently bill the API instead of the subscription.
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
  }
  delete env.CLAUDE_BRIDGE_SECRET;
  env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(req.maxTokens);
  env.DISABLE_AUTOUPDATER = '1';
  return env;
}

/** Finds the `result` event in the CLI's stdout: one JSON object, or NDJSON whose last result line counts. */
export function parseResult(stdout: string): ResultEvent | undefined {
  const isResult = (v: unknown): v is ResultEvent =>
    !!v && typeof v === 'object' && (v as { type?: unknown }).type === 'result';
  const trimmed = stdout.trim();
  try {
    const whole: unknown = JSON.parse(trimmed);
    if (isResult(whole)) return whole;
  } catch {
    // Not one object: try it as NDJSON.
  }
  let found: ResultEvent | undefined;
  for (const line of trimmed.split('\n')) {
    try {
      const v: unknown = JSON.parse(line);
      if (isResult(v)) found = v;
    } catch {
      // Skip a line that is not JSON.
    }
  }
  return found;
}

/** Reads the reset time from a usage-limit message ("...|1760000000"), as a delay from now. */
function resetDelayMs(text: string, now: number): number | undefined {
  const m = /\|(\d{9,13})\b/.exec(text);
  if (!m) return undefined;
  const n = Number(m[1]);
  const at = n < 1e12 ? n * 1000 : n;
  return at > now ? at - now : undefined;
}

/** Maps an error result to the bridge's failure, so the server's provider gets the right retry verdict. */
export function errorOf(ev: ResultEvent, now = Date.now()): BridgeError {
  const text = (ev.result ?? '').slice(0, 500) || `claude failed (${ev.subtype ?? 'error'})`;
  const status = ev.api_error_status ?? undefined;
  const notLoggedIn = () =>
    new BridgeError(424, 'not_logged_in', `claude is not logged in on the bridge host: ${text}`);
  const rateLimited = () =>
    new BridgeError(429, 'rate_limited', text, resetDelayMs(text, now) ?? 60_000);
  const overloaded = () => new BridgeError(503, 'overloaded', text);
  // The API status decides when there is one: a 5xx whose text mentions authentication is still transient.
  if (status !== undefined) {
    if (status === 401 || status === 403) return notLoggedIn();
    if (status === 429) return rateLimited();
    if (status === 529) return overloaded();
    // A bad model name or request will fail again the same way.
    if (status >= 400 && status < 500) return new BridgeError(400, 'rejected', text);
    if (status >= 500 && /overloaded/i.test(text)) return overloaded();
    return new BridgeError(502, 'cli_error', text);
  }
  if (/not logged in|\/login|invalid api key|oauth token|authentication/i.test(text))
    return notLoggedIn();
  if (/rate.?limit|usage limit|too many requests/i.test(text)) return rateLimited();
  if (/overloaded/i.test(text)) return overloaded();
  return new BridgeError(502, 'cli_error', text);
}

/** The answer from a result event, or the failure it reports. */
export function responseOf(
  ev: ResultEvent,
  billing: RunOptions['billing'],
  durationMs: number,
): GenerateResponse {
  const text = ev.result ?? '';
  const u = ev.usage ?? {};
  const usage = {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
  const cost =
    billing === 'api' && typeof ev.total_cost_usd === 'number'
      ? { costUsd: ev.total_cost_usd }
      : {};
  // The CLI reports a reply cut at CLAUDE_CODE_MAX_OUTPUT_TOKENS as an error result.
  if (
    ev.stop_reason === 'max_tokens' ||
    (ev.is_error && /exceeded the \d+ output token maximum/i.test(text))
  ) {
    return { text: ev.is_error ? '' : text, usage, ...cost, truncated: true, durationMs };
  }
  if (ev.stop_reason === 'refusal') return { text, usage, ...cost, refusal: true, durationMs };
  if (ev.is_error || (ev.subtype && ev.subtype !== 'success')) throw errorOf(ev);
  const out = ev.structured_output !== undefined ? JSON.stringify(ev.structured_output) : text;
  return { text: out, usage, ...cost, durationMs };
}

/**
 * Runs `claude -p` once for a request, in a fresh empty working directory that is removed after,
 * and returns its answer. Aborting `signal` or reaching `timeoutMs` kills the whole process group.
 */
export async function runClaude(
  req: GenerateRequest,
  opts: RunOptions,
  signal: AbortSignal,
): Promise<GenerateResponse> {
  if (signal.aborted) throw new BridgeError(499, 'aborted', 'request aborted');
  const root = await mkdtemp(join(tmpdir(), 'claude-bridge-'));
  try {
    const cwd = join(root, 'work');
    await mkdir(cwd, { mode: 0o700 });
    // Outside the working directory, and passed as a file so a long prompt is not an argv limit.
    const systemFile = join(root, 'system.txt');
    await writeFile(systemFile, req.system, { mode: 0o600 });
    return await spawnClaude(req, opts, signal, cwd, systemFile);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function spawnClaude(
  req: GenerateRequest,
  opts: RunOptions,
  signal: AbortSignal,
  cwd: string,
  systemFile: string,
): Promise<GenerateResponse> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(opts.bin, claudeArgs(req, systemFile), {
      cwd,
      env: childEnv(opts.env ?? process.env, req, opts.billing),
      stdio: ['pipe', 'pipe', 'pipe'],
      // Its own process group, so a kill reaches anything the CLI started.
      detached: true,
    });
    let stdout = '';
    let stderr = '';
    let failure: BridgeError | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    const kill = (why: BridgeError) => {
      if (failure || child.exitCode !== null || child.signalCode !== null) return;
      failure = why;
      const group = (sig: NodeJS.Signals) => {
        try {
          if (child.pid) process.kill(-child.pid, sig);
        } catch {
          child.kill(sig);
        }
      };
      group('SIGTERM');
      killTimer = setTimeout(() => group('SIGKILL'), opts.killGraceMs ?? KILL_GRACE_MS);
      killTimer.unref();
    };
    const timer = setTimeout(
      () =>
        kill(new BridgeError(504, 'timeout', `claude did not answer within ${opts.timeoutMs} ms`)),
      opts.timeoutMs,
    );
    const onAbort = () => kill(new BridgeError(499, 'aborted', 'request aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    // An abort during the temp-dir setup has already fired, so the listener would never see it.
    if (signal.aborted) onAbort();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    };

    child.stdout.setEncoding('utf8').on('data', (c: string) => (stdout += c));
    child.stderr.setEncoding('utf8').on('data', (c: string) => {
      if (stderr.length < 4_000) stderr += c;
    });
    child.stdin.on('error', () => {}); // a child that exits early closes the pipe; its exit says why
    child.on('error', (err: NodeJS.ErrnoException) => {
      done();
      reject(
        err.code === 'ENOENT'
          ? new BridgeError(
              424,
              'cli_missing',
              `claude CLI not found at "${opts.bin}" (set CLAUDE_BIN)`,
            )
          : new BridgeError(502, 'spawn_failed', err.message),
      );
    });
    child.on('close', (code) => {
      done();
      if (killTimer) clearTimeout(killTimer);
      if (failure) return reject(failure);
      const ev = parseResult(stdout);
      if (!ev) {
        const why = stderr.trim() || stdout.trim() || `exit code ${code}`;
        return reject(
          /not logged in|\/login/i.test(why)
            ? new BridgeError(
                424,
                'not_logged_in',
                `claude is not logged in on the bridge host: ${why.slice(0, 300)}`,
              )
            : new BridgeError(
                502,
                code === 0 ? 'bad_output' : 'cli_error',
                `claude gave no result: ${why.slice(0, 300)}`,
              ),
        );
      }
      try {
        resolve(responseOf(ev, opts.billing, Date.now() - started));
      } catch (err) {
        reject(err);
      }
    });
    child.stdin.end(promptOf(req.messages));
  });
}
