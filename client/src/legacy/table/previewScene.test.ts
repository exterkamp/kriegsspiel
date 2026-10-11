// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gpu = vi.hoisted(() => ({ lost: false, limit: 4096, allocationFailure: false }));
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeRenderer {
    info = { memory: { textures: 3, geometries: 5 } };
    capabilities = {
      get maxTextureSize() {
        return gpu.limit;
      },
      getMaxAnisotropy: () => 2,
    };
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {}
    getContext() {
      return { isContextLost: () => gpu.lost };
    }
  }
  class PlaneGeometry extends actual.PlaneGeometry {
    constructor(width: number, height: number) {
      if (gpu.allocationFailure) throw new Error('plane allocation failed');
      super(width, height);
    }
  }
  return { ...actual, WebGLRenderer: FakeRenderer, PlaneGeometry };
});
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TableScene, PreviewApplyError, type PreviewRaster } from './FixtureTableScene.js';
import { mapToWorld } from './picking.js';
import { buildSceneState } from './sceneState.js';
import { fixtureMap, fixtureView } from './fixture.js';

const tables: TableScene[] = [];
function make(mode: 'fixture' | 'public-map-preview' | 'local-hq-board' = 'public-map-preview') {
  const table = new TableScene(document.createElement('canvas'), { mode });
  tables.push(table);
  return table;
}
function raster(key = 'asset-A', widthM = 15000, heightM = 5000): PreviewRaster {
  const canvas = document.createElement('canvas');
  canvas.width = 4096;
  canvas.height = 1366;
  return Object.freeze({
    canvas,
    sourceKey: key,
    widthM,
    heightM,
    contentWidthPx: 4096,
    contentHeightPx: 4096 / 3,
  });
}
const mesh = (t: TableScene) =>
  t.scene.getObjectByName('map-artwork') as THREE.Mesh<
    THREE.PlaneGeometry,
    THREE.MeshStandardMaterial
  >;
function errorFrom(run: () => void): PreviewApplyError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(PreviewApplyError);
    return error as PreviewApplyError;
  }
  throw new Error('Expected preview failure');
}
beforeEach(() => {
  gpu.lost = false;
  gpu.limit = 4096;
  gpu.allocationFailure = false;
});
afterEach(() => {
  tables.splice(0).forEach((t) => t.dispose());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('fixed preview authority', () => {
  it('starts empty, rejects all fixture state/artwork and retains no pieces or marks', () => {
    const table = make();
    expect(mesh(table)).toBeUndefined();
    const state = buildSceneState(fixtureView, fixtureMap);
    expect(() => table.apply(state)).toThrow('fixture state');
    table.applyPreviewRaster(raster());
    expect(() => table.apply({ ...state, own: [], ghosts: [], marks: [] })).toThrow(
      'fixture state',
    );
    expect(() => table.setArtwork(document.createElement('img'))).toThrow('external artwork');
    expect(table.pieceCount).toBe(0);
    expect(table.scene.getObjectByName('marks-root')!.children).toHaveLength(0);
  });
  it('default fixture rejects the preview seam and preview canvases', () => {
    const table = new TableScene(document.createElement('canvas'));
    tables.push(table);
    expect(() => table.applyPreviewRaster(raster())).toThrow('Fixture tables');
    expect(() => table.previewTextureLimit()).toThrow('Fixture tables');
    expect(() => table.previewObservation()).toThrow('Fixture tables');
    expect(() => table.fitPreview()).toThrow('Fixture tables');
    const state = buildSceneState(fixtureView, fixtureMap);
    expect(() => table.apply(state, raster().canvas as unknown as HTMLImageElement)).toThrow();
  });
});

describe('preview canvas keyboard pan with actual OrbitControls', () => {
  const connected: HTMLElement[] = [];
  afterEach(() => {
    // OrbitControls removes its existing root interceptor while the canvas is connected.
    tables.splice(0).forEach((table) => table.dispose());
    connected.splice(0).forEach((element) => element.remove());
  });
  function canvas() {
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    Object.defineProperties(canvas, {
      clientWidth: { value: 900 },
      clientHeight: { value: 600 },
    });
    document.body.append(canvas);
    connected.push(canvas);
    return canvas;
  }
  function arrow(target: EventTarget, code = 'ArrowRight') {
    const event = new KeyboardEvent('keydown', {
      key: code,
      code,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
  }
  function preview() {
    const surface = canvas();
    const add = vi.spyOn(surface, 'addEventListener');
    const remove = vi.spyOn(surface, 'removeEventListener');
    const listen = vi.spyOn(OrbitControls.prototype, 'listenToKeyEvents');
    const table = new TableScene(surface, { mode: 'public-map-preview' });
    tables.push(table);
    table.applyPreviewRaster(raster());
    expect(table.controls).toBeInstanceOf(OrbitControls);
    expect(listen).toHaveBeenCalledExactlyOnceWith(surface);
    const registrations = add.mock.calls.filter(([type]) => type === 'keydown');
    expect(registrations).toHaveLength(1);
    return { table, surface, remove, listener: registrations[0]![1] };
  }
  it.each(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])(
    'plain %s translates camera and target equally, preserving relative vector and orientation',
    (code) => {
      const { table, surface } = preview();
      surface.focus();
      expect(document.activeElement).toBe(surface);
      for (const pose of ['top-down', 'oblique']) {
        if (pose === 'top-down') table.snapTopDown();
        else table.snapOblique();
        table.controls.update();
        const position = table.camera.position.clone();
        const target = table.controls.target.clone();
        const relative = position.clone().sub(target);
        const orientation = table.camera.quaternion.clone();
        const event = arrow(document.activeElement!, code);
        const translation = table.camera.position.clone().sub(position);
        expect(translation.length()).toBeGreaterThan(1);
        // Allow submicrometre spherical-coordinate roundoff at kilometre-scale poses.
        expect(translation.distanceTo(table.controls.target.clone().sub(target))).toBeLessThan(
          1e-6,
        );
        expect(
          table.camera.position.clone().sub(table.controls.target).distanceTo(relative),
        ).toBeLessThan(1e-6);
        expect(table.camera.quaternion.angleTo(orientation)).toBeLessThan(1e-7);
        expect(event.defaultPrevented).toBe(true);
      }
    },
  );
  it('does not pan when arrows target another focused button or the document', () => {
    const { table, surface } = preview();
    const button = document.createElement('button');
    document.body.append(button);
    connected.push(button);
    surface.focus();
    arrow(document.activeElement!);
    const position = table.camera.position.clone();
    const target = table.controls.target.clone();
    button.focus();
    expect(document.activeElement).toBe(button);
    for (const destination of [button, document]) {
      expect(arrow(destination).defaultPrevented).toBe(false);
      expect(table.camera.position).toEqual(position);
      expect(table.controls.target).toEqual(target);
    }
  });
  it('leaves fixture arrow behavior unchanged without registering canvas key panning', () => {
    const surface = canvas();
    const add = vi.spyOn(surface, 'addEventListener');
    const listen = vi.spyOn(OrbitControls.prototype, 'listenToKeyEvents');
    const table = new TableScene(surface);
    tables.push(table);
    table.camera.position.set(0, 10000, 10000);
    table.controls.update();
    surface.focus();
    expect(document.activeElement).toBe(surface);
    const position = table.camera.position.clone();
    const target = table.controls.target.clone();
    for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      expect(arrow(document.activeElement!, code).defaultPrevented).toBe(false);
      expect(table.camera.position).toEqual(position);
      expect(table.controls.target).toEqual(target);
    }
    expect(listen).not.toHaveBeenCalled();
    expect(add.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(0);
  });
  it('terminal disposal removes the exact registered key listener and prevents further movement', () => {
    const { table, surface, remove, listener } = preview();
    surface.focus();
    arrow(document.activeElement!);
    const position = table.camera.position.clone();
    const target = table.controls.target.clone();
    table.dispose();
    table.dispose();
    expect(remove.mock.calls.filter(([type]) => type === 'keydown')).toEqual([
      ['keydown', listener],
    ]);
    expect(arrow(document.activeElement!).defaultPrevented).toBe(false);
    expect(table.camera.position).toEqual(position);
    expect(table.controls.target).toEqual(target);
  });
  it('constructor failure after key registration removes that exact listener and prevents further movement', () => {
    const surface = canvas();
    const add = vi.spyOn(surface, 'addEventListener');
    const remove = vi.spyOn(surface, 'removeEventListener');
    const disposed = vi.spyOn(OrbitControls.prototype, 'dispose');
    vi.spyOn(TableScene.prototype, 'resize').mockImplementationOnce(() => {
      throw new Error('initial resize failed');
    });
    expect(() => new TableScene(surface, { mode: 'public-map-preview' })).toThrow(
      'initial resize failed',
    );
    const registrations = add.mock.calls.filter(([type]) => type === 'keydown');
    expect(registrations).toHaveLength(1);
    expect(remove.mock.calls.filter(([type]) => type === 'keydown')).toEqual([
      ['keydown', registrations[0]![1]],
    ]);
    expect(disposed).toHaveBeenCalledOnce();
    const controls = disposed.mock.contexts[0]! as OrbitControls;
    expect(controls).toBeInstanceOf(OrbitControls);
    // A nonzero pose would move if the disposed controls still had a live key listener.
    controls.object.position.set(0, 10000, 10000);
    controls.target.set(0, 0, 0);
    controls.update();
    const position = controls.object.position.clone();
    const target = controls.target.clone();
    surface.focus();
    expect(document.activeElement).toBe(surface);
    expect(arrow(document.activeElement!).defaultPrevented).toBe(false);
    expect(controls.object.position).toEqual(position);
    expect(controls.target).toEqual(target);
  });
});

describe('preview observation snapshots', () => {
  it('reads raw capability and copied renderer counts only after retirement, without rendering', () => {
    const table = make();
    expect(table.previewObservation()).toBeNull();
    gpu.limit = 8192;
    table.applyPreviewRaster(raster());
    const old = mesh(table);
    const during: unknown[] = [];
    old.material.map!.addEventListener('dispose', () => during.push(table.previewObservation()));
    vi.spyOn(table.renderer, 'render').mockImplementationOnce(() => {
      during.push(table.previewObservation());
    });
    table.applyPreviewRaster(raster('renamed-B'));
    expect(during).toEqual([null, null]);
    const render = vi.spyOn(table.renderer, 'render');
    render.mockClear();
    const context = vi.spyOn(table.renderer, 'getContext');
    const snapshot = table.previewObservation()!;
    expect(snapshot).toEqual({
      sourceKey: 'renamed-B',
      deviceMaxTextureSizePx: 8192,
      resources: { textures: 3, geometries: 5 },
    });
    expect(table.previewTextureLimit()).toBe(4096);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.resources)).toBe(true);
    table.renderer.info.memory.textures = 99;
    expect(snapshot.resources!.textures).toBe(3);
    expect(table.previewObservation()!.resources!.textures).toBe(99);
    expect(render).not.toHaveBeenCalled();
    expect(context).toHaveBeenCalledTimes(4);
    table.dispose();
    expect(table.previewObservation()).toBeNull();
  });
  it('returns null for an already-lost context or a throwing context getter without mutating display authority', () => {
    const table = make();
    table.applyPreviewRaster(raster());
    const paper = mesh(table);
    const render = vi.spyOn(table.renderer, 'render');
    const dispose = vi.spyOn(paper.material.map!, 'dispose');
    gpu.lost = true;
    expect(table.previewObservation()).toBeNull();
    gpu.lost = false;
    const context = vi.spyOn(table.renderer, 'getContext').mockImplementationOnce(() => {
      throw new Error('context getter failed');
    });
    expect(table.previewObservation()).toBeNull();
    const existing = table.renderer.getContext();
    context.mockReturnValueOnce({
      ...existing,
      isContextLost() {
        throw new Error('context status failed');
      },
    });
    expect(table.previewObservation()).toBeNull();
    expect(table.previewObservation()!.sourceKey).toBe('asset-A');
    expect(mesh(table)).toBe(paper);
    expect(render).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
  });
  it.each(['context', 'capability', 'memory'] as const)(
    'returns null after terminal disposal during the %s getter',
    (getter) => {
      const table = make();
      table.applyPreviewRaster(raster());
      const dispose = vi.spyOn(mesh(table).material.map!, 'dispose');
      const render = vi.spyOn(table.renderer, 'render');
      if (getter === 'context') {
        const existing = table.renderer.getContext();
        vi.spyOn(table.renderer, 'getContext').mockImplementationOnce(() => {
          table.dispose();
          return existing;
        });
      } else if (getter === 'capability')
        vi.spyOn(table.renderer.capabilities, 'maxTextureSize', 'get').mockImplementationOnce(
          () => {
            table.dispose();
            return 8192;
          },
        );
      else
        Object.defineProperty(table.renderer.info.memory, 'textures', {
          get() {
            table.dispose();
            return 3;
          },
        });
      expect(table.previewObservation()).toBeNull();
      expect(table.scene.children).toHaveLength(0);
      expect(dispose).toHaveBeenCalledOnce();
      expect(render).not.toHaveBeenCalled();
      expect(table.previewObservation()).toBeNull();
    },
  );
  it.each(['asset-B', 'asset-A'])(
    'rejects counters from a synchronous replacement with %s during a getter',
    (key) => {
      const table = make();
      table.applyPreviewRaster(raster());
      const old = mesh(table);
      const memory = table.renderer.info.memory;
      let replace = true;
      Object.defineProperty(memory, 'textures', {
        get() {
          if (replace) {
            replace = false;
            table.applyPreviewRaster(raster(key));
          }
          return 3;
        },
      });
      expect(table.previewObservation()).toBeNull();
      expect(mesh(table)).not.toBe(old);
      expect(table.previewObservation()!.sourceKey).toBe(key);
    },
  );
  it('retains the accepted source after recoverable replacement and returns null after known unavailable display', () => {
    const table = make();
    table.applyPreviewRaster(raster());
    const render = vi.spyOn(table.renderer, 'render').mockImplementationOnce(() => {
      throw new Error('candidate');
    });
    expect(errorFrom(() => table.applyPreviewRaster(raster('B'))).display).toBe('retained');
    expect(table.previewObservation()!.sourceKey).toBe('asset-A');
    render.mockImplementation(() => {
      throw new Error('unavailable');
    });
    expect(errorFrom(() => table.applyPreviewRaster(raster('C'))).display).toBe('unavailable');
    expect(table.previewObservation()).toBeNull();
  });
  it('keeps missing, invalid and throwing capability/counters nullable without changing accepted resources', () => {
    const table = make();
    table.applyPreviewRaster(raster());
    const paper = mesh(table);
    gpu.limit = NaN;
    table.renderer.info.memory.textures = -1;
    expect(table.previewObservation()).toEqual({
      sourceKey: 'asset-A',
      deviceMaxTextureSizePx: null,
      resources: null,
    });
    Object.defineProperty(table.renderer, 'capabilities', {
      get() {
        throw new Error('capability');
      },
    });
    Object.defineProperty(table.renderer, 'info', {
      get() {
        throw new Error('counter');
      },
    });
    expect(table.previewObservation()).toEqual({
      sourceKey: 'asset-A',
      deviceMaxTextureSizePx: null,
      resources: null,
    });
    expect(mesh(table)).toBe(paper);
  });
});

describe('metre registration and camera', () => {
  it('registers each independently labelled asymmetric corner with CanvasTexture flipY and north at -Z', () => {
    const table = make();
    const r = raster();
    table.applyPreviewRaster(r);
    const paper = mesh(table);
    const position = paper.geometry.getAttribute('position');
    const uv = paper.geometry.getAttribute('uv');
    paper.updateMatrixWorld(true);
    // PlaneGeometry local +Y is north after rotating -pi/2. Values are explicit test oracles.
    const expected = [
      [-7500, -2500, 0, 1],
      [7500, -2500, 1, 1],
      [-7500, 2500, 0, 1 - 4096 / 3 / 1366],
      [7500, 2500, 1, 1 - 4096 / 3 / 1366],
    ];
    for (let i = 0; i < 4; i++) {
      const world = new THREE.Vector3()
        .fromBufferAttribute(position, i)
        .applyMatrix4(paper.matrixWorld);
      expect(world.x).toBeCloseTo(expected[i]![0]!);
      expect(world.z).toBeCloseTo(expected[i]![1]!);
      expect(world.y).toBeCloseTo(0);
      expect(uv.getX(i)).toBeCloseTo(expected[i]![2]!);
      expect(uv.getY(i)).toBeCloseTo(expected[i]![3]!, 6);
      // Top-origin canvas sampling after flipY maps each vertex to the expected geographic corner.
      expect(uv.getX(i) * r.canvas.width).toBeCloseTo(i % 2 ? 4096 : 0);
      expect((1 - uv.getY(i)) * r.canvas.height).toBeCloseTo(i < 2 ? 0 : 4096 / 3, 3);
    }
    expect(paper.material.map!.flipY).toBe(true);
    expect(paper.material.map!.anisotropy).toBe(2);
    expect(paper.material.map!.image).toBe(r.canvas);
  });
  it.each([
    [5000, 5000],
    [5000, 10000],
    [15000, 5000],
  ])('preserves %s × %s extents and projected point orientation in both poses', (w, h) => {
    const table = make();
    const r = raster('extent', w, h);
    const scale = 4096 / Math.max(w, h);
    r.canvas.width = Math.ceil(w * scale);
    r.canvas.height = Math.ceil(h * scale);
    table.applyPreviewRaster({ ...r, contentWidthPx: w * scale, contentHeightPx: h * scale });
    for (const oblique of [false, true]) {
      table.resize(900, 1200, 2);
      if (oblique) {
        table.snapOblique();
        table.camera.position.multiplyScalar(2);
        table.controls.update();
      } else table.snapTopDown();
      table.camera.updateMatrixWorld(true);
      for (const point of [
        { x: 0, y: 0 },
        { x: w, y: h },
        { x: w * 0.13, y: h * 0.72 },
      ]) {
        const projected = mapToWorld({ width: w, height: h, features: [] }, point).project(
          table.camera,
        );
        const hit = table.pickNdc(new THREE.Vector2(projected.x, projected.y));
        expect(hit.type).toBe('point');
        if (hit.type === 'point') {
          expect(hit.coord.x).toBeCloseTo(point.x, 7);
          expect(hit.coord.y).toBeCloseTo(point.y, 7);
        }
      }
      const off = mapToWorld({ width: w, height: h, features: [] }, { x: -1e-6, y: h / 2 }).project(
        table.camera,
      );
      expect(table.pickNdc(new THREE.Vector2(off.x, off.y))).toEqual({ type: 'none' });
    }
  });
  it('fits each different full source once, while equal reapply and CSS/DPR resize preserve pose', () => {
    const table = make();
    const fit = vi.spyOn(table, 'snapTopDown');
    table.applyPreviewRaster(raster());
    expect(fit).toHaveBeenCalledTimes(1);
    table.snapOblique();
    table.panTo({ x: 1000, y: 2000 });
    const position = table.camera.position.clone(),
      target = table.controls.target.clone();
    table.applyPreviewRaster(raster());
    table.resize(300, 900, 3);
    expect(fit).toHaveBeenCalledTimes(1);
    expect(table.camera.position).toEqual(position);
    expect(table.controls.target).toEqual(target);
    table.applyPreviewRaster(raster('rename-full-asset-B'));
    expect(fit).toHaveBeenCalledTimes(2);
    expect(table.controls.target).toEqual(new THREE.Vector3());
    table.fitPreview();
    expect(fit).toHaveBeenCalledTimes(3);
  });
});

describe('bounded rendered replacement', () => {
  it('keeps the old texture alive through candidate rendering; publishes and cleans once afterwards', () => {
    const table = make();
    table.applyPreviewRaster(raster());
    const old = mesh(table);
    const dispose = vi.spyOn(old.material.map!, 'dispose');
    vi.spyOn(table.renderer, 'render').mockImplementation((scene) => {
      expect(dispose).not.toHaveBeenCalled();
      expect(scene.getObjectByName('map-artwork')).not.toBe(old);
    });
    table.applyPreviewRaster(raster('B'));
    expect(dispose).toHaveBeenCalledTimes(1);
    table.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
  it('restores the old scene, exact camera and a rendered frame after candidate render failure', () => {
    const table = make();
    table.applyPreviewRaster(raster());
    table.snapOblique();
    const old = mesh(table),
      camera = table.camera.position.clone(),
      target = table.controls.target.clone();
    const oldDispose = vi.spyOn(old.material.map!, 'dispose');
    const allDisposals = vi.spyOn(THREE.Texture.prototype, 'dispose');
    const render = vi.spyOn(table.renderer, 'render').mockImplementationOnce(() => {
      throw new Error('upload failed');
    });
    const error = errorFrom(() => table.applyPreviewRaster(raster('B', 30000, 10000)));
    expect(error.display).toBe('retained');
    expect(render).toHaveBeenCalledTimes(2);
    expect(mesh(table)).toBe(old);
    expect(table.camera.position).toEqual(camera);
    expect(table.controls.target).toEqual(target);
    expect(oldDispose).not.toHaveBeenCalled();
    expect(allDisposals).toHaveBeenCalledTimes(1);
    render.mockRestore();
    table.applyPreviewRaster(raster('B'));
    expect(mesh(table)).not.toBe(old);
    expect(oldDispose).toHaveBeenCalledTimes(1);
  });
  it.each(['restoration', 'context'] as const)(
    'reports unavailable on %s failure instead of claiming retention',
    (failure) => {
      const table = make();
      table.applyPreviewRaster(raster());
      vi.spyOn(table.renderer, 'render').mockImplementation(() => {
        if (failure === 'context') gpu.lost = true;
        throw new Error('render failed');
      });
      expect(errorFrom(() => table.applyPreviewRaster(raster('B'))).display).toBe('unavailable');
    },
  );
  it('reports unavailable on a failed first frame and releases candidate resources', () => {
    const table = make();
    const dispose = vi.spyOn(THREE.Texture.prototype, 'dispose');
    vi.spyOn(table.renderer, 'render').mockImplementationOnce(() => {
      throw new Error('first frame');
    });
    expect(errorFrom(() => table.applyPreviewRaster(raster())).display).toBe('unavailable');
    expect(mesh(table)).toBeUndefined();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
  it('bounds device size, pixel area and uniform fractional content, before allocating a texture', () => {
    const table = make();
    table.applyPreviewRaster(raster());
    const old = mesh(table);
    gpu.limit = 2048;
    expect(table.previewTextureLimit()).toBe(2048);
    const dispose = vi.spyOn(THREE.Texture.prototype, 'dispose');
    for (const r of [
      raster(),
      { ...raster(), widthM: NaN },
      { ...raster(), contentHeightPx: 100 },
      { ...raster(), contentWidthPx: 5000 },
      { ...raster(), sourceKey: '' },
    ]) {
      expect(errorFrom(() => table.applyPreviewRaster(r)).display).toBe('retained');
      expect(mesh(table)).toBe(old);
    }
    expect(dispose).not.toHaveBeenCalled();
    const r = raster();
    r.canvas.width = 2048;
    r.canvas.height = 683;
    table.applyPreviewRaster({
      ...r,
      sourceKey: 'small-device',
      contentWidthPx: 2048,
      contentHeightPx: 2048 / 3,
    });
    gpu.limit = 8192;
    expect(table.previewTextureLimit()).toBe(4096);
  });
  it('releases texture allocation when subsequent geometry allocation fails', () => {
    const table = make();
    table.applyPreviewRaster(raster());
    const old = mesh(table);
    const dispose = vi.spyOn(THREE.Texture.prototype, 'dispose');
    gpu.allocationFailure = true;
    expect(errorFrom(() => table.applyPreviewRaster(raster('B'))).display).toBe('retained');
    expect(mesh(table)).toBe(old);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
  it('rejects nested apply during rendering and old-resource cleanup without changing committed identity or camera', () => {
    const table = make();
    table.applyPreviewRaster(raster());
    const old = mesh(table);
    const nested: PreviewApplyError[] = [];
    old.material.map!.addEventListener('dispose', () =>
      nested.push(errorFrom(() => table.applyPreviewRaster(raster('nested')))),
    );
    const render = vi.spyOn(table.renderer, 'render').mockImplementationOnce(() => {
      nested.push(errorFrom(() => table.applyPreviewRaster(raster('nested-render'))));
    });
    const fit = vi.spyOn(table, 'snapTopDown');
    table.applyPreviewRaster(raster('B'));
    expect(nested).toHaveLength(2);
    expect(nested.every((e) => e.message.includes('Nested'))).toBe(true);
    const accepted = mesh(table);
    const camera = table.camera.position.clone();
    render.mockRestore();
    table.applyPreviewRaster(raster('B'));
    expect(fit).toHaveBeenCalledTimes(1);
    expect(table.camera.position).toEqual(camera);
    expect(mesh(table).material.map!.image).not.toBe(accepted.material.map!.image);
    expect(table.pieceCount).toBe(0);
  });
  it.each(['render', 'cleanup'] as const)(
    'allows terminal disposal during %s, aborting acknowledgment with exactly-once cleanup',
    (point) => {
      const table = make();
      table.applyPreviewRaster(raster());
      const old = mesh(table);
      const dispose = vi.fn();
      old.material.map!.addEventListener('dispose', dispose);
      const allDisposals = vi.spyOn(THREE.Texture.prototype, 'dispose');
      if (point === 'render')
        vi.spyOn(table.renderer, 'render').mockImplementationOnce(() => table.dispose());
      else old.material.map!.addEventListener('dispose', () => table.dispose());
      expect(errorFrom(() => table.applyPreviewRaster(raster('B'))).display).toBe('unavailable');
      expect(table.scene.children).toHaveLength(0);
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(allDisposals).toHaveBeenCalledTimes(2);
      table.start();
      table.dispose();
      expect(table.scene.children).toHaveLength(0);
      expect(errorFrom(() => table.applyPreviewRaster(raster('late'))).display).toBe('unavailable');
      expect(allDisposals).toHaveBeenCalledTimes(2);
    },
  );
});

describe('promotion events and terminal candidate cleanup', () => {
  it.each(['added', 'childadded'] as const)(
    'remains empty when the actual Three %s promotion callback disposes the scene',
    (eventType) => {
      const table = make();
      table.applyPreviewRaster(raster());
      const oldPaper = mesh(table);
      const oldBoard = table.scene.getObjectByName('table-board') as THREE.Mesh;
      const owned = (objects: THREE.Object3D[]) => {
        const resources = new Set<{ dispose(): void }>();
        for (const object of objects)
          object.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (mesh.geometry) resources.add(mesh.geometry);
            const material = mesh.material as THREE.MeshStandardMaterial | undefined;
            if (material) {
              resources.add(material);
              if (material.map) resources.add(material.map);
            }
          });
        return [...resources];
      };
      const oldDisposals = owned([oldPaper, oldBoard]).map((resource) =>
        vi.spyOn(resource, 'dispose'),
      );
      let candidate!: THREE.Object3D;
      let paper!: THREE.Object3D;
      let board!: THREE.Object3D;
      let candidateDisposals: ReturnType<typeof vi.spyOn>[] = [];
      const callback = vi.fn(() => table.dispose());
      const next = raster('promoted-failure');
      vi.spyOn(table.renderer, 'render').mockImplementationOnce((scene) => {
        paper = scene.getObjectByName('map-artwork')!;
        board = scene.getObjectByName('table-board')!;
        candidate = paper.parent!;
        candidateDisposals = owned([candidate]).map((resource) => vi.spyOn(resource, 'dispose'));
        if (eventType === 'added') paper.addEventListener('added', callback);
        else
          scene.addEventListener('childadded', (event) => {
            if (event.child === paper) callback();
          });
      });
      const add = vi.spyOn(table.scene, 'add');
      expect(errorFrom(() => table.applyPreviewRaster(next)).display).toBe('unavailable');
      expect(callback).toHaveBeenCalledOnce();
      expect(add.mock.calls.some((objects) => objects.includes(board))).toBe(false);
      expect(table.scene.children).toHaveLength(0);
      expect(candidate.parent).toBeNull();
      expect(candidate.children).toHaveLength(0);
      expect(paper.parent).toBeNull();
      expect(board.parent).toBeNull();
      expect(Object.values(table)).not.toContain(paper);
      expect(Object.values(table)).not.toContain(board);
      expect(Object.values(table)).not.toContain(next.canvas);
      for (const disposed of [...oldDisposals, ...candidateDisposals])
        expect(disposed).toHaveBeenCalledOnce();
      table.dispose();
      table.start();
      expect(errorFrom(() => table.applyPreviewRaster(next)).display).toBe('unavailable');
      expect(table.scene.children).toHaveLength(0);
      for (const disposed of [...oldDisposals, ...candidateDisposals])
        expect(disposed).toHaveBeenCalledOnce();
    },
  );
});

describe('preview-only frame failure reporting', () => {
  function frames() {
    const queued: FrameRequestCallback[] = [];
    const schedule = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        queued.push(callback);
        return queued.length;
      });
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
    return { queued, schedule, cancel };
  }
  it.each(['controls', 'render'] as const)(
    'reports later %s failure, stops scheduling and refuses false rendered acceptance',
    (stage) => {
      const { queued, schedule, cancel } = frames();
      const report = vi.fn();
      const table = new TableScene(document.createElement('canvas'), {
        mode: 'public-map-preview',
        onPreviewUnavailable: report,
      });
      tables.push(table);
      table.applyPreviewRaster(raster());
      table.start();
      const failed =
        stage === 'controls'
          ? vi.spyOn(table.controls, 'update')
          : vi.spyOn(table.renderer, 'render');
      failed.mockImplementationOnce(() => {
        throw new Error(`later ${stage} failed`);
      });
      expect(() => queued[0]!(1)).not.toThrow();
      expect(report).toHaveBeenCalledOnce();
      expect(report.mock.calls[0]![0]).toMatchObject({
        display: 'unavailable',
        message: `later ${stage} failed`,
      });
      expect(table.previewObservation()).toBeNull();
      expect(schedule).toHaveBeenCalledOnce();
      expect(cancel).toHaveBeenCalledWith(1);
      table.start();
      queued[0]!(2);
      expect(schedule).toHaveBeenCalledOnce();
      expect(report).toHaveBeenCalledOnce();
      expect(errorFrom(() => table.applyPreviewRaster(raster('another'))).display).toBe(
        'unavailable',
      );
      table.dispose();
      table.start();
      queued[0]!(3);
      expect(schedule).toHaveBeenCalledOnce();
      expect(report).toHaveBeenCalledOnce();
    },
  );
  it('cannot restart from a failure callback that disposes the scene', () => {
    const { queued, schedule } = frames();
    const report = vi.fn(() => {
      table.dispose();
      table.start();
    });
    const table = new TableScene(document.createElement('canvas'), {
      mode: 'public-map-preview',
      onPreviewUnavailable: report,
    });
    tables.push(table);
    table.start();
    vi.spyOn(table.renderer, 'render').mockImplementationOnce(() => {
      throw new Error('later render failure');
    });
    queued[0]!(1);
    queued[0]!(2);
    table.start();
    expect(report).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledOnce();
    expect(table.scene.children).toHaveLength(0);
  });
  it('suppresses reports for a controls exception after its callback terminally disposed the scene', () => {
    const { queued, schedule } = frames();
    const report = vi.fn();
    const table = new TableScene(document.createElement('canvas'), {
      mode: 'public-map-preview',
      onPreviewUnavailable: report,
    });
    tables.push(table);
    table.start();
    vi.spyOn(table.controls, 'update').mockImplementationOnce(() => {
      table.dispose();
      throw new Error('disposed frame');
    });
    queued[0]!(1);
    queued[0]!(2);
    table.start();
    expect(report).not.toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledOnce();
    expect(table.scene.children).toHaveLength(0);
  });
  it('preserves fixture frame exceptions and never invokes the preview callback for a fixture', () => {
    const { queued, schedule } = frames();
    const report = vi.fn();
    const table = new TableScene(document.createElement('canvas'), {
      onPreviewUnavailable: report,
    });
    tables.push(table);
    table.start();
    vi.spyOn(table.renderer, 'render').mockImplementationOnce(() => {
      throw new Error('fixture render failure');
    });
    expect(() => queued[0]!(1)).toThrow('fixture render failure');
    expect(report).not.toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledOnce();
  });
});

describe('local HQ board scene isolation', () => {
  it('accepts fixed raster and personal marks only on the immutable local scene mode', () => {
    const local = make('local-hq-board');
    const saved = { ...raster() };
    const state = buildSceneState(fixtureView, fixtureMap);
    expect(() => local.apply(state)).toThrow('fixture state');
    expect(() => local.applyPreviewRaster(saved)).toThrow('preview rasters');
    expect(() => local.setArtwork(document.createElement('img'))).toThrow('external artwork');
    for (const other of [make('fixture'), make()]) {
      expect(() => other.applyLocalBoard(saved, [])).toThrow('Only local HQ');
      expect(() => other.localBoardTextureLimit()).toThrow('Only local HQ');
      expect(() => other.renderLocalBoardFrame()).toThrow('Only local HQ');
    }
    local.applyLocalBoard(saved, [
      { id: 'se', label: '', geometry: { kind: 'pin', at: { x: 14900, y: 4900 } } },
    ]);
    expect(local.pieceCount).toBe(0);
    expect(local.scene.getObjectByName('marks-root')!.children).toHaveLength(1);
    expect(() =>
      local.applyLocalBoard(saved, [
        {
          id: 'truth',
          label: '',
          geometry: { kind: 'pin', at: { x: 1, y: 1 } },
          privateTruth: {},
        } as never,
      ]),
    ).toThrow();
    expect(() => local.applyLocalBoard(raster('different'), [])).toThrow('cannot be replaced');
    (saved as { widthM: number }).widthM = 100;
    expect(() => local.applyLocalBoard(saved, [])).toThrow('cannot be replaced');
    expect(mesh(local).geometry.parameters.width).toBe(15000);
    expect(local.scene.getObjectByName('marks-root')!.children).toHaveLength(1);
  });
  it('reuses paper resources across mark updates and retains old marks after a failed rendered update', () => {
    const local = make('local-hq-board');
    const saved = raster();
    const mark = {
      id: 'private',
      label: '',
      geometry: { kind: 'pin' as const, at: { x: 14500.25, y: 125.75 } },
    };
    local.applyLocalBoard(saved, [mark]);
    const paper = mesh(local),
      texture = paper.material.map;
    const root = local.scene.getObjectByName('marks-root')!;
    const previous = root.children[0]!;
    const render = vi.spyOn(local.renderer, 'render').mockImplementationOnce(() => {
      throw new Error('local frame failed');
    });
    expect(() => local.applyLocalBoard(saved, [])).toThrow('local frame failed');
    expect(root.children).toEqual([previous]);
    expect(mesh(local)).toBe(paper);
    expect(paper.material.map).toBe(texture);
    local.applyLocalBoard(saved, []);
    expect(root.children).toHaveLength(0);
    expect(render).toHaveBeenCalled();
    const dispose = vi.spyOn(texture!, 'dispose');
    local.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(() => local.applyLocalBoard(saved, [])).toThrow('disposed');
  });
  it('acknowledges framed renders and rejects nested apply/disposal during its actual frame', () => {
    const local = make('local-hq-board'),
      saved = raster();
    local.applyLocalBoard(saved, []);
    const render = vi.spyOn(local.renderer, 'render').mockImplementationOnce(() => {
      expect(() => local.applyLocalBoard(saved, [])).toThrow('Nested');
    });
    local.applyLocalBoard(saved, []);
    local.snapTopDown();
    local.renderLocalBoardFrame();
    expect(render).toHaveBeenCalled();
    render.mockImplementationOnce(() => local.dispose());
    expect(() => local.applyLocalBoard(saved, [])).toThrow('unavailable');
    expect(local.scene.children).toHaveLength(0);
  });
  it.each(['render', 'retirement'] as const)(
    'releases every detached predecessor exactly once when disposal re-enters during %s',
    (phase) => {
      const local = make('local-hq-board');
      const saved = raster();
      local.applyLocalBoard(saved, [
        { id: 'first', label: '', geometry: { kind: 'pin', at: { x: 100, y: 100 } } },
        { id: 'second', label: '', geometry: { kind: 'pin', at: { x: 200, y: 200 } } },
      ]);
      const root = local.scene.getObjectByName('marks-root')!;
      const resources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();
      for (const group of root.children) {
        group.traverse((object) => {
          const child = object as THREE.Mesh;
          if (child.geometry) resources.add(child.geometry);
          for (const material of Array.isArray(child.material)
            ? child.material
            : child.material
              ? [child.material]
              : []) {
            resources.add(material);
            const texture = (material as THREE.MeshStandardMaterial).map;
            if (texture) resources.add(texture);
          }
        });
      }
      expect(resources.size).toBeGreaterThan(2);
      const disposals = [...resources].map((resource) => vi.spyOn(resource, 'dispose'));
      if (phase === 'render') {
        vi.spyOn(local.renderer, 'render').mockImplementationOnce(() => local.dispose());
      } else {
        const first = root.children[0]!.children[0] as THREE.Mesh;
        const material = first.material as THREE.Material;
        material.addEventListener('dispose', () => local.dispose());
      }
      expect(() => local.applyLocalBoard(saved, [])).toThrow();
      local.dispose();
      for (const dispose of disposals) expect(dispose).toHaveBeenCalledExactlyOnceWith();
      expect(local.scene.children).toHaveLength(0);
    },
  );
});
