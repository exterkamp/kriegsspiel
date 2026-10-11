// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { createDraftRepository, storageKey, validateDraft, type DraftDocument } from './repository';
import { MemoryStorage, scope } from './fakes';
const encoded = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({
    schemaVersion: 1,
    scope,
    revision: 'stored',
    recipientUnitId: null,
    text: 'stored text',
    ...fields,
  });
function ready(storage = new MemoryStorage(), revision?: () => string) {
  const repo = createDraftRepository(scope, () => storage, revision);
  const result = repo.load();
  expect(result.ok).toBe(true);
  if (result.ok === false) throw Error('load failed');
  return { repo, storage, document: result.value };
}
const code = (result: ReturnType<ReturnType<typeof createDraftRepository>['load']>) =>
  result.ok === false ? result.error.code : null;
it('uses stable absent revisions and new distinct revisions on save and persisted deletion', () => {
  const { repo, storage, document } = ready();
  const repeated = repo.load();
  expect(repeated.ok && repeated.value.revision).toBe(document.revision);
  const saved = repo.save({ ...document, text: 'last keystroke' }, document.revision);
  expect(saved.ok).toBe(true);
  if (saved.ok) {
    expect(saved.value.revision).not.toBe(document.revision);
    const next = repo.save({ ...saved.value, text: 'next' }, saved.value.revision);
    expect(next.ok && next.value.revision).not.toBe(saved.value.revision);
  }
  storage.values.delete(storageKey(scope));
  const empty = repo.load();
  expect(empty.ok && empty.value.text).toBe('');
  expect(empty.ok && empty.value.revision).not.toBe(document.revision);
  const again = repo.load();
  expect(again.ok && again.value.revision).toBe(empty.ok && empty.value.revision);
});
it.each([
  ['corrupt', '{', 'invalid-data'],
  ['future', encoded({ schemaVersion: 2 }), 'migration-required'],
  ['wrong scope', encoded({ scope: { ...scope, playerId: 'other' } }), 'scope-mismatch'],
  ['oversized', 'x'.repeat(65537), 'invalid-data'],
  ['extra', encoded({ token: 'never accepted' }), 'invalid-data'],
  ['long text', encoded({ text: 'x'.repeat(16385) }), 'invalid-data'],
  ['long recipient', encoded({ recipientUnitId: 'x'.repeat(129) }), 'invalid-data'],
])('preserves %s and requires a validated load before autosave', (_name, raw, expected) => {
  const storage = new MemoryStorage();
  storage.values.set(storageKey(scope), raw);
  const repo = createDraftRepository(scope, () => storage);
  expect(code(repo.load())).toBe(expected);
  expect(
    code(
      repo.save(
        { schemaVersion: 1, scope, revision: 'stored', recipientUnitId: null, text: 'new' },
        'stored',
      ),
    ),
  ).toBe('not-ready');
  expect(storage.values.get(storageKey(scope))).toBe(raw);
  expect(storage.writes).toBe(0);
});
it('clones/freeze scope and submission before revision callbacks', () => {
  let count = 0;
  const suppliedScope = { ...scope };
  const storage = new MemoryStorage();
  const repo = createDraftRepository(
    suppliedScope,
    () => storage,
    () => {
      count++;
      if (count === 2) {
        (submission as { text: string }).text = 'mutated';
        (submission.scope as { playerId: string }).playerId = 'changed';
      }
      return `rev-${count}`;
    },
  );
  suppliedScope.playerId = 'changed';
  const loaded = repo.load();
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  const submission: DraftDocument = { ...loaded.value, scope: { ...scope }, text: 'captured' };
  const saved = repo.save(submission, loaded.value.revision);
  expect(saved.ok && saved.value.text).toBe('captured');
  expect(saved.ok && saved.value.scope).toEqual(scope);
  expect(saved.ok && Object.isFrozen(saved.value.scope)).toBe(true);
  expect(JSON.parse(storage.values.get(storageKey(scope))!).text).toBe('captured');
});
it('invalid outgoing text does not poison valid baseline; reduction saves', () => {
  const { repo, storage, document } = ready();
  expect(code(repo.save({ ...document, text: 'x'.repeat(16385) }, document.revision))).toBe(
    'invalid-data',
  );
  expect(repo.getState().writable).toBe(true);
  expect(storage.writes).toBe(0);
  expect(repo.save({ ...document, text: 'reduced' }, document.revision).ok).toBe(true);
  expect(validateDraft({ ...document, text: '\u0000'.repeat(16384) }, scope).ok).toBe(false);
});
it.each(['denial', 'quota'])('retains baseline for %s retry and safe errors', (kind) => {
  const { repo, storage, document } = ready();
  storage.blocked = kind === 'denial';
  storage.quota = kind === 'quota';
  const result = repo.save({ ...document, text: 'recoverable' }, document.revision);
  expect(code(result)).toBe(kind === 'denial' ? 'storage-unavailable' : 'quota-exceeded');
  expect(result.ok === false && result.error.message).not.toContain('secret');
  expect(repo.getState().writable).toBe(true);
  storage.blocked = false;
  storage.quota = false;
  expect(repo.save({ ...document, text: 'recoverable' }, document.revision).ok).toBe(true);
});
it.each(['external write', 'external deletion', 'revision callback'])(
  'detects %s and blocks further saves until explicit reload',
  (kind) => {
    let callback: () => void = () => {};
    let n = 0;
    const { repo, storage, document } = ready(new MemoryStorage(), () => {
      callback();
      return `rev-${++n}`;
    });
    const saved = repo.save({ ...document, text: 'first' }, document.revision);
    if (!saved.ok) throw Error('save');
    if (kind === 'external deletion') storage.values.delete(storageKey(scope));
    else if (kind === 'external write') storage.values.set(storageKey(scope), encoded());
    else callback = () => storage.values.set(storageKey(scope), encoded());
    expect(code(repo.save({ ...saved.value, text: 'unsaved' }, saved.value.revision))).toBe(
      'conflict',
    );
    expect(repo.getState().writable).toBe(false);
    expect(code(repo.save(saved.value, saved.value.revision))).toBe('not-ready');
    callback = () => {};
    expect(repo.load().ok).toBe(true);
  },
);
it.each(['revision', 'storage read', 'storage write', 'factory'])(
  'guards nested operations from %s callbacks without changing outer baseline',
  (where) => {
    const storage = new MemoryStorage();
    let n = 0;
    let armed = false;
    let current: DraftDocument = {
      schemaVersion: 1,
      scope,
      revision: 'unused',
      recipientUnitId: null,
      text: '',
    };
    let calls = 0;
    const nested = () => {
      if (!armed) return;
      calls++;
      expect(code(repo.load())).toBe('conflict');
      expect(code(repo.save(current, current.revision))).toBe('conflict');
    };
    const repo: ReturnType<typeof createDraftRepository> = createDraftRepository(
      scope,
      () => {
        nested();
        return storage;
      },
      () => {
        if (where === 'revision') nested();
        return `rev-${++n}`;
      },
    );
    if (where === 'factory') armed = true;
    const loaded = repo.load();
    if (!loaded.ok) throw Error('load');
    current = loaded.value;
    armed = true;
    if (where === 'storage read') storage.onRead = nested;
    if (where === 'storage write') storage.beforeWrite = nested;
    const saved = repo.save({ ...current, text: 'outer' }, current.revision);
    expect(saved.ok).toBe(true);
    expect(calls).toBeGreaterThan(0);
    expect(JSON.parse(storage.values.get(storageKey(scope))!).text).toBe('outer');
    expect(repo.getState().document).toEqual(saved.ok && saved.value);
  },
);
it.each(['revision', 'final read'])(
  'permits disposal before write in %s callback and prevents physical commit',
  (where) => {
    let n = 0;
    let armed = false;
    const storage = new MemoryStorage();
    const repo: ReturnType<typeof createDraftRepository> = createDraftRepository(
      scope,
      () => storage,
      () => {
        if (armed && where === 'revision') repo.dispose();
        return `rev-${++n}`;
      },
    );
    const loaded = repo.load();
    if (!loaded.ok) throw Error('load');
    armed = true;
    let reads = 0;
    if (where === 'final read')
      storage.onRead = () => {
        if (++reads === 2) repo.dispose();
      };
    expect(code(repo.save({ ...loaded.value, text: 'never written' }, loaded.value.revision))).toBe(
      'disposed',
    );
    expect(storage.writes).toBe(0);
    expect(repo.getState().disposed).toBe(true);
    expect(code(repo.load())).toBe('disposed');
  },
);
it('physical commit returns success after storage callback teardown without reviving repository', () => {
  const { repo, storage, document } = ready();
  storage.afterWrite = () => repo.dispose();
  const result = repo.save({ ...document, text: 'physically saved' }, document.revision);
  expect(result.ok).toBe(true);
  expect(JSON.parse(storage.values.get(storageKey(scope))!).text).toBe('physically saved');
  expect(repo.getState()).toMatchObject({ disposed: true, writable: false, document });
  expect(code(repo.save(document, document.revision))).toBe('disposed');
});
it('guard releases after revision failure and invalid revision can be repaired', () => {
  let value = 'initial';
  const { repo, document } = ready(new MemoryStorage(), () => value);
  expect(code(repo.save(document, document.revision))).toBe('invalid-data');
  value = '';
  expect(code(repo.save(document, document.revision))).toBe('invalid-data');
  value = 'valid-new';
  expect(repo.save(document, document.revision).ok).toBe(true);
});
it('rejects accessor and extra-field input without invoking a getter', () => {
  const { repo, document } = ready();
  let calls = 0;
  const input = {
    ...document,
    get text() {
      calls++;
      return 'secret';
    },
  };
  expect(code(repo.save(input, document.revision))).toBe('invalid-data');
  expect(calls).toBe(0);
});
it.each(['revision', 'storage read', 'factory'])(
  'guards nested load/save during initial load %s callback',
  (where) => {
    const storage = new MemoryStorage();
    let calls = 0;
    const nested = () => {
      calls++;
      expect(code(repo.load())).toBe('conflict');
      expect(
        code(
          repo.save(
            { schemaVersion: 1, scope, revision: 'nested', recipientUnitId: null, text: 'nested' },
            'nested',
          ),
        ),
      ).toBe('conflict');
      expect(repo.getState().document).toBeNull();
    };
    if (where === 'storage read') storage.onRead = nested;
    const repo: ReturnType<typeof createDraftRepository> = createDraftRepository(
      scope,
      () => {
        if (where === 'factory') nested();
        return storage;
      },
      () => {
        if (where === 'revision') nested();
        return 'empty-revision';
      },
    );
    expect(repo.load().ok).toBe(true);
    expect(calls).toBeGreaterThan(0);
    expect(repo.getState().document?.text).toBe('');
    expect(storage.writes).toBe(0);
  },
);
it('rejects superseded absence during load revision callback without accepting an empty saved draft', () => {
  const storage = new MemoryStorage();
  let armed = true;
  const repo = createDraftRepository(
    scope,
    () => storage,
    () => {
      if (armed) storage.values.set(storageKey(scope), encoded({ text: 'External draft' }));
      return 'empty';
    },
  );
  expect(code(repo.load())).toBe('conflict');
  expect(repo.getState()).toMatchObject({ document: null, writable: false });
  expect(storage.values.get(storageKey(scope))).toContain('External draft');
  armed = false;
  expect(repo.load().ok).toBe(true);
  expect(repo.getState().document?.text).toBe('External draft');
});
it('blocks expected-revision mismatch until explicit reload without changing persisted draft', () => {
  const { repo, storage, document } = ready();
  expect(code(repo.save({ ...document, text: 'stale' }, 'wrong'))).toBe('conflict');
  expect(repo.getState().writable).toBe(false);
  expect(storage.writes).toBe(0);
  expect(repo.load().ok).toBe(true);
  expect(repo.save({ ...document, text: 'current' }, document.revision).ok).toBe(true);
});
it('load storage failure releases guard and invalid scope never touches storage', () => {
  const storage = new MemoryStorage();
  storage.blocked = true;
  const repo = createDraftRepository(scope, () => storage);
  expect(code(repo.load())).toBe('storage-unavailable');
  storage.blocked = false;
  expect(repo.load().ok).toBe(true);
  const before = storage.reads;
  const invalid = createDraftRepository({ ...scope, gameId: '' }, () => storage);
  expect(code(invalid.load())).toBe('invalid-data');
  expect(storage.reads).toBe(before);
});
it('disposal during load revision callback never accepts or publishes a document', () => {
  const repo: ReturnType<typeof createDraftRepository> = createDraftRepository(
    scope,
    () => new MemoryStorage(),
    () => {
      repo.dispose();
      return 'unused';
    },
  );
  expect(code(repo.load())).toBe('disposed');
  expect(repo.getState()).toMatchObject({ document: null, writable: false, disposed: true });
});
