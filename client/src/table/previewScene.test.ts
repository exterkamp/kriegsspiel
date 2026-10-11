// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gpu = vi.hoisted(() => ({ lost: false, limit: 4096, allocationFailure: false }));
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeRenderer {
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
import { TableScene, PreviewApplyError, type PreviewRaster } from './FixtureTableScene.js';
import { mapToWorld } from './picking.js';
import { buildSceneState } from './sceneState.js';
import { fixtureMap, fixtureView } from './fixture.js';

const tables: TableScene[] = [];
function make(mode: 'fixture' | 'public-map-preview' = 'public-map-preview') {
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
    expect(() => table.fitPreview()).toThrow('Fixture tables');
    const state = buildSceneState(fixtureView, fixtureMap);
    expect(() => table.apply(state, raster().canvas as unknown as HTMLImageElement)).toThrow();
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
