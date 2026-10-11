/**
 * Entry point. Environment:
 *   PORT                listen port (default 3000)
 *   HOST                listen address (default 127.0.0.1; the container sets 0.0.0.0)
 *   DB_PATH             SQLite file for durable games; unset keeps games in memory
 *   STATIC_DIR          built client to serve at `/`; unset serves the API only
 *   SCRIPTED_OPPONENTS  scripted sides are played by the built-in opponent unless `0`, `false` or `off`
 *   ADMIN_ENABLED       `1`/`true`/`on` mounts the read-only /admin/api (loopback only unless ADMIN_TOKEN is set)
 *   PUBLIC_URL          origin used in login links (default http://localhost:$PORT); https makes the session cookie Secure
 *   MAIL_WEBHOOK_URL    POST `{to, subject, text}` here to send the magic link; unset logs the link instead (dev only)
 *   MAIL_WEBHOOK_TOKEN  optional bearer token for the mail webhook
 *   ADMIN_TOKEN         lets non-loopback callers use /admin/api with this bearer token
 */
import { buildApp } from './api/app.js';
import { adminFromEnv } from './admin/adminApi.js';
import { SqliteAuthStore } from './auth/store.js';
import { SqliteLobbyStore } from './lobby/store.js';
import { authFromEnv, scriptedOpponentsFromEnv, trustProxyFromEnv } from './config.js';
import { SqliteGameStore } from './game/index.js';
import { StubOrderParser } from './orders/stubParser.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const store = process.env.DB_PATH ? new SqliteGameStore(process.env.DB_PATH) : undefined;

const authStore = process.env.DB_PATH ? new SqliteAuthStore(process.env.DB_PATH) : undefined;

const lobby = process.env.DB_PATH ? new SqliteLobbyStore(process.env.DB_PATH) : undefined;

const { server } = await buildApp({
  parser: new StubOrderParser(),
  store,
  lobby,
  staticDir: process.env.STATIC_DIR,
  logger: true,
  scriptedOpponents: scriptedOpponentsFromEnv(process.env),
  admin: adminFromEnv(process.env),
  trustProxy: trustProxyFromEnv(process.env),
  auth: { store: authStore, ...authFromEnv(process.env, port, (line) => server.log.warn(line)) },
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(
    signal,
    () =>
      void server.close().then(() => {
        store?.close();
        authStore?.close();
        lobby?.close();
        process.exit(0);
      }),
  );
}

await server.listen({ port, host });
