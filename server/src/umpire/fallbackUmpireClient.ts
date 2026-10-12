import { UmpireError } from './umpireClient.js';
import type { UmpireClient, UmpireRequest, UmpireResponse, UmpireStage } from './umpireClient.js';

/** One stage that fell back from its primary client. */
export interface UmpireFallback {
  stage: UmpireStage;
  /** `unavailable` when the call was skipped because the primary failed a moment ago. */
  reason: string;
  kind: UmpireError['kind'] | 'unavailable';
  /** Provider and model that failed. */
  provider?: string;
  model?: string;
}

export interface FallbackUmpireOptions {
  primary: UmpireClient;
  fallback: UmpireClient;
  /** Stages the primary serves. Others go straight to the fallback. Default: all. */
  stages?: readonly UmpireStage[];
  /**
   * After a transport or timeout failure the primary is skipped for this long, so a down or slow model does not
   * cost every call its full timeout. 0 turns it off. Default 30 s.
   */
  cooldownMs?: number;
  provider?: string;
  model?: string;
  onFallback?: (f: UmpireFallback) => void;
  now?: () => number;
}

/**
 * Tries the primary umpire (a local model) and, if the call fails for any reason (unreachable, still pulling
 * the model, timeout, output that fails the schema after the allowed repairs), answers from the fallback (the
 * test provider) instead, so the game continues. The returned record carries `fallbackFor`, which says what failed.
 * Budget and rate-limit refusals come from the caller's own caps and are not retried elsewhere.
 */
export class FallbackUmpireClient implements UmpireClient {
  private downUntil = 0;
  private readonly now: () => number;
  /** The newest fallback, for status displays. */
  last: (UmpireFallback & { at: number }) | undefined;
  fallbackCount = 0;

  constructor(private readonly o: FallbackUmpireOptions) {
    this.now = o.now ?? Date.now;
  }

  async call<T>(request: UmpireRequest): Promise<UmpireResponse<T>> {
    if (this.o.stages && !this.o.stages.includes(request.stage)) {
      return this.o.fallback.call<T>(request);
    }
    if (this.now() < this.downUntil) {
      return this.answer<T>(request, {
        stage: request.stage,
        reason: 'skipped: model failed recently',
        kind: 'unavailable',
      });
    }
    try {
      return await this.o.primary.call<T>(request);
    } catch (e) {
      if (!(e instanceof UmpireError) || e.kind === 'budget' || e.kind === 'rate-limit') throw e;
      const cooldown = this.o.cooldownMs ?? 30_000;
      if (cooldown > 0 && (e.kind === 'transport' || e.kind === 'timeout')) {
        this.downUntil = this.now() + cooldown;
      }
      return this.answer<T>(request, { stage: request.stage, reason: e.message, kind: e.kind });
    }
  }

  private async answer<T>(request: UmpireRequest, f: UmpireFallback): Promise<UmpireResponse<T>> {
    const info: UmpireFallback = {
      ...f,
      ...(this.o.provider ? { provider: this.o.provider } : {}),
      ...(this.o.model ? { model: this.o.model } : {}),
    };
    this.fallbackCount++;
    this.last = { ...info, at: this.now() };
    this.o.onFallback?.(info);
    const res = await this.o.fallback.call<T>(request);
    return {
      output: res.output,
      record: {
        ...res.record,
        fallbackFor: {
          reason: info.reason,
          kind: info.kind,
          ...(info.provider ? { provider: info.provider } : {}),
          ...(info.model ? { model: info.model } : {}),
        },
      },
    };
  }
}
