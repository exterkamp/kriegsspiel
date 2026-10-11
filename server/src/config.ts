/** Settings read from the environment by `main.ts`, kept here so tests start the app the same way. */
import {
  DIFFICULTIES,
  PERSONALITIES,
  type Difficulty,
  type Personality,
} from './opponent/llmCommander.js';
import type { UmpireConfig } from './umpire/index.js';
import { COMMANDER_BUDGET_SHARE, type GameLimits } from './umpire/gameLimits.js';
import { LogMailer, WebhookMailer, type Mailer } from './auth/mailer.js';

/** Scripted sides are played by the built-in opponent unless `SCRIPTED_OPPONENTS` is `0`, `false` or `off`. */
export function scriptedOpponentsFromEnv(env: Record<string, string | undefined>): boolean {
  const v = env.SCRIPTED_OPPONENTS?.trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off');
}

/**
 * `AI_COMMANDER=llm` plays scripted sides with the LLM commander (falling back to the built-in
 * opponent on failure); anything else, or unset, keeps the built-in opponent. `AI_DIFFICULTY`
 * (easy|normal|hard) and `AI_PERSONALITY` (cautious|balanced|aggressive) tune it. Throws on a bad value.
 */
export function aiCommanderFromEnv(
  env: Record<string, string | undefined>,
): { difficulty: Difficulty; personality: Personality } | undefined {
  if (env.AI_COMMANDER?.trim().toLowerCase() !== 'llm') return undefined;
  const pick = <T extends string>(name: string, allowed: readonly T[], dflt: T): T => {
    const v = env[name]?.trim().toLowerCase();
    if (!v) return dflt;
    if (!(allowed as readonly string[]).includes(v)) {
      throw new Error(`${name} must be one of ${allowed.join(', ')}, got "${v}"`);
    }
    return v as T;
  };
  return {
    difficulty: pick('AI_DIFFICULTY', DIFFICULTIES, 'normal'),
    personality: pick('AI_PERSONALITY', PERSONALITIES, 'balanced'),
  };
}

/**
 * A startup warning when the AI commander is on and no per-game cost or token cap is set, since
 * it then spends without a limit. Its share (`COMMANDER_BUDGET_SHARE`) is a share of a cap, so
 * without a cap there is nothing to share. Undefined when a cap exists.
 */
export function aiCommanderBudgetWarning(gameBudget?: GameLimits): string | undefined {
  if (gameBudget?.maxCostUsd !== undefined || gameBudget?.maxTotalTokens !== undefined) {
    return undefined;
  }
  return (
    'AI_COMMANDER=llm is on with no per-game cost cap: the AI commander can spend without limit. ' +
    'Set UMPIRE_GAME_BUDGET_USD or UMPIRE_GAME_BUDGET_TOKENS; the commander is then held to ' +
    `${Math.round(COMMANDER_BUDGET_SHARE * 100)}% of it.`
  );
}

/** `TRUST_PROXY` of `1`, `true` or `on` trusts `X-Forwarded-For`; set it behind a reverse proxy only. */
export function trustProxyFromEnv(env: Record<string, string | undefined>): boolean {
  const v = env.TRUST_PROXY?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}

/** Where login links point, and whether they are mailed or only logged. */
export function authFromEnv(
  env: Record<string, string | undefined>,
  port: number,
  log: (line: string) => void,
): { publicUrl: string; mailer: Mailer } {
  const publicUrl = env.PUBLIC_URL?.trim() || `http://localhost:${port}`;
  const hook = env.MAIL_WEBHOOK_URL?.trim();
  return {
    publicUrl,
    mailer: hook
      ? new WebhookMailer(hook, env.MAIL_WEBHOOK_TOKEN?.trim() || undefined)
      : new LogMailer(log),
  };
}

/**
 * `GUEST_PLAY` of `1`, `true` or `on` lets a visitor start a guest session with no email; `0`, `false`
 * or `off` turns it off. Unset: on outside production, off when `NODE_ENV=production` (D17c).
 */
export function guestPlayFromEnv(env: Record<string, string | undefined>): boolean {
  const v = env.GUEST_PLAY?.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'off') return false;
  return env.NODE_ENV !== 'production';
}

/** `GUEST_IDLE_HOURS` (default 168): how long an unused guest and their games are kept. */
export function guestIdleMsFromEnv(env: Record<string, string | undefined>): number {
  const h = Number(env.GUEST_IDLE_HOURS);
  return (Number.isFinite(h) && h > 0 ? h : 168) * 3_600_000;
}

/**
 * Whether orders are parsed by the LLM: the `parse` stage's provider is usable (Anthropic needs its
 * API key; any other configured provider counts) and `ORDER_PARSER` is not `stub`. Otherwise the
 * rule-based stub parses orders, as in tests and with no key. A non-Anthropic provider is not
 * checked for credentials here: if it is misconfigured, each order fails over to the fallback and
 * logs an `order parser fallback` warning. That trade-off keeps the game playable and the problem visible.
 */
export function llmOrderParserEnabled(
  env: Record<string, string | undefined>,
  config: UmpireConfig,
): boolean {
  if (env.ORDER_PARSER?.trim().toLowerCase() === 'stub') return false;
  const spec = config.providers[config.stages.parse.provider];
  if (!spec) return false;
  return spec.type === 'anthropic' ? Boolean(env[spec.apiKeyEnv ?? 'ANTHROPIC_API_KEY']) : true;
}
