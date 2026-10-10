// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { createInTrayStore, decodeDocument, storageKey } from './store';
import { MemoryStorage, scope } from './fakes';
const doc = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ schemaVersion: 1, scope, revision: 'v1', records: [], ...extra });
async function ready(storage = new MemoryStorage()) {
  const store = createInTrayStore(scope, () => storage);
  expect((await store.load()).ok).toBe(true);
  return { store, storage };
}
it('persists statuses across instances and isolates scopes', async () => {
  const { store, storage } = await ready();
  await store.update('paper', 'filed');
  const next = await ready(storage);
  expect(next.store.getState().document?.records).toEqual([{ paperId: 'paper', status: 'filed' }]);
  const other = createInTrayStore({ ...scope, playerId: 'two' }, () => storage);
  await other.load();
  expect(other.getState().document?.records).toEqual([]);
});
it.each([
  ['corrupt', '{', 'invalid-data'],
  ['future', doc({ schemaVersion: 2 }), 'migration-required'],
  ['wrong scope', doc({ scope: { ...scope, sideId: 'red' } }), 'scope-mismatch'],
  ['oversized', 'x'.repeat(512 * 1024 + 1), 'invalid-data'],
  [
    'duplicate',
    doc({
      records: [
        { paperId: 'a', status: 'read' },
        { paperId: 'a', status: 'filed' },
      ],
    }),
    'invalid-data',
  ],
  ['extra', doc({ secret: 'no' }), 'invalid-data'],
  ['invalid status', doc({ records: [{ paperId: 'a', status: 'other' }] }), 'invalid-data'],
  ['invalid id', doc({ records: [{ paperId: 'x'.repeat(129), status: 'read' }] }), 'invalid-data'],
])('preserves %s storage and blocks edits', async (_name, raw, code) => {
  const storage = new MemoryStorage();
  storage.values.set(storageKey(scope), raw);
  const store = createInTrayStore(scope, () => storage);
  const result = await store.load();
  expect(result.ok === false && result.error.code).toBe(code);
  expect((await store.update('a', 'read')).ok).toBe(false);
  expect(storage.values.get(storageKey(scope))).toBe(raw);
  expect(store.getState().document).toBeNull();
});
it('bounds record counts and freezes published document', () => {
  const records = Array.from({ length: 2001 }, (_, i) => ({ paperId: `p${i}`, status: 'read' }));
  expect(decodeDocument(doc({ records }), scope).ok).toBe(false);
  const parsed = decodeDocument(doc({ records: records.slice(0, 2000) }), scope);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) {
    expect(Object.isFrozen(parsed.value.records[0])).toBe(true);
    expect(Object.isFrozen(parsed.value.scope)).toBe(true);
  }
});
it('keeps quota failure dirty and retries against valid old baseline', async () => {
  const { store, storage } = await ready();
  storage.quota = true;
  const result = await store.update('p', 'read');
  expect(result.ok === false && result.error.code).toBe('quota-exceeded');
  expect(store.getState()).toMatchObject({ dirty: true, writable: true, busy: false });
  storage.quota = false;
  expect((await store.save()).ok).toBe(true);
  expect(store.getState().dirty).toBe(false);
});
it.each(['replacement', 'deletion'])(
  'detects external %s, blocks retry and requires explicit dirty discard',
  async (kind) => {
    const { store, storage } = await ready();
    await store.update('p', 'read');
    if (kind === 'deletion') storage.values.delete(storageKey(scope));
    else storage.values.set(storageKey(scope), doc({ revision: 'external' }));
    const result = await store.update('p', 'filed');
    expect(result.ok === false && result.error.code).toBe('conflict');
    expect((await store.save()).ok).toBe(false);
    expect((await store.load()).ok).toBe(false);
    expect((await store.load(true)).ok).toBe(true);
    expect(store.getState().dirty).toBe(false);
  },
);
it('rejects busy mutations, cancels before commit and retains RAM for retry', async () => {
  const { store, storage } = await ready();
  storage.quota = true;
  await store.update('p', 'read');
  storage.quota = false;
  const abort = new AbortController();
  const pending = store.save(abort.signal);
  const rejected = store.update('q', 'read');
  abort.abort();
  expect((await rejected).ok).toBe(false);
  expect((await pending).ok).toBe(false);
  expect(storage.writes).toBe(0);
  expect(store.getState().dirty).toBe(true);
  await store.save();
  expect(storage.writes).toBe(1);
});
it('reports synchronous commit success even if disposed and aborted during write; no late publication', async () => {
  const { store, storage } = await ready();
  storage.quota = true;
  await store.update('p', 'read');
  storage.quota = false;
  const abort = new AbortController();
  let notifications = 0;
  store.subscribe(() => notifications++);
  storage.duringWrite = () => {
    store.dispose();
    abort.abort();
  };
  const before = notifications;
  const pending = store.save(abort.signal);
  expect((await pending).ok).toBe(true);
  expect(notifications).toBe(before + 1);
  expect(storage.values.get(storageKey(scope))).toContain('"read"');
});
it('disposal cancels pending load/save before touching storage', async () => {
  const storage = new MemoryStorage();
  const store = createInTrayStore(scope, () => storage);
  const pending = store.load();
  store.dispose();
  expect((await pending).ok).toBe(false);
  expect(storage.reads).toBe(0);
  const next = await ready(storage);
  const saving = next.store.update('p', 'read');
  next.store.dispose();
  expect((await saving).ok).toBe(false);
  expect(storage.writes).toBe(0);
});
it('storage access failure has no fallback or inferred read state', async () => {
  const storage = new MemoryStorage();
  storage.blocked = true;
  const store = createInTrayStore(scope, () => storage);
  await store.load();
  expect(store.getState()).toMatchObject({ document: null, writable: false });
  storage.blocked = false;
  expect((await store.load()).ok).toBe(true);
});
it('clones scope and prevents published document mutation from changing saved records', async () => {
  const supplied = { ...scope };
  const storage = new MemoryStorage();
  const store = createInTrayStore(supplied, () => storage);
  supplied.playerId = 'changed';
  await store.load();
  expect(store.getState().document?.scope).toEqual(scope);
  await store.update('p', 'read');
  const state = store.getState();
  expect(Object.isFrozen(state)).toBe(true);
  expect(() => {
    (state.document!.records[0] as { status: string }).status = 'filed';
  }).toThrow();
  expect(JSON.parse(storage.values.get(storageKey(scope))!).records[0].status).toBe('read');
});
it('rejects invalid scope before storage access and oversized runtime record IDs', async () => {
  const storage = new MemoryStorage();
  const invalid = createInTrayStore({ ...scope, gameId: 'x'.repeat(129) }, () => storage);
  expect((await invalid.load()).ok).toBe(false);
  expect(storage.reads).toBe(0);
  const { store } = await ready();
  expect((await store.update('x'.repeat(129), 'read')).ok).toBe(false);
});
it('reuses one absence revision across reloads, including discarded unsaved changes', async () => {
  const { store, storage } = await ready();
  const initial = store.getState().document!.revision;
  await store.load();
  expect(store.getState().document!.revision).toBe(initial);
  storage.quota = true;
  await store.update('unsaved', 'read');
  expect(store.getState().dirty).toBe(true);
  await store.load(true);
  expect(store.getState().document!.revision).toBe(initial);
  expect(store.getState().document!.records).toEqual([]);
  expect(storage.writes).toBe(0);
});
it.each(['own save', 'loaded record'])(
  'creates a new stable absence revision after deletion of %s',
  async (kind) => {
    const { store, storage } = await ready();
    const initial = store.getState().document!.revision;
    if (kind === 'own save') await store.update('persisted', 'filed');
    else {
      storage.values.set(
        storageKey(scope),
        doc({ records: [{ paperId: 'persisted', status: 'filed' }] }),
      );
      await store.load();
    }
    const persisted = store.getState().document!.revision;
    storage.values.delete(storageKey(scope));
    await store.load();
    const deleted = store.getState().document!.revision;
    expect(deleted).not.toBe(initial);
    expect(deleted).not.toBe(persisted);
    expect(store.getState().document!.records).toEqual([]);
    await store.load();
    expect(store.getState().document!.revision).toBe(deleted);
  },
);
it('isolates throwing initial, busy and completed observers from load/save and subsequent delivery', async () => {
  const storage = new MemoryStorage();
  const store = createInTrayStore(scope, () => storage);
  expect(() =>
    store.subscribe(() => {
      throw Error('observer failed');
    }),
  ).not.toThrow();
  const deliveries: boolean[] = [];
  store.subscribe((value) => deliveries.push(value.busy));
  expect((await store.load()).ok).toBe(true);
  expect(store.getState()).toMatchObject({ busy: false, writable: true, error: null });
  expect((await store.update('paper', 'read')).ok).toBe(true);
  expect(store.getState()).toMatchObject({ busy: false, dirty: false, error: null });
  expect(deliveries).toEqual([false, true, false, false, true, false]);
  expect(JSON.parse(storage.values.get(storageKey(scope))!).records).toEqual([
    { paperId: 'paper', status: 'read' },
  ]);
});
it('stops deliveries and load when an earlier observer tears down during busy publication', async () => {
  const storage = new MemoryStorage();
  const store = createInTrayStore(scope, () => storage);
  store.subscribe((value) => {
    if (value.busy) store.dispose();
  });
  let deliveries = 0;
  store.subscribe(() => deliveries++);
  const result = await store.load();
  expect(result.ok === false && result.error.code).toBe('aborted');
  expect(deliveries).toBe(1);
  expect(storage.reads).toBe(0);
  store.subscribe(() => deliveries++);
  expect(deliveries).toBe(1);
});
it('preserves committed save success but stops later observers after completion teardown', async () => {
  const { store, storage } = await ready();
  store.subscribe((value) => {
    if (value.document?.records.length && !value.dirty && !value.busy) store.dispose();
  });
  const deliveries: boolean[] = [];
  store.subscribe((value) => deliveries.push(value.busy));
  expect((await store.update('paper', 'read')).ok).toBe(true);
  expect(storage.writes).toBe(1);
  expect(deliveries).toEqual([false, false, true]);
});
