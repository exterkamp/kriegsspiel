import { addUsage, ZERO_USAGE } from './pricing.js';
import { UmpireError } from './umpireClient.js';
import type {
  TokenUsage,
  UmpireClient,
  UmpireRequest,
  UmpireResponse,
  UmpireStage,
} from './umpireClient.js';

/** Caps for one game. Each is optional; an absent cap is not enforced. */
export interface GameLimits {
  maxCostUsd?: number;
  maxTotalTokens?: number;
  /** Calls started in any sliding 60 s of wall time. */
  maxCallsPerMinute?: number;
}

/** One line of the metrics log: a call that ran, or one refused before it ran. */
export type GameUmpireMetric =
  | {
      kind: 'call';
      gameId: string;
      stage: UmpireStage;
      model: string;
      ok: boolean;
      usage: TokenUsage;
      costUsd: number | null;
      totalCostUsd: number;
      totalTokens: number;
    }
  | { kind: 'refused'; gameId: string; stage: UmpireStage; reason: 'budget' | 'rate-limit' };

/** What one game has cost so far. The server reports this per game. */
export interface GameUmpireReport {
  gameId: string;
  calls: number;
  failedCalls: number;
  /** Calls refused by the cap or the rate limit, so the caller used its fallback. */
  refusedBudget: number;
  refusedRateLimit: number;
  usage: TokenUsage;
  totalTokens: number;
  /** Priced models only. Unpriced (local) models add tokens but no dollars. */
  costUsd: number;
  byStage: Record<UmpireStage, { calls: number; costUsd: number; totalTokens: number }>;
  /** True once the budget is spent: every further call is refused. */
  budgetSpent: boolean;
}

export interface GameUmpireOptions {
  gameId: string;
  limits?: GameLimits;
  /** Metrics sink (the server logs it). */
  onMetric?: (metric: GameUmpireMetric) => void;
  /** Wall clock, injected for tests. */
  now?: () => number;
}

const MINUTE_MS = 60_000;

/**
 * One game's view of the umpire: counts its spend and calls, enforces its caps, and refuses
 * (with a `UmpireError` of kind `budget` or `rate-limit`, nothing sent) once a cap is hit. The
 * stage code treats the refusal like any failed call and uses its conservative fallback, so a
 * capped game degrades instead of stalling or erroring. Refusals do not hold up game time: they
 * return at once. Spend includes failed attempts. Calls in flight when a cap is crossed finish,
 * so a cap can be overshot by those calls. In memory only: it resets on restart.
 */
export class GameUmpireClient implements UmpireClient {
  private usage: TokenUsage = ZERO_USAGE;
  private costUsd = 0;
  private calls = 0;
  private failedCalls = 0;
  private refusedBudget = 0;
  private refusedRateLimit = 0;
  private readonly starts: number[] = [];
  private readonly byStage: GameUmpireReport['byStage'] = {
    parse: { calls: 0, costUsd: 0, totalTokens: 0 },
    judge: { calls: 0, costUsd: 0, totalTokens: 0 },
    narrate: { calls: 0, costUsd: 0, totalTokens: 0 },
    command: { calls: 0, costUsd: 0, totalTokens: 0 },
  };
  private readonly limits: GameLimits;
  private readonly now: () => number;

  constructor(
    private readonly inner: UmpireClient,
    private readonly opts: GameUmpireOptions,
  ) {
    this.limits = opts.limits ?? {};
    this.now = opts.now ?? Date.now;
  }

  private get totalTokens(): number {
    return this.usage.inputTokens + this.usage.outputTokens;
  }

  private get budgetSpent(): boolean {
    const { maxCostUsd, maxTotalTokens } = this.limits;
    return (
      (maxCostUsd !== undefined && this.costUsd >= maxCostUsd) ||
      (maxTotalTokens !== undefined && this.totalTokens >= maxTotalTokens)
    );
  }

  report(): GameUmpireReport {
    return {
      gameId: this.opts.gameId,
      calls: this.calls,
      failedCalls: this.failedCalls,
      refusedBudget: this.refusedBudget,
      refusedRateLimit: this.refusedRateLimit,
      usage: this.usage,
      totalTokens: this.totalTokens,
      costUsd: this.costUsd,
      byStage: structuredClone(this.byStage),
      budgetSpent: this.budgetSpent,
    };
  }

  async call<T>(request: UmpireRequest): Promise<UmpireResponse<T>> {
    const { stage } = request;
    if (this.budgetSpent) this.refuse(stage, 'budget', 'game budget spent');
    const cap = this.limits.maxCallsPerMinute;
    if (cap !== undefined) {
      const now = this.now();
      while (this.starts.length > 0 && this.starts[0]! <= now - MINUTE_MS) this.starts.shift();
      if (this.starts.length >= cap) {
        this.refuse(stage, 'rate-limit', `more than ${cap} umpire calls in a minute`);
      }
      this.starts.push(now);
    }
    try {
      const res = await this.inner.call<T>(request);
      this.add(stage, res.record.usage, res.record.costUsd, true, res.record.model);
      return res;
    } catch (err) {
      if (err instanceof UmpireError && err.usage) {
        this.add(stage, err.usage, err.costUsd ?? null, false, '');
      } else {
        this.add(stage, ZERO_USAGE, null, false, '');
      }
      throw err;
    }
  }

  private refuse(stage: UmpireStage, reason: 'budget' | 'rate-limit', message: string): never {
    if (reason === 'budget') this.refusedBudget++;
    else this.refusedRateLimit++;
    this.opts.onMetric?.({ kind: 'refused', gameId: this.opts.gameId, stage, reason });
    throw new UmpireError(message, reason, 0);
  }

  private add(
    stage: UmpireStage,
    usage: TokenUsage,
    cost: number | null,
    ok: boolean,
    model: string,
  ): void {
    this.usage = addUsage(this.usage, usage);
    this.costUsd += cost ?? 0;
    this.calls++;
    if (!ok) this.failedCalls++;
    const s = this.byStage[stage];
    s.calls++;
    s.costUsd += cost ?? 0;
    s.totalTokens += usage.inputTokens + usage.outputTokens;
    this.opts.onMetric?.({
      kind: 'call',
      gameId: this.opts.gameId,
      stage,
      model,
      ok,
      usage,
      costUsd: cost,
      totalCostUsd: this.costUsd,
      totalTokens: this.totalTokens,
    });
  }
}

/** Wraps the shared client for one game. */
export function createGameUmpire(shared: UmpireClient, opts: GameUmpireOptions): GameUmpireClient {
  return new GameUmpireClient(shared, opts);
}
