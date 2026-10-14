import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BridgeError, checkRequest } from './claude.js';
import type { GenerateRequest, GenerateResponse } from './claude.js';

export interface BridgeHandlerOptions {
  /** Runs one request (`runClaude` bound to its options; a fake in tests). */
  run: (req: GenerateRequest, signal: AbortSignal) => Promise<GenerateResponse>;
  /** Required as `Authorization: Bearer <secret>` when set. */
  secret?: string;
  /** CLI runs at once; more wait in a queue. */
  maxConcurrent: number;
  /** Waiting requests beyond this are refused with 503. */
  maxQueue: number;
  /** Largest request body accepted. */
  maxBodyBytes?: number;
  log?: (line: Record<string, unknown>) => void;
}

/** Hands out `max` slots in arrival order. */
export class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly max: number) {}

  get queued(): number {
    return this.waiting.length;
  }

  /** Resolves when a slot is free; rejects if `signal` aborts first. */
  acquire(signal: AbortSignal): Promise<() => void> {
    const release = () => {
      this.active--;
      this.waiting.shift()?.();
    };
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve(release);
    }
    return new Promise((resolve, reject) => {
      const go = () => {
        signal.removeEventListener('abort', onAbort);
        this.active++;
        resolve(release);
      };
      const onAbort = () => {
        const i = this.waiting.indexOf(go);
        if (i >= 0) this.waiting.splice(i, 1);
        reject(new BridgeError(499, 'aborted', 'request aborted while queued'));
      };
      this.waiting.push(go);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}

function authorized(header: string | undefined, secret: string | undefined): boolean {
  if (!secret) return true;
  const m = /^Bearer (.+)$/.exec(header ?? '');
  if (!m) return false;
  const a = Buffer.from(m[1]!);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new BridgeError(413, 'too_large', `request body over ${limit} bytes`));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

/**
 * `POST /v1/generate` runs one request through the CLI; `GET /healthz` answers `{ok: true}`. A
 * request whose client goes away (the server's own timeout aborts its fetch) is dropped from the
 * queue or has its CLI run killed.
 */
export function createBridgeHandler(opts: BridgeHandlerOptions) {
  const slots = new Semaphore(opts.maxConcurrent);
  const log = opts.log ?? (() => {});
  const live = new Set<AbortController>();
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = (req.url ?? '').split('?')[0];
    if (req.method === 'GET' && path === '/healthz') return send(res, 200, { ok: true });
    if (path !== '/v1/generate')
      return send(res, 404, { error: { code: 'not_found', message: 'no such route' } });
    if (req.method !== 'POST')
      return send(res, 405, { error: { code: 'method', message: 'POST only' } });
    if (!authorized(req.headers.authorization, opts.secret)) {
      log({ event: 'unauthorized', from: req.socket.remoteAddress });
      return send(res, 401, {
        error: { code: 'unauthorized', message: 'missing or wrong bridge secret' },
      });
    }
    const ctrl = new AbortController();
    live.add(ctrl);
    res.on('close', () => {
      live.delete(ctrl);
      if (!res.writableFinished) ctrl.abort();
    });
    let release: (() => void) | undefined;
    const started = Date.now();
    let model: string | undefined;
    try {
      const body = await readBody(req, opts.maxBodyBytes ?? 4_000_000);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new BridgeError(400, 'bad_request', 'body is not JSON');
      }
      const request = checkRequest(parsed);
      model = request.model;
      if (slots.queued >= opts.maxQueue) throw new BridgeError(503, 'busy', 'bridge queue is full');
      release = await slots.acquire(ctrl.signal);
      const queuedMs = Date.now() - started;
      const answer = await opts.run(request, ctrl.signal);
      log({
        event: 'generate',
        model,
        queuedMs,
        ms: answer.durationMs,
        usage: answer.usage,
        truncated: answer.truncated,
      });
      send(res, 200, answer);
    } catch (err) {
      const e =
        err instanceof BridgeError
          ? err
          : new BridgeError(500, 'internal', err instanceof Error ? err.message : String(err));
      log({
        event: 'error',
        model,
        code: e.code,
        status: e.status,
        ms: Date.now() - started,
        message: e.message,
      });
      send(
        res,
        e.status,
        { error: { code: e.code, message: e.message } },
        e.retryAfterMs ? { 'retry-after': String(Math.ceil(e.retryAfterMs / 1000)) } : {},
      );
    } finally {
      release?.();
    }
  };
  /** Kills every queued and running request, for shutdown: the CLI runs in its own process group. */
  const abortAll = () => {
    for (const c of live) c.abort();
  };
  return { handle, abortAll };
}
