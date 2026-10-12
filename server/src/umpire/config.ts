import { readFileSync } from 'node:fs';
import type { StructuredOutputSupport } from './provider.js';
import type { GameLimits } from './gameLimits.js';
import type { UmpireStage } from './umpireClient.js';
import { TEST_MODEL } from './providers/test.js';

export const UMPIRE_STAGES: readonly UmpireStage[] = [
  'parse',
  'judge',
  'narrate',
  'staff',
  'command',
];

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
  /**
   * Provider id (a `test` provider) that answers when a stage's own provider fails, so the game continues. Set when
   * `UMPIRE_KEYLESS_PROVIDER=ollama`; `createUmpireClient` wraps the stages that use a local model.
   */
  fallbackProvider?: string;
}

/**
 * The stages `UMPIRE_KEYLESS_PROVIDER=ollama` hands to the local model (`OLLAMA_STAGES` overrides); the rest stay on `test`.
 * Parse is left out by default: on the order corpus the models that fit this host parse no clear order into the
 * expected intents (see docs/llm-providers.md), while narration and staff advice pass their checks.
 */
export const OLLAMA_DEFAULT_STAGES: readonly UmpireStage[] = ['narrate', 'staff'];
const OLLAMA_ELIGIBLE: readonly UmpireStage[] = ['parse', 'narrate', 'staff'];

function ollamaStages(env: Env): readonly UmpireStage[] {
  const raw = env.OLLAMA_STAGES?.trim();
  if (!raw) return OLLAMA_DEFAULT_STAGES;
  const names = raw.split(',').map((x) => x.trim());
  const bad = names.filter((n) => !OLLAMA_ELIGIBLE.includes(n as UmpireStage));
  if (bad.length) {
    throw new Error(
      `OLLAMA_STAGES: "${bad.join(', ')}" is not one of ${OLLAMA_ELIGIBLE.join(', ')}`,
    );
  }
  return names as UmpireStage[];
}
export const OLLAMA_DEFAULT_MODEL = 'qwen2.5:0.5b';
/** A CPU model answers in seconds to a minute, so the call timeout is generous. */
export const OLLAMA_DEFAULT_TIMEOUT_MS = 60_000;
export const OLLAMA_DEFAULT_NUM_CTX = 4096;

export const DEFAULT_UMPIRE_CONFIG: UmpireConfig = {
  providers: { anthropic: { type: 'anthropic' }, test: { type: 'test' } },
  stages: {
    parse: { provider: 'anthropic', model: 'claude-haiku-5-5' },
    judge: { provider: 'anthropic', model: 'claude-opus-5-5' },
    narrate: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    staff: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    command: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
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
 * Builds the config: defaults, then the optional file, then env overrides. Env reads `UMPIRE_PROVIDER` (every
 * stage; `test` answers with canned responses), `UMPIRE_KEYLESS_PROVIDER` (the provider for stages that would use
 * Anthropic with no API key; `ollama` serves parse, narrate and staff from a local model with `test` as the fallback, configured by
 * `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_STAGES`, `OLLAMA_NUM_CTX` and `OLLAMA_TIMEOUT_MS`), `UMPIRE_PROVIDER_PARSE|JUDGE|NARRATE|STAFF|COMMAND`, `UMPIRE_MODEL_PARSE|JUDGE|NARRATE|STAFF|COMMAND`, `UMPIRE_TIMEOUT_MS`,
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
  const keylessOllama = env.UMPIRE_KEYLESS_PROVIDER === 'ollama';
  if (keylessOllama && !file.providers?.ollama) {
    providers.ollama = {
      type: 'ollama',
      ...(env.OLLAMA_URL ? { baseUrl: env.OLLAMA_URL } : {}),
      numCtx: positiveInt(env, 'OLLAMA_NUM_CTX', OLLAMA_DEFAULT_NUM_CTX),
    };
  }
  const onOllama = ollamaStages(env);
  let usesOllama = false;
  const stages = { ...d.stages, ...file.stages } as Record<UmpireStage, StageRoute>;
  for (const stage of UMPIRE_STAGES) {
    const key = stage.toUpperCase();
    const route = stages[stage];
    const provider = env[`UMPIRE_PROVIDER_${key}`] || env.UMPIRE_PROVIDER || route.provider;
    const spec = providers[provider];
    // A keyless Anthropic stage runs on the fallback provider, if one is named (the Docker demo names `test`).
    const keyless =
      !env[`UMPIRE_PROVIDER_${key}`] &&
      !env.UMPIRE_PROVIDER &&
      env.UMPIRE_KEYLESS_PROVIDER &&
      spec?.type === 'anthropic' &&
      !env[spec.apiKeyEnv ?? 'ANTHROPIC_API_KEY'];
    // The local model serves the stages it can; the others run on the canned provider.
    const chosen = keyless
      ? keylessOllama && !onOllama.includes(stage)
        ? 'test'
        : (env.UMPIRE_KEYLESS_PROVIDER as string)
      : provider;
    const local = Boolean(keyless) && chosen === 'ollama';
    usesOllama ||= local;
    stages[stage] = {
      ...route,
      provider: chosen,
      // The test provider has one model name; other providers keep the route's unless env overrides it.
      model:
        env[`UMPIRE_MODEL_${key}`] ||
        (providers[chosen]?.type === 'test'
          ? TEST_MODEL
          : local
            ? env.OLLAMA_MODEL || OLLAMA_DEFAULT_MODEL
            : route.model),
      // Low temperature and short outputs suit a tiny model.
      ...(local ? { params: { temperature: 0.2, maxTokens: stage === 'parse' ? 400 : 700 } } : {}),
    };
    if (!providers[stages[stage].provider]) {
      throw new Error(
        `stage "${stage}" uses provider "${stages[stage].provider}", which is not configured`,
      );
    }
  }

  // One CPU model answers one call at a time; queueing more only makes every call slower.
  const maxConcurrent = positiveInt(
    env,
    'UMPIRE_MAX_CONCURRENT',
    file.rateLimit?.maxConcurrent ?? (usesOllama ? 1 : 0),
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
    timeoutMs: positiveInt(
      env,
      'UMPIRE_TIMEOUT_MS',
      file.timeoutMs ??
        (usesOllama
          ? positiveInt(env, 'OLLAMA_TIMEOUT_MS', OLLAMA_DEFAULT_TIMEOUT_MS)
          : d.timeoutMs),
    ),
    maxAttempts: positiveInt(
      env,
      'UMPIRE_MAX_ATTEMPTS',
      file.maxAttempts ?? (usesOllama ? 2 : d.maxAttempts),
    ),
    ...(usesOllama ? { fallbackProvider: 'test' } : {}),
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
