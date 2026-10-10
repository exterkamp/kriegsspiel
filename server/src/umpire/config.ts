import { readFileSync } from 'node:fs';
import type { StructuredOutputSupport } from './provider.js';
import type { GameLimits } from './gameLimits.js';
import type { UmpireStage } from './umpireClient.js';

export const UMPIRE_STAGES: readonly UmpireStage[] = ['parse', 'judge', 'narrate'];

/** One configured model server. `type` names a factory in the `ProviderRegistry`. */
export interface ProviderSpec {
  type: string;
  baseUrl?: string;
  /**
   * NAME of the environment variable holding the API key. Keys themselves are never read from
   * config files. Providers other than Anthropic send no key unless this is set, so a key is not
   * sent to a local server by accident.
   */
  apiKeyEnv?: string;
  /** Override the adapter's structured-output capability, e.g. `json-mode` for a server without schema support. */
  structuredOutput?: StructuredOutputSupport;
  contextWindow?: number;
  /** Ollama only: `options.num_ctx`. */
  numCtx?: number;
}

/** Where a stage runs. Swapping provider or model is a config change only. */
export interface StageRoute {
  /** Key into `UmpireConfig.providers`. */
  provider: string;
  /** A plain string passed to the server. Never validated or hard-coded elsewhere. */
  model: string;
  params?: { temperature?: number; maxTokens?: number };
}

export interface UmpireConfig {
  providers: Record<string, ProviderSpec>;
  stages: Record<UmpireStage, StageRoute>;
  /** Per-attempt timeout. */
  timeoutMs: number;
  /** Total attempts including the first. */
  maxAttempts: number;
  /** Backoff before retry n is `min(maxBackoffMs, baseBackoffMs * 2^(n-1))`, with jitter. */
  baseBackoffMs: number;
  maxBackoffMs: number;
  rateLimit?: { maxConcurrent?: number; minIntervalMs?: number };
  /** Caps on spend across the life of the client. Cost is only counted for priced models. */
  budget?: { maxCostUsd?: number; maxTotalTokens?: number };
  /** Caps for each game (see `GameUmpireClient`). Absent: no per-game cap. */
  gameBudget?: GameLimits;
}

export const DEFAULT_UMPIRE_CONFIG: UmpireConfig = {
  providers: { anthropic: { type: 'anthropic' } },
  stages: {
    parse: { provider: 'anthropic', model: 'claude-haiku-5-5' },
    judge: { provider: 'anthropic', model: 'claude-opus-5-5' },
    narrate: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
  },
  timeoutMs: 60_000,
  maxAttempts: 3,
  baseBackoffMs: 500,
  maxBackoffMs: 8_000,
};

/** A config file: every field optional, merged over the defaults. */
export type UmpireConfigFile = Partial<Omit<UmpireConfig, 'stages'>> & {
  stages?: Partial<Record<UmpireStage, StageRoute>>;
};

type Env = Record<string, string | undefined>;

function positiveInt(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return n;
}

function positiveNumber(env: Env, name: string): number | undefined {
  const raw = env[name];
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(`${name} must be a positive number, got "${raw}"`);
  return n;
}

function checkFile(file: UmpireConfigFile): void {
  for (const [id, spec] of Object.entries(file.providers ?? {})) {
    if ('apiKey' in spec || 'key' in spec) {
      throw new Error(
        `provider "${id}": API keys must come from the environment; set apiKeyEnv to the variable's name`,
      );
    }
    if (typeof spec.type !== 'string') throw new Error(`provider "${id}": missing type`);
  }
  const caps: [string, number | undefined][] = [
    ['budget.maxCostUsd', file.budget?.maxCostUsd],
    ['budget.maxTotalTokens', file.budget?.maxTotalTokens],
    ['gameBudget.maxCostUsd', file.gameBudget?.maxCostUsd],
    ['gameBudget.maxTotalTokens', file.gameBudget?.maxTotalTokens],
    ['gameBudget.maxCallsPerMinute', file.gameBudget?.maxCallsPerMinute],
  ];
  for (const [name, value] of caps) {
    if (value !== undefined && !(Number.isFinite(value) && value > 0)) {
      throw new Error(`${name} must be a positive number, got ${String(value)}`);
    }
  }
}

/**
 * Builds the config: defaults, then the optional file, then env overrides. Env reads
 * `UMPIRE_PROVIDER_PARSE|JUDGE|NARRATE`, `UMPIRE_MODEL_PARSE|JUDGE|NARRATE`, `UMPIRE_TIMEOUT_MS`,
 * `UMPIRE_MAX_ATTEMPTS`, `UMPIRE_BASE_BACKOFF_MS`, `UMPIRE_MAX_BACKOFF_MS`, `UMPIRE_MAX_CONCURRENT`,
 * `UMPIRE_MIN_INTERVAL_MS`, `UMPIRE_BUDGET_USD`, `UMPIRE_BUDGET_TOKENS` and the per-game
 * `UMPIRE_GAME_BUDGET_USD`, `UMPIRE_GAME_BUDGET_TOKENS` and `UMPIRE_GAME_CALLS_PER_MINUTE`. Throws if a stage names
 * a provider that is not configured.
 */
export function umpireConfigFromEnv(
  env: Env = process.env,
  file: UmpireConfigFile = {},
): UmpireConfig {
  checkFile(file);
  const d = DEFAULT_UMPIRE_CONFIG;
  const providers = { ...d.providers, ...file.providers };
  const stages = { ...d.stages, ...file.stages } as Record<UmpireStage, StageRoute>;
  for (const stage of UMPIRE_STAGES) {
    const key = stage.toUpperCase();
    const route = stages[stage];
    stages[stage] = {
      ...route,
      provider: env[`UMPIRE_PROVIDER_${key}`] || route.provider,
      model: env[`UMPIRE_MODEL_${key}`] || route.model,
    };
    if (!providers[stages[stage].provider]) {
      throw new Error(
        `stage "${stage}" uses provider "${stages[stage].provider}", which is not configured`,
      );
    }
  }

  const maxConcurrent = positiveInt(
    env,
    'UMPIRE_MAX_CONCURRENT',
    file.rateLimit?.maxConcurrent ?? 0,
  );
  const minIntervalMs = positiveInt(
    env,
    'UMPIRE_MIN_INTERVAL_MS',
    file.rateLimit?.minIntervalMs ?? 0,
  );
  const maxCostUsd = positiveNumber(env, 'UMPIRE_BUDGET_USD') ?? file.budget?.maxCostUsd;
  const maxTotalTokens = positiveNumber(env, 'UMPIRE_BUDGET_TOKENS') ?? file.budget?.maxTotalTokens;
  const gameCostUsd = positiveNumber(env, 'UMPIRE_GAME_BUDGET_USD') ?? file.gameBudget?.maxCostUsd;
  const gameTokens =
    positiveNumber(env, 'UMPIRE_GAME_BUDGET_TOKENS') ?? file.gameBudget?.maxTotalTokens;
  const gameCalls =
    env.UMPIRE_GAME_CALLS_PER_MINUTE === undefined || env.UMPIRE_GAME_CALLS_PER_MINUTE === ''
      ? file.gameBudget?.maxCallsPerMinute
      : positiveInt(env, 'UMPIRE_GAME_CALLS_PER_MINUTE', 0);
  return {
    providers,
    stages,
    timeoutMs: positiveInt(env, 'UMPIRE_TIMEOUT_MS', file.timeoutMs ?? d.timeoutMs),
    maxAttempts: positiveInt(env, 'UMPIRE_MAX_ATTEMPTS', file.maxAttempts ?? d.maxAttempts),
    baseBackoffMs: positiveInt(
      env,
      'UMPIRE_BASE_BACKOFF_MS',
      file.baseBackoffMs ?? d.baseBackoffMs,
    ),
    maxBackoffMs: positiveInt(env, 'UMPIRE_MAX_BACKOFF_MS', file.maxBackoffMs ?? d.maxBackoffMs),
    ...(maxConcurrent || minIntervalMs
      ? {
          rateLimit: {
            ...(maxConcurrent ? { maxConcurrent } : {}),
            ...(minIntervalMs ? { minIntervalMs } : {}),
          },
        }
      : {}),
    ...(gameCostUsd !== undefined || gameTokens !== undefined || gameCalls !== undefined
      ? {
          gameBudget: {
            ...(gameCostUsd !== undefined ? { maxCostUsd: gameCostUsd } : {}),
            ...(gameTokens !== undefined ? { maxTotalTokens: gameTokens } : {}),
            ...(gameCalls !== undefined ? { maxCallsPerMinute: gameCalls } : {}),
          },
        }
      : {}),
    ...(maxCostUsd !== undefined || maxTotalTokens !== undefined
      ? {
          budget: {
            ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
            ...(maxTotalTokens !== undefined ? { maxTotalTokens } : {}),
          },
        }
      : {}),
  };
}

/** Reads the JSON file named by `UMPIRE_CONFIG_FILE` (if set) and applies env overrides. */
export function loadUmpireConfig(env: Env = process.env): UmpireConfig {
  const path = env.UMPIRE_CONFIG_FILE;
  const file = path ? (JSON.parse(readFileSync(path, 'utf8')) as UmpireConfigFile) : {};
  return umpireConfigFromEnv(env, file);
}
