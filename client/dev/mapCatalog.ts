import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { HARD_LIMITS, importAsset } from '../../packages/maps/src/index.js';
import type { MapRef, MapSummary } from '../src/game-setup/contracts.js';

const prefix = '/__local/maps';
const validId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(id);

interface Options {
  premadeDirectory?: string;
  generatedDirectory?: string;
  newId?: () => string;
}
class CatalogError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}
async function boundedFile(path: string): Promise<string> {
  if ((await stat(path)).size > HARD_LIMITS.maxBytes)
    throw new CatalogError(400, 'Map exceeds the 64 MiB import limit');
  const text = await readFile(path, 'utf8');
  if (Buffer.byteLength(text) > HARD_LIMITS.maxBytes)
    throw new CatalogError(400, 'Map exceeds the 64 MiB import limit');
  return text;
}
function summary(json: string, ref: MapRef, name?: string): MapSummary {
  const asset = importAsset(json);
  return {
    ref,
    name: name ?? asset.name,
    widthM: asset.settings.widthM,
    heightM: asset.settings.heightM,
  };
}
async function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let failed = false;
    req.on('data', (chunk: Buffer) => {
      if (failed) return;
      bytes += chunk.length;
      if (bytes > HARD_LIMITS.maxBytes) {
        failed = true;
        chunks.length = 0;
        // Drain the request without destroying the socket used for the 400 response.
        reject(new CatalogError(400, 'Map exceeds the 64 MiB import limit'));
      } else chunks.push(chunk);
    });
    req.once('end', () => {
      if (!failed) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.once('error', reject);
    req.once('aborted', () => reject(new CatalogError(400, 'Map upload was interrupted')));
  });
}

/** Development-only storage helper. Import validity is not complete certification. */
export function mapCatalogPlugin(options: Options = {}): Plugin {
  const premade =
    options.premadeDirectory ?? fileURLToPath(new URL('../../data/maps/', import.meta.url));
  const generated =
    options.generatedDirectory ??
    fileURLToPath(new URL('../../.local/generated-maps/', import.meta.url));
  const newId = options.newId ?? randomUUID;
  return {
    name: 'local-map-catalog',
    apply: 'serve',
    configureServer(server) {
      const log = (message: string, error: unknown) =>
        server.config.logger.warn(
          `[local-map-catalog] ${message}: ${error instanceof Error ? error.message : String(error)}`,
        );
      const entries = async (): Promise<{ id: string; name: string; filename: string }[]> => {
        const data: unknown = JSON.parse(await boundedFile(join(premade, 'catalog.json')));
        if (!Array.isArray(data)) throw new Error('Premade catalog must be an array');
        const seen = new Set<string>();
        return data.map((entry) => {
          if (!entry || typeof entry !== 'object') throw new Error('Invalid premade catalog entry');
          const { id, name, filename } = entry;
          // Even committed filenames are basenames, never path inputs.
          if (
            !validId(id) ||
            seen.has(id) ||
            typeof name !== 'string' ||
            !name.trim() ||
            filename !== `${id}.json`
          )
            throw new Error('Invalid or duplicate premade catalog entry');
          seen.add(id);
          return { id, name, filename };
        });
      };
      const list = async (): Promise<MapSummary[]> => {
        const result: MapSummary[] = [];
        for (const entry of await entries()) {
          try {
            result.push(
              summary(
                await boundedFile(join(premade, entry.filename)),
                { kind: 'premade', id: entry.id },
                entry.name,
              ),
            );
          } catch (error) {
            log(`Omitting premade map ${entry.id}`, error);
          }
        }
        let files: string[];
        try {
          files = await readdir(generated);
        } catch (error) {
          if (missing(error)) return result;
          throw error;
        }
        for (const filename of files.sort()) {
          const id = filename.slice(0, -5);
          if (!filename.endsWith('.json') || !validId(id)) {
            log(
              `Omitting generated file ${filename}`,
              new Error('Expected a map ID.json filename'),
            );
            continue;
          }
          try {
            result.push(
              summary(await boundedFile(join(generated, filename)), { kind: 'generated', id }),
            );
          } catch (error) {
            log(`Omitting generated map ${id}`, error);
          }
        }
        return result;
      };
      const read = async (kind: string, id: string): Promise<string> => {
        if (!validId(id) || !['premade', 'generated'].includes(kind))
          throw new CatalogError(400, 'Invalid map reference');
        let filename = `${id}.json`;
        let name: string | undefined;
        if (kind === 'premade') {
          const entry = (await entries()).find((entry) => entry.id === id);
          if (!entry) throw new CatalogError(404, 'Map was not found');
          filename = entry.filename;
          name = entry.name;
        }
        let json: string;
        try {
          json = await boundedFile(join(kind === 'premade' ? premade : generated, filename));
        } catch (error) {
          if (missing(error)) throw new CatalogError(404, 'Map was not found');
          throw error;
        }
        // Reads of corrupt local files remain explicit, rather than returning unusable JSON.
        try {
          summary(json, { kind: kind as MapRef['kind'], id }, name);
        } catch {
          throw new CatalogError(400, 'Saved map is invalid; choose another map');
        }
        return json;
      };
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0]!;
        if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return next();
        const send = (status: number, value: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(value));
        };
        void (async () => {
          if (pathname === prefix && req.method === 'GET') return send(200, await list());
          if (pathname === prefix && req.method === 'POST') {
            const json = await body(req);
            let saved: MapSummary;
            try {
              saved = summary(json, { kind: 'generated', id: '' });
            } catch {
              throw new CatalogError(400, 'Map JSON is invalid or exceeds import limits');
            }
            const id = newId();
            if (!validId(id)) throw new Error('Storage generated an invalid map ID');
            await mkdir(generated, { recursive: true });
            // Exclusive creation: an ID collision is an error, never an overwrite or retry.
            await writeFile(join(generated, `${id}.json`), json, { encoding: 'utf8', flag: 'wx' });
            saved = { ...saved, ref: { kind: 'generated', id } };
            return send(201, saved);
          }
          const parts = pathname.slice(prefix.length + 1).split('/');
          if (req.method !== 'GET' || parts.length !== 2)
            throw new CatalogError(400, 'Unsupported map catalog request');
          let kind: string, id: string;
          try {
            [kind, id] = parts.map(decodeURIComponent) as [string, string];
          } catch {
            throw new CatalogError(400, 'Invalid map reference encoding');
          }
          const json = await read(kind, id);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(json);
        })().catch((error: unknown) => {
          if (!(error instanceof CatalogError)) log('Catalog request failed', error);
          if (!res.destroyed && !res.writableEnded)
            send(error instanceof CatalogError ? error.status : 500, {
              error:
                error instanceof CatalogError
                  ? error.message
                  : 'Could not access local map storage; check the development server log and directory permissions',
            });
        });
      });
    },
  };
}
