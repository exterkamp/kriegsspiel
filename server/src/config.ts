/** Settings read from the environment by `main.ts`, kept here so tests start the app the same way. */
import { LogMailer, WebhookMailer, type Mailer } from './auth/mailer.js';

/** Scripted sides are played by the built-in opponent unless `SCRIPTED_OPPONENTS` is `0`, `false` or `off`. */
export function scriptedOpponentsFromEnv(env: Record<string, string | undefined>): boolean {
  const v = env.SCRIPTED_OPPONENTS?.trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off');
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
