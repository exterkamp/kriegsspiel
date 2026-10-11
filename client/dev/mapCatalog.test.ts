import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import {
  createServer,
  request,
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ViteDevServer } from 'vite';
import {
  assetIdentity,
  battlefieldPreset,
  canonicalizeAsset,
  HARD_LIMITS,
  importAsset,
  validateBattlefield,
} from '../../packages/maps/src/index.js';
import { mapCatalogPlugin } from './mapCatalog.js';

const maps = fileURLToPath(new URL('../../data/maps/', import.meta.url));
let directory: string;
let premade: string;
let generated: string;
let server: Server | undefined;
let endpoint: string;
const warn = vi.fn();
let canonical: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'kriegsspiel-catalog-'));
  premade = join(directory, 'premade');
  generated = join(directory, 'generated');
  await mkdir(premade);
  canonical = await readFile(join(maps, 'countryside-rectangle.json'), 'utf8');
  await writeFile(join(premade, 'board.json'), canonical);
  await writeFile(
    join(premade, 'catalog.json'),
    JSON.stringify([{ id: 'board', name: 'A rectangle', filename: 'board.json' }]),
  );
  warn.mockClear();
});
afterEach(async () => {
  if (server?.listening)
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
  server = undefined;
  await rm(directory, { recursive: true, force: true });
});
async function start(options: Parameters<typeof mapCatalogPlugin>[0] = {}) {
  const plugin = mapCatalogPlugin({
    premadeDirectory: premade,
    generatedDirectory: generated,
    ...options,
  });
  const configure = plugin.configureServer as (server: ViteDevServer) => void;
  configure({
    config: { logger: { warn } },
    middlewares: {
      use: (middleware: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => {
        server = createServer((req, res) => {
          // A real HTTP stream exercises body handling and response status/bytes.
          middleware(req, res, () => {
            res.statusCode = 418;
            res.end('next');
          });
        });
      },
    },
  } as unknown as ViteDevServer);
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(0, '127.0.0.1', resolve);
  });
  const address = server!.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  endpoint = `http://127.0.0.1:${address.port}/__local/maps`;
}
const save = (json: string) => fetch(endpoint, { method: 'POST', body: json });

it('lists committed labels/rectangular extents and reads exact bytes without a generated directory', async () => {
  await start();
  expect(await (await fetch(endpoint)).json()).toEqual([
    { ref: { kind: 'premade', id: 'board' }, name: 'A rectangle', widthM: 5000, heightM: 3000 },
  ]);
  expect(await (await fetch(`${endpoint}/premade/board`)).text()).toBe(canonical);
  expect(await readdir(directory)).toEqual(['premade']);
  expect((await fetch(endpoint.replace('/__local/maps', '/elsewhere'))).status).toBe(418);
});

it('saves a large accepted export exactly, lists it and independently imports saved bytes', async () => {
  await start({ newId: () => 'saved-board' });
  const large = await readFile(join(maps, 'wooded-hills.json'), 'utf8');
  expect(Buffer.byteLength(large)).toBeGreaterThan(2 * 1024 * 1024);
  const response = await save(large);
  expect(response.status).toBe(201);
  const summary = await response.json();
  expect(summary).toEqual({
    ref: { kind: 'generated', id: 'saved-board' },
    name: importAsset(large).name,
    widthM: 5000,
    heightM: 5000,
  });
  const bytes = await readFile(join(generated, 'saved-board.json'), 'utf8');
  expect(bytes).toBe(large);
  expect(validateBattlefield(importAsset(bytes)).ok).toBe(true);
  expect(await (await fetch(`${endpoint}/generated/saved-board`)).text()).toBe(bytes);
  expect(await (await fetch(endpoint)).json()).toEqual(expect.arrayContaining([summary]));
});

it('never overwrites an existing file on generated ID collision', async () => {
  await start({ newId: () => 'collision' });
  expect((await save(canonical)).status).toBe(201);
  const different = await readFile(join(maps, 'river-valley.json'), 'utf8');
  const response = await save(different);
  expect(response.status).toBe(500);
  expect(await response.json()).toHaveProperty('error');
  expect(await readFile(join(generated, 'collision.json'), 'utf8')).toBe(canonical);
});

it('omits bad files with a log while individual corrupt reads stay visible', async () => {
  await mkdir(generated);
  await writeFile(join(generated, 'broken.json'), '{');
  await writeFile(join(generated, 'ignored.txt'), 'text');
  await writeFile(join(premade, 'board.json'), '{}');
  await start();
  expect(await (await fetch(endpoint)).json()).toEqual([]);
  expect(warn).toHaveBeenCalledTimes(3);
  expect((await fetch(`${endpoint}/generated/broken`)).status).toBe(400);
  expect((await fetch(`${endpoint}/premade/board`)).status).toBe(400);
});

it('returns 404 for unknown IDs, 400 for malformed/path IDs and saves no malformed input', async () => {
  await start();
  expect((await fetch(`${endpoint}/premade/unknown`)).status).toBe(404);
  expect((await fetch(`${endpoint}/generated/unknown`)).status).toBe(404);
  for (const path of [
    'generated/..%2Foutside',
    'generated/%2Ftmp%2Fmap',
    'generated/%5Coutside',
    'generated/%ZZ',
    'other/board',
  ])
    expect((await fetch(`${endpoint}/${path}`)).status).toBe(400);
  expect((await save('{}')).status).toBe(400);
  expect((await save('{')).status).toBe(400);
  expect(await readdir(directory)).toEqual(['premade']);
});

it('rejects traversal in committed catalog filenames and generated IDs without writing', async () => {
  await writeFile(
    join(premade, 'catalog.json'),
    JSON.stringify([{ id: 'board', name: 'Bad', filename: '../outside.json' }]),
  );
  await start({ newId: () => '../outside' });
  expect((await fetch(endpoint)).status).toBe(500);
  expect((await save(canonical)).status).toBe(500);
  expect(await readdir(directory)).toEqual(['premade']);
});

it('reports filesystem failures explicitly on list and save', async () => {
  await writeFile(generated, 'not a directory');
  await start();
  for (const response of [await fetch(endpoint), await save(canonical)]) {
    expect(response.status).toBe(500);
    expect(await response.json()).toHaveProperty('error');
  }
  expect(warn).toHaveBeenCalledTimes(2);
});

it('caps actual streamed upload bytes at the existing import limit with a 400 response', async () => {
  await start();
  const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(endpoint, { method: 'POST' }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode!, body }));
    });
    req.on('error', reject);
    const block = Buffer.alloc(1024 * 1024, 32);
    for (let i = 0; i < HARD_LIMITS.maxBytes / block.length; i++) req.write(block);
    req.end(' ');
  });
  expect(response.status).toBe(400);
  expect(JSON.parse(response.body).error).toMatch(/64 MiB/);
  expect(await readdir(directory)).toEqual(['premade']);
});

it('committed defaults are canonical, fully certified, pinned recipes with full asset identities', async () => {
  const entries = JSON.parse(await readFile(join(maps, 'catalog.json'), 'utf8')) as {
    id: string;
    filename: string;
  }[];
  const cases = [
    [
      'countryside-rectangle',
      'flat-countryside',
      17,
      3000,
      '26c444cba00bb0320aaaf7605007d9a3557d317d4a3e989e69d3e75146de7c84',
    ],
    [
      'wooded-hills',
      'wooded-hills',
      31,
      5000,
      'ecce44a083ff6f5a616d9ffc6946b5ffa53023092396ba5230836f221c59f4ed',
    ],
    [
      'river-valley',
      'river-valley',
      97,
      5000,
      'bf704cc07170dcf9b7587c11bee7db54139220ef9b8a69384c01f4de68b7aba2',
    ],
  ] as const;
  expect(entries.map((entry) => entry.id)).toEqual(cases.map(([id]) => id));
  for (const [id, preset, seed, height, identity] of cases) {
    const json = await readFile(join(maps, `${id}.json`), 'utf8');
    const asset = importAsset(json);
    expect(canonicalizeAsset(asset)).toBe(json);
    expect(validateBattlefield(asset).ok).toBe(true);
    expect(asset.provenance.seed).toBe(seed);
    const recipe = battlefieldPreset(preset);
    recipe.settings.heightM = height;
    expect(asset.settings).toEqual(recipe.settings);
    expect(asset.overrides).toEqual([]);
    expect(asset.bounds).toEqual({ minX: 0, minY: 0, maxX: 5000, maxY: height });
    expect(await assetIdentity(asset, 'asset')).toBe(identity);
  }
}, 30_000);
