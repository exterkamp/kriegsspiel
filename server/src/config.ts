/** Settings read from the environment by `main.ts`, kept here so tests start the app the same way. */
import {
  DIFFICULTIES,
  PERSONALITIES,
  type Difficulty,
  type Personality,
} from './opponent/llmCommander.js';
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
