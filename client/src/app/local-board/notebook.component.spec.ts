import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalBoardBinding, LocalScope } from './contracts';
import { NotebookComponent } from './notebook.component';
import { PersonalRepository, personalRecordKey, type PersonalStorage } from './personal-repository';
import { PersonalStore } from './personal-store';

const scope: LocalScope = {
  gameId: 'local-00000000-0000-4000-8000-000000000021',
  sideId: 'blue',
  playerId: 'local-general',
};
const digest = 'a'.repeat(64);
const binding: LocalBoardBinding = {
  assetIdentity: digest,
  revision: digest,
  mapId: `local-map:${digest}`,
  bounds: { minX: 0, minY: 0, maxX: 5000, maxY: 3000 },
  registration: { origin: 'north-west', units: 'metres', xAxis: 'east', yAxis: 'south' },
};
let fixture: ComponentFixture<NotebookComponent>;
let store: PersonalStore;
let records: Map<string, string>;
let storage: PersonalStorage;
beforeEach(async () => {
  records = new Map();
  storage = {
    getItem: vi.fn((key: string) => records.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      records.set(key, value);
    }),
  };
  store = new PersonalStore(
    scope,
    binding,
    new PersonalRepository(scope, binding, { storage: () => storage }),
  );
  await store.initialize();
  store.setInteractionEnabled(true);
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  await render();
});
afterEach(async () => {
  fixture?.destroy();
  await store.dispose();
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});
async function render() {
  fixture = TestBed.createComponent(NotebookComponent);
  fixture.componentRef.setInput('store', store);
  await fixture.whenStable();
}
function root(): HTMLElement {
  return fixture.nativeElement;
}
function text(): HTMLTextAreaElement {
  return root().querySelector('textarea[name="notebook-text"]')!;
}
function exportText(): HTMLElement {
  return root().querySelector('[aria-label="Selectable notebook export"]')!;
}
function button(label: string): HTMLButtonElement {
  return [...root().querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;
}
async function type(value: string) {
  text().value = value;
  text().dispatchEvent(new Event('input', { bubbles: true }));
  await fixture.whenStable();
}
async function click(label: string) {
  button(label).click();
  await fixture.whenStable();
}

describe('native personal notebook', () => {
  it('renders literal script-like text, searches the unsaved draft and exports it exactly', async () => {
    const raw = '  <script>alert("private")</script>\nVillage\nvILLAGE\n<&>  ';
    await type(raw);
    const search = root().querySelector<HTMLInputElement>('[name="notebook-search"]')!;
    search.value = '  VILLage  ';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(text().value).toBe(raw);
    expect(store.notebookQuery()).toBe('  VILLage  ');
    expect(store.notebookMatches()).toHaveLength(2);
    expect(exportText().textContent).toBe(store.notebookExport());
    expect(exportText().textContent).toContain(raw);
    expect(root().textContent).toContain('Includes unsaved notebook changes.');
    expect(exportText().tabIndex).toBe(0);
    expect(exportText().querySelector('script')).toBeNull();
    expect(root().querySelector('script')).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('accepts the exact text limit and rejects one-over without truncating the retained draft', async () => {
    const exact = '<&>\n'.repeat(4096);
    await type(exact);
    expect(store.notebook().draft).toBe(exact);
    expect(text().maxLength).toBe(16_384);
    await type(exact + 'x');
    expect(store.notebook().draft).toBe(exact);
    expect(text().value).toBe(exact);
    expect(exportText().textContent).toContain(exact);
    expect(root().querySelector('[role="alert"]')?.textContent).toContain(
      store.notebook().error?.message,
    );
  });

  it('keeps focus and selection when typing and signal-driven search changes', async () => {
    text().focus();
    await type('Unfinished notebook');
    text().setSelectionRange(4, 10);
    store.setNotebookQuery('notebook');
    await fixture.whenStable();
    expect(document.activeElement).toBe(text());
    expect(text().selectionStart).toBe(4);
    expect(text().selectionEnd).toBe(10);
  });

  it('makes failed reload text selectable/read-only and preserves exact dirty export until explicit recovery', async () => {
    await type('unsaved\n<private>  ');
    const prepared = store.notebookExport();
    const key = personalRecordKey('notebook', scope, binding);
    records.set(key, '{corrupt private stored bytes');
    await click('Reload notebook');
    expect(records.get(key)).toBe('{corrupt private stored bytes');
    expect(text().value).toBe('unsaved\n<private>  ');
    expect(text().readOnly).toBe(true);
    expect(text().disabled).toBe(false);
    text().focus();
    text().select();
    expect(text().selectionEnd).toBe(text().value.length);
    expect(store.notebook().dirty).toBe(true);
    expect(exportText().textContent).toBe(prepared);
    expect(button('Save notebook').disabled).toBe(true);
    expect(button('Reload notebook').disabled).toBe(false);
    expect(root().querySelector('[role="alert"]')?.textContent).toBe(
      store.notebook().error?.message,
    );
    expect(root().textContent).not.toContain('corrupt private stored bytes');
    records.delete(key);
    await click('Reload notebook');
    expect(text().readOnly).toBe(false);
    expect(text().value).toBe('');
    expect(root().querySelector('[role="alert"]')).toBeNull();
  });

  it('shows sanitized quota failure, retains editable dirty text and permits explicit retry', async () => {
    await type('recoverable notebook');
    vi.mocked(storage.setItem).mockImplementationOnce(() => {
      throw new DOMException('secret filesystem path', 'QuotaExceededError');
    });
    await click('Save notebook');
    expect(store.notebook().dirty).toBe(true);
    expect(text().readOnly).toBe(false);
    expect(root().querySelector('[role="alert"]')?.textContent).toContain('full');
    expect(root().textContent).not.toContain('secret filesystem path');
    expect(exportText().textContent).toContain('recoverable notebook');
    await click('Save notebook');
    expect(store.notebook().dirty).toBe(false);
    expect(JSON.parse(records.get(personalRecordKey('notebook', scope, binding))!).text).toBe(
      'recoverable notebook',
    );
    expect(root().querySelector('[role="alert"]')).toBeNull();
  });

  it('gates editing/save/reload/navigation behind a dialog while keeping search and export usable', async () => {
    await type('private draft searchable');
    const returned = vi.fn();
    fixture.componentInstance.returnToTable.subscribe(returned);
    store.setInteractionEnabled(false);
    await fixture.whenStable();
    expect(text().readOnly).toBe(true);
    for (const label of ['Save notebook', 'Reload notebook', 'Return to table']) {
      expect(button(label).disabled).toBe(true);
      await click(label);
    }
    await type('blocked edit');
    expect(text().value).toBe('private draft searchable');
    store.setNotebookQuery('draft');
    await fixture.whenStable();
    expect(store.notebookMatches()).toHaveLength(1);
    expect(exportText().textContent).toContain('private draft searchable');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(returned).not.toHaveBeenCalled();
    store.setInteractionEnabled(true);
    await fixture.whenStable();
    await click('Return to table');
    expect(returned).toHaveBeenCalledOnce();
    expect(store.notebook().draft).toBe('private draft searchable');
  });

  it('component recreation and equal-valued input rerenders never initialize or dispose the session store', async () => {
    await type('navigation keeps this draft');
    store.setNotebookQuery('keeps');
    const initialize = vi.spyOn(store, 'initialize');
    const dispose = vi.spyOn(store, 'dispose');
    fixture.componentRef.setInput('store', store);
    await fixture.whenStable();
    fixture.destroy();
    await render();
    expect(text().value).toBe('navigation keeps this draft');
    expect(store.notebookQuery()).toBe('keeps');
    expect(exportText().textContent).toBe(store.notebookExport());
    expect(initialize).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
  });

  it('labels the only notebook textarea and native search/actions without auto-saving on return', async () => {
    expect(root().querySelectorAll('textarea')).toHaveLength(1);
    expect(text().closest('label')?.textContent).toContain('Notebook text');
    expect(
      root().querySelector('[name="notebook-search"]')?.closest('label')?.textContent,
    ).toContain('Search notebook');
    expect([...root().querySelectorAll('button')].every((b) => b.type === 'button')).toBe(true);
    await type('not saved by navigation');
    const returned = vi.fn();
    fixture.componentInstance.returnToTable.subscribe(returned);
    await click('Return to table');
    expect(returned).toHaveBeenCalledOnce();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(store.notebook().dirty).toBe(true);
  });
});
