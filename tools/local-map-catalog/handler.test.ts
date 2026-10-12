import { mkdtemp, mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  assetIdentity,
  battlefieldPreset,
  canonicalizeAsset,
  HARD_LIMITS,
  importAsset,
  validateBattlefield,
} from '@kriegsspiel/maps';
import { createMapCatalogHandler } from './handler.js';
import type { MapSummary } from './types.js';

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
async function start(options: Parameters<typeof createMapCatalogHandler>[0] = {}) {
  // A real HTTP stream exercises body handling and response status/bytes.
  server = createServer(
    createMapCatalogHandler({
      premadeDirectory: premade,
      generatedDirectory: generated,
      logger: { warn },
      ...options,
    }),
  );
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
  const unknown = await fetch(endpoint.replace('/__local/maps', '/elsewhere'));
  expect(unknown.status).toBe(404);
  expect(await unknown.json()).toEqual({ error: 'Not found' });
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
}, 30_000);

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

it('keeps unsupported catalog requests at 400 and unknown routes at JSON 404', async () => {
  await start();
  for (const [path, method] of [
    ['', 'PUT'],
    ['', 'DELETE'],
    ['/generated/board', 'POST'],
    ['/', 'GET'],
    ['/generated/board/extra', 'GET'],
  ]) {
    const response = await fetch(`${endpoint}${path}`, { method });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Unsupported map catalog request' });
  }
  for (const path of ['/elsewhere', '/__local/maps-extra']) {
    const response = await fetch(new URL(path, endpoint), { method: 'POST', body: 'ignored' });
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await response.json()).toEqual({ error: 'Not found' });
  }
  const response = await fetch(`${endpoint}?unused=yes`, {
    headers: { Origin: 'https://example.com' },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
  expect(await response.json()).toHaveLength(1);
});

it('discards an interrupted real upload without writing and serves later requests', async () => {
  await start();
  let observedAbort!: () => void;
  const aborted = new Promise<void>((resolve) => {
    observedAbort = resolve;
  });
  server!.once('request', (req) => {
    req.once('aborted', observedAbort);
  });
  await new Promise<void>((resolve, reject) => {
    const req = request(endpoint, {
      method: 'POST',
      headers: { 'Content-Length': Buffer.byteLength(canonical) + 1 },
    });
    req.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNRESET') resolve();
      else reject(error);
    });
    // The server sees body bytes before the client destroys its incomplete request.
    server!.once('request', (incoming) => {
      incoming.once('data', () => req.destroy());
    });
    req.write(canonical.slice(0, 1024));
  });
  await aborted;
  expect(await readdir(directory)).toEqual(['premade']);
  expect((await fetch(endpoint)).status).toBe(200);
  expect(warn).not.toHaveBeenCalled();
});

it('omits oversized files on list and rejects their explicit reads before parsing', async () => {
  await mkdir(generated);
  const file = await open(join(generated, 'oversized.json'), 'w');
  try {
    await file.truncate(HARD_LIMITS.maxBytes + 1);
  } finally {
    await file.close();
  }
  await start();
  expect(await (await fetch(endpoint)).json()).toHaveLength(1);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('Omitting generated map oversized'));
  const response = await fetch(`${endpoint}/generated/oversized`);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Map exceeds the 64 MiB import limit' });
});

it('restricts premade reads to unique valid catalog entries and basename filenames', async () => {
  await start();
  // A file on disk is not authority to expose a premade map absent from the catalog.
  await writeFile(join(premade, 'hidden.json'), canonical);
  expect((await fetch(`${endpoint}/premade/hidden`)).status).toBe(404);
  for (const entries of [
    [{ id: 'board', name: 'Bad', filename: 'other.json' }],
    [{ id: 'board', name: 'Bad', filename: '/board.json' }],
    [{ id: 'board', name: ' ', filename: 'board.json' }],
    [{ id: '_board', name: 'Bad', filename: '_board.json' }],
    [
      { id: 'board', name: 'First', filename: 'board.json' },
      { id: 'board', name: 'Second', filename: 'board.json' },
    ],
  ]) {
    await writeFile(join(premade, 'catalog.json'), JSON.stringify(entries));
    const response = await fetch(endpoint);
    expect(response.status).toBe(500);
    expect(await response.json()).toHaveProperty('error');
  }
  const response = await fetch(`${endpoint}/generated/${'a'.repeat(97)}`);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid map reference' });
});

it('preserves noncanonical accepted upload bytes and uses a UUID by default', async () => {
  await start();
  const json = `\n${canonical}\n `;
  const response = await save(json);
  expect(response.status).toBe(201);
  const saved = (await response.json()) as MapSummary;
  expect(saved.ref.kind).toBe('generated');
  expect(saved.ref.id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(await readFile(join(generated, `${saved.ref.id}.json`), 'utf8')).toBe(json);
  expect(await (await fetch(`${endpoint}/generated/${saved.ref.id}`)).text()).toBe(json);
});

it('uses import validity for storage without claiming complete certification', async () => {
  const asset = importAsset(canonical);
  asset.provenance.generator.version = 'unsupported-version';
  // Import validity does not certify supported generator identities or complete geography.
  const json = JSON.stringify(asset);
  expect(() => importAsset(json)).not.toThrow();
  expect(validateBattlefield(importAsset(json)).ok).toBe(false);
  await start({ newId: () => 'import-valid' });
  const response = await save(json);
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({
    ref: { kind: 'generated', id: 'import-valid' },
    name: asset.name,
    widthM: asset.settings.widthM,
    heightM: asset.settings.heightM,
  });
  expect(await (await fetch(`${endpoint}/generated/import-valid`)).text()).toBe(json);
});

it('derives the default premade root from module location without consulting cwd', async () => {
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
  try {
    await start({ premadeDirectory: undefined });
    const response = await fetch(`${endpoint}/premade/countryside-rectangle`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(canonical);
  } finally {
    cwd.mockRestore();
  }
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
