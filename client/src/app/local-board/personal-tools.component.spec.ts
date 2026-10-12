import { webcrypto } from 'node:crypto';
import { assetIdentity, canonicalizeAsset, createReferenceAsset } from '@kriegsspiel/maps';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  provideZonelessChangeDetection,
  signal,
  viewChild,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CertifiedBoard } from '../../shared/game-setup/contracts';
import { prepareRaster, rasterLayout } from '../../shared/map-table/raster';
import { createLocalBoardBinding } from './board-binding';
import {
  BOARD_SURFACE_FACTORY,
  BoardHostComponent,
  type BoardSurfaceFactory,
} from './board-host.component';
import { BoardSurface, type BoardScene } from './board-surface';
import type { LocalBoardBinding, LocalScope } from './contracts';
import { NotebookComponent } from './notebook.component';
import { PersonalRepository, personalRecordKey, type PersonalStorage } from './personal-repository';
import { PersonalStore, type ManualTool } from './personal-store';
import { PersonalToolsComponent } from './personal-tools.component';

const scope: LocalScope = {
  gameId: 'local-00000000-0000-4000-8000-000000000022',
  sideId: 'blue',
  playerId: 'local-general',
};
const digest = 'b'.repeat(64);
const binding: LocalBoardBinding = {
  assetIdentity: digest,
  revision: digest,
  mapId: `local-map:${digest}`,
  bounds: { minX: 0, minY: 0, maxX: 5000, maxY: 3000 },
  registration: { origin: 'north-west', units: 'metres', xAxis: 'east', yAxis: 'south' },
};
let fixture: ComponentFixture<PersonalToolsComponent>;
let store: PersonalStore;
let records: Map<string, string>;
let writes: ReturnType<typeof vi.fn<PersonalStorage['setItem']>>;
beforeEach(async () => {
  records = new Map();
  writes = vi.fn((key: string, value: string) => {
    records.set(key, value);
  });
  let id = 0;
  let revision = 0;
  store = new PersonalStore(
    scope,
    binding,
    new PersonalRepository(scope, binding, {
      storage: () => ({ getItem: (key) => records.get(key) ?? null, setItem: writes }),
      revision: () => `test-revision-${++revision}`,
    }),
    { markId: () => `mark-${++id}` },
  );
  await store.initialize();
  store.setInteractionEnabled(true);
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
});
afterEach(async () => {
  fixture?.destroy();
  await store.dispose();
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render() {
  fixture = TestBed.createComponent(PersonalToolsComponent);
  fixture.componentRef.setInput('store', store);
  await fixture.whenStable();
}
function root(): HTMLElement {
  return fixture.nativeElement;
}
function button(label: string): HTMLButtonElement {
  return [...root().querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;
}
async function click(label: string) {
  button(label).click();
  await fixture.whenStable();
}
async function field(name: string, value: string) {
  const control = root().querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  control.value = value;
  control.dispatchEvent(new Event('input', { bubbles: true }));
  await fixture.whenStable();
}
async function coordinates(x = '11.25', y = '22.125') {
  await field('mark-x', x);
  await field('mark-y', y);
}
function key(target: Element, value: string, extra: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: value,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
  target.dispatchEvent(event);
  return event;
}
const toolName = (tool: ManualTool) =>
  tool === 'polyline' ? 'Line' : tool[0]!.toUpperCase() + tool.slice(1);

describe('native personal marks', () => {
  it.each(['pin', 'symbol', 'ring', 'polyline', 'arrow'] as const)(
    'creates, edits label/geometry and deletes a labelled fractional %s through genuine DOM events',
    async (tool) => {
      await render();
      await click(`New ${toolName(tool)}`);
      await field('mark-label', `<${tool} & village>`);
      await coordinates();
      if (tool === 'symbol') {
        const select = root().querySelector<HTMLSelectElement>('[name="mark-symbol"]')!;
        select.value = 'flag';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (tool === 'ring') await field('mark-radius', '125.75');
      const multi = tool === 'polyline' || tool === 'arrow';
      if (multi) {
        expect(button('Finish mark').disabled).toBe(true);
        await click('Add point');
        await coordinates('31.5', '42.625');
        await click('Add point');
        await click('Finish mark');
      } else await click('Add mark');
      expect(store.marks().draft).toHaveLength(1);
      const original = store.marks().draft[0]!;
      expect(original.label).toBe(`<${tool} & village>`);
      expect(original.source).toEqual({ kind: 'manual' });
      expect(original.placedAtGame).toBe(0);
      expect(original.editedAtGame).toBeNull();
      if (multi)
        expect(original.geometry).toEqual({
          kind: tool,
          points: [
            { x: 11.25, y: 22.125 },
            { x: 31.5, y: 42.625 },
          ],
        });
      else if (tool === 'ring')
        expect(original.geometry).toEqual({
          kind: tool,
          centre: { x: 11.25, y: 22.125 },
          radiusM: 125.75,
        });
      else
        expect(original.geometry).toEqual({
          kind: tool,
          at: { x: 11.25, y: 22.125 },
          ...(tool === 'symbol' ? { symbol: 'flag' } : {}),
        });
      expect(root().querySelector('.marks')?.textContent).toContain(original.label);
      expect(root().querySelector('.marks span')?.children).toHaveLength(0);
      const edit = root().querySelector<HTMLButtonElement>('.marks button')!;
      expect(edit.getAttribute('aria-label')).toContain(`Edit ${tool}:`);
      edit.click();
      await fixture.whenStable();
      await field('mark-label', 'Edited village');
      await coordinates('51.75', '62.875');
      if (multi) {
        await click('Remove point 2');
        await click('Add point');
        await click('Finish edit');
      } else {
        if (tool === 'ring') await field('mark-radius', '225.5');
        if (tool === 'symbol') {
          const select = root().querySelector<HTMLSelectElement>('[name="mark-symbol"]')!;
          select.value = 'dot';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        await click('Apply edit');
      }
      const edited = store.marks().draft[0]!;
      expect(edited).toMatchObject({
        id: original.id,
        scope: original.scope,
        binding: original.binding,
        source: original.source,
        placedAtGame: 0,
        editedAtGame: 0,
        label: 'Edited village',
      });
      if (multi)
        expect(edited.geometry).toEqual({
          kind: tool,
          points: [
            { x: 11.25, y: 22.125 },
            { x: 51.75, y: 62.875 },
          ],
        });
      else if (tool === 'ring')
        expect(edited.geometry).toEqual({
          kind: tool,
          centre: { x: 51.75, y: 62.875 },
          radiusM: 225.5,
        });
      else
        expect(edited.geometry).toEqual({
          kind: tool,
          at: { x: 51.75, y: 62.875 },
          ...(tool === 'symbol' ? { symbol: 'dot' } : {}),
        });
      expect(
        root()
          .querySelector<HTMLButtonElement>('.marks button:last-child')!
          .getAttribute('aria-label'),
      ).toContain(`Delete ${tool}: Edited village`);
      await click('Delete');
      expect(store.marks().draft).toHaveLength(0);
      expect(store.sceneMarks()).toHaveLength(0);
      expect(writes).not.toHaveBeenCalled();
    },
  );

  it.each(['polyline', 'arrow'] as const)(
    'preserves ordered %s points, enforces 2–256 and permits removal/Finish at the limit',
    async (tool) => {
      await render();
      await click(`New ${toolName(tool)}`);
      await field('mark-label', 'ordered route');
      await coordinates('1.125', '2.25');
      await click('Add point');
      expect(button('Finish mark').disabled).toBe(true);
      await coordinates('3.5', '4.75');
      await click('Add point');
      await coordinates('5.875', '6.125');
      await click('Add point');
      await click('Remove point 2');
      expect(store.markForm().points).toEqual([
        { x: 1.125, y: 2.25 },
        { x: 5.875, y: 6.125 },
      ]);
      // Exercise the same store seam for the large boundary without 254 redundant CD cycles.
      for (let i = 2; i < 256; i++) {
        store.setMarkFields({ x: String(i), y: String(i + 0.25) });
        expect(store.appendNumericPoint().ok).toBe(true);
      }
      await fixture.whenStable();
      expect(button('Add point').disabled).toBe(true);
      await click('Place on map');
      expect(store.acceptPoint({ key: scope.gameId, at: { x: 257.5, y: 258.5 } }).ok).toBe(false);
      await fixture.whenStable();
      expect(store.markForm().points).toHaveLength(256);
      expect(button('Finish mark').disabled).toBe(false);
      expect(button('Remove point 256').disabled).toBe(false);
      await coordinates('100.875', '101.625');
      await click('Replace point 2');
      expect(store.markForm().points).toHaveLength(256);
      expect(store.markForm().points[1]).toEqual({ x: 100.875, y: 101.625 });
      expect(store.markForm().points[0]).toEqual({ x: 1.125, y: 2.25 });
      const ordered = structuredClone(store.markForm().points);
      await coordinates('invalid.', '20');
      await click('Replace point 1');
      expect(store.markForm().points).toEqual(ordered);
      expect(store.markForm().x).toBe('invalid.');
      expect(root().querySelector('[role="alert"]')).not.toBeNull();
      await click('Remove point 256');
      expect(button('Add point').disabled).toBe(false);
      await click('Finish mark');
      const geometry = store.marks().draft[0]!.geometry;
      expect(geometry.kind === tool && geometry.points.length).toBe(255);
      expect(store.drawingActive()).toBe(false);
      expect(store.cameraEnabled()).toBe(true);
    },
  );

  it('retains raw invalid strings without clamping and labels all numeric controls', async () => {
    await render();
    await click('New Ring');
    for (const [name, label] of [
      ['mark-label', 'Mark label'],
      ['mark-x', 'X east'],
      ['mark-y', 'Y south'],
      ['mark-radius', 'Radius'],
    ]) {
      expect(root().querySelector(`[name="${name}"]`)?.closest('label')?.textContent).toContain(
        label,
      );
    }
    for (const invalid of ['', 'Infinity', '5000.001', '-0.125']) {
      await coordinates(invalid, '3000');
      await field('mark-radius', '1.5');
      await click('Add mark');
      expect(store.markForm().x).toBe(invalid);
      expect(store.marks().draft).toHaveLength(0);
      expect(root().querySelector('[role="alert"]')).not.toBeNull();
    }
    await coordinates('5000', '3000');
    await field('mark-radius', '1.5');
    await click('Add mark');
    expect(store.marks().draft).toHaveLength(1);
    expect([...root().querySelectorAll('button')].every((b) => b.type === 'button')).toBe(true);
  });

  it('explicitly arms placement, preserves an invalid ring draft and Escape stops without losing fields', async () => {
    await render();
    await click('New Ring');
    await field('mark-label', 'unfinished radius');
    await field('mark-radius', 'bad radius');
    expect(store.drawingActive()).toBe(false);
    await click('Place on map');
    expect(store.cameraEnabled()).toBe(false);
    expect(store.acceptPoint({ key: scope.gameId, at: { x: 12.25, y: 13.5 } }).ok).toBe(false);
    expect(store.drawingActive()).toBe(true);
    const before = structuredClone(store.markForm());
    const escape = key(button('Stop placement'), 'Escape');
    await fixture.whenStable();
    expect(escape.defaultPrevented).toBe(true);
    expect(store.drawingActive()).toBe(false);
    expect(store.cameraEnabled()).toBe(true);
    expect(store.markForm()).toEqual(before);
  });

  it('ignores Escape/Delete during typing, composition, modifier chords and dialog gating; only handles valid actions', async () => {
    await render();
    await coordinates();
    await click('Add mark');
    await click('Edit');
    await click('Place on map');
    const fieldInput = root().querySelector<HTMLInputElement>('[name="mark-label"]')!;
    fieldInput.focus();
    for (const value of ['Escape', 'Delete']) {
      expect(key(fieldInput, value).defaultPrevented).toBe(false);
    }
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    editable.append(child);
    root().append(editable);
    expect(key(child, 'Delete').defaultPrevented).toBe(false);
    expect(key(child, 'Escape').defaultPrevented).toBe(false);
    const select = document.createElement('select');
    root().append(select);
    expect(key(select, 'Delete').defaultPrevented).toBe(false);
    const textarea = document.createElement('textarea');
    root().append(textarea);
    expect(key(textarea, 'Escape').defaultPrevented).toBe(false);
    expect(key(button('Stop placement'), 'Escape', { isComposing: true }).defaultPrevented).toBe(
      false,
    );
    expect(key(button('Stop placement'), 'Delete', { ctrlKey: true }).defaultPrevented).toBe(false);
    const before = structuredClone(store.markForm());
    store.setInteractionEnabled(false);
    await fixture.whenStable();
    expect(key(root(), 'Escape').defaultPrevented).toBe(false);
    expect(key(root(), 'Delete').defaultPrevented).toBe(false);
    expect(store.drawingActive()).toBe(true);
    expect(store.markForm()).toEqual(before);
    expect(store.marks().draft).toHaveLength(1);
    store.setInteractionEnabled(true);
    await fixture.whenStable();
    expect(key(root(), 'Escape').defaultPrevented).toBe(true);
    expect(key(root(), 'Escape').defaultPrevented).toBe(false);
    expect(key(root(), 'Delete').defaultPrevented).toBe(true);
    await fixture.whenStable();
    expect(store.marks().draft).toHaveLength(0);
    expect(key(root(), 'Delete').defaultPrevented).toBe(false);
  });

  it('preserves store-owned unfinished form/points and focus through signal updates and component recreation', async () => {
    await render();
    await click('New Arrow');
    await field('mark-label', 'unfinished <route>');
    await coordinates();
    await click('Add point');
    await field('mark-x', 'unfinished.');
    const focused = root().querySelector<HTMLInputElement>('[name="mark-x"]')!;
    focused.focus();
    focused.setSelectionRange(2, 7);
    store.setMarkFields({ label: 'edited elsewhere' });
    await fixture.whenStable();
    expect(document.activeElement).toBe(focused);
    expect(focused.selectionStart).toBe(2);
    const before = structuredClone(store.markForm());
    const initialize = vi.spyOn(store, 'initialize');
    const dispose = vi.spyOn(store, 'dispose');
    fixture.destroy();
    await render();
    fixture.componentRef.setInput('store', store);
    await fixture.whenStable();
    expect(store.markForm()).toEqual(before);
    expect(root().querySelector<HTMLInputElement>('[name="mark-x"]')!.value).toBe('unfinished.');
    expect(initialize).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
    expect(store.sceneMarks()).toHaveLength(0);
  });

  it('shows record conflicts without overwriting and recovers only with explicit reload', async () => {
    await render();
    await coordinates();
    await click('Add mark');
    await click('Save marks');
    const key = personalRecordKey('marks', scope, binding);
    const baseline = records.get(key)!;
    records.set(key, baseline + ' ');
    await click('Edit');
    await field('mark-label', 'recoverable change');
    await click('Apply edit');
    await click('Save marks');
    expect(records.get(key)).toBe(baseline + ' ');
    expect(store.marks().dirty).toBe(true);
    expect(root().querySelector('[role="alert"]')?.textContent).toBe(store.marks().error?.message);
    expect(button('Save marks').disabled).toBe(true);
    await click('Reload marks');
    expect(store.marks().dirty).toBe(false);
    expect(root().querySelector('[role="alert"]')).toBeNull();
  });
});

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PersonalToolsComponent, NotebookComponent, BoardHostComponent],
  template: `
    <ks-local-board-host
      [key]="key"
      [board]="board()"
      [presentation]="presentation()"
      [interactionEnabled]="store().interactionEnabled() && !notebookView()"
      [cameraEnabled]="store().cameraEnabled()"
      (pointed)="store().acceptPoint($event)"
      (keydown)="tools()?.handleKeydown($event)"
    />
    @if (notebookView()) {
      <ks-personal-notebook [store]="store()" (returnToTable)="notebookView.set(false)" />
    } @else {
      <ks-personal-tools [store]="store()" />
    }
  `,
})
class PersonalHarness {
  readonly store = input.required<PersonalStore>();
  readonly board = input.required<CertifiedBoard>();
  readonly binding = input.required<LocalBoardBinding>();
  readonly key = scope.gameId;
  readonly notebookView = signal(false);
  readonly tools = viewChild(PersonalToolsComponent);
  readonly presentation = computed(() => ({
    binding: this.binding(),
    marks: this.store().sceneMarks(),
    gameMs: 0 as const,
    rate: 0 as const,
    pieces: [] as const,
    roster: [] as const,
    papers: [] as const,
  }));
}

describe('A3a host / native personal UI focused composition with a scene double', () => {
  it('arms clicks/Finish and dialog gates, rejects stale points, preserves Cancel/navigation drafts, and applies marks without raster work', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const asset = createReferenceAsset();
    const board: CertifiedBoard = {
      asset,
      canonicalJson: canonicalizeAsset(asset),
      assetIdentity: await assetIdentity(asset, 'asset'),
      bounds: asset.bounds,
      summary: {
        name: asset.name,
        widthM: asset.bounds.maxX,
        heightM: asset.bounds.maxY,
        ref: null,
      },
    };
    const fixed = await createLocalBoardBinding(board, new AbortController().signal);
    await store.dispose();
    let id = 0;
    store = new PersonalStore(
      scope,
      fixed,
      new PersonalRepository(scope, fixed, {
        storage: () => ({ getItem: () => null, setItem: vi.fn() }),
      }),
      { markId: () => `host-mark-${++id}` },
    );
    await store.initialize();
    store.setInteractionEnabled(true);
    let picked = { x: 11.25, y: 22.125 };
    const scene: BoardScene = {
      controls: { enabled: true, update: vi.fn(), listenToKeyEvents: vi.fn() },
      localBoardTextureLimit: () => 512,
      applyLocalBoard: vi.fn(),
      renderLocalBoardFrame: vi.fn(),
      snapTopDown: vi.fn(),
      snapOblique: vi.fn(),
      pickAt: vi.fn<BoardScene['pickAt']>(() => ({ type: 'point', coord: picked })),
      resize: vi.fn(),
      dispose: vi.fn(),
    };
    const prepare = vi.fn<typeof prepareRaster>((preparedAsset, sourceKey, limit) => {
      const layout = rasterLayout(preparedAsset.bounds.maxX, preparedAsset.bounds.maxY, limit);
      const canvas = document.createElement('canvas');
      canvas.width = layout.width;
      canvas.height = layout.height;
      return {
        canvas,
        sourceKey,
        widthM: preparedAsset.bounds.maxX,
        heightM: preparedAsset.bounds.maxY,
        contentWidthPx: layout.contentWidthPx,
        contentHeightPx: layout.contentHeightPx,
      };
    });
    const factory: BoardSurfaceFactory = (key, certified, bound, onAvailability) =>
      new BoardSurface(key, certified, bound, {
        onAvailability,
        sceneFactory: () => scene,
        prepare,
        observerFactory: () =>
          ({ observe: vi.fn(), disconnect: vi.fn() }) as unknown as ResizeObserver,
        requestFrame: () => 1,
        cancelFrame: vi.fn(),
      });
    TestBed.configureTestingModule({
      providers: [{ provide: BOARD_SURFACE_FACTORY, useValue: factory }],
    });
    const parent = TestBed.createComponent(PersonalHarness);
    parent.componentRef.setInput('store', store);
    parent.componentRef.setInput('board', board);
    parent.componentRef.setInput('binding', fixed);
    const flush = async () => {
      for (let i = 0; i < 8; i++) {
        await parent.whenStable();
        await Promise.resolve();
      }
    };
    try {
      await flush();
      const native: HTMLElement = parent.nativeElement;
      const canvas = native.querySelector('canvas')!;
      const clickAt = () =>
        canvas.dispatchEvent(
          new MouseEvent('click', { clientX: 30, clientY: 40, button: 0, bubbles: true }),
        );
      await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
      await flush();
      expect(native.querySelector('ks-local-board-host [role="status"]')?.textContent).toContain(
        'ready',
      );
      clickAt();
      expect(store.marks().draft).toHaveLength(0);
      store.setMarkFields({ label: 'canvas pin' });
      const place = [...native.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Place on map',
      )!;
      place.click();
      await flush();
      expect(scene.controls.enabled).toBe(false);
      expect(
        store.acceptPoint({ key: 'local-00000000-0000-4000-8000-000000000099', at: picked }).ok,
      ).toBe(false);
      clickAt();
      await flush();
      expect(store.marks().draft).toHaveLength(1);
      expect(store.marks().draft[0]!.geometry).toEqual({ kind: 'pin', at: picked });
      expect(scene.controls.enabled).toBe(true);
      store.beginTool('arrow');
      store.setMarkFields({ label: 'canvas route' });
      store.startDrawing();
      await flush();
      clickAt();
      await flush();
      const retained = structuredClone(store.markForm());
      store.setInteractionEnabled(false);
      await flush();
      picked = { x: 31.5, y: 42.25 };
      clickAt();
      expect(key(canvas, 'Escape').defaultPrevented).toBe(false);
      expect(store.markForm()).toEqual(retained);
      expect(store.drawingActive()).toBe(true);
      // Setup Cancel restores the parent's interaction gate on this same store.
      store.setInteractionEnabled(true);
      await flush();
      clickAt();
      await flush();
      expect(store.markForm().points).toEqual([{ x: 11.25, y: 22.125 }, picked]);
      expect(store.marks().draft).toHaveLength(1);
      const finish = [...native.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Finish mark',
      )!;
      finish.click();
      await flush();
      expect(store.marks().draft).toHaveLength(2);
      expect(scene.controls.enabled).toBe(true);
      expect(prepare).toHaveBeenCalledOnce();
      expect(vi.mocked(scene.applyLocalBoard).mock.calls.at(-1)?.[1]).toEqual(store.sceneMarks());
      store.beginTool('polyline');
      store.setMarkFields({ label: 'unfinished', x: '2.75', y: '3.125' });
      store.appendNumericPoint();
      const form = structuredClone(store.markForm());
      store.setNotebookText('unsaved navigation text');
      store.setNotebookQuery('navigation');
      const initialize = vi.spyOn(store, 'initialize');
      const dispose = vi.spyOn(store, 'dispose');
      parent.componentInstance.notebookView.set(true);
      await flush();
      expect(native.querySelector<HTMLTextAreaElement>('[name="notebook-text"]')!.value).toBe(
        'unsaved navigation text',
      );
      [...native.querySelectorAll('button')]
        .find((b) => b.textContent?.trim() === 'Return to table')!
        .click();
      await flush();
      expect(store.markForm()).toEqual(form);
      expect(store.notebook().draft).toBe('unsaved navigation text');
      parent.componentInstance.notebookView.set(true);
      await flush();
      expect(native.querySelector<HTMLInputElement>('[name="notebook-search"]')!.value).toBe(
        'navigation',
      );
      expect(initialize).not.toHaveBeenCalled();
      expect(dispose).not.toHaveBeenCalled();
      expect(prepare).toHaveBeenCalledOnce();
    } finally {
      parent.destroy();
      await flush();
    }
  });
});
