/**
 * Entry point. Environment:
 *   PORT        listen port (default 3000)
 *   HOST        listen address (default 127.0.0.1; the container sets 0.0.0.0)
 *   DB_PATH     SQLite file for durable games; unset keeps games in memory
 *   STATIC_DIR  built client to serve at `/`; unset serves the API only
 */
import { buildApp } from './api/app.js';
import { SqliteGameStore } from './game/index.js';
import { StubOrderParser } from './orders/stubParser.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const store = process.env.DB_PATH ? new SqliteGameStore(process.env.DB_PATH) : undefined;

const { server } = await buildApp({
  parser: new StubOrderParser(),
  store,
  staticDir: process.env.STATIC_DIR,
  logger: true,
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(
    signal,
    () =>
      void server.close().then(() => {
        store?.close();
        process.exit(0);
      }),
  );
}

await server.listen({ port, host });
