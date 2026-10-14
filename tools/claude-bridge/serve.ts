import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { BlockList, isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KILL_GRACE_MS, runClaude } from './claude.js';
import { createBridgeHandler } from './handler.js';

/** The docker0 gateway: the container reaches the host here, and other LAN hosts cannot. */
export const DEFAULT_HOST = '172.17.0.1';
export const DEFAULT_PORT = 8790;

export interface BridgeConfig {
  host: string;
  port: number;
  secret?: string;
  bin: string;
  maxConcurrent: number;
  maxQueue: number;
  timeoutMs: number;
  billing: 'subscription' | 'api';
}

/** `0.0.0.0` and `::` in any spelling (`::0`, `0:0:0:0:0:0:0:0`, ...). */
const unspecified = new BlockList();
unspecified.addAddress('0.0.0.0', 'ipv4');
unspecified.addAddress('::', 'ipv6');
const isUnspecified = (host: string) =>
  isIP(host) !== 0 && unspecified.check(host, isIP(host) === 6 ? 'ipv6' : 'ipv4');

const isLoopback = (host: string) => host === 'localhost' || host === '::1' || /^127\./.test(host);

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return n;
}

/**
 * Reads `CLAUDE_BRIDGE_HOST` (default the docker0 gateway), `CLAUDE_BRIDGE_PORT` (8790),
 * `CLAUDE_BRIDGE_SECRET`, `CLAUDE_BIN` (`claude`), `CLAUDE_BRIDGE_MAX_CONCURRENT` (2),
 * `CLAUDE_BRIDGE_MAX_QUEUE` (16), `CLAUDE_BRIDGE_TIMEOUT_MS` (300000) and `CLAUDE_BRIDGE_BILLING`
 * (`subscription` or `api`). A bind beyond the loopback needs a secret: the bridge spends the host's
 * Claude subscription, so it must not answer anyone else who can route to the address.
 */
export function bridgeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const host = env.CLAUDE_BRIDGE_HOST?.trim() || DEFAULT_HOST;
  if (host !== 'localhost' && !isIP(host))
    throw new Error(`CLAUDE_BRIDGE_HOST must be an IP address, got "${host}"`);
  if (isUnspecified(host)) {
    throw new Error(
      'CLAUDE_BRIDGE_HOST must not be every interface; bind the docker0 gateway or the loopback',
    );
  }
  const secret = env.CLAUDE_BRIDGE_SECRET?.trim() || undefined;
  if (!secret && !isLoopback(host)) {
    throw new Error(
      `CLAUDE_BRIDGE_SECRET is required to listen on ${host}; set the same value for the game server (see docs/llm-providers.md)`,
    );
  }
  if (secret && secret.length < 16)
    throw new Error('CLAUDE_BRIDGE_SECRET must be at least 16 characters');
  const billing = env.CLAUDE_BRIDGE_BILLING?.trim() || 'subscription';
  if (billing !== 'subscription' && billing !== 'api') {
    throw new Error(`CLAUDE_BRIDGE_BILLING must be subscription or api, got "${billing}"`);
  }
  const port = positiveInt(env, 'CLAUDE_BRIDGE_PORT', DEFAULT_PORT);
  if (port > 65535) throw new Error('CLAUDE_BRIDGE_PORT must be at most 65535');
  return {
    host,
    port,
    ...(secret ? { secret } : {}),
    bin: env.CLAUDE_BIN?.trim() || 'claude',
    maxConcurrent: positiveInt(env, 'CLAUDE_BRIDGE_MAX_CONCURRENT', 2),
    maxQueue: positiveInt(env, 'CLAUDE_BRIDGE_MAX_QUEUE', 16),
    timeoutMs: positiveInt(env, 'CLAUDE_BRIDGE_TIMEOUT_MS', 300_000),
    billing,
  };
}

const log = (line: Record<string, unknown>) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), ...line }));

export async function startBridge(
  config: BridgeConfig,
): Promise<{ server: Server; abortAll: () => Promise<void> }> {
  const { handle, abortAll } = createBridgeHandler({
    run: (req, signal) =>
      runClaude(
        req,
        { bin: config.bin, timeoutMs: config.timeoutMs, billing: config.billing },
        signal,
      ),
    ...(config.secret ? { secret: config.secret } : {}),
    maxConcurrent: config.maxConcurrent,
    maxQueue: config.maxQueue,
    log,
  });
  const server = createServer((req, res) => void handle(req, res));
  // Calls run for minutes (a whole turn); the server's own timeout decides when to give up.
  server.requestTimeout = 0;
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(config.port, config.host, () => {
      server.removeListener('error', fail);
      done();
    });
  });
  return { server, abortAll };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = bridgeConfigFromEnv();
    const { server, abortAll } = await startBridge(config);
    execFile(config.bin, ['--version'], (err, out) =>
      log(
        err
          ? { event: 'warning', message: `"${config.bin} --version" failed: ${err.message}` }
          : { event: 'cli', version: out.trim() },
      ),
    );
    log({
      event: 'listening',
      url: `http://${config.host}:${config.port}`,
      secret: Boolean(config.secret),
      maxConcurrent: config.maxConcurrent,
      timeoutMs: config.timeoutMs,
      billing: config.billing,
    });
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      server.close();
      // Wait for the killed runs to finish (SIGKILL after the grace, temp dirs removed), but not forever.
      const cap = new Promise<void>((r) => setTimeout(r, KILL_GRACE_MS + 1_000).unref());
      void Promise.race([abortAll(), cap]).then(() => {
        server.closeAllConnections();
        process.exit(0);
      });
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    console.error(
      e.code === 'EADDRNOTAVAIL'
        ? `${e.message}: no such address on this host (is Docker running? set CLAUDE_BRIDGE_HOST=127.0.0.1 to run without it)`
        : e.message,
    );
    process.exitCode = 1;
  }
}
