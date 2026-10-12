import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startLocalMapCatalog } from './serve.js';

let directory: string;
let premade: string;
let generated: string;
const servers = new Set<Server>();

async function close(server: Server): Promise<void> {
  if (server.listening)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  servers.delete(server);
}

async function reservePort(): Promise<Server> {
  const server = createServer();
  servers.add(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

function portOf(server: Server): string {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  return String(address.port);
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'kriegsspiel-catalog-start-'));
  premade = join(directory, 'premade');
  generated = join(directory, 'generated');
  await mkdir(premade);
  await writeFile(join(premade, 'catalog.json'), '[]');
});

afterEach(async () => {
  for (const server of servers) await close(server);
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

it('requires an exact explicit opt-in and leaves disabled startup inert', async () => {
  for (const LOCAL_MAP_CATALOG of [undefined, '', '0', 'true', 'yes', ' 1', '1 ']) {
    expect(await startLocalMapCatalog({ LOCAL_MAP_CATALOG, PORT: 'invalid' })).toBeUndefined();
  }
});

it('requires a valid port with no default or ephemeral-port fallback', async () => {
  for (const PORT of [
    undefined,
    '',
    '0',
    '-1',
    '65536',
    '3000x',
    '1.5',
    ' 3000',
    '3000 ',
    '+3000',
    '1e3',
    'Infinity',
    '9007199254740993',
  ]) {
    await expect(startLocalMapCatalog({ LOCAL_MAP_CATALOG: '1', PORT })).rejects.toThrow(
      'requires PORT to be an integer from 1 to 65535',
    );
  }
});

it('binds only IPv4 loopback, serves HTTP and releases its socket on close', async () => {
  const reserved = await reservePort();
  const PORT = portOf(reserved);
  await close(reserved);
  const server = await startLocalMapCatalog(
    { LOCAL_MAP_CATALOG: '1', PORT },
    { premadeDirectory: premade, generatedDirectory: generated },
  );
  if (!server) throw new Error('Catalog did not start');
  servers.add(server);
  expect(server.address()).toEqual({ address: '127.0.0.1', family: 'IPv4', port: Number(PORT) });
  const response = await fetch(`http://127.0.0.1:${PORT}/__local/maps`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([]);
  await close(server);
  expect(server.listening).toBe(false);
  // Rebinding the same port proves close released the listener.
  const replacement = await startLocalMapCatalog(
    { LOCAL_MAP_CATALOG: '1', PORT },
    { premadeDirectory: premade, generatedDirectory: generated },
  );
  if (!replacement) throw new Error('Catalog did not restart');
  servers.add(replacement);
});

it('rejects a real listen failure without taking over an occupied socket', async () => {
  const blocker = await reservePort();
  await expect(
    startLocalMapCatalog(
      { LOCAL_MAP_CATALOG: '1', PORT: portOf(blocker) },
      { premadeDirectory: premade, generatedDirectory: generated },
    ),
  ).rejects.toMatchObject({ code: 'EADDRINUSE' });
  expect(blocker.listening).toBe(true);
});

it('does not listen on module import even with valid opt-in environment', async () => {
  const reserved = await reservePort();
  const PORT = portOf(reserved);
  vi.stubEnv('LOCAL_MAP_CATALOG', '1');
  vi.stubEnv('PORT', PORT);
  vi.resetModules();
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const exitCode = process.exitCode;
  try {
    await expect(import('./serve.js')).resolves.toHaveProperty('startLocalMapCatalog');
    // Accidental startup on the reserved port would fail asynchronously and log an error.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(error).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(exitCode);
  } finally {
    error.mockRestore();
    process.exitCode = exitCode;
  }
  await close(reserved);
  const server = await startLocalMapCatalog(
    { LOCAL_MAP_CATALOG: '1', PORT },
    { premadeDirectory: premade, generatedDirectory: generated },
  );
  if (!server) throw new Error('Catalog did not start after import');
  servers.add(server);
});
