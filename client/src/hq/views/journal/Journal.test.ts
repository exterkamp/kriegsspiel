// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import Journal from './Journal.svelte';
import TestHarness from './TestHarness.svelte';
import { writable } from 'svelte/store';
import type { HqSnapshot, Paper, Scope } from '../../contracts';
import { NOTE_LIMIT, notesKey, NotesStore, type NotesStorage, type StorageFactory } from './notes';

const scope: Scope = { gameId: 'fixture', sideId: 'blue', playerId: 'one' };
function paper(
  id = 'first',
  time = 2000,
  text = 'Bridge report',
  category: Paper['category'] = 'scouts',
): Paper {
  return {
    id,
    from: 'Scout',
    category,
    writtenAtGame: time - 1000,
    receivedAtGame: time,
    observedAtGame: null,
    location: null,
    unitId: null,
    sizeEstimate: null,
    confidence: null,
    text,
  };
}
function snapshot(papers: readonly Paper[] = [], session = scope): HqSnapshot {
  return {
    scope: session,
    epoch: 'fixture',
    ordinal: 1,
    authorityRevision: null,
    atGame: 10000,
    clock: {
      authoritativeGameMs: 10000,
      rate: 1,
      status: 'paused',
      mode: 'manual',
      barrier: { kind: 'unknown' },
      coherence: 'fixture-atomic',
      receivedMonotonicMs: 0,
    },
    roster: [],
    papers,
    pieces: [],
  };
}
function memory() {
  const records = new Map<string, string>();
  const storage: NotesStorage = {
    getItem: vi.fn((key) => records.get(key) ?? null),
    setItem: vi.fn((key, value) => {
      records.set(key, value);
    }),
  };
  return { records, storage, factory: () => storage };
}
let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null;
const flush = async () => {
  await tick();
  await tick();
};
beforeEach(() => {
  target = document.createElement('div');
  document.body.append(target);
});
afterEach(async () => {
  if (component) await unmount(component);
  component = null;
  target.remove();
  vi.restoreAllMocks();
});
async function render(
  value: HqSnapshot | null = snapshot(),
  factory: StorageFactory = memory().factory,
  session = scope,
) {
  component = mount(Journal, {
    target,
    props: { snapshot: value, scope: session, storageFactory: factory },
  });
  await flush();
}
async function remount(value: HqSnapshot | null, factory: StorageFactory, session = scope) {
  await unmount(component!);
  component = null;
  await render(value, factory, session);
}
function button(text: string) {
  return [...target.querySelectorAll('button')].find((el) => el.textContent === text)!;
}
async function input(selector: string, value: string, event = 'input') {
  const el = target.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    selector,
  )!;
  el.value = value;
  el.dispatchEvent(new Event(event, { bubbles: true }));
  await flush();
}
const notebook = () => target.querySelector<HTMLTextAreaElement>('textarea:not([readonly])')!;
const exported = () => target.querySelector<HTMLTextAreaElement>('textarea[readonly]')!;

describe('fixture journal DOM and storage', () => {
  it('deduplicates stable IDs and orders by received game time then ID with distinct written times', async () => {
    const first = paper('a', 2000);
    await render(snapshot([paper('z', 3000), first, { ...first }, paper('b', 2000)]));
    expect(
      [...target.querySelectorAll('article')].map((el) => el.getAttribute('aria-label')),
    ).toEqual(['Paper a', 'Paper b', 'Paper z']);
    expect(target.querySelector('article')?.textContent).toContain('1000 game ms');
    expect(target.querySelector('article')?.textContent).toContain('2000 game ms');
    expect(target.textContent?.replace(/\s+/g, ' ')).toContain(
      'Order history and pause history are unavailable',
    );
    expect(target.querySelector('article dd:last-child')?.textContent).toBe('Unavailable');
  });
  it('omits conflicting content under one ID instead of fabricating an event', async () => {
    await render(snapshot([paper(), paper('first', 2000, 'Changed report'), paper('safe')]));
    expect(target.querySelectorAll('article')).toHaveLength(1);
    expect(target.querySelector('[role="alert"]')?.textContent).toContain('Conflicting paper IDs');
    expect(target.textContent).not.toContain('Changed report');
  });
  it('renders full long text as literal text and exports without truncation or markup execution', async () => {
    const text = '<script>secret()</script>\n' + 'Long report '.repeat(1300);
    await render(snapshot([paper('long', 2000, text)]));
    expect(target.querySelector('.prose')?.textContent).toBe(text);
    expect(target.querySelector('script')).toBeNull();
    button('Prepare text export').click();
    await flush();
    expect(exported().value).toContain(text);
    expect(exported().readOnly).toBe(true);
    exported().focus();
    expect(exported().selectionEnd).toBe(exported().value.length);
    expect(target.textContent).toContain('select and copy');
  });
  it('searches text, sender and ID case-insensitively and exports only filtered papers and matching notes', async () => {
    await render(snapshot([paper('bridge', 2000), paper('staff-id', 3000, 'Supplies', 'staff')]));
    await input('textarea:not([readonly])', 'Remember bridge');
    await input('input[type="search"]', ' BRIDGE ');
    expect(target.querySelectorAll('article')).toHaveLength(1);
    button('Prepare text export').click();
    await flush();
    expect(exported().value).toContain('Remember bridge');
    expect(exported().value).toContain('unsaved edits');
    expect(exported().value).not.toContain('Supplies');
    await input('input[type="search"]', 'STAFF-ID');
    expect(target.querySelectorAll('article')).toHaveLength(1);
    await input('input[type="search"]', 'scout');
    expect(target.querySelectorAll('article')).toHaveLength(2);
    await input('select', 'staff', 'change');
    expect(target.querySelectorAll('article')).toHaveLength(1);
    button('Prepare text export').click();
    await flush();
    expect(exported().value).toContain('Supplies');
    expect(exported().value).not.toContain('Remember bridge');
    await input('select', 'notes', 'change');
    await input('input[type="search"]', 'no match');
    expect(target.querySelectorAll('article')).toHaveLength(0);
    expect(target.querySelector('[aria-label="Matching personal notes"]')).toBeNull();
  });
  it('separates missing/empty and scope mismatch; never displays another player paper', async () => {
    await render(null);
    expect(target.textContent).toContain('Waiting for a supplied snapshot');
    const storage = memory();
    await remount(snapshot(), storage.factory);
    expect(target.textContent).toContain('No supplied papers match');
    await remount(snapshot([paper('private')], { ...scope, playerId: 'other' }), storage.factory);
    expect(target.textContent).toContain('different HQ sessions');
    expect(target.textContent).not.toContain('Bridge report');
  });
  it('saves notes across reload, isolates each game/side/player and accepts equal-valued scopes', async () => {
    const storage = memory();
    await render(snapshot(), storage.factory, { ...scope });
    await input('textarea:not([readonly])', 'Personal memorandum');
    expect(target.textContent).toContain('Unsaved edits');
    button('Save personal notes').click();
    await flush();
    expect(target.textContent).toContain('Notes saved in this browser');
    await remount(snapshot(), storage.factory);
    expect(notebook().value).toBe('Personal memorandum');
    for (const session of [
      { ...scope, gameId: 'other' },
      { ...scope, sideId: 'red' },
      { ...scope, playerId: 'two' },
    ]) {
      await remount(snapshot([], session), storage.factory, session);
      expect(notebook().value).toBe('');
      await input('textarea:not([readonly])', session.gameId + session.sideId + session.playerId);
      button('Save personal notes').click();
      await flush();
    }
    await remount(snapshot(), storage.factory);
    expect(notebook().value).toBe('Personal memorandum');
    expect(storage.records.size).toBe(4);
    expect(notesKey({ gameId: 'a,b', sideId: 'c', playerId: 'd' })).not.toBe(
      notesKey({ gameId: 'a', sideId: 'b,c', playerId: 'd' }),
    );
  });
  it.each([
    '{broken',
    JSON.stringify({ schemaVersion: 2, data: 'future' }),
    JSON.stringify({ schemaVersion: 1, scope, text: '', extra: true }),
    JSON.stringify({ schemaVersion: 1, scope: { ...scope, playerId: 'other' }, text: 'private' }),
  ])(
    'preserves invalid/future/mismatched records and visibly blocks overwrites: %s',
    async (raw) => {
      const storage = memory();
      storage.records.set(notesKey(scope), raw);
      await render(snapshot(), storage.factory);
      expect(notebook().disabled).toBe(true);
      expect(button('Save personal notes').disabled).toBe(true);
      expect(target.textContent).toContain('preserved');
      expect(notebook().value).toBe('');
      expect(storage.records.get(notesKey(scope))).toBe(raw);
      expect(storage.storage.setItem).not.toHaveBeenCalled();
    },
  );
  it.each(['QuotaExceededError', 'SecurityError', 'Error'])(
    'reports %s saves without claiming success or losing unsaved text',
    async (name) => {
      const storage = memory();
      await render(snapshot(), storage.factory);
      vi.mocked(storage.storage.setItem).mockImplementation(() => {
        const error = new Error('private details');
        error.name = name;
        throw error;
      });
      await input('textarea:not([readonly])', 'Keep this note');
      button('Save personal notes').click();
      await flush();
      expect(target.textContent).toContain('Notes were not saved');
      expect(target.textContent).not.toContain('private details');
      expect(target.textContent).not.toContain('Notes saved in this browser');
      expect(notebook().value).toBe('Keep this note');
      expect(storage.records.size).toBe(0);
      button('Prepare text export').click();
      await flush();
      expect(exported().value).toContain('Keep this note');
      expect(exported().value).toContain('unsaved edits');
    },
  );
  it('handles lazy factory denial and supports explicit load retry', async () => {
    const storage = memory();
    const factory = vi.fn<StorageFactory>(() => {
      throw new Error('private');
    });
    expect(factory).not.toHaveBeenCalled();
    await render(snapshot(), factory);
    expect(target.textContent).toContain('Notes cannot be loaded');
    expect(button('Save personal notes').disabled).toBe(true);
    factory.mockImplementation(storage.factory);
    button('Reload local notes (discard edits)').click();
    await flush();
    expect(notebook().disabled).toBe(false);
  });
  it('detects observed external changes and preserves both stored data and editable unsaved text', async () => {
    const storage = memory();
    await render(snapshot(), storage.factory);
    await input('textarea:not([readonly])', 'My edits');
    const external = JSON.stringify({ schemaVersion: 1, scope, text: 'Other writer' });
    storage.records.set(notesKey(scope), external);
    button('Save personal notes').click();
    await flush();
    expect(target.textContent).toContain('changed elsewhere');
    expect(notebook().value).toBe('My edits');
    expect(storage.records.get(notesKey(scope))).toBe(external);
    button('Reload local notes (discard edits)').click();
    await flush();
    expect(notebook().value).toBe('Other writer');
  });
  it('replaces supplied papers on refresh without accumulating a fabricated history', async () => {
    const storage = memory();
    const session = writable({ snapshot: snapshot([paper('old')]), scope });
    component = mount(TestHarness, { target, props: { session, storageFactory: storage.factory } });
    await flush();
    session.set({ snapshot: snapshot([paper('new'), paper('new')]), scope });
    await flush();
    expect(target.querySelectorAll('article')).toHaveLength(1);
    expect(target.querySelector('article')?.getAttribute('aria-label')).toBe('Paper new');
    expect(target.textContent).not.toContain('Paper ID: old');
  });
  it('clears notes, search and export on reactive scope changes and preserves equal scope edits', async () => {
    const storage = memory();
    const session = writable({ snapshot: snapshot([paper('first')]), scope });
    component = mount(TestHarness, { target, props: { session, storageFactory: storage.factory } });
    await flush();
    await input('textarea:not([readonly])', 'Saved for one');
    button('Save personal notes').click();
    await flush();
    await input('textarea:not([readonly])', 'Unsaved for one');
    session.update((value) => ({ ...value, scope: { ...scope } }));
    await flush();
    expect(notebook().value).toBe('Unsaved for one');
    await input('input[type="search"]', 'one');
    button('Prepare text export').click();
    await flush();
    expect(exported().value).toContain('Unsaved for one');
    const other = { ...scope, playerId: 'two' };
    session.set({
      scope: other,
      snapshot: snapshot([paper('second', 2000, 'Second player report')], other),
    });
    await flush();
    expect(notebook().value).toBe('');
    expect(exported()).toBeNull();
    expect(target.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe('');
    expect(target.textContent).not.toContain('Unsaved for one');
    await input('textarea:not([readonly])', 'Saved for two');
    button('Save personal notes').click();
    await flush();
    session.set({ scope: { ...scope }, snapshot: snapshot([paper('first')]) });
    await flush();
    expect(notebook().value).toBe('Saved for one');
    expect(storage.records.get(notesKey(other))).toContain('Saved for two');
  });
  it('defaults lazily to localStorage and retains a previously saved record after quota failure', async () => {
    window.localStorage.clear();
    component = mount(Journal, { target, props: { snapshot: snapshot(), scope } });
    await flush();
    await input('textarea:not([readonly])', 'Durable note');
    button('Save personal notes').click();
    await flush();
    const previous = window.localStorage.getItem(notesKey(scope));
    await unmount(component!);
    component = null;
    component = mount(Journal, { target, props: { snapshot: snapshot(), scope } });
    await flush();
    expect(notebook().value).toBe('Durable note');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('private', 'QuotaExceededError');
    });
    await input('textarea:not([readonly])', 'Unsaved replacement');
    button('Save personal notes').click();
    await flush();
    expect(target.textContent).toContain('quota exceeded');
    expect(window.localStorage.getItem(notesKey(scope))).toBe(previous);
    expect(notebook().value).toBe('Unsaved replacement');
    vi.restoreAllMocks();
    window.localStorage.clear();
  });
  it('enforces finite notes/JSON limits and strict nested scope keys', () => {
    const storage = memory();
    const store = new NotesStore(scope, storage.factory);
    expect(store.load().ok).toBe(true);
    expect(store.save('x'.repeat(NOTE_LIMIT)).ok).toBe(true);
    const baseline = storage.records.get(notesKey(scope));
    expect(store.save('x'.repeat(NOTE_LIMIT + 1)).ok).toBe(false);
    expect(storage.records.get(notesKey(scope))).toBe(baseline);
    for (const raw of [
      'x'.repeat(131073),
      JSON.stringify({ schemaVersion: 1, scope: { ...scope, hidden: true }, text: '' }),
    ]) {
      storage.records.set(notesKey(scope), raw);
      expect(store.load().ok).toBe(false);
      expect(store.save('overwrite').ok).toBe(false);
      expect(storage.records.get(notesKey(scope))).toBe(raw);
    }
  });
});
