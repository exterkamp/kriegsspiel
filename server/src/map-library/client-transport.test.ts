import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assetIdentity,
  battlefieldPreset,
  canonicalizeAsset,
  generateBattlefield,
  validateBattlefield,
  type MapAsset,
} from '@kriegsspiel/maps';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  LibraryMapSummary,
  MapLibraryPort,
} from '../../../client/src/shared/lobby-map-library/contracts.js';
import { buildApp, type App } from '../api/app.js';
import { hashToken } from '../auth/store.js';
import { SqliteCreationStore } from '../lobby/creation-store.js';
import { StubOrderParser } from '../orders/stubParser.js';
import { MapLibraryService } from './service.js';
import { LibraryStore } from './store.js';

// Real TCP, cookies, SQLite and certification workers. Only the acknowledgement-loss
// wrapper below changes delivery; no route/service/store/validator is mocked.
const mediaType = 'application/vnd.kriegsspiel.map+json';
type CheckInput = { canonicalJson: string; assetIdentity: string; widthM: number; heightM: number };
type Verifier = (input: CheckInput, signal: AbortSignal) => Promise<MapAsset>;
let createHttpMapLibrary: (fetcher: typeof fetch, verifier: Verifier) => MapLibraryPort;
let verifyMessage: (
  message: unknown,
) => Promise<{ type: 'verified'; asset: MapAsset } | { type: 'failed' }>;
const verifyInNode: Verifier = async (input, signal) => {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const reply = await verifyMessage({
    v: 1,
    type: 'verify-library-asset',
    requestId: randomUUID(),
    byteLength: Buffer.byteLength(input.canonicalJson),
    input,
  });
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (reply.type !== 'verified') throw new Error('Map verification failed');
  return reply.asset;
};
let directory: string;
let databasePath: string;
let core: SqliteCreationStore;
let library: MapLibraryService;
let app: App;
let origin: string;
let canonicalJson: string;
let identity: string;
let geometryIdentity: string;
let changedJson: string;
let changedIdentity: string;
let obsoleteJson: string;
const signal = () => new AbortController().signal;
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

type Call = {
  method: string;
  path: string;
  headers: Headers;
  body: NonNullable<Parameters<typeof fetch>[1]>['body'];
  status?: number;
  responseHeaders?: Headers;
  errorBody?: string;
};

function client(owner = core.auth.createGuest(Date.now()).id, loseAcknowledgement = false) {
  const token = randomUUID();
  core.auth.putSession(hashToken(token), owner, Date.now() + 60_000);
  const calls: Call[] = [];
  let lose = loseAcknowledgement;
  const fetcher: typeof fetch = async (input, init) => {
    // The browser helper supplies relative URLs; Node supplies only this test's
    // ephemeral origin and a synthetic session. Never forward another origin.
    expect(typeof input).toBe('string');
    const url = new URL(String(input), origin);
    expect(url.origin).toBe(origin);
    expect(url.pathname.startsWith('/map-library/')).toBe(true);
    expect(init?.credentials).toBe('same-origin');
    expect(init?.mode).toBe('same-origin');
    const headers = new Headers(init?.headers);
    headers.set('cookie', `ks_session=${token}`);
    const call: Call = {
      method: init?.method ?? 'GET',
      path: url.pathname + url.search,
      headers,
      body: init?.body,
    };
    expect(['GET', 'PUT']).toContain(call.method);
    calls.push(call);
    const response = await fetch(url, { ...init, headers });
    call.status = response.status;
    call.responseHeaders = new Headers(response.headers);
    if (!response.ok) {
      // These real server error responses are tiny; keep the original stream for
      // the client so its actual streaming/error path is still exercised.
      const bytes = new Uint8Array(await response.clone().arrayBuffer());
      expect(bytes.byteLength).toBeLessThanOrEqual(4096);
      call.errorBody = new TextDecoder().decode(bytes);
    }
    if (lose && call.method === 'PUT') {
      lose = false;
      expect(response.status).toBe(200);
      await response.arrayBuffer(); // commit and finish the real response first
      const key = url.pathname.split('/').at(-1)!;
      expect(library.store.operation(owner, key)).toBeDefined();
      throw new TypeError('Test-only acknowledgement lost after commit');
    }
    return response;
  };
  return { owner, calls, port: createHttpMapLibrary(fetcher, verifyInNode) };
}

function intent(name = 'Countryside — Élan 🗺', requestId = randomUUID()) {
  return { requestId, name, canonicalJson, assetIdentity: identity };
}

function counts() {
  return core.database
    .prepare(
      'SELECT (SELECT COUNT(*) FROM library_assets) AS assets, (SELECT COUNT(*) FROM library_operations) AS operations',
    )
    .get() as { assets: number; operations: number };
}

function oneOperation(owner: string, requestId: string, item: LibraryMapSummary) {
  const rows = core.database
    .prepare(
      `SELECT o.asset_id,o.owner,o.original_owner,o.request_id,o.name,o.identity,o.state,
       o.width,o.height,a.canonical_json FROM library_operations o
       JOIN library_assets a ON a.asset_id=o.asset_id WHERE o.original_owner=? AND o.request_id=?`,
    )
    .all(owner, requestId);
  expect(rows).toEqual([
    {
      asset_id: item.ref.id,
      owner,
      original_owner: owner,
      request_id: requestId,
      name: item.name,
      identity,
      state: 'accepted',
      width: 5000,
      height: 5000,
      canonical_json: canonicalJson,
    },
  ]);
}

beforeAll(async () => {
  // Runtime cross-package test: each package retains its own lib/typecheck context.
  // Do not add browser DOM globals to the server. The real exported implementations run below.
  const transportUrl = new URL(
    '../../../client/src/shared/lobby-map-library/http.ts',
    import.meta.url,
  ).href;
  const workerUrl = new URL(
    '../../../client/src/shared/lobby-map-library/asset-check.worker.ts',
    import.meta.url,
  ).href;
  const transport: unknown = await import(transportUrl);
  const worker: unknown = await import(workerUrl);
  if (
    !transport ||
    typeof transport !== 'object' ||
    !('createHttpMapLibrary' in transport) ||
    typeof transport.createHttpMapLibrary !== 'function' ||
    !worker ||
    typeof worker !== 'object' ||
    !('verifyLibraryAssetMessage' in worker) ||
    typeof worker.verifyLibraryAssetMessage !== 'function'
  )
    throw new Error('Missing actual client verification/transport exports');
  createHttpMapLibrary = transport.createHttpMapLibrary as typeof createHttpMapLibrary;
  verifyMessage = worker.verifyLibraryAssetMessage as typeof verifyMessage;
  // Deliberately the unmodified production Countryside 5 km preset, not a small
  // fixture or a second generation with reduced populations/validation limits.
  const recipe = battlefieldPreset('flat-countryside');
  expect(recipe.seed).toBe(17);
  expect([recipe.settings.widthM, recipe.settings.heightM]).toEqual([5000, 5000]);
  const generated = generateBattlefield(recipe);
  if (!generated.ok) throw new Error('Actual Countryside generation failed');
  const asset = generated.value;
  expect(validateBattlefield(asset).ok).toBe(true);
  expect(asset.layers.buildings.length).toBeGreaterThan(0);
  expect(asset.layers.roads.length).toBeGreaterThan(0);
  canonicalJson = canonicalizeAsset(asset);
  expect(Buffer.byteLength(canonicalJson)).toBeGreaterThan(1_000_000);
  identity = await assetIdentity(asset, 'asset');
  geometryIdentity = await assetIdentity(asset, 'geometry');
  expect(identity).toBe(sha256(canonicalJson));
  expect(identity).not.toBe(geometryIdentity);
  const renamed = structuredClone(asset);
  renamed.name = 'Different asset name, same geography';
  changedJson = canonicalizeAsset(renamed);
  changedIdentity = await assetIdentity(renamed, 'asset');
  expect(changedIdentity).not.toBe(identity);
  expect(await assetIdentity(renamed, 'geometry')).toBe(geometryIdentity);
  const obsolete = structuredClone(asset);
  obsolete.provenance.generator.version = 'obsolete-test-version';
  obsoleteJson = canonicalizeAsset(obsolete);

  directory = await mkdtemp(join(tmpdir(), 'ks-client-library-'));
  databasePath = join(directory, 'state.sqlite');
  await writeFile(join(directory, 'countryside.json'), canonicalJson, 'utf8');
  await writeFile(
    join(directory, 'catalog.json'),
    JSON.stringify([
      { id: 'countryside-17', name: 'Included countryside', filename: 'countryside.json' },
    ]),
  );
  core = new SqliteCreationStore(databasePath);
  // Startup, PUT and GET all use the real server worker's current complete cert.
  library = await MapLibraryService.open(core, pathToFileURL(directory + '/'));
  app = await buildApp({
    parser: new StubOrderParser(),
    creations: core,
    mapLibrary: library,
    limits: { sweepEveryMs: 0 },
  });
  origin = await app.server.listen({ port: 0, host: '127.0.0.1' });
}, 60_000);

afterAll(async () => {
  try {
    if (core) {
      expect(core.database.prepare('SELECT COUNT(*) AS n FROM creation_receipts').get()).toEqual({
        n: 0,
      });
      expect(core.database.prepare('SELECT COUNT(*) AS n FROM lobby_games').get()).toEqual({
        n: 0,
      });
    }
  } finally {
    await app?.server.close();
    core?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

describe.sequential(
  'reviewed client transport against the durable library HTTP API',
  { timeout: 60_000 },
  () => {
    it('reads actual included geography, saves exact bytes with a separate name, and retries one immutable intent', async () => {
      const c = client();
      const included = await c.port.list('included', signal());
      expect(included).toEqual({
        items: [
          {
            ref: { kind: 'included', id: 'countryside-17' },
            name: 'Included countryside',
            widthM: 5000,
            heightM: 5000,
            assetIdentity: identity,
            status: 'needs-scenario',
          },
        ],
      });
      expect(await c.port.read(included.items[0]!.ref, signal())).toEqual({
        item: included.items[0],
        canonicalJson,
      });
      const value = intent();
      const before = counts();
      const saved = await c.port.save(value, signal());
      expect(saved).toEqual({
        ref: { kind: 'owned', id: expect.any(String) },
        name: value.name,
        widthM: 5000,
        heightM: 5000,
        assetIdentity: identity,
        status: 'needs-scenario',
        createdAtMs: expect.any(Number),
      });
      expect(await c.port.save(value, signal())).toEqual(saved);
      expect(counts()).toEqual({ assets: before.assets + 1, operations: before.operations + 1 });
      oneOperation(c.owner, value.requestId, saved);
      expect(await c.port.list('owned', signal())).toEqual({ items: [saved] });
      const read = await c.port.read(saved.ref, signal());
      expect(read).toEqual({ item: saved, canonicalJson });
      expect(Buffer.from(read.canonicalJson)).toEqual(Buffer.from(canonicalJson));
      const put = c.calls.find((call) => call.method === 'PUT')!;
      expect(put.body).toBe(canonicalJson);
      expect(put.headers.get('content-type')).toBe(mediaType);
      expect(put.headers.get('x-map-name')).toBe(encodeURIComponent(value.name));
      expect(put.headers.get('x-map-identity')).toBe(identity);
      const get = c.calls.at(-1)!;
      expect(get.responseHeaders?.get('content-type')).toBe(`${mediaType}; charset=utf-8`);
      expect(get.responseHeaders?.get('x-map-name')).toBe(encodeURIComponent(value.name));
      expect(get.responseHeaders?.get('cache-control')).toBe('private, no-store');
    });

    it('recovers a committed lost acknowledgement through the same UUID receipt without a second PUT', async () => {
      const c = client(undefined, true);
      const value = intent('Lost acknowledgement');
      const before = counts();
      const saved = await c.port.save(value, signal());
      expect(c.calls.map(({ method, path, status }) => ({ method, path, status }))).toEqual([
        { method: 'PUT', path: `/map-library/saves/${value.requestId}`, status: 200 },
        { method: 'GET', path: `/map-library/saves/${value.requestId}`, status: 200 },
      ]);
      expect(saved.status).toBe('needs-scenario');
      expect(library.store.operation(c.owner, value.requestId)).toEqual(saved);
      expect(counts()).toEqual({ assets: before.assets + 1, operations: before.operations + 1 });
      oneOperation(c.owner, value.requestId, saved);
      expect(await c.port.read(saved.ref, signal())).toEqual({ item: saved, canonicalJson });
    });

    it('rejects changed name, bytes or identity at an accepted key without reconciling a conflict into success', async () => {
      const c = client();
      const value = intent('Immutable intent');
      const saved = await c.port.save(value, signal());
      const before = counts();
      const start = c.calls.length;
      for (const changed of [
        { ...value, name: 'Different display name' },
        { ...value, canonicalJson: changedJson, assetIdentity: changedIdentity },
        { ...value, assetIdentity: geometryIdentity },
      ]) {
        await expect(c.port.save(changed, signal())).rejects.toMatchObject({
          kind: 'conflict',
          status: 409,
        });
      }
      expect(c.calls.slice(start).map(({ method, status }) => ({ method, status }))).toEqual([
        { method: 'PUT', status: 409 },
        { method: 'PUT', status: 409 },
        { method: 'PUT', status: 409 },
      ]);
      expect(counts()).toEqual(before);
      oneOperation(c.owner, value.requestId, saved);
      expect(await c.port.read(saved.ref, signal())).toEqual({ item: saved, canonicalJson });
    });

    it('requires the full asset hash and current complete certification before accepting a new operation', async () => {
      const c = client();
      const before = counts();
      for (const value of [
        { ...intent('Geometry hash is insufficient'), assetIdentity: geometryIdentity },
        {
          ...intent('Obsolete provenance'),
          canonicalJson: obsoleteJson,
          assetIdentity: sha256(obsoleteJson),
        },
      ]) {
        await expect(c.port.save(value, signal())).rejects.toMatchObject({ status: 400 });
        expect(library.store.operation(c.owner, value.requestId)).toBeUndefined();
      }
      expect(c.calls.map(({ method, status }) => ({ method, status }))).toEqual([
        { method: 'PUT', status: 400 },
        { method: 'PUT', status: 400 },
      ]);
      expect(counts()).toEqual(before);
      expect(await c.port.list('owned', signal())).toEqual({ items: [] });
    });

    it('returns a foreign owner 404 without asset bytes, identity or a save receipt', async () => {
      const a = client();
      const b = client();
      const value = intent('Private geography');
      const saved = await a.port.save(value, signal());
      const before = counts();
      await expect(b.port.read(saved.ref, signal())).rejects.toMatchObject({
        kind: 'missing',
        status: 404,
      });
      const denied = b.calls.at(-1)!;
      expect(denied.errorBody).toBe('{"error":"map_not_found"}');
      expect(denied.responseHeaders?.get('content-type')).toMatch(/^application\/json/);
      expect([...denied.responseHeaders!.keys()].filter((key) => key.startsWith('x-map-'))).toEqual(
        [],
      );
      expect(denied.errorBody).not.toContain(identity);
      expect(denied.errorBody).not.toContain(canonicalJson);
      expect(await b.port.list('owned', signal())).toEqual({ items: [] });
      // This is the real receipt route, not the client save fallback (which would PUT).
      const foreignReceipt = await fetch(`${origin}/map-library/saves/${value.requestId}`, {
        headers: { cookie: b.calls[0]!.headers.get('cookie')! },
      });
      expect(foreignReceipt.status).toBe(404);
      expect(await foreignReceipt.json()).toEqual({ error: 'map_save_unknown' });
      expect(counts()).toEqual(before);
      expect(await a.port.read(saved.ref, signal())).toEqual({ item: saved, canonicalJson });
    });

    it('preserves the accepted operation across adoption and file reopen, then removes private bytes on account deletion', async () => {
      const guest = client();
      // Synthetic local account row only: no login email or external auth request.
      const target = core.auth.upsertUser('library-transport@example.invalid', Date.now()).id;
      const account = client(target);
      const stranger = client();
      const value = intent('Adopted geography');
      const saved = await guest.port.save(value, signal());
      const before = counts();
      core.auth.adoptGuest(guest.owner, target);
      expect(core.auth.getUser(guest.owner)).toBeUndefined();
      await expect(guest.port.read(saved.ref, signal())).rejects.toMatchObject({
        kind: 'sign-in',
        status: 401,
      });
      expect(await account.port.list('owned', signal())).toEqual({ items: [saved] });
      expect(await account.port.save(value, signal())).toEqual(saved);
      expect(await account.port.read(saved.ref, signal())).toEqual({ item: saved, canonicalJson });
      expect(counts()).toEqual(before);

      // A fresh SQLite connection reads the committed file, not the service's JS
      // state. Register the same real ownership participant for transactional delete.
      const reopened = new SqliteCreationStore(databasePath);
      try {
        const durable = new LibraryStore(reopened.database, reopened.auth);
        reopened.registerOwnershipParticipant(durable);
        expect(durable.operation(target, value.requestId)).toEqual(saved);
        expect(durable.read(target, saved.ref.id)).toEqual({ item: saved, canonicalJson });
        reopened.auth.deleteUser(target);
        expect(durable.read(target, saved.ref.id)).toBeUndefined();
        expect(
          reopened.database
            .prepare('SELECT COUNT(*) AS n FROM library_assets WHERE asset_id=?')
            .get(saved.ref.id),
        ).toEqual({ n: 0 });
      } finally {
        reopened.close();
      }
      await expect(account.port.read(saved.ref, signal())).rejects.toMatchObject({
        kind: 'sign-in',
        status: 401,
      });
      await expect(stranger.port.read(saved.ref, signal())).rejects.toMatchObject({
        kind: 'missing',
        status: 404,
      });
      expect(counts()).toEqual({ assets: before.assets - 1, operations: before.operations });
      expect(
        core.database
          .prepare(
            'SELECT state,name,identity FROM library_operations WHERE original_owner=? AND request_id=?',
          )
          .get(guest.owner, value.requestId),
      ).toEqual({ state: 'tombstone', name: null, identity: null });
    });
  },
);
