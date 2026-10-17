import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assetIdentity,
  canonicalizeAsset,
  createReferenceAsset,
  importAsset,
} from '@kriegsspiel/maps';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as THREE from 'three';

const gpu = vi.hoisted(() => ({ disposes: 0, lost: false, renders: 0 }));
vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  class Renderer {
    capabilities = { maxTextureSize: 512, getMaxAnisotropy: () => 2 };
    setPixelRatio() {}
    setSize() {}
    render() {
      gpu.renders++;
    }
    getContext() {
      return { isContextLost: () => gpu.lost };
    }
    dispose() {
      gpu.disposes++;
    }
  }
  return Object.assign({}, actual, { WebGLRenderer: Renderer });
});
import { TableScene as FixtureTableScene } from '../../legacy/table/FixtureTableScene';
import { rasterLayout } from '../../shared/map-table/raster';
import type { CertifiedBoard } from '../../shared/game-setup/contracts';
import { createLocalBoardBinding } from './board-binding';
import { BoardSurface, type BoardScene, type BoardSurfaceDependencies } from './board-surface';
import type { LocalBoardBinding, LocalPresentation, LocalSessionKey } from './contracts';

const key: LocalSessionKey = 'local-00000000-0000-4000-8000-000000000001';
let board: CertifiedBoard;
let binding: LocalBoardBinding;
const surfaces: BoardSurface[] = [];
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
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  gpu.disposes = gpu.renders = 0;
  gpu.lost = false;
});
afterEach(async () => {
  await Promise.all(surfaces.splice(0).map((surface) => surface.dispose()));
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const presentation = (b = binding): LocalPresentation => ({
  binding: b,
  marks: [],
  gameMs: 0,
  rate: 0,
  pieces: [],
  roster: [],
  papers: [],
});
function scene(): BoardScene {
  return {
    controls: { enabled: true, update: vi.fn(), listenToKeyEvents: vi.fn() },
    localBoardTextureLimit: vi.fn(() => 512),
    applyLocalBoard: vi.fn(),
    renderLocalBoardFrame: vi.fn(),
    snapTopDown: vi.fn(),
    snapOblique: vi.fn(),
    pickAt: vi.fn<BoardScene['pickAt']>(() => ({ type: 'point', coord: { x: 10.25, y: 20.75 } })),
    resize: vi.fn(),
    dispose: vi.fn(),
  };
}
function setup(overrides: BoardSurfaceDependencies = {}) {
  const scenes: BoardScene[] = [];
  const observers: { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] =
    [];
  const callbacks: ResizeObserverCallback[] = [];
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  const availability = vi.fn();
  const factory = vi.fn(() => {
    const next = scene();
    scenes.push(next);
    return next;
  });
  const prepare = vi.fn((asset, sourceKey, limit) => {
    const widthM = asset.bounds.maxX,
      heightM = asset.bounds.maxY;
    const layout = rasterLayout(widthM, heightM, limit);
    const canvas = document.createElement('canvas');
    canvas.width = layout.width;
    canvas.height = layout.height;
    return {
      canvas,
      sourceKey,
      widthM,
      heightM,
      contentWidthPx: layout.contentWidthPx,
      contentHeightPx: layout.contentHeightPx,
    };
  }) as ReturnType<typeof vi.fn<NonNullable<BoardSurfaceDependencies['prepare']>>>;
  const cancel = vi.fn((frame: number) => {
    frames.delete(frame);
  });
  const surface = new BoardSurface(key, board, binding, {
    sceneFactory: factory,
    prepare,
    identity: async () => board.assetIdentity,
    observerFactory: (callback) => {
      callbacks.push(callback);
      const observer = { observe: vi.fn(), disconnect: vi.fn() };
      observers.push(observer);
      return observer as unknown as ResizeObserver;
    },
    requestFrame: (callback) => {
      frames.set(++id, callback);
      return id;
    },
    cancelFrame: cancel,
    onAvailability: availability,
    ...overrides,
  });
  surfaces.push(surface);
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  return {
    surface,
    canvas,
    scenes,
    observers,
    callbacks,
    factory,
    prepare,
    cancel,
    frames,
    availability,
    mount: () => surface.mount(canvas, new AbortController().signal, presentation()),
    tick: () => {
      const [frame, callback] = [...frames][0]!;
      frames.delete(frame);
      callback(1);
    },
  };
}

describe('BoardSurface session and canvas ownership with scene doubles', () => {
  it('acknowledges only an applied, framed, rendered board and reuses one raster for marks/remount', async () => {
    const h = setup();
    await h.mount();
    const first = h.scenes[0]!;
    expect(first.applyLocalBoard).toHaveBeenCalledOnce();
    expect(first.snapTopDown).toHaveBeenCalledOnce();
    expect(first.renderLocalBoardFrame).toHaveBeenCalledOnce();
    expect(vi.mocked(first.applyLocalBoard).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(first.snapTopDown).mock.invocationCallOrder[0]!,
    );
    expect(vi.mocked(first.snapTopDown).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(first.renderLocalBoardFrame).mock.invocationCallOrder[0]!,
    );
    expect(h.availability).toHaveBeenLastCalledWith(true, undefined);
    const marks = [
      {
        id: 'pin',
        label: 'Manual',
        geometry: { kind: 'pin' as const, at: { x: 13.25, y: 22.125 } },
      },
    ];
    h.surface.apply({ ...presentation(), marks });
    expect(first.renderLocalBoardFrame).toHaveBeenCalledTimes(2);
    expect(vi.mocked(first.applyLocalBoard).mock.invocationCallOrder[1]).toBeLessThan(
      vi.mocked(first.renderLocalBoardFrame).mock.invocationCallOrder[1]!,
    );
    expect(h.prepare).toHaveBeenCalledOnce();
    const raster = vi.mocked(first.applyLocalBoard).mock.calls[0]![0];
    expect(vi.mocked(first.applyLocalBoard).mock.calls[1]![0]).toBe(raster);
    const next = document.createElement('canvas');
    await h.surface.mount(next, new AbortController().signal, { ...presentation(), marks });
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(h.observers[0]!.disconnect).toHaveBeenCalledOnce();
    expect(h.scenes[1]!.applyLocalBoard).toHaveBeenCalledWith(raster, marks);
    expect(h.prepare).toHaveBeenCalledOnce();
    await h.surface.unmount(h.canvas); // Old Angular cleanup cannot retire the new canvas.
    expect(h.scenes[1]!.dispose).not.toHaveBeenCalled();
    const disposal = h.surface.dispose();
    expect(h.surface.dispose()).toBe(disposal);
    await disposal;
    expect(h.scenes[1]!.dispose).toHaveBeenCalledOnce();
    expect(h.frames.size).toBe(0);
  });
  it('rejects a wrong full identity before scene allocation and detaches constructor inputs', async () => {
    const h = setup({ identity: async () => 'f'.repeat(64) });
    await expect(h.mount()).rejects.toThrow('identity');
    await h.surface.dispose();
    expect(h.factory).not.toHaveBeenCalled();
    const input = structuredClone(board);
    const factory = vi.fn(() => scene());
    const other = new BoardSurface(key, input, binding, {
      sceneFactory: factory,
      identity: async () => 'f'.repeat(64),
    });
    Object.assign(input.bounds, { maxX: 1 });
    await expect(
      other.mount(h.canvas, new AbortController().signal, presentation()),
    ).rejects.toThrow('identity');
    await other.dispose();
    expect(factory).not.toHaveBeenCalled();
  });
  it('awaits cancelled delayed hashing before a successor can allocate', async () => {
    let settle!: (value: string) => void;
    const hash = new Promise<string>((resolve) => {
      settle = resolve;
    });
    const identity = vi
      .fn()
      .mockImplementationOnce(() => hash)
      .mockResolvedValue(board.assetIdentity);
    const h = setup({ identity });
    const abort = new AbortController();
    const pending = h.surface.mount(h.canvas, abort.signal, presentation());
    const rejected = expect(pending).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(identity).toHaveBeenCalledOnce());
    abort.abort();
    const retired = h.surface.unmount(h.canvas);
    let released = false;
    void retired.then(() => {
      released = true;
    });
    const next = document.createElement('canvas');
    const successor = h.surface.mount(next, new AbortController().signal, presentation());
    await Promise.resolve();
    expect(released).toBe(false);
    expect(h.factory).not.toHaveBeenCalled();
    settle(board.assetIdentity);
    await rejected;
    await successor;
    expect(released).toBe(true);
    expect(h.factory).toHaveBeenCalledOnce();
  });
  it('suppresses a late hash rejection after terminal disposal', async () => {
    let reject!: (error: Error) => void;
    const identity = vi.fn(
      () =>
        new Promise<string>((_, r) => {
          reject = r;
        }),
    );
    const h = setup({ identity });
    const pending = h.mount();
    const rejected = expect(pending).rejects.toThrow('late hash');
    await vi.waitFor(() => expect(identity).toHaveBeenCalledOnce());
    const disposed = h.surface.dispose();
    reject(new Error('late hash'));
    await rejected;
    await disposed;
    expect(h.factory).not.toHaveBeenCalled();
    expect(h.availability.mock.calls.some(([ready, error]) => ready || error)).toBe(false);
    await expect(h.mount()).rejects.toThrow('cancelled');
  });
  it.each(['scene', 'observer', 'observe', 'apply', 'frame', 'schedule'])(
    'releases late handles exactly once after reentrant teardown during %s',
    async (step) => {
      const owned = scene();
      const observer = { observe: vi.fn(), disconnect: vi.fn() };
      const h = setup({
        sceneFactory: () => {
          if (step === 'scene') void h.surface.dispose();
          return owned;
        },
        observerFactory: () => {
          if (step === 'observer') void h.surface.dispose();
          return observer as unknown as ResizeObserver;
        },
        requestFrame: () => {
          if (step === 'schedule') void h.surface.dispose();
          return 99;
        },
      });
      observer.observe.mockImplementation(() => {
        if (step === 'observe') void h.surface.dispose();
      });
      vi.mocked(owned.applyLocalBoard).mockImplementation(() => {
        if (step === 'apply') void h.surface.dispose();
      });
      vi.mocked(owned.renderLocalBoardFrame).mockImplementation(() => {
        if (step === 'frame') void h.surface.dispose();
      });
      await expect(h.mount()).rejects.toThrow('cancelled');
      await h.surface.dispose();
      expect(owned.dispose).toHaveBeenCalledOnce();
      expect(observer.disconnect).toHaveBeenCalledTimes(step === 'scene' ? 0 : 1);
      if (step === 'schedule') expect(h.cancel).toHaveBeenCalledWith(99);
      expect(h.availability.mock.calls.some(([ready]) => ready)).toBe(false);
    },
  );
  it('detaches ownership before external release and continues through throwing/reentrant releases', async () => {
    const h = setup();
    await h.mount();
    const owned = h.scenes[0]!;
    h.observers[0]!.disconnect.mockImplementation(() => {
      void h.surface.dispose();
      throw new Error('disconnect');
    });
    vi.mocked(owned.dispose).mockImplementation(() => {
      void h.surface.dispose();
      throw new Error('dispose');
    });
    h.cancel.mockImplementation(() => {
      throw new Error('cancel');
    });
    await h.surface.dispose();
    expect(owned.dispose).toHaveBeenCalledOnce();
    expect(h.observers[0]!.disconnect).toHaveBeenCalledOnce();
    expect(h.cancel).toHaveBeenCalledOnce();
    await expect(h.mount()).rejects.toThrow('cancelled');
  });
  it('preserves a valid raster returned during reentrant canvas cleanup for the successor', async () => {
    const h = setup();
    const prepare = h.prepare.getMockImplementation()!;
    h.prepare.mockImplementationOnce((asset, identity, cap) => {
      void h.surface.unmount(h.canvas);
      return prepare(asset, identity, cap);
    });
    await expect(h.mount()).rejects.toThrow('cancelled');
    await h.surface.mount(
      document.createElement('canvas'),
      new AbortController().signal,
      presentation(),
    );
    expect(h.prepare).toHaveBeenCalledOnce();
    expect(h.scenes[0]!.dispose).toHaveBeenCalledOnce();
    expect(h.scenes[0]!.applyLocalBoard).not.toHaveBeenCalled();
  });
  it('prevents listener allocation after reentrant controls gating and retires partial observer failures', async () => {
    const owned = scene();
    Object.defineProperty(owned.controls, 'enabled', {
      set() {
        void h.surface.dispose();
      },
    });
    const h = setup({ sceneFactory: () => owned });
    await expect(h.mount()).rejects.toThrow('cancelled');
    await h.surface.dispose();
    expect(owned.controls.listenToKeyEvents).not.toHaveBeenCalled();
    expect(owned.dispose).toHaveBeenCalledOnce();
    const observer = {
      observe: vi.fn(() => {
        throw new Error('observe failed');
      }),
      disconnect: vi.fn(),
    };
    const other = setup({ observerFactory: () => observer as unknown as ResizeObserver });
    await expect(other.mount()).rejects.toThrow('observe failed');
    await other.surface.dispose();
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(other.scenes[0]!.dispose).toHaveBeenCalledOnce();
    expect(other.scenes[0]!.applyLocalBoard).not.toHaveBeenCalled();
  });
  it('aborts exact listener lifetimes and ignores stale callbacks after a successor mounts', async () => {
    const registration = vi.spyOn(window, 'addEventListener');
    const h = setup();
    await h.mount();
    const first = h.scenes[0]!;
    const listeners = registration.mock.calls.filter(
      ([type]) => type === 'resize' || type === 'pagehide',
    );
    const firstOptions = listeners[0]![2] as AddEventListenerOptions;
    expect(firstOptions.signal!.aborted).toBe(false);
    await h.surface.mount(
      document.createElement('canvas'),
      new AbortController().signal,
      presentation(),
    );
    expect(firstOptions.signal!.aborted).toBe(true);
    for (const [type, listener] of listeners) (listener as EventListener)(new Event(type));
    expect(h.scenes[1]!.dispose).not.toHaveBeenCalled();
    expect(first.resize).toHaveBeenCalledOnce();
    await h.surface.dispose();
    expect(h.scenes[1]!.dispose).toHaveBeenCalledOnce();
  });
  it.each(['sourceKey', 'extent', 'fractional', 'allocation'])(
    'rejects divergent raster %s',
    async (field) => {
      const h = setup();
      h.prepare.mockImplementationOnce((asset, sourceKey, cap) => {
        const layout = rasterLayout(asset.bounds.maxX, asset.bounds.maxY, cap);
        const canvas = document.createElement('canvas');
        canvas.width = layout.width;
        canvas.height = layout.height;
        return {
          canvas,
          sourceKey: field === 'sourceKey' ? 'wrong' : sourceKey,
          widthM: field === 'extent' ? 1 : asset.bounds.maxX,
          heightM: asset.bounds.maxY,
          contentWidthPx:
            field === 'fractional' ? layout.contentWidthPx - 0.1 : layout.contentWidthPx,
          contentHeightPx: field === 'allocation' ? 1 : layout.contentHeightPx,
        };
      });
      await expect(h.mount()).rejects.toThrow('Raster');
      await h.surface.dispose();
      expect(h.scenes[0]!.applyLocalBoard).not.toHaveBeenCalled();
      expect(h.scenes[0]!.dispose).toHaveBeenCalledOnce();
    },
  );
  it('fails a lower-cap remount without preparing a second session raster', async () => {
    const h = setup();
    await h.mount();
    await h.surface.unmount(h.canvas);
    const next = scene();
    vi.mocked(next.localBoardTextureLimit).mockReturnValue(256);
    h.factory.mockImplementationOnce(() => {
      h.scenes.push(next);
      return next;
    });
    await expect(
      h.surface.mount(
        document.createElement('canvas'),
        new AbortController().signal,
        presentation(),
      ),
    ).rejects.toThrow('device cap');
    await h.surface.dispose();
    expect(h.prepare).toHaveBeenCalledOnce();
    expect(next.dispose).toHaveBeenCalledOnce();
  });
  it('supports a larger-cap remount without enlarging or preparing the raster again', async () => {
    const h = setup();
    await h.mount();
    const raster = vi.mocked(h.scenes[0]!.applyLocalBoard).mock.calls[0]![0];
    const next = scene();
    vi.mocked(next.localBoardTextureLimit).mockReturnValue(1024);
    h.factory.mockImplementationOnce(() => next);
    await h.surface.mount(
      document.createElement('canvas'),
      new AbortController().signal,
      presentation(),
    );
    expect(next.applyLocalBoard).toHaveBeenCalledWith(raster, []);
    expect(h.prepare).toHaveBeenCalledOnce();
    raster.canvas.width++;
    expect(() => h.surface.apply(presentation())).toThrow('Raster');
  });
  it.each(['frame', 'controls', 'resize', 'snap', 'context', 'apply'])(
    'invalidates readiness for %s failure and stops owned work',
    async (step) => {
      const h = setup();
      await h.mount();
      const owned = h.scenes[0]!;
      if (step === 'frame')
        vi.mocked(owned.renderLocalBoardFrame).mockImplementationOnce(() => {
          throw new Error('frame failed');
        });
      if (step === 'controls')
        vi.mocked(owned.controls.update).mockImplementationOnce(() => {
          throw new Error('controls failed');
        });
      if (step === 'frame' || step === 'controls') h.tick();
      if (step === 'resize') {
        vi.mocked(owned.resize).mockImplementationOnce(() => {
          throw new Error('resize failed');
        });
        h.surface.resize();
      }
      if (step === 'snap') {
        vi.mocked(owned.snapOblique).mockImplementationOnce(() => {
          throw new Error('snap failed');
        });
        h.surface.snap('oblique');
      }
      if (step === 'context') {
        const event = new Event('webglcontextlost', { cancelable: true });
        h.canvas.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
      }
      if (step === 'apply') {
        vi.mocked(owned.applyLocalBoard).mockImplementationOnce(() => {
          throw new Error('apply failed');
        });
        expect(() => h.surface.apply(presentation())).toThrow('apply failed');
      }
      expect(h.availability.mock.calls.at(-1)![0]).toBe(false);
      await h.surface.dispose();
      expect(owned.dispose).toHaveBeenCalledOnce();
      expect(h.frames.size).toBe(0);
      const count = vi.mocked(owned.renderLocalBoardFrame).mock.calls.length;
      h.callbacks[0]!([], h.observers[0] as unknown as ResizeObserver);
      h.surface.resize();
      expect(owned.renderLocalBoardFrame).toHaveBeenCalledTimes(count);
    },
  );
  it('rejects invalid updates while preserving valid display, and gates controls/snapping/picking', async () => {
    const h = setup();
    await h.mount();
    const owned = h.scenes[0]!;
    expect(() =>
      h.surface.apply({ ...presentation(), rate: 1 } as unknown as LocalPresentation),
    ).toThrow();
    expect(h.availability).toHaveBeenLastCalledWith(true, undefined);
    h.surface.setInteractionEnabled(false);
    expect(owned.controls.enabled).toBe(false);
    expect(h.surface.pickAt(1, 2)).toBeNull();
    h.surface.snap('oblique');
    expect(owned.snapOblique).not.toHaveBeenCalled();
    h.surface.setInteractionEnabled(true);
    expect(h.surface.pickAt(1, 2)).toEqual({ x: 10.25, y: 20.75 });
    vi.mocked(owned.pickAt).mockReturnValueOnce({ type: 'point', coord: { x: 151, y: 10 } });
    expect(h.surface.pickAt(1, 2)).toBeNull();
    vi.mocked(owned.snapOblique).mockImplementationOnce(() => {
      void h.surface.dispose();
    });
    const frames = vi.mocked(owned.renderLocalBoardFrame).mock.calls.length;
    h.surface.snap('oblique');
    expect(owned.renderLocalBoardFrame).toHaveBeenCalledTimes(frames);
  });
  it('separates drawing camera lock from dialog interaction gating before and after mount', async () => {
    const h = setup();
    h.surface.setCameraEnabled(false);
    await h.mount();
    const owned = h.scenes[0]!;
    expect(owned.controls.enabled).toBe(false);
    expect(h.surface.pickAt(1, 2)).toEqual({ x: 10.25, y: 20.75 });
    h.surface.snap('oblique');
    expect(owned.snapOblique).not.toHaveBeenCalled();
    h.surface.setInteractionEnabled(false);
    expect(h.surface.pickAt(1, 2)).toBeNull();
    h.surface.setCameraEnabled(true);
    expect(owned.controls.enabled).toBe(false);
    h.surface.snap('oblique');
    expect(owned.snapOblique).not.toHaveBeenCalled();
    h.surface.setInteractionEnabled(true);
    expect(owned.controls.enabled).toBe(true);
    h.surface.snap('oblique');
    expect(owned.snapOblique).toHaveBeenCalledOnce();
    h.surface.setCameraEnabled(false);
    expect(owned.controls.enabled).toBe(false);
    expect(h.surface.pickAt(1, 2)).toEqual({ x: 10.25, y: 20.75 });
  });
  it('retires on persisted pagehide and never resumes on pageshow', async () => {
    const h = setup();
    await h.mount();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    await h.surface.dispose();
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    expect(h.scenes[0]!.dispose).toHaveBeenCalledOnce();
    await expect(h.mount()).rejects.toThrow('cancelled');
  });
});

describe('actual raster/scene/OrbitControls with a WebGLRenderer double', () => {
  function canvasContext() {
    return new Proxy(
      {
        measureText: () => ({ width: 12 }),
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      },
      {
        get(target, property) {
          return Reflect.get(target, property) ?? (() => {});
        },
        set(target, property, value) {
          Reflect.set(target, property, value);
          return true;
        },
      },
    ) as unknown as CanvasRenderingContext2D;
  }
  it.each(['countryside-rectangle', 'wooded-hills'])(
    'preserves %s metre corners, fractional UVs, raster/texture reuse and original-root cleanup',
    async (name) => {
      vi.stubGlobal(
        'Path2D',
        class {
          moveTo() {}
          lineTo() {}
          closePath() {}
          // The period raster merges each base layer into one path (#498).
          addPath() {}
        },
      );
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => canvasContext());
      // Committed public bytes; no claim of worker certification in this rendering test.
      const json = readFileSync(resolve(process.cwd(), '../data/maps', `${name}.json`), 'utf8');
      const asset = importAsset(json);
      const certified: CertifiedBoard = {
        asset,
        canonicalJson: json,
        assetIdentity: await assetIdentity(asset, 'asset'),
        bounds: asset.bounds,
        summary: {
          name: asset.name,
          widthM: asset.bounds.maxX,
          heightM: asset.bounds.maxY,
          ref: { kind: 'premade', id: name },
        },
      };
      const fixed = await createLocalBoardBinding(certified, new AbortController().signal);
      const canvas = document.createElement('canvas');
      document.body.append(canvas);
      Object.defineProperties(canvas, {
        clientWidth: { value: 900 },
        clientHeight: { value: 500 },
      });
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
        x: 10,
        y: 20,
        left: 10,
        top: 20,
        right: 910,
        bottom: 520,
        width: 900,
        height: 500,
        toJSON() {},
      });
      const add = vi.spyOn(document, 'addEventListener');
      const remove = vi.spyOn(document, 'removeEventListener');
      const tables: FixtureTableScene[] = [];
      const surface = new BoardSurface(key, certified, fixed, {
        sceneFactory: (c) => {
          const table = new FixtureTableScene(c, { mode: 'local-hq-board' });
          tables.push(table);
          return table;
        },
        observerFactory: () => ({ observe() {}, disconnect() {} }) as unknown as ResizeObserver,
        requestFrame: () => 1,
        cancelFrame: () => {},
      });
      surfaces.push(surface);
      await surface.mount(canvas, new AbortController().signal, presentation(fixed));
      const table = tables[0]!;
      const mesh = table.scene.getObjectByName('map-artwork') as THREE.Mesh<
        THREE.PlaneGeometry,
        THREE.MeshStandardMaterial
      >;
      expect(mesh.geometry.parameters).toMatchObject({
        width: asset.bounds.maxX,
        height: asset.bounds.maxY,
      });
      const uv = mesh.geometry.getAttribute('uv');
      const rasterCanvas = mesh.material.map!.image as HTMLCanvasElement;
      const layout = rasterLayout(asset.bounds.maxX, asset.bounds.maxY, 512);
      expect(rasterCanvas.height).toBe(layout.height);
      expect(Math.min(...Array.from({ length: uv.count }, (_, i) => uv.getY(i)))).toBeCloseTo(
        1 - layout.contentHeightPx / layout.height,
        6,
      );
      for (const point of [
        { x: 0, y: 0 },
        { x: asset.bounds.maxX, y: 0 },
        { x: 0, y: asset.bounds.maxY },
        { x: asset.bounds.maxX, y: asset.bounds.maxY },
        { x: 123.25, y: 789.125 },
      ]) {
        const vector = new (await import('three')).Vector3(
          point.x - asset.bounds.maxX / 2,
          0,
          point.y - asset.bounds.maxY / 2,
        );
        table.camera.updateMatrixWorld();
        vector.project(table.camera);
        const picked = surface.pickAt(10 + (vector.x + 1) * 450, 20 + (1 - vector.y) * 250);
        expect(picked).not.toBeNull();
        expect(picked!.x).toBeCloseTo(point.x, 6);
        expect(picked!.y).toBeCloseTo(point.y, 6);
      }
      const texture = mesh.material.map!;
      const release = vi.spyOn(texture, 'dispose');
      surface.apply({
        ...presentation(fixed),
        marks: [
          {
            id: 'se',
            label: 'Manual',
            geometry: {
              kind: 'pin',
              at: { x: asset.bounds.maxX - 20.25, y: asset.bounds.maxY - 30.125 },
            },
          },
        ],
      });
      expect(mesh.material.map).toBe(texture);
      expect(table.pieceCount).toBe(0);
      expect(release).not.toHaveBeenCalled();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', bubbles: true }));
      canvas.remove();
      await surface.unmount(canvas);
      expect(release).toHaveBeenCalledOnce();
      for (const type of ['keydown', 'keyup']) {
        const registration = add.mock.calls.find(
          ([event, , options]) =>
            event === type && typeof options === 'object' && options?.capture === true,
        );
        expect(registration).toBeDefined();
        expect(remove).toHaveBeenCalledWith(type, registration![1], true);
      }
      const next = document.createElement('canvas');
      document.body.append(next);
      await surface.mount(next, new AbortController().signal, presentation(fixed));
      const nextMesh = tables[1]!.scene.getObjectByName('map-artwork') as THREE.Mesh<
        THREE.PlaneGeometry,
        THREE.MeshStandardMaterial
      >;
      expect(nextMesh.material.map!.image).toBe(rasterCanvas);
      await surface.dispose();
      expect(gpu.disposes).toBe(2);
    },
    30000,
  );
});
