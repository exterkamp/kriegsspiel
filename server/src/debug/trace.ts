/**
 * Debug trace store. See docs/architecture.md (Debug trace).
 *
 * Structured entries for requests, commands, engine events, clock changes, errors and LLM
 * calls, each tagged with the correlation id of the inbound request that caused it. The trace
 * is read-only diagnostics: it is never consulted by the engine and never sent to game clients.
 *
 * Producers depend on `TraceSink`. When the admin view is disabled they get `NOOP_TRACE`, whose
 * `enabled` is false: callers check it before building any payload, so nothing is allocated or
 * stored.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { createWriteStream, type WriteStream } from 'node:fs';
import { Redactor } from './redact.js';

export type TraceKind = 'request' | 'command' | 'engine' | 'clock' | 'error' | 'llm';

export interface TraceEntry {
  /** Per-store, strictly increasing. */
  seq: number;
  /** Wall time in ms. */
  ts: number;
  gameId: string;
  /** Id of the inbound request (or scheduler tick) that caused this entry. */
  correlationId: string;
  kind: TraceKind;
  /** Redacted, JSON-safe payload. */
  data: unknown;
}

export interface TraceSink {
  /** False means `record` does nothing; check it before building a payload. */
  readonly enabled: boolean;
  record(gameId: string, kind: TraceKind, data: unknown, correlationId?: string): void;
}

export const NOOP_TRACE: TraceSink = { enabled: false, record: () => undefined };

const context = new AsyncLocalStorage<string>();

export function newCorrelationId(): string {
  return randomUUID();
}

/** The correlation id of the work running now, if any. */
export function currentCorrelationId(): string | undefined {
  return context.getStore();
}

/** Run `fn` so everything it causes (awaited or not) is tagged with `id`. */
export function withCorrelationId<T>(id: string, fn: () => T): T {
  return context.run(id, fn);
}

export interface TraceStoreOptions {
  /** Ring buffer size per game. Default 2000. */
  maxEntriesPerGame?: number;
  /** Append-only JSON Lines file. Entries are written as they are recorded. */
  filePath?: string;
  /** Exact secret values (such as the API key) to scrub on top of the built-in patterns. */
  secrets?: readonly (string | undefined)[];
  now?: () => number;
  /** Called when the file sink fails; the trace must never take a game down. */
  onFileError?: (error: unknown) => void;
}

export const DEFAULT_MAX_TRACE_ENTRIES = 2000;

export class TraceStore implements TraceSink {
  readonly enabled = true;
  private readonly max: number;
  private readonly rings = new Map<string, TraceEntry[]>();
  private readonly redactor: Redactor;
  private readonly now: () => number;
  private readonly file?: WriteStream;
  private seq = 0;

  constructor(options: TraceStoreOptions = {}) {
    this.max = Math.max(1, options.maxEntriesPerGame ?? DEFAULT_MAX_TRACE_ENTRIES);
    this.redactor = new Redactor(options.secrets);
    this.now = options.now ?? Date.now;
    if (options.filePath) {
      this.file = createWriteStream(options.filePath, { flags: 'a' });
      this.file.on('error', (e) => options.onFileError?.(e));
    }
  }

  record(gameId: string, kind: TraceKind, data: unknown, correlationId?: string): void {
    const entry: TraceEntry = {
      seq: ++this.seq,
      ts: this.now(),
      gameId,
      correlationId: correlationId ?? currentCorrelationId() ?? 'none',
      kind,
      data: this.redactor.value(data),
    };
    let ring = this.rings.get(gameId);
    if (!ring) this.rings.set(gameId, (ring = []));
    ring.push(entry);
    if (ring.length > this.max) ring.splice(0, ring.length - this.max);
    this.file?.write(JSON.stringify(entry) + '\n');
  }

  /** Entries for a game, oldest first, optionally filtered. */
  entries(gameId: string, filter: { kind?: TraceKind; correlationId?: string } = {}): TraceEntry[] {
    return (this.rings.get(gameId) ?? []).filter(
      (e) =>
        (!filter.kind || e.kind === filter.kind) &&
        (!filter.correlationId || e.correlationId === filter.correlationId),
    );
  }

  /** Drop a game's buffered entries (the file keeps them). */
  clear(gameId: string): void {
    this.rings.delete(gameId);
  }

  /** Flush and close the file sink. */
  close(): Promise<void> {
    const file = this.file;
    if (!file) return Promise.resolve();
    return new Promise((resolve) => file.end(resolve));
  }
}

export interface RequestInfo {
  transport: 'http' | 'ws';
  /** HTTP method, or the WebSocket message type. */
  method: string;
  path: string;
  /** Request body size in bytes. */
  bytes?: number;
}

/**
 * Wrap the handling of one inbound HTTP request or WebSocket message. Assigns a correlation id,
 * runs `fn` under it, and records the request with its duration, outcome and response size.
 */
export async function traceRequest<T>(
  sink: TraceSink,
  gameId: string,
  info: RequestInfo,
  fn: (correlationId: string) => Promise<T>,
  options: { now?: () => number; responseBytes?: (result: T) => number } = {},
): Promise<T> {
  if (!sink.enabled) return fn('none');
  const now = options.now ?? Date.now;
  const id = newCorrelationId();
  const start = now();
  return withCorrelationId(id, async () => {
    try {
      const result = await fn(id);
      sink.record(gameId, 'request', {
        ...info,
        ok: true,
        durationMs: now() - start,
        responseBytes: options.responseBytes?.(result),
      });
      return result;
    } catch (e) {
      sink.record(gameId, 'request', { ...info, ok: false, durationMs: now() - start, error: e });
      throw e;
    }
  });
}
