import { z } from 'zod';
import type { Scope } from '../../contracts';

export const NOTE_LIMIT = 16384;
export const RECORD_LIMIT = 131072;
const id = z.string().min(1).max(128);
export const notesSchema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z.object({ gameId: id, sideId: id, playerId: id }).strict(),
    text: z.string().max(NOTE_LIMIT),
  })
  .strict();
export type NotesDocument = z.infer<typeof notesSchema>;
export interface NotesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export type StorageFactory = () => NotesStorage;
// Access only when a mounted view loads/saves, never at module evaluation.
export const browserStorage: StorageFactory = () => window.localStorage;
export const sameScope = (a: Scope, b: Scope) =>
  a.gameId === b.gameId && a.sideId === b.sideId && a.playerId === b.playerId;
export const notesKey = (scope: Scope) =>
  JSON.stringify(['kriegsspiel.hq.journal-notes', scope.gameId, scope.sideId, scope.playerId]);
export type NotesResult = { ok: true; text: string } | { ok: false; message: string };
const invalid = (): NotesResult => ({
  ok: false,
  message:
    'Stored notes are corrupt or exceed the limits. The record was preserved; saving is blocked.',
});

/** A single view writer, with observed-change detection only. No cross-tab atomicity. */
export class NotesStore {
  private baseline: string | null | undefined;
  private writable = false;
  private busy = false;
  private reentered = false;
  private readonly scope: Scope;
  constructor(
    scope: Scope,
    private readonly storage: StorageFactory = browserStorage,
  ) {
    this.scope = { ...scope };
  }
  private enter(): NotesResult | null {
    if (this.busy) {
      this.reentered = true;
      return { ok: false, message: 'A notebook operation is already in progress. Retry loading.' };
    }
    this.busy = true;
    this.reentered = false;
    return null;
  }
  private interrupted(): NotesResult {
    this.writable = false;
    return {
      ok: false,
      message: 'The notebook operation was interrupted. Saving is blocked; retry loading.',
    };
  }
  load(): NotesResult {
    const blocked = this.enter();
    if (blocked) return blocked;
    this.writable = false;
    try {
      // Validate scope even if no record exists.
      if (!notesSchema.safeParse({ schemaVersion: 1, scope: this.scope, text: '' }).success)
        return { ok: false, message: 'Invalid journal scope. Saving is blocked.' };
      const raw = this.storage().getItem(notesKey(this.scope));
      if (this.reentered) return this.interrupted();
      if (raw !== null) {
        if (raw.length > RECORD_LIMIT) return invalid();
        let value: unknown;
        try {
          value = JSON.parse(raw);
        } catch {
          return invalid();
        }
        if (
          value &&
          typeof value === 'object' &&
          'schemaVersion' in value &&
          typeof value.schemaVersion === 'number' &&
          value.schemaVersion > 1
        )
          return {
            ok: false,
            message:
              'Stored notes use a future version. The record was preserved; saving is blocked.',
          };
        const parsed = notesSchema.safeParse(value);
        if (!parsed.success) return invalid();
        if (!sameScope(parsed.data.scope, this.scope))
          return {
            ok: false,
            message:
              'Stored notes belong to another HQ session. The record was preserved; saving is blocked.',
          };
        this.baseline = raw;
        this.writable = true;
        return { ok: true, text: parsed.data.text };
      }
      this.baseline = null;
      this.writable = true;
      return { ok: true, text: '' };
    } catch {
      return {
        ok: false,
        message:
          'Browser storage access failed or was denied. Notes cannot be loaded. Retry loading.',
      };
    } finally {
      this.busy = false;
    }
  }
  save(text: string): NotesResult {
    const blocked = this.enter();
    if (blocked) return blocked;
    try {
      return this.saveCurrent(text);
    } finally {
      this.busy = false;
    }
  }
  private saveCurrent(text: string): NotesResult {
    if (!this.writable)
      return {
        ok: false,
        message: 'Notes have not been safely loaded. Saving is blocked; retry loading.',
      };
    const parsed = notesSchema.safeParse({ schemaVersion: 1, scope: this.scope, text });
    if (!parsed.success)
      return {
        ok: false,
        message: `Notes exceed the ${NOTE_LIMIT} character limit and were not saved.`,
      };
    try {
      const baseline = this.baseline;
      const storage = this.storage();
      const observed = storage.getItem(notesKey(this.scope));
      if (this.reentered) return this.interrupted();
      if (observed !== baseline) {
        this.writable = false;
        return {
          ok: false,
          message:
            'Stored notes changed elsewhere. Your edits were not saved. Copy them before reloading notes.',
        };
      }
      const raw = JSON.stringify(parsed.data);
      if (raw.length > RECORD_LIMIT) return invalid();
      storage.setItem(notesKey(this.scope), raw);
      this.baseline = raw;
      return { ok: true, text };
    } catch (error) {
      const quota =
        error !== null &&
        typeof error === 'object' &&
        'name' in error &&
        error.name === 'QuotaExceededError';
      return {
        ok: false,
        message: quota
          ? 'Browser storage is full (quota exceeded). Notes were not saved; keep a text copy and retry.'
          : 'Browser storage access failed or was denied. Notes were not saved; keep a text copy and retry.',
      };
    }
  }
}
