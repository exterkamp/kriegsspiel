import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as THREE from 'three';
import type { DisplayInspection, LoadState } from '../../shared/map-table/loader';
import {
  TableScene as FixtureTableScene,
  type PreviewApplyError,
} from '../../legacy/table/FixtureTableScene';
import { MapTableComponent } from './map-table.component';
import {
  MAP_TABLE_LOADER_FACTORY,
  MAP_TABLE_OBSERVER_FACTORY,
  MAP_TABLE_SCENE_FACTORY,
  type MapTableScene,
} from './map-table.service';

const rendererState = vi.hoisted(() => ({ disposes: 0 }));
vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  class Renderer {
    capabilities = { maxTextureSize: 4096, getMaxAnisotropy: () => 4 };
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {
      rendererState.disposes++;
    }
    getContext() {
      return { isContextLost: () => false };
    }
  }
  // Avoid bundled spread helpers: their shared chunk imports the scene before mock setup.
  return Object.assign({}, actual, { WebGLRenderer: Renderer });
});
const displayed = {
  name: '<Village & Hills>',
  filename: 'public.json',
  sourceKey: 'full-asset-digest',
  widthM: 15000,
  heightM: 5000,
  inspection: {
    sourceKey: 'full-asset-digest',
    textureLimitPx: 4096,
    deviceMaxTextureSizePx: 8192,
    textureWidthPx: 4096,
    textureHeightPx: 1366,
    contentWidthPx: 4096,
    contentHeightPx: 4096 / 3,
    readMs: null,
    parseAndDispatchMs: 10,
    certificationWaitMs: 20,
    identityMs: 1,
    rasterMs: 30,
    applyAndRetireMs: 5,
    resources: { textures: 3, geometries: 5 },
  },
};
function create(realScene = false) {
  let publish!: (state: LoadState) => void;
  let actualScene: FixtureTableScene | undefined;
  const scene = {
    start: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
    fitPreview: vi.fn(),
    snapTopDown: vi.fn(),
    snapOblique: vi.fn(),
    previewTextureLimit: () => 4096,
    previewObservation: () => null,
    applyPreviewRaster: vi.fn(),
  } satisfies MapTableScene;
  const unsubscribe = vi.fn(() => true);
  const loader = {
    load: vi.fn(async () => {}),
    cancel: vi.fn(),
    dispose: vi.fn(),
    unavailable: vi.fn(),
    subscribe(listener: (state: LoadState) => void) {
      publish = listener;
      listener({
        phase: 'empty',
        message: 'Load saved generated JSON.',
        displayed: null,
        available: true,
      });
      return unsubscribe;
    },
  };
  const observer = { observe: vi.fn(), disconnect: vi.fn() };
  const factory = vi.fn(
    (canvas: HTMLCanvasElement, onPreviewUnavailable: (error: PreviewApplyError) => void) => {
      if (realScene)
        return (actualScene = new FixtureTableScene(canvas, {
          mode: 'public-map-preview',
          onPreviewUnavailable,
        }));
      return scene;
    },
  );
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: MAP_TABLE_SCENE_FACTORY, useValue: factory },
      { provide: MAP_TABLE_LOADER_FACTORY, useValue: () => loader },
      { provide: MAP_TABLE_OBSERVER_FACTORY, useValue: () => observer },
    ],
  });
  const fixture = TestBed.createComponent(MapTableComponent);
  const root = fixture.nativeElement as HTMLElement;
  const get = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
  return {
    fixture,
    root,
    scene,
    loader,
    observer,
    factory,
    unsubscribe,
    get,
    table: fixture.componentInstance.table,
    actualScene: () => actualScene!,
    publish: async (state: LoadState) => {
      publish(state);
      await fixture.whenStable();
    },
    ready: async () => {
      publish({ phase: 'ready', message: 'Map loaded.', displayed, available: true });
      await fixture.whenStable();
    },
  };
}
beforeEach(() => {
  rendererState.disposes = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(9);
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
});
afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('native MapTableComponent', () => {
  it('renders empty, binds file selection/progress/cancel and resets equal-file input', async () => {
    const h = create();
    expect(h.factory).not.toHaveBeenCalled();
    await h.fixture.whenStable();
    expect(h.factory).toHaveBeenCalledExactlyOnceWith(h.get('map-canvas'), expect.any(Function));
    expect(h.get('displayed-name').textContent).toBe('No map displayed');
    expect((h.get('fit') as HTMLButtonElement).disabled).toBe(true);
    const input = h.get('saved-map') as HTMLInputElement;
    const selected = new File(['{}'], 'map.json');
    Object.defineProperty(input, 'files', { value: [selected] });
    for (let selection = 0; selection < 2; selection++) input.dispatchEvent(new Event('change'));
    expect(h.loader.load).toHaveBeenCalledTimes(2);
    expect(h.loader.load).toHaveBeenCalledWith(selected);
    expect(input.value).toBe('');
    await h.publish({
      phase: 'validating',
      message: 'Certifying saved geometry…',
      displayed: null,
      available: true,
    });
    expect(h.get('load-status').textContent?.trim()).toBe('Certifying saved geometry…');
    expect(h.get('load-progress').hidden).toBe(false);
    expect((h.get('cancel') as HTMLButtonElement).disabled).toBe(false);
    h.get('cancel').click();
    expect(h.loader.cancel).toHaveBeenCalledOnce();
  });

  it('binds safe metadata, camera actions and retained identity for invalid replacement and cancel', async () => {
    const h = create();
    await h.fixture.whenStable();
    await h.ready();
    expect(h.get('displayed-name').textContent).toBe('<Village & Hills>');
    expect(h.get('displayed-name').children).toHaveLength(0);
    expect(h.get('displayed-extent').textContent).toContain('15,000 × 5,000 m');
    expect(h.get('displayed-identity').textContent).toBe(displayed.sourceKey);
    expect(h.get('empty-table').hidden).toBe(true);
    h.get('fit').click();
    h.get('top-down').click();
    h.get('oblique').click();
    expect(h.scene.fitPreview).toHaveBeenCalledOnce();
    expect(h.scene.snapTopDown).toHaveBeenCalledOnce();
    expect(h.scene.snapOblique).toHaveBeenCalledOnce();
    for (const phase of ['reading', 'validating', 'cancelled', 'failed'] as const) {
      await h.publish({ phase, message: 'Replacement request', displayed, available: true });
      expect(h.get('displayed-name').textContent).toBe(displayed.name);
      expect(h.get('retained-display').textContent).toContain('remains');
      expect(h.get('retained-display').hidden).toBe(false);
      expect(JSON.parse(h.get('displayed-identity').dataset['inspection']!)).toEqual(
        displayed.inspection,
      );
    }
    await h.publish({ phase: 'failed', message: 'Restore failed', displayed, available: false });
    expect(h.get('retained-display').textContent).toContain('historical');
    expect(h.get('load-status').dataset['error']).toBe('true');
    expect((h.get('fit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('removes absent or unserializable inspection evidence through bindings', async () => {
    const h = create();
    await h.fixture.whenStable();
    await h.ready();
    expect(h.get('displayed-identity').hasAttribute('data-inspection')).toBe(true);
    const broken = {
      ...displayed.inspection,
      toJSON() {
        throw new Error('serialization failed');
      },
    };
    await h.publish({
      phase: 'ready',
      message: 'ready',
      displayed: {
        ...displayed,
        inspection: broken as DisplayInspection,
      },
      available: true,
    });
    expect(h.get('displayed-identity').hasAttribute('data-inspection')).toBe(false);
    expect(h.get('displayed-identity').textContent).toBe(displayed.sourceKey);
    expect((h.get('fit') as HTMLButtonElement).disabled).toBe(false);
    await h.publish({ phase: 'empty', message: 'empty', displayed: null, available: true });
    expect(h.get('identity-details').hidden).toBe(true);
  });

  it('uses the actual default loader and scene and displays a native FileReader failure', async () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const start = vi.spyOn(FixtureTableScene.prototype, 'start');
    const dispose = vi.spyOn(FixtureTableScene.prototype, 'dispose');
    const fixture = TestBed.createComponent(MapTableComponent);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector<HTMLInputElement>('#saved-map')!;
    Object.defineProperty(input, 'files', { value: [new File(['invalid JSON'], 'bad.json')] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(fixture.componentInstance.table.state().phase).toBe('failed'));
    await fixture.whenStable();
    expect(root.querySelector('#load-status')!.getAttribute('data-error')).toBe('true');
    expect(start).toHaveBeenCalledOnce();
    fixture.destroy();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('reports actual partial startup failure and releases its resources once', async () => {
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {
          throw new Error('Observer unavailable');
        }
        disconnect = disconnect;
      },
    );
    const dispose = vi.spyOn(FixtureTableScene.prototype, 'dispose');
    const start = vi.spyOn(FixtureTableScene.prototype, 'start');
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const fixture = TestBed.createComponent(MapTableComponent);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('#load-status')!.textContent).toContain('Observer unavailable');
    expect((root.querySelector('#saved-map') as HTMLInputElement).disabled).toBe(true);
    expect(start).not.toHaveBeenCalled();
    fixture.destroy();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('preserves renderer constructor cleanup when initial scene sizing fails', async () => {
    const sceneDispose = vi.spyOn(FixtureTableScene.prototype, 'dispose');
    vi.spyOn(FixtureTableScene.prototype, 'resize').mockImplementation(() => {
      throw new Error('Initial sizing failed');
    });
    const observe = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: MAP_TABLE_OBSERVER_FACTORY, useValue: () => ({ observe, disconnect() {} }) },
      ],
    });
    const fixture = TestBed.createComponent(MapTableComponent);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('#load-status')!.textContent).toContain('Initial sizing failed');
    expect((root.querySelector('#saved-map') as HTMLInputElement).disabled).toBe(true);
    expect(rendererState.disposes).toBe(1);
    expect(sceneDispose).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
    fixture.destroy();
    expect(rendererState.disposes).toBe(1);
  });

  it('allocates nothing after destruction before the first render', async () => {
    const h = create();
    h.fixture.destroy();
    TestBed.tick();
    await Promise.resolve();
    expect(h.factory).not.toHaveBeenCalled();
    h.table.mount(document.createElement('canvas'));
    expect(h.factory).not.toHaveBeenCalled();
  });

  it('cleans a scene returned after reentrant component destruction without allocating a loader', async () => {
    const h = create();
    h.factory.mockImplementation(() => {
      h.fixture.destroy();
      return h.scene;
    });
    await h.fixture.whenStable();
    expect(h.scene.dispose).toHaveBeenCalledOnce();
    expect(h.loader.dispose).not.toHaveBeenCalled();
    expect(h.observer.observe).not.toHaveBeenCalled();
    expect(h.table.canLoad()).toBe(false);
  });

  it('cleans resources once and blocks late UI, resize and context callbacks', async () => {
    const h = create();
    await h.fixture.whenStable();
    await h.ready();
    const input = h.get('saved-map') as HTMLInputElement,
      canvas = h.get('map-canvas');
    Object.defineProperty(input, 'files', { value: [new File(['{}'], 'late.json')] });
    h.scene.dispose.mockImplementation(() => h.table.dispose());
    h.fixture.destroy();
    h.table.dispose();
    input.dispatchEvent(new Event('change'));
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    window.dispatchEvent(new Event('resize'));
    expect(h.loader.load).not.toHaveBeenCalled();
    expect(h.loader.unavailable).not.toHaveBeenCalled();
    expect(h.scene.resize).not.toHaveBeenCalled();
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    expect(h.observer.disconnect).toHaveBeenCalledOnce();
    expect(h.loader.dispose).toHaveBeenCalledOnce();
    expect(h.scene.dispose).toHaveBeenCalledOnce();
  });

  it('binds context loss to stop and loader unavailability', async () => {
    const h = create();
    await h.fixture.whenStable();
    const event = new Event('webglcontextlost', { cancelable: true });
    h.get('map-canvas').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(h.scene.stop).toHaveBeenCalledOnce();
    expect(h.loader.unavailable).toHaveBeenCalledWith(expect.stringContaining('context was lost'));
  });

  it('preserves actual texture and settled camera across repeated bfcache events', async () => {
    const h = create(true);
    await h.fixture.whenStable();
    const scene = h.actualScene();
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = 300;
    sourceCanvas.height = 100;
    scene.applyPreviewRaster({
      canvas: sourceCanvas,
      sourceKey: displayed.sourceKey,
      widthM: 15000,
      heightM: 5000,
      contentWidthPx: 300,
      contentHeightPx: 100,
    });
    await h.ready();
    scene.snapOblique();
    scene.panTo({ x: 2500, y: 1750 });
    const paper = scene.scene.getObjectByName('map-artwork') as THREE.Mesh<
      THREE.PlaneGeometry,
      THREE.MeshStandardMaterial
    >;
    const texture = paper.material.map!,
      position = scene.camera.position.clone(),
      target = scene.controls.target.clone();
    const dispose = vi.spyOn(texture, 'dispose'),
      fit = vi.spyOn(scene, 'snapTopDown');
    for (let visit = 0; visit < 3; visit++) {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      expect(scene.scene.getObjectByName('map-artwork')).toBe(paper);
      expect(paper.material.map).toBe(texture);
      expect(texture.image).toBe(sourceCanvas);
      expect(scene.camera.position.distanceTo(position)).toBeLessThan(1e-8);
      expect(scene.controls.target).toEqual(target);
      expect(h.get('displayed-identity').textContent).toBe(displayed.sourceKey);
      expect(dispose).not.toHaveBeenCalled();
      expect(fit).not.toHaveBeenCalled();
    }
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    h.fixture.destroy();
    expect(dispose).toHaveBeenCalledOnce();
    expect(scene.scene.children).toHaveLength(0);
  });

  it('creates a fresh scoped service for a recreated route', async () => {
    const h = create();
    await h.fixture.whenStable();
    h.fixture.destroy();
    const next = TestBed.createComponent(MapTableComponent);
    expect(next.componentInstance.table).not.toBe(h.table);
    await next.whenStable();
    expect(h.factory).toHaveBeenCalledTimes(2);
    expect(h.loader.dispose).toHaveBeenCalledOnce();
    expect(next.componentInstance.table.state().displayed).toBeNull();
    next.destroy();
    expect(h.loader.dispose).toHaveBeenCalledTimes(2);
  });
});
