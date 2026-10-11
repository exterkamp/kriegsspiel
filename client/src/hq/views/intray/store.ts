import type { HqError, Result, Scope } from '../../contracts';

export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export type PaperStatus = 'unread' | 'read' | 'filed' | 'discarded';
export interface InTrayDocument {
  readonly schemaVersion: 1;
  readonly scope: Scope;
  readonly revision: string;
  readonly records: readonly { readonly paperId: string; readonly status: PaperStatus }[];
}
export interface StoreState {
  readonly document: InTrayDocument | null;
  readonly busy: boolean;
  readonly dirty: boolean;
  readonly writable: boolean;
  readonly error: HqError | null;
}
const statuses = new Set(['unread', 'read', 'filed', 'discarded']);
const id = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= 128;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, expected: string[]) =>
  Object.keys(v).sort().join(',') === expected.sort().join(',');
export const sameScope = (a: Scope, b: Scope) =>
  a.gameId === b.gameId && a.sideId === b.sideId && a.playerId === b.playerId;
const validScope = (v: unknown): v is Scope =>
  object(v) &&
  keys(v, ['gameId', 'sideId', 'playerId']) &&
  id(v.gameId) &&
  id(v.sideId) &&
  id(v.playerId);
export const storageKey = (scope: Scope) =>
  JSON.stringify(['kriegsspiel.hq.intray-state', scope.gameId, scope.sideId, scope.playerId]);
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (
  code: HqError['code'],
  message: string,
  retry: HqError['retry'] = 'after-resolution',
): Result<never> => ({ ok: false, error: { code, message, retry } });
let serial = 0;
const revision = () => `intray-${Date.now().toString(36)}-${(++serial).toString(36)}`;
function freezeDocument(doc: InTrayDocument): InTrayDocument {
  return Object.freeze({
    ...doc,
    scope: Object.freeze({ ...doc.scope }),
    records: Object.freeze(doc.records.map((r) => Object.freeze({ ...r }))),
  });
}
export function decodeDocument(raw: string, scope: Scope): Result<InTrayDocument> {
  if (raw.length > 512 * 1024)
    return fail('invalid-data', 'Stored in-tray state exceeds the size limit.');
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return fail('invalid-data', 'Stored in-tray state is corrupt; it has been preserved.');
  }
  if (object(v) && v.schemaVersion !== 1)
    return fail(
      'migration-required',
      'Stored in-tray version is unsupported; migration is required.',
    );
  if (
    !object(v) ||
    !keys(v, ['schemaVersion', 'scope', 'revision', 'records']) ||
    !validScope(v.scope) ||
    !id(v.revision) ||
    !Array.isArray(v.records) ||
    v.records.length > 2000
  )
    return fail('invalid-data', 'Stored in-tray state is invalid; it has been preserved.');
  if (!sameScope(v.scope, scope))
    return fail('scope-mismatch', 'Stored in-tray state belongs to another scope.');
  const seen = new Set<string>();
  for (const r of v.records) {
    if (
      !object(r) ||
      !keys(r, ['paperId', 'status']) ||
      !id(r.paperId) ||
      typeof r.status !== 'string' ||
      !statuses.has(r.status) ||
      seen.has(r.paperId)
    )
      return fail('invalid-data', 'Stored in-tray records are invalid; they have been preserved.');
    seen.add(r.paperId);
  }
  return ok(freezeDocument(v as unknown as InTrayDocument));
}
/** Single writer per scope. Raw comparison detects conflicts, not cross-tab atomicity. */
export function createInTrayStore(
  scope: Scope,
  storageFactory: () => StoragePort = () => window.localStorage,
) {
  const fixedScope = Object.freeze({ ...scope });
  let ui: StoreState = Object.freeze({
    document: null,
    busy: false,
    dirty: false,
    writable: false,
    error: null,
  });
  let storage: StoragePort | null = null;
  let baseline: string | null = null;
  let absenceDocument: InTrayDocument | null = null;
  let alive = true;
  const listeners = new Set<(value: StoreState) => void>();
  function deliver(fn: (value: StoreState) => void, value: StoreState) {
    if (!alive || !listeners.has(fn)) return;
    try {
      fn(value);
    } catch {
      // Observer failures cannot change storage outcomes or strand an operation.
    }
  }
  function publish(change: Partial<StoreState>) {
    if (!alive) return;
    ui = Object.freeze({ ...ui, ...change });
    const published = ui;
    for (const fn of [...listeners]) {
      if (!alive) break;
      deliver(fn, published);
    }
  }
  function errorResult(error: unknown): Result<never> {
    return typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      error.name === 'QuotaExceededError'
      ? fail('quota-exceeded', 'Storage quota exceeded. Changes remain unsaved.', 'same-request')
      : fail(
          'storage-unavailable',
          'Storage is unavailable. Changes have not been saved.',
          'same-request',
        );
  }
  async function load(discard = false, signal?: AbortSignal): Promise<Result<void>> {
    if (!alive || signal?.aborted) return fail('aborted', 'Load canceled.');
    if (ui.busy) return fail('not-ready', 'Storage is busy.');
    if (ui.dirty && !discard)
      return fail('conflict', 'Confirm discarding unsaved changes before reload.');
    publish({ busy: true });
    await Promise.resolve();
    let result: Result<InTrayDocument>;
    let raw: string | null = null;
    if (!alive || signal?.aborted) {
      publish({ busy: false });
      return fail('aborted', 'Load canceled.');
    }
    try {
      if (!validScope(fixedScope)) result = fail('invalid-data', 'In-tray scope is invalid.');
      else {
        storage ??= storageFactory();
        raw = storage.getItem(storageKey(fixedScope));
        result =
          raw === null
            ? ok(
                absenceDocument ??
                  freezeDocument({
                    schemaVersion: 1,
                    scope: fixedScope,
                    revision: revision(),
                    records: [],
                  }),
              )
            : decodeDocument(raw, fixedScope);
      }
    } catch (e) {
      result = errorResult(e);
    }
    if (!alive || signal?.aborted) {
      publish({ busy: false });
      return fail('aborted', 'Load canceled.');
    }
    if (result.ok === false) {
      publish({ busy: false, writable: false, error: result.error });
      return result;
    }
    baseline = raw;
    absenceDocument = raw === null ? result.value : null;
    publish({ document: result.value, busy: false, dirty: false, writable: true, error: null });
    return ok(undefined);
  }
  async function save(signal?: AbortSignal): Promise<Result<void>> {
    if (!alive || signal?.aborted) return fail('aborted', 'Save canceled.');
    if (ui.busy || !ui.writable || !ui.document || !storage)
      return fail('not-ready', 'Saved state is unavailable or busy.');
    if (!ui.dirty) return ok(undefined);
    const captured = ui.document;
    publish({ busy: true });
    await Promise.resolve();
    if (!alive || signal?.aborted) {
      publish({ busy: false });
      return fail('aborted', 'Save canceled.');
    }
    try {
      if (storage.getItem(storageKey(fixedScope)) !== baseline) {
        const result = fail(
          'conflict',
          'Stored state changed elsewhere. Export unsaved changes, then explicitly reload.',
        );
        if (result.ok === false) publish({ busy: false, writable: false, error: result.error });
        return result;
      }
      const next = freezeDocument({ ...captured, revision: revision() });
      const raw = JSON.stringify(next);
      if (raw.length > 512 * 1024) {
        const result = fail('invalid-data', 'In-tray state exceeds the size limit.');
        if (result.ok === false) publish({ busy: false, error: result.error });
        return result;
      }
      if (!alive || signal?.aborted) {
        publish({ busy: false });
        return fail('aborted', 'Save canceled.');
      }
      storage.setItem(storageKey(fixedScope), raw);
      // A completed synchronous write is committed even if the port cancels during it.
      baseline = raw;
      absenceDocument = null;
      publish({ document: next, dirty: false, busy: false, error: null });
      return ok(undefined);
    } catch (e) {
      const result = errorResult(e);
      if (result.ok === false) publish({ busy: false, error: result.error });
      return result;
    }
  }
  function update(paperId: string, status: PaperStatus): Promise<Result<void>> {
    if (!alive || ui.busy || !ui.writable || !ui.document)
      return Promise.resolve(
        fail('not-ready', 'Read-state was not saved: storage is unavailable or busy.'),
      );
    if (!id(paperId) || !statuses.has(status))
      return Promise.resolve(fail('invalid-data', 'Invalid paper state.'));
    const records = ui.document.records.filter((r) => r.paperId !== paperId);
    if (records.length >= 2000)
      return Promise.resolve(
        fail('invalid-data', 'In-tray state has reached its 2000-record limit.'),
      );
    records.push({ paperId, status });
    records.sort((a, b) => a.paperId.localeCompare(b.paperId));
    publish({ document: freezeDocument({ ...ui.document, records }), dirty: true });
    return save();
  }
  return {
    getState: () => ui,
    subscribe(fn: (value: StoreState) => void) {
      if (alive) {
        listeners.add(fn);
        deliver(fn, ui);
      }
      return () => {
        listeners.delete(fn);
      };
    },
    load,
    save,
    update,
    dispose() {
      alive = false;
      listeners.clear();
    },
  };
}
