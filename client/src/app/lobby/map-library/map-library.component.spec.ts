import { webcrypto } from 'node:crypto';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  assetIdentity,
  canonicalizeAsset,
  createReferenceAsset,
  type MapAsset,
} from '@kriegsspiel/maps';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseReplayParameters,
  type ReplayParameters,
} from '../../../legacy/map-authoring/generation/protocol';
import type { BoardPreparation, CertifiedBoard } from '../../../shared/game-setup/contracts';
import type {
  LibraryMapSummary,
  MapLibraryPort,
} from '../../../shared/lobby-map-library/contracts';
import {
  MAP_LIBRARY_PREVIEW_FACTORY,
  MapLibraryComponent,
  type LibraryPreview,
} from './map-library.component';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let fixture: ComponentFixture<MapLibraryComponent>;
let component: MapLibraryComponent;
let root: HTMLElement;
let board: CertifiedBoard;
let recipe: ReplayParameters;
let prep: BoardPreparation;
let library: MapLibraryPort;
let summary: LibraryMapSummary;
let previews: LibraryPreview[];
let factory: ReturnType<typeof vi.fn<(canvas: HTMLCanvasElement) => LibraryPreview>>;
let saved: ReturnType<typeof vi.fn<(item: LibraryMapSummary) => void>>;
let cancelled: ReturnType<typeof vi.fn<() => void>>;
let dirty: ReturnType<typeof vi.fn<(value: boolean) => void>>;

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  const asset = createReferenceAsset();
  recipe = parseReplayParameters({
    seed: asset.provenance.seed,
    settings: asset.settings,
    overrides: asset.overrides,
  });
  board = {
    asset,
    canonicalJson: canonicalizeAsset(asset),
    assetIdentity: await assetIdentity(asset, 'asset'),
    bounds: { minX: 0, minY: 0, maxX: asset.bounds.maxX, maxY: asset.bounds.maxY },
    summary: { ref: null, name: asset.name, widthM: 150, heightM: 150 },
  };
  summary = {
    ref: { kind: 'owned', id: '7da01aae-638e-4700-9a8d-5f39646c78d1' },
    name: 'My geography',
    widthM: 150,
    heightM: 150,
    assetIdentity: board.assetIdentity,
    status: 'needs-scenario',
    createdAtMs: 123,
  };
  prep = {
    generate: vi.fn().mockImplementation(async () => board),
    load: vi.fn(),
    dispose: vi.fn(),
  };
  library = {
    list: vi.fn(),
    save: vi.fn(async (intent) => ({ ...summary, name: intent.name })),
    read: vi.fn(async () => ({ item: summary, canonicalJson: board.canonicalJson })),
  };
  previews = [];
  factory = vi.fn(() => {
    const preview = {
      loadAsset: vi.fn().mockReturnValue({ ok: true, asset }),
      dispose: vi.fn(),
    } as LibraryPreview;
    previews.push(preview);
    return preview;
  });
  saved = vi.fn();
  cancelled = vi.fn();
  dirty = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: MAP_LIBRARY_PREVIEW_FACTORY, useValue: factory },
    ],
  });
});
afterEach(() => {
  fixture?.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(initial: ReplayParameters | null = recipe) {
  fixture = TestBed.createComponent(MapLibraryComponent);
  component = fixture.componentInstance;
  root = fixture.nativeElement as HTMLElement;
  fixture.componentRef.setInput('preparation', prep);
  fixture.componentRef.setInput('library', library);
  if (initial) fixture.componentRef.setInput('initialRecipe', initial);
  component.saved.subscribe(saved);
  component.cancelled.subscribe(cancelled);
  component.dirtyChange.subscribe(dirty);
  await fixture.whenStable();
}
function button(text: string): HTMLButtonElement {
  const element = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === text,
  );
  if (!element) throw new Error(`Missing button ${text}`);
  return element;
}
function field(name: string): HTMLInputElement | HTMLSelectElement {
  const element = root.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
  if (!element) throw new Error(`Missing field ${name}`);
  return element;
}
async function generate() {
  await component.state.generate();
  await fixture.whenStable();
}
async function named() {
  await generate();
  component.state.setName(summary.name);
  await fixture.whenStable();
}
async function save() {
  await component.state.save();
  await fixture.whenStable();
}

// These public reference assets exercise exact bytes/hash/metadata boundaries. The preparation doubles
// stand for current complete certification; they are not claims of real generation/composition evidence.
describe('portable Add geography content', () => {
  it('defaults to Countryside 5km, generates only on explicit click and owns no dialog/history or library browsing', async () => {
    await render(null);
    expect(field('landscape').value).toBe('flat-countryside');
    expect(field('map-size').value).toBe('5000');
    expect(
      [...root.querySelectorAll('select[name=landscape] option')].map((item) =>
        item.textContent?.trim(),
      ),
    ).toEqual(['Custom / recorded settings', 'Countryside', 'Wooded hills', 'River valley']);
    expect(root.textContent).toContain('Repeat this map');
    expect(root.textContent).toContain('Map number');
    expect(root.querySelector('dialog')).toBeNull();
    expect(root.querySelector('canvas')).toBeNull();
    expect(prep.generate).not.toHaveBeenCalled();
    expect(library.list).not.toHaveBeenCalled();
    expect(library.read).not.toHaveBeenCalled();
    expect(root.textContent).toContain('has no armies or objectives and cannot start a game');
    const pending = deferred<CertifiedBoard>();
    vi.mocked(prep.generate).mockReturnValueOnce(pending.promise);
    const push = vi.spyOn(window.history, 'pushState');
    button('Generate map').click();
    await fixture.whenStable();
    expect(prep.generate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prep.generate).mock.calls[0]![0].settings).toMatchObject({
      widthM: 5000,
      heightM: 5000,
    });
    expect(vi.mocked(prep.generate).mock.calls[0]![0].seed).toBe(Number(field('map-number').value));
    expect(push).not.toHaveBeenCalled();
    component.requestCancel();
    await fixture.whenStable();
    button('Discard map').click();
    pending.resolve(board);
    await pending.promise;
    await fixture.whenStable();
    expect(saved).not.toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(prep.dispose).toHaveBeenCalledTimes(1);
  });

  it('initially collapses Repeat this map in a labelled native disclosure and preserves its recipe across expansion', async () => {
    await render();
    const disclosure = root.querySelector<HTMLDetailsElement>('details')!;
    const summary = disclosure.querySelector<HTMLElement>('summary')!;
    expect(disclosure.open).toBe(false);
    expect(disclosure.hasAttribute('open')).toBe(false);
    expect(summary.textContent?.trim()).toBe('Repeat this map');
    expect(disclosure.querySelector('label')?.textContent).toContain('Map number');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    summary.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false); // Native Enter/Space activation stays available.
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    summary.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(false);
    summary.click(); // jsdom supports the native summary click default action.
    expect(disclosure.open).toBe(true);
    const input = field('map-number') as HTMLInputElement;
    input.value = '97';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(component.state.draft()).toEqual({ ...recipe, seed: 97 });
    summary.click();
    expect(disclosure.open).toBe(false);
    summary.click();
    expect(disclosure.open).toBe(true);
    expect(field('map-number').value).toBe('97');
    expect(prep.generate).not.toHaveBeenCalled();
    expect(library.save).not.toHaveBeenCalled();
  });

  it('preserves a complete custom recipe, seed and ordered overrides; size edits change only dimensions', async () => {
    const custom = parseReplayParameters({
      ...recipe,
      overrides: [
        { kind: 'rename', siteId: 'village:0', name: 'First' },
        {
          kind: 'exclude-sites',
          id: 'custom-area',
          polygon: {
            outer: [
              [10, 10],
              [10, 40],
              [40, 40],
              [40, 10],
              [10, 10],
            ],
            holes: [
              [
                [20, 20],
                [30, 20],
                [30, 30],
                [20, 30],
                [20, 20],
              ],
            ],
          },
        },
        { kind: 'rename', siteId: 'village:0', name: 'Last' },
      ],
    });
    await render(custom);
    expect(field('landscape').value).toBe('');
    expect(field('map-size').value).toBe('');
    component.state.setSize('10000');
    component.state.setSeed('9001');
    expect(component.state.draft()).toEqual({
      ...custom,
      seed: 9001,
      settings: { ...custom.settings, widthM: 10000, heightM: 10000 },
    });
    expect(component.state.landscape()).toBe('');
    component.state.setLandscape('wooded-hills');
    expect(component.state.draft()).toMatchObject({
      seed: 9001,
      settings: { widthM: 10000, heightM: 10000 },
      overrides: custom.overrides,
    });
    expect(prep.generate).not.toHaveBeenCalled();
  });

  it('shows Unsaved geography, saves exact canonical bytes separately from the display name, and emits only verified Needs a scenario', async () => {
    await render();
    const spy = vi.spyOn(component.state, 'generate');
    button('Generate map').click();
    await spy.mock.results[0]!.value;
    await fixture.whenStable();
    expect(root.textContent).toContain('Unsaved');
    expect(root.querySelector('canvas')).not.toBeNull();
    expect(saved).not.toHaveBeenCalled();
    expect(button('Save map').disabled).toBe(true);
    expect(previews[0]!.loadAsset).toHaveBeenCalledWith(board.asset);
    component.state.setName(summary.name);
    await save();
    const intent = vi.mocked(library.save).mock.calls[0]![0];
    expect(intent).toEqual({
      requestId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      name: summary.name,
      canonicalJson: board.canonicalJson,
      assetIdentity: await assetIdentity(board.asset as MapAsset, 'asset'),
    });
    expect(JSON.parse(intent.canonicalJson).name).toBe('Reference valley');
    expect(library.read).toHaveBeenCalledWith(summary.ref, expect.any(AbortSignal));
    expect(saved).toHaveBeenCalledExactlyOnceWith(summary);
    expect(root.textContent).toContain('Saved · Needs a scenario');
    expect(component.state.dirty()).toBe(false);
    expect(
      [...root.querySelectorAll('button')].some((item) =>
        /^(Use|Start)/.test(item.textContent?.trim() ?? ''),
      ),
    ).toBe(false);
    Object.defineProperty(saved.mock.calls[0]![0], 'name', { value: 'Mutated event' });
    expect(component.state.completed()?.name).toBe(summary.name);
    await save();
    expect(library.save).toHaveBeenCalledTimes(1);
    button('Back to maps').click();
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it.each(['save', 'read'])(
    'keeps the exact candidate/name/key locked on %s failure and recovers only by same-key Save',
    async (phase) => {
      await render();
      await named();
      const candidate = component.state.board();
      if (phase === 'save') vi.mocked(library.save).mockRejectedValueOnce(new Error('lost ack'));
      else vi.mocked(library.read).mockRejectedValueOnce(new Error('read failed'));
      await save();
      const intent = structuredClone(vi.mocked(library.save).mock.calls[0]![0]);
      expect(root.textContent).toContain('may already be saved');
      expect(saved).not.toHaveBeenCalled();
      component.state.setName('changed');
      component.state.setSeed('42');
      component.state.setSize('15000');
      component.state.setLandscape('river-valley');
      expect(component.state.name()).toBe(intent.name);
      expect(component.state.seed()).toBe(String(recipe.seed));
      expect(component.state.board()).toBe(candidate);
      expect(component.state.canGenerate()).toBe(false);
      expect(field('map-name').disabled).toBe(true);
      expect(button('Save map').disabled).toBe(false);
      await save();
      expect(vi.mocked(library.save).mock.calls.map((call) => call[0])).toEqual([intent, intent]);
      expect(saved).toHaveBeenCalledExactlyOnceWith(summary);
    },
  );

  it.each(['', '   ', 'x'.repeat(161)])(
    'does not dispatch a save for invalid display name %j',
    async (name) => {
      await render();
      await generate();
      component.state.setName(name);
      await save();
      expect(button('Save map').disabled).toBe(true);
      expect(library.save).not.toHaveBeenCalled();
    },
  );

  it('makes generation failure retryable without changing the recorded candidate recipe', async () => {
    await render();
    vi.mocked(prep.generate).mockRejectedValueOnce(new Error('private worker details'));
    await generate();
    expect(root.textContent).toContain('try Generate map again');
    expect(root.textContent).not.toContain('private worker');
    await generate();
    expect(vi.mocked(prep.generate).mock.calls.map((call) => call[0])).toEqual([recipe, recipe]);
    expect(component.state.board()?.canonicalJson).toBe(board.canonicalJson);
  });

  it('contains form Enter, uses button actions and lets the parent route Escape through requestCancel', async () => {
    await render();
    for (const action of root.querySelectorAll<HTMLButtonElement>('button'))
      expect(action.type).toBe('button');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    field('map-number').dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    const parent = root.parentElement!;
    const route = (event: Event) => {
      if ((event as KeyboardEvent).key === 'Escape') component.requestCancel();
    };
    parent.addEventListener('keydown', route);
    try {
      field('map-number').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      expect(cancelled).toHaveBeenCalledTimes(1);
    } finally {
      parent.removeEventListener('keydown', route);
    }
  });
});

describe('candidate and readback agreement', () => {
  it.each(['canonical bytes', 'full identity', 'saved reference', 'recipe seed', 'dimensions'])(
    'rejects mismatched prepared %s before preview/save',
    async (mismatch) => {
      await render();
      const bad = structuredClone(board);
      if (mismatch === 'canonical bytes')
        Object.assign(bad, { canonicalJson: board.canonicalJson + ' ' });
      if (mismatch === 'full identity')
        Object.assign(bad, {
          assetIdentity: await assetIdentity(board.asset as MapAsset, 'geometry'),
        });
      if (mismatch === 'saved reference')
        Object.assign(bad.summary, { ref: { kind: 'generated', id: 'already-saved' } });
      if (mismatch === 'recipe seed') {
        (bad.asset as MapAsset).provenance.seed = 42;
        Object.assign(bad, { canonicalJson: canonicalizeAsset(bad.asset as MapAsset) });
      }
      if (mismatch === 'dimensions') Object.assign(bad.bounds, { maxX: 151 });
      vi.mocked(prep.generate).mockResolvedValueOnce(bad);
      await generate();
      expect(component.state.board()).toBeUndefined();
      expect(factory).not.toHaveBeenCalled();
      expect(library.save).not.toHaveBeenCalled();
      expect(saved).not.toHaveBeenCalled();
    },
  );

  it.each([
    'name',
    'dimensions',
    'identity',
    'reference',
    'status',
    'private field',
    'nonstring identity',
  ])('rejects invalid save %s metadata while retaining recovery identity', async (mismatch) => {
    await render();
    await named();
    const bad = structuredClone(summary);
    if (mismatch === 'name') Object.assign(bad, { name: 'another name' });
    if (mismatch === 'dimensions') Object.assign(bad, { widthM: 5000 });
    if (mismatch === 'identity')
      Object.assign(bad, {
        assetIdentity: await assetIdentity(board.asset as MapAsset, 'geometry'),
      });
    if (mismatch === 'reference')
      Object.assign(bad, { ref: { kind: 'included', id: 'canonical:1' } });
    if (mismatch === 'status') Object.assign(bad, { status: 'ready' });
    if (mismatch === 'private field') Object.assign(bad, { initialWorld: {} });
    if (mismatch === 'nonstring identity')
      Object.assign(bad, { assetIdentity: [summary.assetIdentity] });
    vi.mocked(library.save).mockResolvedValueOnce(bad);
    await save();
    expect(saved).not.toHaveBeenCalled();
    expect(library.read).not.toHaveBeenCalled();
    expect(component.state.pending()).toBe(true);
    const key = vi.mocked(library.save).mock.calls[0]![0].requestId;
    await save();
    expect(vi.mocked(library.save).mock.calls[1]![0].requestId).toBe(key);
    expect(saved).toHaveBeenCalledOnce();
  });

  it.each([
    'bytes',
    'asset name',
    'metadata name',
    'metadata identity',
    'metadata reference',
    'timestamp',
  ])('requires exact readback %s agreement before emitting', async (mismatch) => {
    await render();
    await named();
    const readback = { item: structuredClone(summary), canonicalJson: board.canonicalJson };
    if (mismatch === 'bytes') readback.canonicalJson += ' ';
    if (mismatch === 'asset name') {
      const asset = structuredClone(board.asset) as MapAsset;
      asset.name = 'Same ground, different full asset';
      readback.canonicalJson = canonicalizeAsset(asset);
    }
    if (mismatch === 'metadata name') Object.assign(readback.item, { name: 'another label' });
    if (mismatch === 'metadata identity')
      Object.assign(readback.item, { assetIdentity: '0'.repeat(64) });
    if (mismatch === 'metadata reference')
      Object.assign(readback.item.ref, { id: '1e5a6270-9b79-4a48-a1fd-5435d8a733d0' });
    if (mismatch === 'timestamp') Object.assign(readback.item, { createdAtMs: 124 });
    vi.mocked(library.read).mockResolvedValueOnce(readback);
    await save();
    expect(saved).not.toHaveBeenCalled();
    expect(component.state.pending()).toBe(true);
    expect(component.state.completed()).toBeUndefined();
    await save();
    expect(saved).toHaveBeenCalledExactlyOnceWith(summary);
  });

  it('will not substitute another saved reference on retry after a readback failure', async () => {
    await render();
    await named();
    vi.mocked(library.read).mockRejectedValueOnce(new Error('lost read'));
    await save();
    vi.mocked(library.save).mockResolvedValueOnce({
      ...summary,
      ref: { kind: 'owned', id: '1e5a6270-9b79-4a48-a1fd-5435d8a733d0' },
    });
    await save();
    expect(saved).not.toHaveBeenCalled();
    expect(library.read).toHaveBeenCalledTimes(1);
    expect(component.state.pending()).toBe(true);
  });
});

describe('discard and owned lifetimes', () => {
  it('cancels pristine work immediately and disposes its supplied preparation exactly once', async () => {
    await render();
    component.requestCancel();
    component.requestCancel();
    fixture.destroy();
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(prep.dispose).toHaveBeenCalledTimes(1);
    expect(saved).not.toHaveBeenCalled();
  });

  it('asks before discarding unsaved work and Keep editing retains candidate and returns exact focus', async () => {
    await render();
    await named();
    const candidate = component.state.board();
    const opener = button('Cancel');
    opener.focus();
    component.requestCancel();
    await fixture.whenStable();
    expect(cancelled).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(root.querySelector('h3'));
    component.requestCancel();
    button('Keep editing').click();
    await fixture.whenStable();
    expect(document.activeElement).toBe(opener);
    expect(component.state.board()).toBe(candidate);
    expect(component.state.name()).toBe(summary.name);
    component.requestCancel();
    await fixture.whenStable();
    button('Discard map').click();
    await fixture.whenStable();
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(dirty.mock.calls.map((call) => call[0])).toEqual([true, false]);
    expect(prep.dispose).toHaveBeenCalledTimes(1);
    expect(previews[0]!.dispose).toHaveBeenCalledTimes(1);
  });

  it.each(['save', 'read'])(
    'aborts %s on Cancel/discard and never publishes a late result, with honest accepted-save copy',
    async (phase) => {
      await render();
      await named();
      const delayedSave = deferred<LibraryMapSummary>();
      const delayedRead = deferred<{ item: LibraryMapSummary; canonicalJson: string }>();
      if (phase === 'save') vi.mocked(library.save).mockReturnValueOnce(delayedSave.promise);
      else vi.mocked(library.read).mockReturnValueOnce(delayedRead.promise);
      const operation = component.state.save();
      if (phase === 'read') await vi.waitFor(() => expect(library.read).toHaveBeenCalledOnce());
      component.requestCancel();
      await fixture.whenStable();
      expect(root.textContent).toContain('it does not delete a saved map');
      expect(cancelled).not.toHaveBeenCalled();
      expect(vi.mocked(library.save).mock.calls[0]![1].aborted).toBe(true);
      button('Discard map').click();
      delayedSave.resolve(summary);
      delayedRead.resolve({ item: summary, canonicalJson: board.canonicalJson });
      await operation;
      expect(saved).not.toHaveBeenCalled();
      expect(cancelled).toHaveBeenCalledTimes(1);
      expect(prep.dispose).toHaveBeenCalledTimes(1);
      expect(previews[0]!.dispose).toHaveBeenCalledTimes(1);
      expect(library.read).toHaveBeenCalledTimes(phase === 'save' ? 0 : 1);
    },
  );

  it('retains the same save key after Keep editing an interrupted save', async () => {
    await render();
    await named();
    const pending = deferred<LibraryMapSummary>();
    vi.mocked(library.save).mockReturnValueOnce(pending.promise);
    const first = component.state.save();
    const intent = structuredClone(vi.mocked(library.save).mock.calls[0]![0]);
    component.requestCancel();
    await fixture.whenStable();
    button('Keep editing').click();
    await fixture.whenStable();
    expect(component.state.locked()).toBe(true);
    await save();
    expect(vi.mocked(library.save).mock.calls[1]![0]).toEqual(intent);
    expect(saved).toHaveBeenCalledOnce();
    pending.resolve(summary);
    await first;
    expect(saved).toHaveBeenCalledOnce();
  });

  it('cancels old generation on input replacement and ignores it after the new lifetime generates', async () => {
    await render();
    const old = deferred<CertifiedBoard>();
    vi.mocked(prep.generate).mockReturnValueOnce(old.promise);
    const first = component.state.generate();
    const signal = vi.mocked(prep.generate).mock.calls[0]![1];
    const next: BoardPreparation = {
      generate: vi.fn().mockResolvedValue(board),
      load: vi.fn(),
      dispose: vi.fn(),
    };
    fixture.componentRef.setInput('preparation', next);
    await fixture.whenStable();
    expect(signal.aborted).toBe(true);
    expect(prep.dispose).toHaveBeenCalledTimes(1);
    await generate();
    const candidate = component.state.board();
    old.resolve(board);
    await first;
    expect(component.state.board()).toBe(candidate);
    expect(saved).not.toHaveBeenCalled();
    fixture.destroy();
    expect(next.dispose).toHaveBeenCalledTimes(1);
    expect(prep.dispose).toHaveBeenCalledTimes(1);
  });

  it('revokes an old library save on replacement, preserving preparation ownership until its final disposal', async () => {
    await render();
    await named();
    const pending = deferred<LibraryMapSummary>();
    vi.mocked(library.save).mockReturnValueOnce(pending.promise);
    const first = component.state.save();
    const signal = vi.mocked(library.save).mock.calls[0]![1];
    const next = { ...library, save: vi.fn(), read: vi.fn() };
    fixture.componentRef.setInput('library', next);
    await fixture.whenStable();
    expect(signal.aborted).toBe(true);
    expect(previews[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(prep.dispose).not.toHaveBeenCalled();
    pending.resolve(summary);
    await first;
    expect(saved).not.toHaveBeenCalled();
    expect(library.read).not.toHaveBeenCalled();
    fixture.destroy();
    expect(prep.dispose).toHaveBeenCalledTimes(1);
  });

  it.each(['generation', 'save', 'read'])(
    'destroy during %s aborts ownership without late output or double cleanup',
    async (phase) => {
      await render();
      const generation = deferred<CertifiedBoard>();
      const saving = deferred<LibraryMapSummary>();
      const reading = deferred<{ item: LibraryMapSummary; canonicalJson: string }>();
      let operation: Promise<void>;
      if (phase === 'generation') {
        vi.mocked(prep.generate).mockReturnValueOnce(generation.promise);
        operation = component.state.generate();
      } else {
        await named();
        if (phase === 'save') vi.mocked(library.save).mockReturnValueOnce(saving.promise);
        else vi.mocked(library.read).mockReturnValueOnce(reading.promise);
        operation = component.state.save();
      }
      if (phase === 'read') await vi.waitFor(() => expect(library.read).toHaveBeenCalledOnce());
      fixture.destroy();
      generation.resolve(board);
      saving.resolve(summary);
      reading.resolve({ item: summary, canonicalJson: board.canonicalJson });
      await operation;
      expect(saved).not.toHaveBeenCalled();
      expect(cancelled).not.toHaveBeenCalled();
      expect(prep.dispose).toHaveBeenCalledTimes(1);
      for (const preview of previews) expect(preview.dispose).toHaveBeenCalledTimes(1);
    },
  );

  it('allows preview retry and releases the old and replacement previews exactly once', async () => {
    await render();
    factory.mockImplementationOnce(() => {
      throw new Error('No Canvas2D');
    });
    await generate();
    expect(root.textContent).toContain('preview could not be displayed');
    button('Retry preview').click();
    await fixture.whenStable();
    expect(previews).toHaveLength(1);
    expect(previews[0]!.loadAsset).toHaveBeenCalled();
    fixture.destroy();
    expect(previews[0]!.dispose).toHaveBeenCalledTimes(1);
  });

  it('releases a preview returned after its factory synchronously destroys the child', async () => {
    await render();
    const preview = { loadAsset: vi.fn(), dispose: vi.fn() } as LibraryPreview;
    factory.mockImplementationOnce(() => {
      fixture.destroy();
      return preview;
    });
    await component.state.generate();
    await fixture.whenStable();
    expect(preview.dispose).toHaveBeenCalledTimes(1);
    expect(preview.loadAsset).not.toHaveBeenCalled();
    expect(prep.dispose).toHaveBeenCalledTimes(1);
  });
});
