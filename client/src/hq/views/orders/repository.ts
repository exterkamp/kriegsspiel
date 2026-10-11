import type { HqError, Result, Scope } from '../../contracts';
export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface DraftDocument {
  readonly schemaVersion: 1;
  readonly scope: Scope;
  readonly revision: string;
  readonly recipientUnitId: string | null;
  readonly text: string;
}
export interface DraftRepositoryState {
  readonly document: DraftDocument | null;
  readonly writable: boolean;
  readonly disposed: boolean;
}
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (
  code: HqError['code'],
  message: string,
  retry: HqError['retry'] = 'after-resolution',
): Result<never> => ({ ok: false, error: { code, message, retry } });
const id = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128;
function record(value: unknown, fields: string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return (
    Reflect.ownKeys(descriptors).length === fields.length &&
    fields.every((key) => descriptors[key] && 'value' in descriptors[key]!)
  );
}
const validScope = (value: unknown): value is Scope =>
  record(value, ['gameId', 'sideId', 'playerId']) &&
  id(value.gameId) &&
  id(value.sideId) &&
  id(value.playerId);
export const sameScope = (a: Scope, b: Scope) =>
  a.gameId === b.gameId && a.sideId === b.sideId && a.playerId === b.playerId;
export const storageKey = (scope: Scope) =>
  JSON.stringify(['kriegsspiel.hq.order-draft', scope.gameId, scope.sideId, scope.playerId]);
function freeze(value: DraftDocument): DraftDocument {
  return Object.freeze({ ...value, scope: Object.freeze({ ...value.scope }) });
}
export function validateDraft(value: unknown, scope: Scope): Result<DraftDocument> {
  if (!record(value, ['schemaVersion', 'scope', 'revision', 'recipientUnitId', 'text']))
    return fail('invalid-data', 'Draft record has invalid fields.');
  if (
    typeof value.schemaVersion === 'number' &&
    Number.isInteger(value.schemaVersion) &&
    value.schemaVersion !== 1
  )
    return fail(
      'migration-required',
      'Draft version is unsupported; migration is required. Stored data is preserved.',
    );
  if (
    value.schemaVersion !== 1 ||
    !validScope(value.scope) ||
    !id(value.revision) ||
    !(value.recipientUnitId === null || id(value.recipientUnitId)) ||
    typeof value.text !== 'string' ||
    value.text.length > 16384
  )
    return fail(
      'invalid-data',
      'Draft must have valid identifiers and at most 16384 text characters.',
    );
  if (!sameScope(value.scope, scope))
    return fail('scope-mismatch', 'Draft belongs to another game, side or player.');
  const cloned = freeze(value as unknown as DraftDocument);
  if (JSON.stringify(cloned).length > 65536)
    return fail('invalid-data', 'Draft record exceeds 65536 characters.');
  return ok(cloned);
}
export function decodeDraft(raw: string, scope: Scope): Result<DraftDocument> {
  if (raw.length > 65536)
    return fail('invalid-data', 'Stored draft exceeds 65536 characters and is preserved.');
  try {
    return validateDraft(JSON.parse(raw), scope);
  } catch {
    return fail('invalid-data', 'Stored draft is corrupt and has been preserved.');
  }
}
function storageFailure(error: unknown): Result<never> {
  return typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'QuotaExceededError'
    ? fail('quota-exceeded', 'Storage quota exceeded. Draft remains unsaved.', 'same-request')
    : fail('storage-unavailable', 'Storage is unavailable. Draft remains unsaved.', 'same-request');
}
/** Synchronous single-writer repository. Raw checks detect observed changes, not cross-tab atomicity. */
export function createDraftRepository(
  scope: Scope,
  storageFactory: () => StoragePort = () => window.localStorage,
  makeRevision: () => string = () => crypto.randomUUID(),
) {
  const scopeIsValid = validScope(scope);
  const fixedScope = Object.freeze(
    scopeIsValid ? { ...scope } : { gameId: '', sideId: '', playerId: '' },
  );
  let storage: StoragePort | null = null;
  let document: DraftDocument | null = null;
  let absence: DraftDocument | null = null;
  let baseline: string | null = null;
  let writable = false;
  let disposed = false;
  let operating = false;
  const terminal = () => fail('disposed', 'Draft repository has been disposed.', 'never');
  function load(): Result<DraftDocument> {
    if (disposed) return terminal();
    if (operating) return fail('conflict', 'A draft storage operation is already in progress.');
    operating = true;
    try {
      if (!scopeIsValid) {
        writable = false;
        return fail('invalid-data', 'Draft scope is invalid.');
      }
      storage ??= storageFactory();
      if (disposed) return terminal();
      const raw = storage.getItem(storageKey(fixedScope));
      if (disposed) return terminal();
      const result =
        raw === null
          ? validateDraft(
              absence ?? {
                schemaVersion: 1,
                scope: fixedScope,
                revision: makeRevision(),
                recipientUnitId: null,
                text: '',
              },
              fixedScope,
            )
          : decodeDraft(raw, fixedScope);
      if (disposed) return terminal();
      if (result.ok === false) {
        writable = false;
        return result;
      }
      // Revision callbacks can change storage; do not accept a superseded baseline.
      if (storage.getItem(storageKey(fixedScope)) !== raw) {
        writable = false;
        return fail('conflict', 'Stored draft changed during load. Reload explicitly.');
      }
      if (disposed) return terminal();
      document = result.value;
      baseline = raw;
      absence = raw === null ? document : null;
      writable = true;
      return ok(document);
    } catch (error) {
      if (disposed) return terminal();
      writable = false;
      return storageFailure(error);
    } finally {
      operating = false;
    }
  }
  function save(submission: DraftDocument, expectedRevision: string): Result<DraftDocument> {
    if (disposed) return terminal();
    if (operating) return fail('conflict', 'A draft storage operation is already in progress.');
    operating = true;
    const capturedBaseline = baseline;
    const capturedRevision = document?.revision;
    try {
      if (!writable || !document || !storage)
        return fail(
          'not-ready',
          'Saved draft is unavailable. Export your text and explicitly reload before saving.',
        );
      const parsed = validateDraft(submission, fixedScope);
      if (parsed.ok === false) return parsed;
      const captured = parsed.value;
      if (expectedRevision !== capturedRevision || captured.revision !== capturedRevision) {
        writable = false;
        return fail('conflict', 'Draft revision changed. Reload explicitly.');
      }
      const conflict = () => {
        writable = false;
        return fail(
          'conflict',
          'Stored draft changed elsewhere. Export your text, then explicitly reload.',
        );
      };
      if (storage.getItem(storageKey(fixedScope)) !== capturedBaseline) return conflict();
      if (disposed) return terminal();
      const next = validateDraft({ ...captured, revision: makeRevision() }, fixedScope);
      if (disposed) return terminal();
      if (next.ok === false) return next;
      if (next.value.revision === capturedRevision)
        return fail('invalid-data', 'A new distinct draft revision is required.');
      const raw = JSON.stringify(next.value);
      // Final comparison follows revision callbacks and uses the captured baseline.
      if (storage.getItem(storageKey(fixedScope)) !== capturedBaseline) return conflict();
      if (disposed) return terminal();
      storage.setItem(storageKey(fixedScope), raw);
      // Physical synchronous commit remains successful after terminal callback disposal.
      if (!disposed) {
        document = next.value;
        baseline = raw;
        absence = null;
      }
      return ok(next.value);
    } catch (error) {
      if (disposed) return terminal();
      return storageFailure(error);
    } finally {
      operating = false;
    }
  }
  return {
    scope: fixedScope,
    load,
    save,
    getState: (): DraftRepositoryState =>
      Object.freeze({ document, writable: writable && !disposed, disposed }),
    dispose() {
      disposed = true;
      writable = false;
    },
  };
}
