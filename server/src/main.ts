/**
 * Entry point. Environment:
 *   PORT                listen port (default 3000)
 *   HOST                listen address (default 127.0.0.1; the container sets 0.0.0.0)
 *   DB_PATH             SQLite file for durable games; unset keeps games in memory
 *   STATIC_DIR          built client to serve at `/`; unset serves the API only
 *   SPA_FALLBACK        on by default with STATIC_DIR: serves index.html for the client's routes and redirects the old *.html pages; `0`/`false`/`off` disables it
 *   SCRIPTED_OPPONENTS  scripted sides are played by the built-in opponent unless `0`, `false` or `off`
 *   AI_COMMANDER        `llm` plays scripted sides with the LLM commander (needs a provider key, see docs/llm-providers.md); AI_DIFFICULTY easy|normal|hard, AI_PERSONALITY cautious|balanced|aggressive
 *   ORDER_PARSER        `stub` forces the rule-based order parser; otherwise the LLM parses orders whenever the parse stage's provider is configured (ANTHROPIC_API_KEY for the default)
 *   ADMIN_ENABLED       `1`/`true`/`on` mounts the read-only /admin/api (loopback only unless ADMIN_TOKEN is set)
 *   ALLOWED_ORIGINS     extra origins (comma-separated) allowed to open a game WebSocket; * allows any (default: PUBLIC_URL and the request's own Host)
 *   PUBLIC_URL          origin used in login links (default http://localhost:$PORT); https makes the session cookie Secure
 *   MAIL_WEBHOOK_URL    POST `{to, subject, text}` here to send the magic link; unset logs the link instead (dev only)
 *   MAIL_WEBHOOK_TOKEN  optional bearer token for the mail webhook
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT  enable web push (generate a pair with `npx web-push generate-vapid-keys`); unset: email and WebSocket only
 *   ADMIN_OPEN         `1` (with ADMIN_ENABLED) lets any caller use /admin with no token; refused under NODE_ENV=production unless ADMIN_OPEN_FORCE=1
 *   ADMIN_TOKEN         lets non-loopback callers use /admin/api with this bearer token
 */
import { buildApp } from './api/app.js';
import { ADMIN_OPEN_WARNING, adminFromEnv } from './admin/adminApi.js';
import { SqliteNotifyStore, pushFromEnv } from './notify/index.js';
import { allowedOriginsFromEnv } from './auth/origin.js';
import { SqliteAuthStore } from './auth/store.js';
import { SqliteLobbyStore } from './lobby/store.js';
import {
  aiCommanderBudgetWarning,
  aiCommanderFromEnv,
  authFromEnv,
  devToolsFromEnv,
  guestIdleMsFromEnv,
  guestPerHourFromEnv,
  guestPlayFromEnv,
  llmOrderParserEnabled,
  turnUmpireEnabled,
  scriptedOpponentsFromEnv,
  trustProxyFromEnv,
  usesTestUmpire,
} from './config.js';
import { SqliteGameStore } from './game/index.js';
import { llmAgents } from './opponent/index.js';
import { LlmOrderParser } from './orders/llmParser.js';
import { StubOrderParser } from './orders/stubParser.js';
import { TraceStore, traceUmpire } from './debug/index.js';
import { OrderPlayground } from './admin/orderDebug.js';
import type { UmpireClient } from './umpire/index.js';
import { GameClients, orderParserFor } from './umpire/gameClients.js';
import {
  createGameUmpire,
  createUmpireClient,
  loadUmpireConfig,
  umpireConfigFromEnv,
} from './umpire/index.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const store = process.env.DB_PATH ? new SqliteGameStore(process.env.DB_PATH) : undefined;

const authStore = process.env.DB_PATH ? new SqliteAuthStore(process.env.DB_PATH) : undefined;

const notifyStore = process.env.DB_PATH ? new SqliteNotifyStore(process.env.DB_PATH) : undefined;
const lobby = process.env.DB_PATH ? new SqliteLobbyStore(process.env.DB_PATH) : undefined;

// The LLM umpire, when a provider is configured or the LLM commander is asked for: one capped
// client per game over the shared one, used by both the order parser and the commander.
const ai = aiCommanderFromEnv(process.env);
const loadedConfig = loadUmpireConfig(process.env);
const llmParser = llmOrderParserEnabled(process.env, loadedConfig);
// The turn umpire is on only with a capable model on `adjudicate` (the keyless demo stays on the engine).
const turnUmpire = turnUmpireEnabled(process.env, loadedConfig);
const umpireConfig = ai || llmParser || turnUmpire ? loadedConfig : undefined;
if (ai && umpireConfig) {
  const warning = aiCommanderBudgetWarning(umpireConfig.gameBudget);
  if (warning) console.warn(warning);
}
// Test-provider calls are traced as such, so the admin LLM panel labels them.
const admin = adminFromEnv(process.env);
const trace = admin.enabled ? new TraceStore() : undefined;
const umpire = umpireConfig
  ? createUmpireClient({
      config: umpireConfig,
      onFallback: (f) =>
        server.log.warn(
          { stage: f.stage, kind: f.kind, reason: f.reason },
          'umpire fallback to test provider',
        ),
    })
  : undefined;
const tracedUmpire = (client: UmpireClient, gameId: string): UmpireClient =>
  trace ? traceUmpire(client, { trace, gameId, mode: 'live' }) : client;
// With a local model on `parse`, an order it cannot place is retried by the canned test parser before the stub.
// The test provider is also the canned parser the admin playground compares against (#395).
const testUmpire = createUmpireClient({
  config: umpireConfigFromEnv({ UMPIRE_PROVIDER: 'test' }),
  env: {},
});
const cannedParser = umpireConfig?.fallbackProvider
  ? (gameId: string) =>
      new LlmOrderParser(tracedUmpire(testUmpire, gameId), {
        fallbackParser: new StubOrderParser(),
      })
  : undefined;
const gameClients = new GameClients((gameId) =>
  createGameUmpire(tracedUmpire(umpire!, gameId), {
    gameId,
    limits: umpireConfig?.gameBudget,
    onMetric: (m) => server.log.info({ umpire: m }, 'umpire call'),
  }),
);
const gameUmpire = (gameId: string) => gameClients.get(gameId);

const { server } = await buildApp({
  parser: orderParserFor({
    llm: llmParser,
    clientFor: gameUmpire,
    cannedParser,
    onFallback: (gameId, reason) => server.log.warn({ gameId, reason }, 'order parser fallback'),
    trace,
  }),
  onGameDone: (gameId) => {
    const report = gameClients.peek(gameId)?.report();
    if (report) server.log.info({ gameId, umpire: report }, 'umpire cost for game');
    gameClients.evict(gameId);
  },
  store,
  lobby,
  staticDir: process.env.STATIC_DIR,
  spaFallback: !/^(0|false|off)$/i.test(process.env.SPA_FALLBACK ?? ''),
  logger: true,
  scriptedOpponents: scriptedOpponentsFromEnv(process.env),
  aiAgents:
    ai && umpire
      ? (gameId, world, scripted) => {
          const client = gameUmpire(gameId);
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
  // Not with the turn umpire alone: turning it on changes only how turns are decided.
  narrator:
    umpire && (ai || llmParser)
      ? // The same client as the parser's, so one game has one budget.
        (gameId) => gameUmpire(gameId)
      : undefined,
  critic: umpire && (ai || llmParser) ? (gameId) => gameUmpire(gameId) : undefined,
  adjudicator: umpire && turnUmpire ? (gameId) => gameUmpire(gameId) : undefined,
  admin: {
    ...admin,
    trace,
    // Dry runs use their own client from the same config: no game budget, no fallback (#395).
    playground: admin.enabled
      ? new OrderPlayground({ config: umpireConfig ?? loadedConfig, cannedClient: testUmpire })
      : undefined,
  },
  testUmpire: umpireConfig ? usesTestUmpire(umpireConfig) : false,
  trustProxy: trustProxyFromEnv(process.env),
  notify: { store: notifyStore, push: pushFromEnv(process.env) },
  auth: {
    store: authStore,
    ...authFromEnv(process.env, port, (line) => server.log.warn(line)),
    guestPlay: guestPlayFromEnv(process.env),
    allowedOrigins: allowedOriginsFromEnv(process.env),
    devTools: devToolsFromEnv(process.env),
    guestIdleMs: guestIdleMsFromEnv(process.env),
    guestPerIp: guestPerHourFromEnv(process.env),
  },
});

if (admin.open) server.log.warn(ADMIN_OPEN_WARNING);

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
