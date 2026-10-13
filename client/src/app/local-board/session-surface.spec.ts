import { webcrypto } from 'node:crypto';
import { assetIdentity, canonicalizeAsset, createReferenceAsset } from '@kriegsspiel/maps';
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CertifiedBoard } from '../../shared/game-setup/contracts';
import { createLocalBoardBinding } from './board-binding';
import {
  BOARD_SURFACE_FACTORY,
  BoardHostComponent,
  type BoardSurfaceHandle,
} from './board-host.component';
import { BoardSurface, type BoardScene } from './board-surface';
import { rasterLayout } from '../../shared/map-table/raster';
import type { LocalBoardBinding, LocalPresentation, LocalSessionKey } from './contracts';
import { SessionSurface } from './session-surface';

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
  binding = await createLocalBoardBinding(board, new AbortController().signal, () =>
    Promise.resolve(board.assetIdentity),
  );
});
afterAll(() => vi.unstubAllGlobals());
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => (resolve = yes));
  return { promise, resolve };
}
const presentation = (): LocalPresentation => ({
  binding,
  marks: [],
  gameMs: 0,
  rate: 0,
  pieces: [],
  roster: [],
  papers: [],
});
function setup(
  options: {
    mount?: BoardSurfaceHandle['mount'];
    unmount?: BoardSurfaceHandle['unmount'];
    construct?: (owner: SessionSurface) => void;
  } = {},
) {
  let notify!: (ready: boolean, error?: string) => void;
  const resource: BoardSurfaceHandle = {
    mount: vi.fn(options.mount ?? (() => Promise.resolve())),
    unmount: vi.fn(options.unmount ?? (() => Promise.resolve())),
    dispose: vi.fn(() => Promise.resolve()),
    apply: vi.fn(),
    setInteractionEnabled: vi.fn(),
    setCameraEnabled: vi.fn(),
    resize: vi.fn(),
    snap: vi.fn(),
    pickAt: vi.fn(() => ({ x: 1, y: 2 })),
  };
  const make = vi.fn((callback: typeof notify) => {
    notify = callback;
    options.construct?.(owner);
    return resource;
  });
  const owner = new SessionSurface(key, board, binding, make);
  const lease = (callback = vi.fn()) => ({
    handle: owner.factory(key, board, binding, callback),
    callback,
  });
  return {
    owner,
    resource,
    make,
    lease,
    notify: (ready: boolean, error?: string) => notify(ready, error),
  };
}

describe('session-owned board canvas leases', () => {
  it('reuses the same surface after an entire host is retired and replaced', async () => {
    const s = setup();
    const first = s.lease();
    const c1 = document.createElement('canvas');
    await first.handle.mount(c1, new AbortController().signal, presentation());
    await first.handle.dispose();
    expect(s.resource.dispose).not.toHaveBeenCalled();
    const second = s.lease();
    await second.handle.mount(
      document.createElement('canvas'),
      new AbortController().signal,
      presentation(),
    );
    expect(s.make).toHaveBeenCalledTimes(1);
    expect(s.resource.mount).toHaveBeenCalledTimes(2);
    await s.owner.dispose();
    expect(s.resource.dispose).toHaveBeenCalledTimes(1);
  });
  it('awaits pending predecessor mounting and unmount before allocating the successor canvas', async () => {
    const mounting = deferred(),
      retirement = deferred();
    const order: string[] = [];
    const s = setup({
      mount: async () => {
        order.push('mount');
        if (order.length === 1) await mounting.promise;
      },
      unmount: async () => {
        order.push('unmount');
        await retirement.promise;
      },
    });
    const first = s.lease();
    const firstPending = first.handle
      .mount(document.createElement('canvas'), new AbortController().signal, presentation())
      .catch(() => {});
    await vi.waitFor(() => expect(order).toEqual(['mount']));
    const second = s.lease();
    const secondPending = second.handle.mount(
      document.createElement('canvas'),
      new AbortController().signal,
      presentation(),
    );
    expect(first.handle.pickAt(0, 0)).toBeNull();
    mounting.resolve();
    await firstPending;
    await vi.waitFor(() => expect(order).toEqual(['mount', 'unmount']));
    retirement.resolve();
    await secondPending;
    expect(order).toEqual(['mount', 'unmount', 'mount']);
    await s.owner.dispose();
  });
  it('old dispose/unmount cannot retire a successor reusing the exact same canvas', async () => {
    const s = setup(),
      canvas = document.createElement('canvas'),
      first = s.lease(),
      second = s.lease();
    await first.handle.mount(canvas, new AbortController().signal, presentation());
    await second.handle.mount(canvas, new AbortController().signal, presentation());
    const calls = vi.mocked(s.resource.unmount).mock.calls.length;
    await first.handle.unmount(canvas);
    await first.handle.dispose();
    first.handle.setCameraEnabled(false);
    first.handle.apply(presentation());
    expect(s.resource.unmount).toHaveBeenCalledTimes(calls);
    expect(s.resource.apply).not.toHaveBeenCalled();
    expect(second.handle.pickAt(0, 0)).toEqual({ x: 1, y: 2 });
    await s.owner.dispose();
  });
  it('does not forward predecessor release notifications into a successor generation', async () => {
    const held = deferred();
    const s = setup({ unmount: () => held.promise }),
      first = s.lease(),
      second = s.lease();
    await first.handle.mount(
      document.createElement('canvas'),
      new AbortController().signal,
      presentation(),
    );
    s.notify(true);
    expect(first.callback).toHaveBeenCalledWith(true, undefined);
    const pending = second.handle.mount(
      document.createElement('canvas'),
      new AbortController().signal,
      presentation(),
    );
    s.notify(false, 'old error');
    expect(second.callback).not.toHaveBeenCalled();
    held.resolve();
    await pending;
    s.notify(true);
    expect(second.callback).toHaveBeenCalledWith(true, undefined);
    expect(first.callback).toHaveBeenCalledTimes(1);
    await s.owner.dispose();
  });
  it('remembers pre-mount camera/dialog gates before the first frame can become ready', async () => {
    let saw = false;
    const s = setup({
      mount: async () => {
        expect(s.resource.setInteractionEnabled).toHaveBeenLastCalledWith(false);
        expect(s.resource.setCameraEnabled).toHaveBeenLastCalledWith(false);
        saw = true;
      },
    });
    const first = s.lease();
    first.handle.setInteractionEnabled(false);
    first.handle.setCameraEnabled(false);
    await first.handle.mount(
      document.createElement('canvas'),
      new AbortController().signal,
      presentation(),
    );
    expect(saw).toBe(true);
    await s.owner.dispose();
  });
  it('terminal disposal during synchronous factory handoff retires the late surface exactly once', async () => {
    let retired: Promise<void> | undefined;
    const s = setup({
        construct: (owner) => {
          retired = owner.dispose();
        },
      }),
      first = s.lease();
    await expect(
      first.handle.mount(
        document.createElement('canvas'),
        new AbortController().signal,
        presentation(),
      ),
    ).rejects.toThrow('retired');
    await retired;
    expect(s.resource.mount).not.toHaveBeenCalled();
    expect(s.resource.dispose).toHaveBeenCalledTimes(1);
    expect(s.owner.dispose()).toBe(retired);
    expect(() => s.lease()).toThrow('retired');
  });
  it('terminal disposal while successor is queued prevents successor allocation and releases all leases', async () => {
    const mounting = deferred();
    const s = setup({ mount: () => mounting.promise }),
      first = s.lease(),
      second = s.lease();
    const pending = first.handle
      .mount(document.createElement('canvas'), new AbortController().signal, presentation())
      .catch(() => {});
    await vi.waitFor(() => expect(s.resource.mount).toHaveBeenCalledTimes(1));
    const queued = second.handle
      .mount(document.createElement('canvas'), new AbortController().signal, presentation())
      .catch(() => {});
    const retired = s.owner.dispose();
    mounting.resolve();
    await Promise.all([pending, queued, retired]);
    expect(s.resource.mount).toHaveBeenCalledTimes(1);
    expect(s.resource.dispose).toHaveBeenCalledTimes(1);
  });
  it('rejects incompatible key, binding or altered certified asset before surface construction', () => {
    const s = setup();
    expect(() => s.owner.factory('local-other', board, binding, vi.fn())).toThrow();
    expect(() => s.owner.factory(key, board, { ...binding, revision: 'bad' }, vi.fn())).toThrow();
    const changed = { ...board, asset: { ...board.asset, name: 'changed' } };
    expect(() => s.owner.factory(key, changed, binding, vi.fn())).toThrow();
    expect(s.make).not.toHaveBeenCalled();
  });
  it('keeps abort propagation after successful mount and removes its listener on release', async () => {
    let linked: AbortSignal | undefined;
    const s = setup({
        mount: async (_canvas, signal) => {
          linked = signal;
        },
      }),
      first = s.lease(),
      controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    await first.handle.mount(document.createElement('canvas'), controller.signal, presentation());
    controller.abort();
    expect(linked?.aborted).toBe(true);
    await first.handle.dispose();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    await s.owner.dispose();
  });
});

describe('fresh lease generation and independent terminal failures', () => {
  it('A → canceled B → C retains the entire deferred mount/unmount fence', async () => {
    const mount = deferred(),
      unmount = deferred();
    const s = setup({
      mount: async () => {
        if (vi.mocked(s.resource.mount).mock.calls.length === 1) await mount.promise;
      },
      unmount: () => unmount.promise,
    });
    const a = s.lease(),
      b = s.lease(),
      c = s.lease();
    const pa = a.handle
      .mount(document.createElement('canvas'), new AbortController().signal, presentation())
      .catch(() => {});
    await vi.waitFor(() => expect(s.resource.mount).toHaveBeenCalledOnce());
    const pb = b.handle
      .mount(document.createElement('canvas'), new AbortController().signal, presentation())
      .catch(() => {});
    const retiredB = b.handle.dispose();
    const pc = c.handle.mount(
      document.createElement('canvas'),
      new AbortController().signal,
      presentation(),
    );
    mount.resolve();
    await pa;
    await vi.waitFor(() => expect(s.resource.unmount).toHaveBeenCalledOnce());
    expect(s.resource.mount).toHaveBeenCalledTimes(1);
    unmount.resolve();
    await Promise.all([pb, retiredB, pc]);
    expect(s.resource.mount).toHaveBeenCalledTimes(2);
    await s.owner.dispose();
  });
  it('terminal cleanup releases the independent surface and retains rejected predecessor unmount', async () => {
    const s = setup({
      unmount: async () => {
        throw new Error('release');
      },
    });
    const a = s.lease(),
      b = s.lease();
    await a.handle.mount(
      document.createElement('canvas'),
      new AbortController().signal,
      presentation(),
    );
    await expect(
      b.handle.mount(
        document.createElement('canvas'),
        new AbortController().signal,
        presentation(),
      ),
    ).rejects.toThrow('retirement');
    await expect(s.owner.dispose()).rejects.toThrow('retirement');
    expect(s.resource.dispose).toHaveBeenCalledOnce();
    expect(s.resource.mount).toHaveBeenCalledOnce();
  });
  it('retained same host canvas replacement caches old retirement without a host destruction barrier', async () => {
    const held = deferred();
    const s = setup({ unmount: () => held.promise });
    const a = s.lease();
    const canvas = document.createElement('canvas');
    await a.handle.mount(canvas, new AbortController().signal, presentation());
    const old = a.handle.unmount(canvas);
    expect(a.handle.unmount(canvas)).not.toBeUndefined();
    const mounting = a.handle.mount(canvas, new AbortController().signal, presentation());
    await Promise.resolve();
    expect(s.resource.mount).toHaveBeenCalledOnce();
    held.resolve();
    await old;
    await mounting;
    expect(s.make).toHaveBeenCalledOnce();
    expect(s.resource.mount).toHaveBeenCalledTimes(2);
    await s.owner.dispose();
  });
  it('suppresses predecessor notifications and stale mutation while a successor mount is blocked', async () => {
    const held = deferred();
    const s = setup({ unmount: () => held.promise });
    const a = s.lease(),
      b = s.lease();
    await a.handle.mount(
      document.createElement('canvas'),
      new AbortController().signal,
      presentation(),
    );
    const mounting = b.handle.mount(
      document.createElement('canvas'),
      new AbortController().signal,
      presentation(),
    );
    s.notify(true);
    s.notify(false, 'old');
    a.handle.apply(presentation());
    a.handle.resize();
    a.handle.snap('oblique');
    expect(b.callback).not.toHaveBeenCalled();
    expect(s.resource.apply).not.toHaveBeenCalled();
    expect(s.resource.resize).not.toHaveBeenCalled();
    held.resolve();
    await mounting;
    s.notify(true);
    expect(b.callback).toHaveBeenCalledOnce();
    await s.owner.dispose();
  });
  it('a throwing surface factory retires its acquisition ticket without mounting anything', async () => {
    const s = setup({
      construct: () => {
        throw new Error('construction');
      },
    });
    const a = s.lease();
    await expect(
      a.handle.mount(
        document.createElement('canvas'),
        new AbortController().signal,
        presentation(),
      ),
    ).rejects.toThrow('construction');
    await s.owner.dispose();
    expect(s.resource.mount).not.toHaveBeenCalled();
  });
  it('validates summary/ref as immutable session metadata in addition to bytes, binding and key', () => {
    const s = setup();
    expect(() =>
      s.owner.factory(
        key,
        { ...board, summary: { ...board.summary, ref: { kind: 'generated', id: 'foreign' } } },
        binding,
        vi.fn(),
      ),
    ).toThrow();
    expect(s.make).not.toHaveBeenCalled();
  });
});

@Component({
  standalone: true,
  imports: [BoardHostComponent],
  template:
    '@if (visible()) { <ks-local-board-host [key]="key" [board]="board" [presentation]="presentation" (initialized)="ready.set($event.ok)"/> }',
})
class RetainedParent {
  readonly visible = signal(true);
  readonly ready = signal(false);
  readonly key = key;
  readonly board = board;
  readonly presentation = presentation();
}
const nativeSurfaces: SessionSurface[] = [];
afterEach(async () => {
  TestBed.resetTestingModule();
  await Promise.allSettled(nativeSurfaces.splice(0).map((surface) => surface.dispose()));
});
function native(options: { observer?: () => ResizeObserver; scene?: () => BoardScene } = {}) {
  const sequence: string[] = [];
  const scenes: BoardScene[] = [];
  const prepare = vi.fn((asset, sourceKey, limit) => {
    const layout = rasterLayout(asset.bounds.maxX, asset.bounds.maxY, limit),
      canvas = document.createElement('canvas');
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
  });
  const make = vi.fn(
    (notify) =>
      new BoardSurface(key, board, binding, {
        onAvailability: notify,
        prepare,
        identity: async () => board.assetIdentity,
        sceneFactory: () => {
          sequence.push('scene');
          if (options.scene) return options.scene();
          const scene: BoardScene = {
            controls: { enabled: true, update: vi.fn(), listenToKeyEvents: vi.fn() },
            localBoardTextureLimit: () => 512,
            applyLocalBoard: vi.fn(),
            renderLocalBoardFrame: vi.fn(() => {
              sequence.push('frame');
            }),
            snapTopDown: vi.fn(),
            snapOblique: vi.fn(),
            pickAt: () => ({ type: 'point', coord: { x: 1, y: 2 } }),
            resize: vi.fn(),
            dispose: vi.fn(() => {
              sequence.push('disposed');
            }),
          };
          scenes.push(scene);
          return scene;
        },
        observerFactory:
          options.observer ??
          (() => ({ observe: vi.fn(), disconnect: vi.fn() }) as unknown as ResizeObserver),
        requestFrame: () => 1,
        cancelFrame: vi.fn(),
      }),
  );
  const owner = new SessionSurface(key, board, binding, make);
  nativeSurfaces.push(owner);
  return { owner, make, prepare, scenes, sequence };
}
describe('actual native child hosts borrowing a retained parent session', () => {
  it('recreates entire native host components, retaining one underlying surface/raster after actual predecessor destruction', async () => {
    const n = native();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: BOARD_SURFACE_FACTORY, useValue: n.owner.factory },
      ],
    });
    const fixture = TestBed.createComponent(RetainedParent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.ready()).toBe(true));
    const first = n.scenes[0]!;
    fixture.componentInstance.visible.set(false);
    fixture.detectChanges();
    await vi.waitFor(() => expect(first.dispose).toHaveBeenCalledOnce());
    fixture.componentInstance.ready.set(false);
    fixture.componentInstance.visible.set(true);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.ready()).toBe(true));
    expect(n.make).toHaveBeenCalledOnce();
    expect(n.prepare).toHaveBeenCalledOnce();
    expect(n.scenes).toHaveLength(2);
    expect(n.sequence).toEqual(['scene', 'frame', 'frame', 'disposed', 'scene', 'frame', 'frame']);
    fixture.destroy();
    await n.owner.dispose();
    expect(n.scenes[1]!.dispose).toHaveBeenCalledOnce();
  });
  it('retires a native acquired scene when observer construction throws after the scene returned', async () => {
    const n = native({
      observer: () => {
        throw new Error('observer construction');
      },
    });
    const host = n.owner.factory(key, board, binding, vi.fn());
    await expect(
      host.mount(document.createElement('canvas'), new AbortController().signal, presentation()),
    ).rejects.toThrow('observer construction');
    await n.owner.dispose();
    expect(n.scenes[0]!.dispose).toHaveBeenCalledOnce();
  });
  it('retires a native acquired observer and scene when observation fails', async () => {
    const disconnect = vi.fn();
    const n = native({
      observer: () =>
        ({
          observe: () => {
            throw new Error('observe');
          },
          disconnect,
        }) as unknown as ResizeObserver,
    });
    const host = n.owner.factory(key, board, binding, vi.fn());
    await expect(
      host.mount(document.createElement('canvas'), new AbortController().signal, presentation()),
    ).rejects.toThrow('observe');
    await n.owner.dispose();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(n.scenes[0]!.dispose).toHaveBeenCalledOnce();
  });
  it('handles native scene constructor failure without a returned scene while closing the surface', async () => {
    const n = native({
      scene: () => {
        throw new Error('scene constructor');
      },
    });
    const host = n.owner.factory(key, board, binding, vi.fn());
    await expect(
      host.mount(document.createElement('canvas'), new AbortController().signal, presentation()),
    ).rejects.toThrow('scene constructor');
    await n.owner.dispose();
    expect(n.prepare).not.toHaveBeenCalled();
    expect(n.scenes).toHaveLength(0);
  });
});
