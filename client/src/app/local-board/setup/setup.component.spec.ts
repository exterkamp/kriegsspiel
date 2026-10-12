import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { battlefieldPreset, createReferenceAsset } from '@kriegsspiel/maps';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapPreview } from '../../../legacy/map-authoring/preview.js';
import type {
  CertifiedBoard,
  MapSummary,
  SetupProps,
} from '../../../shared/game-setup/contracts.js';
import { SETUP_PREVIEW_FACTORY, SetupComponent, type SetupPreview } from './setup.component';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const summary: MapSummary = {
  ref: { kind: 'generated', id: 'saved' },
  name: 'Saved title',
  widthM: 150,
  heightM: 150,
};
function certified(saved = false): CertifiedBoard {
  return {
    asset: createReferenceAsset(),
    canonicalJson: 'canonical',
    assetIdentity: 'full-identity',
    summary: { ...structuredClone(summary), ref: saved ? structuredClone(summary.ref) : null },
    bounds: { minX: 0, minY: 0, maxX: 150, maxY: 150 },
  };
}
let props: SetupProps;
let fixture: ComponentFixture<SetupComponent>;
let previews: SetupPreview[];
let factory: ReturnType<typeof vi.fn<(canvas: HTMLCanvasElement) => SetupPreview>>;
beforeEach(() => {
  props = {
    catalog: {
      list: vi.fn().mockResolvedValue([structuredClone(summary)]),
      read: vi.fn().mockResolvedValue('saved-json'),
      save: vi.fn().mockResolvedValue(structuredClone(summary)),
    },
    preparation: {
      load: vi.fn().mockResolvedValue(certified(true)),
      generate: vi.fn().mockResolvedValue(certified()),
      dispose: vi.fn(),
    },
    onStart: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn(),
  };
  previews = [];
  factory = vi.fn(() => {
    const preview: SetupPreview = {
      loadAsset: vi.fn().mockReturnValue({ ok: true, asset: createReferenceAsset() }),
      dispose: vi.fn(),
    };
    previews.push(preview);
    return preview;
  });
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: SETUP_PREVIEW_FACTORY, useValue: factory },
    ],
  });
});
afterEach(() => {
  fixture?.destroy();
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function flush() {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
    await fixture.whenStable();
  }
}
async function render() {
  fixture = TestBed.createComponent(SetupComponent);
  for (const [key, value] of Object.entries(props)) fixture.componentRef.setInput(key, value);
  await flush();
}
function root(): HTMLElement {
  return fixture.nativeElement;
}
function button(text: string): HTMLButtonElement {
  return [...root().querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === text,
  )!;
}
function control<T extends HTMLInputElement | HTMLSelectElement>(name: string): T {
  return root().querySelector<T>(`[name="${name}"]`)!;
}
async function click(text: string) {
  button(text).click();
  await flush();
}
async function input(value: string) {
  const seed = control<HTMLInputElement>('seed');
  seed.value = value;
  seed.dispatchEvent(new Event('input', { bubbles: true }));
  await flush();
}
async function select(name: string, value: string) {
  const element = control<HTMLSelectElement>(name);
  element.value = value;
  element.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
}

describe('native setup retained P4 assertions', () => {
  it.each([false, true])(
    'late initial list retains saved reference and newer metadata (duplicate %s)',
    async (duplicate) => {
      const listed = deferred<MapSummary[]>();
      const other: MapSummary = {
        ...summary,
        name: 'Other map',
        ref: { kind: 'premade', id: 'other' },
      };
      props.initialRef = other.ref;
      vi.mocked(props.catalog.list).mockReturnValue(listed.promise);
      await render();
      await click('Generate');
      await click('Save map');
      const element = control<HTMLSelectElement>('saved-map');
      expect(element.selectedOptions[0]?.textContent).toContain('Saved title');
      listed.resolve(duplicate ? [other, { ...summary, name: 'Stale catalog title' }] : [other]);
      await flush();
      expect(element.value).toBe('generated:saved');
      expect(element.selectedOptions[0]?.textContent).toContain('Saved title');
      expect(
        [...element.options].filter((option) => option.textContent?.includes('Saved title')),
      ).toHaveLength(1);
      expect([...element.options].some((option) => option.textContent?.includes('Other map'))).toBe(
        true,
      );
      expect(props.catalog.read).not.toHaveBeenCalled();
      await click('Start game');
      expect(props.onStart).toHaveBeenCalledOnce();
      expect(vi.mocked(props.onStart).mock.calls[0]![0].summary.ref).toEqual(summary.ref);
    },
  );

  it('invalid draft during save cannot revive Start even when catalog ignores abort', async () => {
    const saving = deferred<MapSummary>();
    vi.mocked(props.catalog.save).mockReturnValue(saving.promise);
    await render();
    await click('Generate');
    await click('Save map');
    await input('invalid');
    saving.resolve(summary);
    await flush();
    expect(button('Start game').disabled).toBe(true);
    expect(root().textContent).toContain('Unsaved');
    await input('17');
    expect(button('Start game').disabled).toBe(true);
    expect(button('Save map').disabled).toBe(false);
  });

  it('suppresses stale generation and saved selection results', async () => {
    const generated = deferred<CertifiedBoard>();
    const loaded = deferred<CertifiedBoard>();
    vi.mocked(props.preparation.generate).mockReturnValue(generated.promise);
    vi.mocked(props.preparation.load).mockReturnValue(loaded.promise);
    await render();
    await click('Generate');
    await select('saved-map', 'generated:saved');
    generated.resolve(certified());
    await flush();
    expect(previews[0]!.loadAsset).not.toHaveBeenCalled();
    expect(props.preparation.load).toHaveBeenCalledOnce();
    await input('18');
    loaded.resolve(certified(true));
    await flush();
    expect(button('Start game').disabled).toBe(true);
    expect(previews[0]!.loadAsset).not.toHaveBeenCalled();
  });

  it('Cancel aborts preparation, disposes preview/workers and suppresses late results', async () => {
    const generated = deferred<CertifiedBoard>();
    vi.mocked(props.preparation.generate).mockReturnValue(generated.promise);
    await render();
    await click('Generate');
    const signal = vi.mocked(props.preparation.generate).mock.calls[0]![1];
    await click('Cancel');
    expect(signal.aborted).toBe(true);
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(props.preparation.dispose).toHaveBeenCalledOnce();
    expect(previews[0]!.dispose).toHaveBeenCalledOnce();
    generated.resolve(certified());
    await flush();
    expect(props.onCancel).toHaveBeenCalledOnce();
    expect(previews[0]!.loadAsset).not.toHaveBeenCalled();
    await fixture.componentInstance.dispose();
    expect(previews[0]!.dispose).toHaveBeenCalledOnce();
  });

  it('saved load never generates and starts once with the exact certified board', async () => {
    const started = deferred<void>();
    vi.mocked(props.onStart).mockReturnValue(started.promise);
    await render();
    await select('saved-map', 'generated:saved');
    const result = await vi.mocked(props.preparation.load).mock.results[0]!.value;
    await click('Start game');
    await click('Start game');
    expect(props.preparation.generate).not.toHaveBeenCalled();
    expect(props.onStart).toHaveBeenCalledExactlyOnceWith(result);
    expect(button('Cancel').disabled).toBe(true);
    expect(control<HTMLInputElement>('seed').disabled).toBe(true);
    started.resolve();
    await flush();
    expect(button('Start game').disabled).toBe(true);
  });

  it.each(['saved', 'generated'] as const)(
    'passes a detached cloneable %s board across Start',
    async (source) => {
      vi.mocked(props.preparation.load).mockImplementation(async (_json, selectedSummary) => ({
        ...certified(true),
        summary: selectedSummary,
      }));
      let received: CertifiedBoard | undefined;
      let cloned: CertifiedBoard | undefined;
      vi.mocked(props.onStart).mockImplementation(async (board) => {
        received = board;
        cloned = structuredClone(board);
      });
      await render();
      if (source === 'saved') await select('saved-map', 'generated:saved');
      else {
        await click('Generate');
        await click('Save map');
      }
      const owned = fixture.componentInstance.state.board();
      await click('Start game');
      expect(props.onStart).toHaveBeenCalledOnce();
      expect(cloned).toEqual(received);
      expect(cloned).not.toBe(received);
      expect(received).not.toBe(owned);
      expect(received?.asset).not.toBe(owned?.asset);
      expect(button('Start game').disabled).toBe(true);
      expect(root().textContent).not.toContain('could not be cloned');
    },
  );

  it('retries save with retained canonical result and replaces summary before Start', async () => {
    vi.mocked(props.catalog.save)
      .mockRejectedValueOnce(new Error('Storage unavailable'))
      .mockResolvedValueOnce(summary);
    await render();
    await click('Generate');
    await click('Save map');
    expect(root().textContent).toContain('Storage unavailable');
    expect(button('Start game').disabled).toBe(true);
    expect(button('Save map').disabled).toBe(false);
    await click('Save map');
    await click('Start game');
    expect(props.preparation.generate).toHaveBeenCalledOnce();
    expect(props.catalog.save).toHaveBeenCalledTimes(2);
    expect(control<HTMLSelectElement>('saved-map').value).toBe('generated:saved');
    expect(vi.mocked(props.catalog.save).mock.calls.map(([bytes]) => bytes)).toEqual([
      'canonical',
      'canonical',
    ]);
    expect(vi.mocked(props.onStart).mock.calls[0]![0].summary).toEqual(summary);
  });

  it('preserves recorded settings and overrides on seed edits and uses complete presets explicitly', async () => {
    await render();
    await select('saved-map', 'generated:saved');
    await input('42');
    await click('Generate');
    const asset = certified(true).asset;
    expect(vi.mocked(props.preparation.generate).mock.calls[0]![0]).toEqual({
      seed: 42,
      settings: asset.settings,
      overrides: asset.overrides,
    });
    await select('preset', 'river-valley');
    await click('Generate');
    expect(vi.mocked(props.preparation.generate).mock.calls[1]![0]).toEqual({
      seed: 42,
      settings: battlefieldPreset('river-valley').settings,
      overrides: asset.overrides,
    });
  });

  it('selection during save suppresses the old completion and destruction disposes resources', async () => {
    const saving = deferred<MapSummary>();
    vi.mocked(props.catalog.save).mockReturnValue(saving.promise);
    await render();
    await click('Generate');
    await click('Save map');
    await select('saved-map', 'generated:saved');
    const selected = await vi.mocked(props.preparation.load).mock.results[0]!.value;
    saving.resolve({ ...summary, name: 'Stale save' });
    await flush();
    await click('Start game');
    expect(props.onStart).toHaveBeenCalledExactlyOnceWith(selected);
    fixture.destroy();
    await fixture.componentInstance.dispose();
    expect(props.preparation.dispose).toHaveBeenCalledOnce();
    expect(previews[0]!.dispose).toHaveBeenCalledOnce();
  });
});

describe('native setup canvas and input ownership', () => {
  it('canvas replacement retires only preview and keeps constructor-owned draft and pending certification', async () => {
    const visible = signal(true);
    TestBed.overrideComponent(SetupComponent, {
      set: { template: '@if ($any(this).showCanvas()) { <canvas #canvas></canvas> }' },
    });
    const generating = deferred<CertifiedBoard>();
    vi.mocked(props.preparation.generate).mockReturnValue(generating.promise);
    fixture = TestBed.createComponent(SetupComponent);
    Object.assign(fixture.componentInstance, { showCanvas: visible });
    for (const [key, value] of Object.entries(props)) fixture.componentRef.setInput(key, value);
    await flush();
    const state = fixture.componentInstance.state;
    state.setSeed('42');
    const pending = state.generate();
    await flush();
    visible.set(false);
    await flush();
    expect(previews[0]!.dispose).toHaveBeenCalledOnce();
    expect(props.preparation.dispose).not.toHaveBeenCalled();
    visible.set(true);
    await flush();
    expect(fixture.componentInstance.state).toBe(state);
    expect(state.seed()).toBe('42');
    expect(factory).toHaveBeenCalledTimes(2);
    expect(factory.mock.calls[0]![0]).not.toBe(factory.mock.calls[1]![0]);
    generating.resolve(certified());
    await pending;
    await flush();
    expect(previews[0]!.loadAsset).not.toHaveBeenCalled();
    expect(previews[1]!.loadAsset).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledTimes(2); // Board signals never allocate a preview.
  });

  it('returns a late preview handle to exactly-once disposal after reentrant destruction', async () => {
    const late: SetupPreview = {
      loadAsset: vi.fn().mockReturnValue({ ok: true, asset: createReferenceAsset() }),
      dispose: vi.fn(),
    };
    factory.mockImplementation(() => {
      fixture.destroy();
      return late;
    });
    await render();
    await fixture.componentInstance.dispose();
    expect(late.dispose).toHaveBeenCalledOnce();
    expect(late.loadAsset).not.toHaveBeenCalled();
    expect(props.preparation.dispose).toHaveBeenCalledOnce();
  });

  it('destroy before first render allocates no preview and exposes stable awaitable teardown', async () => {
    fixture = TestBed.createComponent(SetupComponent);
    for (const [key, value] of Object.entries(props)) fixture.componentRef.setInput(key, value);
    fixture.destroy();
    const retired = fixture.componentInstance.dispose();
    expect(fixture.componentInstance.dispose()).toBe(retired);
    await retired;
    expect(factory).not.toHaveBeenCalled();
    expect(props.catalog.list).not.toHaveBeenCalled();
  });

  it('required callback inputs refresh without capturing stale props or restarting catalog', async () => {
    await render();
    await select('saved-map', 'generated:saved');
    const latest = vi.fn().mockResolvedValue(undefined);
    fixture.componentRef.setInput('onStart', latest);
    await flush();
    await click('Start game');
    expect(latest).toHaveBeenCalledOnce();
    expect(props.onStart).not.toHaveBeenCalled();
    expect(props.catalog.list).toHaveBeenCalledOnce();
  });

  it('saved read failures are visible, retry selection certifies, and recorded sizes use the custom option', async () => {
    vi.mocked(props.catalog.read).mockRejectedValueOnce(new Error('Catalog unavailable'));
    await render();
    await select('saved-map', 'generated:saved');
    expect(root().querySelector('[role="status"]')?.textContent).toContain('Catalog unavailable');
    expect(button('Start game').disabled).toBe(true);
    await select('saved-map', 'generated:saved');
    expect(props.preparation.generate).not.toHaveBeenCalled();
    expect(button('Start game').disabled).toBe(false);
    expect(control<HTMLSelectElement>('size').value).toBe('');
    expect(control<HTMLSelectElement>('size').selectedOptions[0]?.textContent).toContain(
      'Custom / recorded',
    );
    await select('size', '10000');
    expect(button('Start game').disabled).toBe(true);
    await click('Generate');
    expect(vi.mocked(props.preparation.generate).mock.calls[0]![0].settings).toMatchObject({
      widthM: 10000,
      heightM: 10000,
    });
  });

  it('labels native controls, reports invalid seed, safely binds metadata and keeps canvas focusable', async () => {
    vi.mocked(props.catalog.list).mockResolvedValue([{ ...summary, name: '<Village & Hills>' }]);
    await render();
    for (const name of ['saved-map', 'preset', 'seed', 'size']) {
      expect(control(name).closest('label')?.textContent).toContain(
        { 'saved-map': 'Saved map', preset: 'Preset', seed: 'Seed', size: 'Map size' }[name],
      );
    }
    const option = control<HTMLSelectElement>('saved-map').options[1]!;
    expect(option.textContent).toContain('<Village & Hills>');
    expect(option.children).toHaveLength(0);
    const canvas = root().querySelector('canvas')!;
    expect(canvas.tabIndex).toBe(0);
    expect(canvas.getAttribute('aria-label')).toContain('F to fit');
    expect([...root().querySelectorAll('button')].every((button) => button.type === 'button')).toBe(
      true,
    );
    await input('9007199254740992');
    expect(control('seed').getAttribute('aria-invalid')).toBe('true');
    expect(root().querySelector<HTMLElement>('#draft-validation')!.hidden).toBe(false);
    expect(button('Generate').disabled).toBe(true);
  });

  it('real MapPreview canvas recreation removes old keyboard/observer/RAF ownership without reusing it', async () => {
    const visible = signal(true);
    vi.stubGlobal(
      'Path2D',
      class {
        moveTo() {}
        lineTo() {}
        closePath() {}
      },
    );
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const observers: { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] =
      [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
        constructor() {
          observers.push(this);
        }
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData() {},
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(9);
    const cancelFrame = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
    const real: MapPreview[] = [];
    const fits: ReturnType<typeof vi.spyOn>[] = [];
    const disposes: ReturnType<typeof vi.spyOn>[] = [];
    factory.mockImplementation((canvas) => {
      const preview = new MapPreview(canvas);
      real.push(preview);
      fits.push(vi.spyOn(preview, 'fit'));
      disposes.push(vi.spyOn(preview, 'dispose'));
      return preview;
    });
    TestBed.overrideComponent(SetupComponent, {
      set: { template: '@if ($any(this).showCanvas()) { <canvas #canvas tabindex="0"></canvas> }' },
    });
    fixture = TestBed.createComponent(SetupComponent);
    Object.assign(fixture.componentInstance, { showCanvas: visible });
    for (const [key, value] of Object.entries(props)) fixture.componentRef.setInput(key, value);
    await flush();
    await fixture.componentInstance.state.selectSaved('generated:saved');
    await flush();
    const original = root().querySelector('canvas')!;
    expect(fixture.componentInstance.previewError()).toBe('');
    fits[0]!.mockClear();
    original.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', cancelable: true }));
    expect(fits[0]).toHaveBeenCalledOnce();
    visible.set(false);
    await flush();
    fits[0]!.mockClear();
    original.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', cancelable: true }));
    expect(fits[0]).not.toHaveBeenCalled();
    expect(disposes[0]).toHaveBeenCalledOnce();
    expect(observers[0]!.disconnect).toHaveBeenCalledOnce();
    expect(cancelFrame).toHaveBeenCalled();
    visible.set(true);
    await flush();
    expect(real).toHaveLength(2);
    expect(real[1]).not.toBe(real[0]);
    expect(root().querySelector('canvas')).not.toBe(original);
    fits[1]!.mockClear();
    root()
      .querySelector('canvas')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));
    expect(fits[1]).toHaveBeenCalledOnce();
    fixture.destroy();
    await fixture.componentInstance.dispose();
    expect(disposes[0]).toHaveBeenCalledOnce();
    expect(disposes[1]).toHaveBeenCalledOnce();
    expect(observers[1]!.disconnect).toHaveBeenCalledOnce();
  });
});
