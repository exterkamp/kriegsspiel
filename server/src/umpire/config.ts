import type { UmpireStage } from './umpireClient.js';

export interface UmpireConfig {
  models: Record<UmpireStage, string>;
  /** Per-attempt timeout. */
  timeoutMs: number;
  /** Total attempts including the first. */
  maxAttempts: number;
  /** Backoff before retry n is `min(maxBackoffMs, baseBackoffMs * 2^(n-1))`, with jitter. */
  baseBackoffMs: number;
  maxBackoffMs: number;
}

export const DEFAULT_UMPIRE_CONFIG: UmpireConfig = {
  models: { parse: 'claude-sonnet-5-5', judge: 'claude-opus-5-5', narrate: 'claude-sonnet-5-5' },
  timeoutMs: 60_000,
  maxAttempts: 3,
  baseBackoffMs: 500,
  maxBackoffMs: 8_000,
};

function positiveInt(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return n;
}

/**
 * Reads `UMPIRE_MODEL_PARSE|JUDGE|NARRATE`, `UMPIRE_TIMEOUT_MS`, `UMPIRE_MAX_ATTEMPTS`,
 * `UMPIRE_BASE_BACKOFF_MS` and `UMPIRE_MAX_BACKOFF_MS`. Unset values keep the defaults.
 */
export function umpireConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): UmpireConfig {
  const d = DEFAULT_UMPIRE_CONFIG;
  return {
    models: {
      parse: env.UMPIRE_MODEL_PARSE || d.models.parse,
      judge: env.UMPIRE_MODEL_JUDGE || d.models.judge,
      narrate: env.UMPIRE_MODEL_NARRATE || d.models.narrate,
    },
    timeoutMs: positiveInt(env, 'UMPIRE_TIMEOUT_MS', d.timeoutMs),
    maxAttempts: positiveInt(env, 'UMPIRE_MAX_ATTEMPTS', d.maxAttempts),
    baseBackoffMs: positiveInt(env, 'UMPIRE_BASE_BACKOFF_MS', d.baseBackoffMs),
    maxBackoffMs: positiveInt(env, 'UMPIRE_MAX_BACKOFF_MS', d.maxBackoffMs),
  };
}
