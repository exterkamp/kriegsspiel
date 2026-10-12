import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMapCatalogHandler, type MapCatalogOptions } from './handler.js';

/** Explicit opt-in only; importing this module never opens a listening socket. */
export async function startLocalMapCatalog(
  env: NodeJS.ProcessEnv = process.env,
  options: MapCatalogOptions = {},
): Promise<Server | undefined> {
  if (env.LOCAL_MAP_CATALOG !== '1') return undefined;
  const portText = env.PORT;
  if (!portText || !/^[0-9]+$/.test(portText))
    throw new Error('Local map catalog requires PORT to be an integer from 1 to 65535');
  const port = Number(portText);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error('Local map catalog requires PORT to be an integer from 1 to 65535');

  const server = createServer(createMapCatalogHandler(options));
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => {
      server.removeListener('listening', listening);
      reject(error);
    };
    const listening = () => {
      server.removeListener('error', failed);
      resolve();
    };
    server.once('error', failed);
    server.once('listening', listening);
    server.listen(port, '127.0.0.1');
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void startLocalMapCatalog().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
