import { webcrypto } from 'node:crypto';
import { assetIdentity, canonicalizeAsset, createReferenceAsset } from '@kriegsspiel/maps';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CertifiedBoard } from '../../shared/game-setup/contracts';
import { rasterLayout } from '../../shared/map-table/raster';
import { createLocalBoardBinding } from './board-binding';
import { BoardSurface, type BoardScene } from './board-surface';
import {
  BOARD_BINDING_FACTORY,
  BOARD_SURFACE_FACTORY,
  BoardHostComponent,
  type BoardSurfaceFactory,
  type BoardSurfaceHandle,
  type LocalBoardAvailability,
} from './board-host.component';
import type {
  LocalBoardBinding,
  LocalInitializationResult,
  LocalPresentation,
  LocalSessionKey,
} from './contracts';

const key: LocalSessionKey = 'local-00000000-0000-4000-8000-000000000001';
let board: CertifiedBoard;
let binding: LocalBoardBinding;
beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
  const asset = createReferenceAsset();
  board = {
    asset,
    canonicalJson: canonicalizeAsset(asset),
    assetIdentity: await assetIdentity(asset, 'asset'),
    bounds: asset.bounds,
    summary: { name: asset.name, widthM: asset.bounds.maxX, heightM: asset.bounds.maxY, ref: null },
  };
  binding = await createLocalBoardBinding(board, new AbortController().signal);
});
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(async () => {
  TestBed.resetTestingModule();
  await Promise.resolve();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const presentation = (): LocalPresentation => ({
  binding,
  marks: [],
  gameMs: 0,
  rate: 0,
  pieces: [],
  roster: [],
  papers: [],
});
function double(): BoardScene {
  return {
    controls: { enabled: true, update: vi.fn(), listenToKeyEvents: vi.fn() },
    localBoardTextureLimit: () => 512,
    applyLocalBoard: vi.fn(),
    renderLocalBoardFrame: vi.fn(),
    snapTopDown: vi.fn(),
    snapOblique: vi.fn(),
    pickAt: () => ({ type: 'point', coord: { x: 11.25, y: 22.125 } }),
    resize: vi.fn(),
    dispose: vi.fn(),
  };
}
function setup(
  options: {
    retained?: boolean;
    bindingFactory?: typeof createLocalBoardBinding;
    surfaceFactory?: BoardSurfaceFactory;
    renderFrame?: () => void;
  } = {},
) {
  const scenes: BoardScene[] = [];
  const observers: { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] =
    [];
  const sequence: string[] = [];
  const frames = new Map<number, FrameRequestCallback>();
  let frame = 0;
  const surfaces: BoardSurface[] = [];
  const factory = vi.fn<BoardSurfaceFactory>((sessionKey, certified, fixed, onAvailability) => {
    const surface = new BoardSurface(sessionKey, certified, fixed, {
      onAvailability,
      sceneFactory: () => {
        sequence.push('allocate');
        const scene = double();
        if (options.renderFrame)
          vi.mocked(scene.renderLocalBoardFrame).mockImplementation(options.renderFrame);
        vi.mocked(scene.dispose).mockImplementation(() => {
          sequence.push('dispose');
        });
        scenes.push(scene);
        return scene;
      },
      prepare: (asset, sourceKey, limit) => {
        const layout = rasterLayout(asset.bounds.maxX, asset.bounds.maxY, limit);
        const canvas = document.createElement('canvas');
        canvas.width = layout.width;
        canvas.height = layout.height;
        return {
          canvas,
          sourceKey,
          widthM: asset.bounds.maxX,
          heightM: asset.bounds.maxY,
          contentWidthPx: layout.contentWidthPx,
          contentHeightPx: layout.contentHeightPx,
        };
      },
      observerFactory: () => {
        const observer = { observe: vi.fn(), disconnect: vi.fn() };
        observers.push(observer);
        return observer as unknown as ResizeObserver;
      },
      requestFrame: (callback) => {
        frames.set(++frame, callback);
        return frame;
      },
      cancelFrame: (id) => {
        frames.delete(id);
      },
    });
    surfaces.push(surface);
    return surface;
  });
  if (options.retained)
    TestBed.overrideComponent(BoardHostComponent, {
      set: {
        template: '@if (showCanvas()) { <canvas #canvas></canvas> } <p>{{ state().ready }}</p>',
      },
    });
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: BOARD_SURFACE_FACTORY, useValue: options.surfaceFactory ?? factory },
      {
        provide: BOARD_BINDING_FACTORY,
        useValue: options.bindingFactory ?? createLocalBoardBinding,
      },
    ],
  });
  const fixture = TestBed.createComponent(BoardHostComponent);
  const visible = signal(true);
  if (options.retained) Object.assign(fixture.componentInstance, { showCanvas: visible });
  fixture.componentRef.setInput('key', key);
  fixture.componentRef.setInput('board', board);
  fixture.componentRef.setInput('presentation', presentation());
  const initialized: LocalInitializationResult[] = [];
  const availability: LocalBoardAvailability[] = [];
  fixture.componentInstance.initialized.subscribe((event) => initialized.push(event));
  fixture.componentInstance.availability.subscribe((event) => {
    sequence.push(`ready:${event.ready}`);
    availability.push(event);
  });
  const host = fixture.componentInstance;
  return {
    fixture,
    host,
    visible,
    initialized,
    availability,
    sequence,
    scenes,
    observers,
    frames,
    factory,
    surfaces,
    ready: async () => {
      await fixture.whenStable();
      await vi.waitFor(() => expect(host.state().ready).toBe(true));
      await fixture.whenStable();
    },
  };
}
function handle(): BoardSurfaceHandle {
  return {
    mount: vi.fn(async () => {}),
    unmount: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
    apply: vi.fn(),
    setInteractionEnabled: vi.fn(),
    setCameraEnabled: vi.fn(),
    resize: vi.fn(),
    snap: vi.fn(),
    pickAt: vi.fn(() => ({ x: 1, y: 2 })),
  };
}

describe('native BoardHostComponent with real BoardSurface and scene doubles', () => {
  it('renders native status/camera bindings and emits keyed success only after framing and an actual frame call', async () => {
    const h = setup();
    const result = vi.fn();
    h.host.initialized.subscribe(result);
    expect(h.factory).not.toHaveBeenCalled();
    expect(h.initialized).toEqual([]);
    await h.ready();
    expect(h.initialized).toEqual([{ key, ok: true }]);
    expect(h.availability.at(-1)).toEqual({ key, ready: true });
    const scene = h.scenes[0]!;
    expect(scene.snapTopDown).toHaveBeenCalledOnce();
    expect(scene.renderLocalBoardFrame).toHaveBeenCalledTimes(2);
    expect(vi.mocked(scene.applyLocalBoard).mock.invocationCallOrder.at(-1)).toBeLessThan(
      vi.mocked(scene.renderLocalBoardFrame).mock.invocationCallOrder.at(-1)!,
    );
    expect(vi.mocked(scene.renderLocalBoardFrame).mock.invocationCallOrder.at(-1)).toBeLessThan(
      result.mock.invocationCallOrder[0]!,
    );
    expect(vi.mocked(scene.snapTopDown).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(scene.renderLocalBoardFrame).mock.invocationCallOrder[0]!,
    );
    const root = h.fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[role="status"]')!.textContent).toContain('time stopped at 0');
    (root.querySelectorAll('button')[1] as HTMLButtonElement).click();
    await h.fixture.whenStable();
    expect(scene.snapOblique).toHaveBeenCalledOnce();
    expect(h.host.pickAt(1, 2)).toEqual({ x: 11.25, y: 22.125 });
    h.fixture.componentRef.setInput('interactionEnabled', false);
    await h.fixture.whenStable();
    expect(scene.controls.enabled).toBe(false);
    expect(h.host.pickAt(1, 2)).toBeNull();
    expect([...root.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
    h.host.snap('oblique');
    expect(scene.snapOblique).toHaveBeenCalledOnce();
    await h.host.teardown();
    h.fixture.destroy();
    expect(scene.dispose).toHaveBeenCalledOnce();
    expect(h.observers[0]!.disconnect).toHaveBeenCalledOnce();
    expect(h.frames.size).toBe(0);
  });
  it('remounts an actual retained component on canvas replacement, clearing readiness before disposal and preserving the raster', async () => {
    const h = setup({ retained: true });
    await h.ready();
    const instance = h.fixture.componentInstance;
    const original = (h.fixture.nativeElement as HTMLElement).querySelector('canvas');
    const raster = vi.mocked(h.scenes[0]!.applyLocalBoard).mock.calls[0]![0];
    h.visible.set(false);
    await h.fixture.whenStable();
    await vi.waitFor(() => expect(h.scenes[0]!.dispose).toHaveBeenCalledOnce());
    expect(h.host.state().ready).toBe(false);
    expect(h.availability.at(-1)).toEqual({ key, ready: false });
    const retirement = h.sequence.lastIndexOf('dispose');
    expect(h.sequence.lastIndexOf('ready:false')).toBeLessThan(retirement);
    h.visible.set(true);
    await h.ready();
    expect(h.fixture.componentInstance).toBe(instance);
    expect((h.fixture.nativeElement as HTMLElement).querySelector('canvas')).not.toBe(original);
    expect(h.factory).toHaveBeenCalledOnce();
    expect(h.scenes).toHaveLength(2);
    expect(h.sequence.lastIndexOf('allocate')).toBeGreaterThan(retirement);
    expect(vi.mocked(h.scenes[1]!.applyLocalBoard).mock.calls[0]![0]).toBe(raster);
    expect(h.initialized).toEqual([{ key, ok: true }]);
    expect(h.availability.at(-1)).toEqual({ key, ready: true });
    await h.host.teardown();
    h.fixture.destroy();
    expect(h.scenes[1]!.dispose).toHaveBeenCalledOnce();
  });
  it('applies current marks after pending startup and rejects changing the session key or populated pieces', async () => {
    let resolve!: (value: string) => void;
    const identity = new Promise<string>((r) => {
      resolve = r;
    });
    const makeBinding = vi.fn<typeof createLocalBoardBinding>((input, signal) =>
      createLocalBoardBinding(input, signal, () => identity),
    );
    const h = setup({ bindingFactory: makeBinding });
    await h.fixture.whenStable();
    await vi.waitFor(() => expect(makeBinding).toHaveBeenCalledOnce());
    const marks = [
      {
        id: 'during-startup',
        label: '<Current>',
        geometry: { kind: 'pin' as const, at: { x: 13.25, y: 25.125 } },
      },
    ];
    h.fixture.componentRef.setInput('presentation', { ...presentation(), marks });
    await h.fixture.whenStable();
    expect(h.initialized).toEqual([]);
    resolve(board.assetIdentity);
    await h.ready();
    expect(h.scenes[0]!.applyLocalBoard).toHaveBeenLastCalledWith(expect.anything(), marks);
    h.fixture.componentRef.setInput('presentation', { ...presentation(), pieces: [{}] });
    await h.fixture.whenStable();
    expect(h.host.state().ready).toBe(false);
    expect(h.availability.at(-1)!.ready).toBe(false);
    await h.host.teardown();
    expect(h.scenes[0]!.dispose).toHaveBeenCalledOnce();
    expect(h.initialized).toHaveLength(1);
  });
  it('rejects replacing board/key inputs on a retained host with the original key in outputs', async () => {
    const h = setup();
    await h.ready();
    h.fixture.componentRef.setInput('key', 'local-00000000-0000-4000-8000-000000000002');
    await h.fixture.whenStable();
    expect(h.host.state().error).toContain('fresh keyed host');
    expect(h.availability.at(-1)).toMatchObject({ key, ready: false });
    expect(h.initialized).toEqual([{ key, ok: true }]);
    await h.host.teardown();
  });
  it('rejects initialization when the latest applied marks fail their render frame', async () => {
    const renderFrame = vi
      .fn()
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error('latest marks frame failed');
      });
    const h = setup({ renderFrame });
    await h.fixture.whenStable();
    await vi.waitFor(() => expect(h.initialized).toHaveLength(1));
    expect(h.initialized).toEqual([{ key, ok: false, error: 'latest marks frame failed' }]);
    expect(h.availability.some((event) => event.ready)).toBe(false);
    expect(h.host.state()).toEqual({ ready: false, error: 'latest marks frame failed' });
    await h.host.teardown();
    expect(h.scenes[0]!.dispose).toHaveBeenCalledOnce();
    expect(h.frames.size).toBe(0);
    h.fixture.destroy();
  });
  it('invalidates runtime frame failure without repeating initial initialization', async () => {
    const h = setup();
    await h.ready();
    vi.mocked(h.scenes[0]!.renderLocalBoardFrame).mockImplementationOnce(() => {
      throw new Error('late frame failed');
    });
    const [frame, callback] = [...h.frames][0]!;
    h.frames.delete(frame);
    callback(1);
    expect(h.host.state()).toEqual({ ready: false, error: 'late frame failed' });
    expect(h.availability.at(-1)).toEqual({ key, ready: false, error: 'late frame failed' });
    expect(h.initialized).toEqual([{ key, ok: true }]);
    await h.host.teardown();
    expect(h.scenes[0]!.dispose).toHaveBeenCalledOnce();
  });
  it('allocates nothing after destruction before afterRenderEffect', async () => {
    const h = setup();
    h.fixture.destroy();
    TestBed.tick();
    await h.host.teardown();
    expect(h.factory).not.toHaveBeenCalled();
    expect(h.initialized).toEqual([]);
    expect(h.frames.size).toBe(0);
  });
  it('awaits late binding after destroy, suppressing allocation/success/error outputs', async () => {
    let reject!: (error: Error) => void;
    const makeBinding = vi.fn<typeof createLocalBoardBinding>(
      () =>
        new Promise((_, r) => {
          reject = r;
        }),
    );
    const h = setup({ bindingFactory: makeBinding });
    await h.fixture.whenStable();
    await vi.waitFor(() => expect(makeBinding).toHaveBeenCalledOnce());
    h.fixture.destroy();
    const teardown = h.host.teardown();
    let finished = false;
    void teardown.then(() => {
      finished = true;
    });
    const count = h.availability.length;
    await Promise.resolve();
    expect(finished).toBe(false);
    reject(new Error('late binding rejection'));
    await teardown;
    expect(h.factory).not.toHaveBeenCalled();
    expect(h.initialized).toEqual([]);
    expect(h.availability).toHaveLength(count);
  });
  it('retires on pagehide before first render and never allocates on persisted pageshow', async () => {
    const h = setup();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    await h.host.teardown();
    await h.fixture.whenStable();
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    await h.fixture.whenStable();
    expect(h.factory).not.toHaveBeenCalled();
    expect(h.initialized).toEqual([]);
  });
  it('invalidates a pending startup hash on pagehide without late failure/success publication', async () => {
    let resolve!: (value: string) => void;
    const makeBinding = vi.fn<typeof createLocalBoardBinding>((input, signal) =>
      createLocalBoardBinding(
        input,
        signal,
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      ),
    );
    const h = setup({ bindingFactory: makeBinding });
    await h.fixture.whenStable();
    await vi.waitFor(() => expect(makeBinding).toHaveBeenCalledOnce());
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    const count = h.availability.length;
    resolve(board.assetIdentity);
    await h.host.teardown();
    expect(h.factory).not.toHaveBeenCalled();
    expect(h.initialized).toEqual([]);
    expect(h.availability).toHaveLength(count);
    expect(h.host.state().ready).toBe(false);
  });
  it('retires an abandoned delayed mount before a retained canvas replacement', async () => {
    const surface = handle();
    let settle!: () => void;
    const pending = new Promise<void>((r) => {
      settle = r;
    });
    vi.mocked(surface.mount).mockImplementationOnce(() => pending);
    const factory = vi.fn<BoardSurfaceFactory>(() => surface);
    const h = setup({ retained: true, surfaceFactory: factory });
    await h.fixture.whenStable();
    await vi.waitFor(() => expect(surface.mount).toHaveBeenCalledOnce());
    h.visible.set(false);
    await h.fixture.whenStable();
    h.visible.set(true);
    await h.fixture.whenStable();
    expect(surface.mount).toHaveBeenCalledOnce();
    expect(h.initialized).toEqual([]);
    settle();
    await h.ready();
    expect(surface.unmount).toHaveBeenCalledOnce();
    expect(surface.mount).toHaveBeenCalledTimes(2);
    expect(vi.mocked(surface.unmount).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(surface.mount).mock.invocationCallOrder[1]!,
    );
    expect(h.initialized).toEqual([{ key, ok: true }]);
    await h.host.teardown();
    expect(surface.dispose).toHaveBeenCalledOnce();
  });
  it('disposes a handle returned after reentrant component destruction exactly once', async () => {
    const surface = handle();
    const factory = vi.fn<BoardSurfaceFactory>(() => {
      h.fixture.destroy();
      return surface;
    });
    const h = setup({ surfaceFactory: factory });
    await h.fixture.whenStable();
    await vi.waitFor(() => expect(surface.dispose).toHaveBeenCalledOnce());
    await h.host.teardown();
    expect(surface.mount).not.toHaveBeenCalled();
    expect(h.initialized).toEqual([]);
  });
  it('reports keyed initialization failure and completes teardown despite throwing handle releases', async () => {
    const surface = handle();
    vi.mocked(surface.mount).mockRejectedValueOnce(new Error('frame failed'));
    vi.mocked(surface.unmount).mockImplementation(() => {
      throw new Error('unmount release');
    });
    vi.mocked(surface.dispose).mockImplementation(() => {
      throw new Error('dispose release');
    });
    const h = setup({ surfaceFactory: () => surface });
    await h.fixture.whenStable();
    await vi.waitFor(() =>
      expect(h.initialized).toEqual([{ key, ok: false, error: 'frame failed' }]),
    );
    const teardown = h.host.teardown();
    expect(h.host.teardown()).toBe(teardown);
    await teardown;
    expect(surface.dispose).toHaveBeenCalledOnce();
    expect(surface.unmount).toHaveBeenCalledOnce();
    expect(h.host.state().ready).toBe(false);
  });
  it('reports invalid canonical input with its captured key before allocating a surface', async () => {
    const h = setup();
    h.fixture.componentRef.setInput('board', {
      ...board,
      canonicalJson: board.canonicalJson + '\n',
    });
    await h.fixture.whenStable();
    await vi.waitFor(() => expect(h.initialized).toHaveLength(1));
    expect(h.initialized[0]).toMatchObject({ key, ok: false });
    expect(h.factory).not.toHaveBeenCalled();
    await h.host.teardown();
  });
  it('emits keyed detached metre points from native left-clicks only in ready drawing mode', async () => {
    const h = setup();
    const points: { key: LocalSessionKey; at: Readonly<{ x: number; y: number }> }[] = [];
    h.host.pointed.subscribe((point) => points.push(point));
    const click = (button = 0) =>
      (h.fixture.nativeElement as HTMLElement)
        .querySelector('canvas')!
        .dispatchEvent(
          new MouseEvent('click', { button, clientX: 123, clientY: 234, bubbles: true }),
        );
    h.fixture.componentRef.setInput('cameraEnabled', false);
    await h.fixture.whenStable();
    click();
    expect(points).toEqual([]);
    await h.ready();
    const owned = h.scenes[0]!;
    expect(owned.controls.enabled).toBe(false);
    expect(h.host.pickAt(123, 234)).toEqual({ x: 11.25, y: 22.125 });
    click(2);
    click(1);
    expect(points).toEqual([]);
    click();
    click();
    expect(points).toEqual([
      { key, at: { x: 11.25, y: 22.125 } },
      { key, at: { x: 11.25, y: 22.125 } },
    ]);
    expect(Object.isFrozen(points[0]!.at)).toBe(true);
    expect(Object.isFrozen(points[0])).toBe(true);
    expect(
      [...(h.fixture.nativeElement as HTMLElement).querySelectorAll('button')].every(
        (button) => button.disabled,
      ),
    ).toBe(true);
    h.fixture.componentRef.setInput('interactionEnabled', false);
    await h.fixture.whenStable();
    click();
    expect(points).toHaveLength(2);
    expect(h.host.pickAt(123, 234)).toBeNull();
    h.fixture.componentRef.setInput('cameraEnabled', true);
    await h.fixture.whenStable();
    expect(owned.controls.enabled).toBe(false);
    click();
    expect(points).toHaveLength(2);
    h.fixture.componentRef.setInput('interactionEnabled', true);
    await h.fixture.whenStable();
    expect(owned.controls.enabled).toBe(true);
    click();
    expect(points).toHaveLength(2);
    h.fixture.componentRef.setInput('cameraEnabled', false);
    await h.fixture.whenStable();
    click();
    expect(points).toHaveLength(3);
    await h.host.teardown();
    click();
    expect(points).toHaveLength(3);
  });
});
