/**
 * Entry point: `PORT` (default 3000), `HOST` (default 127.0.0.1) and `SCRIPTED_OPPONENTS` (on unless
 * `0`, `false` or `off`).
 */
import { buildApp } from './api/app.js';
import { scriptedOpponentsFromEnv } from './config.js';
import { StubOrderParser } from './orders/stubParser.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

const { server } = await buildApp({
  parser: new StubOrderParser(),
  logger: true,
  scriptedOpponents: scriptedOpponentsFromEnv(process.env),
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void server.close().then(() => process.exit(0)));
}

await server.listen({ port, host });
