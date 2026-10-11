/**
 * Entry point. Environment:
 *   PORT                listen port (default 3000)
 *   HOST                listen address (default 127.0.0.1; the container sets 0.0.0.0)
 *   DB_PATH             SQLite file for durable games; unset keeps games in memory
 *   STATIC_DIR          built client to serve at `/`; unset serves the API only
 *   SCRIPTED_OPPONENTS  scripted sides are played by the built-in opponent unless `0`, `false` or `off`
 *   AI_COMMANDER        `llm` plays scripted sides with the LLM commander (needs a provider key, see docs/llm-providers.md); AI_DIFFICULTY easy|normal|hard, AI_PERSONALITY cautious|balanced|aggressive
 *   ADMIN_ENABLED       `1`/`true`/`on` mounts the read-only /admin/api (loopback only unless ADMIN_TOKEN is set)
 *   PUBLIC_URL          origin used in login links (default http://localhost:$PORT); https makes the session cookie Secure
 *   MAIL_WEBHOOK_URL    POST `{to, subject, text}` here to send the magic link; unset logs the link instead (dev only)
 *   MAIL_WEBHOOK_TOKEN  optional bearer token for the mail webhook
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT  enable web push (generate a pair with `npx web-push generate-vapid-keys`); unset: email and WebSocket only
 *   ADMIN_TOKEN         lets non-loopback callers use /admin/api with this bearer token
 */
import { buildApp } from './api/app.js';
import { adminFromEnv } from './admin/adminApi.js';
import { SqliteNotifyStore, pushFromEnv } from './notify/index.js';
import { SqliteAuthStore } from './auth/store.js';
import { SqliteLobbyStore } from './lobby/store.js';
import {
  aiCommanderBudgetWarning,
  aiCommanderFromEnv,
  authFromEnv,
  guestIdleMsFromEnv,
  guestPlayFromEnv,
  scriptedOpponentsFromEnv,
  trustProxyFromEnv,
} from './config.js';
import { SqliteGameStore } from './game/index.js';
import { llmAgents } from './opponent/index.js';
import { LlmOrderParser } from './orders/llmParser.js';
import { StubOrderParser } from './orders/stubParser.js';
import { createGameUmpire, createUmpireClient, loadUmpireConfig } from './umpire/index.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const store = process.env.DB_PATH ? new SqliteGameStore(process.env.DB_PATH) : undefined;

const authStore = process.env.DB_PATH ? new SqliteAuthStore(process.env.DB_PATH) : undefined;

const notifyStore = process.env.DB_PATH ? new SqliteNotifyStore(process.env.DB_PATH) : undefined;
const lobby = process.env.DB_PATH ? new SqliteLobbyStore(process.env.DB_PATH) : undefined;

// The LLM commander, when asked for: one capped client per game over the shared one.
const ai = aiCommanderFromEnv(process.env);
const umpireConfig = ai ? loadUmpireConfig(process.env) : undefined;
if (ai && umpireConfig) {
  const warning = aiCommanderBudgetWarning(umpireConfig.gameBudget);
  if (warning) console.warn(warning);
}
const umpire = umpireConfig ? createUmpireClient({ config: umpireConfig }) : undefined;

const { server } = await buildApp({
  parser: new StubOrderParser(),
  store,
  lobby,
  staticDir: process.env.STATIC_DIR,
  logger: true,
  scriptedOpponents: scriptedOpponentsFromEnv(process.env),
  aiAgents:
    ai && umpire
      ? (gameId, world, scripted) => {
          const client = createGameUmpire(umpire, {
            gameId,
            limits: umpireConfig?.gameBudget,
            onMetric: (m) => server.log.info({ umpire: m }, 'umpire call'),
          });
          const commanderClient = client.commanderClient();
          const llm = llmAgents(world, {
            ...ai,
            client: commanderClient,
            parser: new LlmOrderParser(commanderClient),
            onNote: (side, note) => server.log.warn({ gameId, side, note }, 'ai commander'),
          });
          return llm.length > 0 ? llm : scripted;
        }
      : undefined,
  narrator:
    umpire && umpireConfig
      ? (gameId) =>
          createGameUmpire(umpire, {
            gameId,
            limits: umpireConfig.gameBudget,
            onMetric: (m) => server.log.info({ umpire: m }, 'umpire call'),
          })
      : undefined,
  admin: adminFromEnv(process.env),
  trustProxy: trustProxyFromEnv(process.env),
  notify: { store: notifyStore, push: pushFromEnv(process.env) },
  auth: {
    store: authStore,
    ...authFromEnv(process.env, port, (line) => server.log.warn(line)),
    guestPlay: guestPlayFromEnv(process.env),
    guestIdleMs: guestIdleMsFromEnv(process.env),
  },
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(
    signal,
    () =>
      void server.close().then(() => {
        store?.close();
        authStore?.close();
        notifyStore?.close();
        lobby?.close();
        process.exit(0);
      }),
  );
}

await server.listen({ port, host });
