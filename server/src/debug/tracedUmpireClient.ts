import type { TraceSink } from './trace.js';
import type { UmpireClient, UmpireRequest, UmpireResponse } from '../umpire/umpireClient.js';
import { UmpireError } from '../umpire/umpireClient.js';

export interface TracedUmpireOptions {
  inner: UmpireClient;
  trace: TraceSink;
  gameId: string;
  /** `playback` for replays served from recordings, `live` for real model calls. */
  mode: 'live' | 'playback';
  provider?: string;
  now?: () => number;
}

/**
 * Records every umpire call into the debug trace: provider, model, stage, prompt, response,
 * schema, latency, tokens, cost and retries. The correlation id comes from the request being
 * handled when the call starts. When tracing is disabled `traceUmpire` returns the inner
 * client unchanged.
 */
export class TracedUmpireClient implements UmpireClient {
  private readonly now: () => number;

  constructor(private readonly o: TracedUmpireOptions) {
    this.now = o.now ?? Date.now;
  }

  async call<T>(request: UmpireRequest): Promise<UmpireResponse<T>> {
    const start = this.now();
    const base = {
      provider: this.o.provider ?? 'anthropic',
      mode: this.o.mode,
      stage: request.stage,
      promptVersion: request.promptVersion,
      system: request.system,
      input: request.input,
      schema: request.schema,
    };
    try {
      const res = await this.o.inner.call<T>(request);
      const r = res.record;
      this.o.trace.record(this.o.gameId, 'llm', {
        ...base,
        model: r.model,
        response: r.rawOutput,
        latencyMs: this.now() - start,
        usage: r.usage,
        costUsd: r.costUsd,
        attempts: r.attempts,
        retries: Math.max(0, r.attempts - 1),
        ok: true,
      });
      return res;
    } catch (e) {
      const failed = e instanceof UmpireError ? e : undefined;
      this.o.trace.record(this.o.gameId, 'llm', {
        ...base,
        latencyMs: this.now() - start,
        usage: failed?.usage,
        costUsd: failed?.costUsd,
        attempts: failed?.attempts,
        retries: failed ? Math.max(0, failed.attempts - 1) : undefined,
        ok: false,
        errorKind: failed?.kind,
        error: e,
      });
      throw e;
    }
  }
}

/** Wrap `inner` for tracing, or return it untouched (zero overhead) when tracing is off. */
export function traceUmpire(inner: UmpireClient, options: Omit<TracedUmpireOptions, 'inner'>) {
  return options.trace.enabled ? new TracedUmpireClient({ ...options, inner }) : inner;
}
