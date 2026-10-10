// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeRenderer {
    constructor(readonly params: unknown) {}
    setPixelRatio(): void {}
    setSize(): void {}
    render(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

import * as THREE from 'three';
import { fixtureMap, fixtureView } from './fixture.js';
import { facingToRotationY, fitDistance } from './framing.js';
import { MAX_TEXTURE_PX, mapCanvas, paintOrder, pxPerMetre } from './mapTexture.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSceneState } from './sceneState.js';
import { TableScene } from './TableScene.js';
import { FEATURE_KINDS } from './types.js';
import { mapToWorld } from './picking.js';
import { performanceSceneState } from './performanceFixture.js';

const state = buildSceneState(fixtureView, fixtureMap);
const tables: TableScene[] = [];
const make = (): TableScene => {
  const table = new TableScene(document.createElement('canvas'));
  tables.push(table);
  return table;
};
beforeEach(() => {
  const context = {
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    closePath: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
});
afterEach(() => {
  tables.splice(0).forEach((table) => table.dispose());
  vi.restoreAllMocks();
});

const count = (t: TableScene): number => t.pieceCount;
const piecesOf = (t: TableScene): THREE.Object3D =>
  t.scene.children.find((c) => c.children.some((k) => k.userData.id !== undefined))!;
const resources = (t: TableScene): string =>
  JSON.stringify([
    t.scene.children.length,
    t.scene.children[t.scene.children.length - 1]?.children.length,
  ]);

describe('TableScene.apply', () => {
  it('is idempotent for equal states', () => {
    const t = make();
    t.apply(state);
    const before = [count(t), resources(t)];
    for (let i = 0; i < 20; i++) t.apply(state);
    expect([count(t), resources(t)]).toEqual(before);
    expect(count(t)).toBe(state.own.length + state.ghosts.length);
  });

  it('moves, removes and re-adds pieces', () => {
    const t = make();
    t.apply(state);
    const first = state.own[0]!;
    t.apply({
      ...state,
      own: [{ ...first, position: { x: first.position.x + 3, y: first.position.y } }],
      ghosts: [],
    });
    expect(count(t)).toBe(1);
    t.apply(state);
    expect(count(t)).toBe(state.own.length + state.ghosts.length);
  });

  it('rebuilds the map when the features change', () => {
    const t = make();
    t.apply(state);
    const mesh = t.scene.children.find((c) => (c as { isMesh?: boolean }).isMesh);
    t.apply({ ...state, map: { ...state.map, features: state.map.features.slice(1) } });
    expect(t.scene.children.find((c) => (c as { isMesh?: boolean }).isMesh)).not.toBe(mesh);
  });

  it('start is guarded and dispose stops the loop', () => {
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(7);
    const t = make();
    t.start();
    t.start();
    expect(raf).toHaveBeenCalledTimes(1);
    t.dispose();
    t.start();
    expect(raf).toHaveBeenCalledTimes(1);
    expect(t.pieceCount).toBe(0);
    t.apply(state);
    expect(t.pieceCount).toBe(0);
    t.dispose();
    raf.mockRestore();
  });

  it('reconciles 60 fixture pieces without multiplying bodies or paper resources', () => {
    const t = make();
    t.apply(performanceSceneState);
    const initial = new Set<THREE.Object3D>();
    t.scene.traverse((object) => initial.add(object));
    for (let index = 0; index < 10; index++) t.apply(performanceSceneState);
    const after = new Set<THREE.Object3D>();
    t.scene.traverse((object) => after.add(object));
    expect(t.pieceCount).toBe(60);
    expect(after).toEqual(initial);
  });

  it('keeps an obsolete stopped RAF callback from restarting a second loop', () => {
    const callbacks: FrameRequestCallback[] = [];
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const t = make();
    t.start();
    t.stop();
    t.start();
    callbacks[0]!(100);
    expect(raf).toHaveBeenCalledTimes(2);
    t.dispose();
    callbacks[1]!(200);
    expect(raf).toHaveBeenCalledTimes(2);
  });

  it('updates body and readable paper fading from game age while retaining the piece', () => {
    const t = make();
    const contact = state.ghosts[0]!;
    t.apply({ ...state, own: [], ghosts: [{ ...contact, ageMs: 0, observedAtGame: undefined }] });
    let piece: THREE.Object3D | undefined;
    t.scene.traverse((object) => {
      if (object.userData.id === contact.id) piece = object;
    });
    const body = piece!.getObjectByName('block') as THREE.Mesh<
      THREE.BoxGeometry,
      THREE.MeshStandardMaterial
    >;
    const tag = piece!.getObjectByName('paper-tag') as THREE.Sprite;
    const freshOpacity = body.material.opacity;
    const freshPaperOpacity = tag.material.opacity;
    t.apply({ ...state, own: [], ghosts: [{ ...contact, ageMs: 2 * 3_600_000 }] });
    expect(piece!.parent).not.toBeNull();
    expect(body.material.opacity).toBeLessThan(freshOpacity);
    expect(tag.material.opacity).toBeLessThan(freshPaperOpacity);
    expect(tag.material.opacity).toBeGreaterThanOrEqual(0.65);
  });

  it('keeps economical dressing outside the map and out of piece picking', () => {
    const t = make();
    t.apply(state);
    const dressing = t.scene.getObjectByName('table-dressing')!;
    expect(dressing.children.map((child) => child.name)).toEqual([
      'ruler',
      'dividers',
      'inkwell',
      'lamp',
    ]);
    let meshes = 0;
    dressing.traverse((object) => {
      if (object instanceof THREE.Mesh) meshes++;
      expect(object.name).not.toBe('pick');
      expect(object.castShadow).toBe(false);
    });
    expect(meshes).toBeLessThanOrEqual(12);
    const lamp = dressing
      .getObjectByName('lamp')!
      .getWorldPosition(new THREE.Vector3())
      .project(t.camera);
    expect(t.pickNdc(new THREE.Vector2(lamp.x, lamp.y))).toEqual({ type: 'none' });
  });

  it('updates a paper tag without destroying its piece or shared sprite geometry', () => {
    const t = make();
    t.apply(state);
    const findTag = () => {
      let tag: THREE.Sprite | undefined;
      t.scene.traverse((object) => {
        if (object.userData.id === state.own[0]!.id)
          tag = object.getObjectByName('paper-tag') as THREE.Sprite;
      });
      return tag!;
    };
    const tag = findTag();
    const body = tag.parent!.getObjectByName('pick');
    const textureDisposed = vi.spyOn(tag.material.map!, 'dispose');
    const geometryDisposed = vi.spyOn(tag.geometry, 'dispose');
    t.apply({ ...state, own: state.own.map((piece) => ({ ...piece, snapshotAtGame: 3_660_000 })) });
    expect(findTag()).toBe(tag);
    expect(tag.parent!.getObjectByName('pick')).toBe(body);
    expect(textureDisposed).toHaveBeenCalledTimes(1);
    expect(tag.userData.lines).toContain('Snapshot at 1:01:00 game');
    t.dispose();
    expect(geometryDisposed).not.toHaveBeenCalled();
  });

  it('disposes all owned textures/materials/geometry once, including shared dressing materials', () => {
    const t = make();
    t.apply(state);
    const resources = new Set<{ dispose(): void }>();
    t.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry && !(object instanceof THREE.Sprite)) resources.add(mesh.geometry);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material) continue;
        resources.add(material);
        const texture = (material as THREE.MeshStandardMaterial).map;
        if (texture) resources.add(texture);
      }
    });
    const disposed = [...resources].map((resource) => vi.spyOn(resource, 'dispose'));
    const rendererDisposed = vi.spyOn(t.renderer, 'dispose');
    const controlsDisposed = vi.spyOn(t.controls, 'dispose');
    t.dispose();
    t.dispose();
    disposed.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
    expect(rendererDisposed).toHaveBeenCalledTimes(1);
    expect(controlsDisposed).toHaveBeenCalledTimes(1);
    expect(t.scene.children).toHaveLength(0);
  });

  it('cleans constructor resources when initial resize fails', () => {
    const geometryDisposed = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const materialDisposed = vi.spyOn(THREE.Material.prototype, 'dispose');
    const rendererDisposed = vi.spyOn(THREE.WebGLRenderer.prototype, 'dispose');
    const removeListener = vi.spyOn(HTMLCanvasElement.prototype, 'removeEventListener');
    vi.spyOn(THREE.WebGLRenderer.prototype, 'setSize').mockImplementation(() => {
      throw new Error('Viewport setup failed');
    });
    expect(() => make()).toThrow('Viewport setup failed');
    expect(geometryDisposed).toHaveBeenCalled();
    expect(materialDisposed).toHaveBeenCalled();
    expect(rendererDisposed).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));
  });
});

const artwork = (width = 1200, height = 900, src = '/hq-preview.svg'): HTMLImageElement => {
  const image = document.createElement('img');
  image.src = src;
  Object.defineProperties(image, {
    complete: { value: true },
    naturalWidth: { value: width },
    naturalHeight: { value: height },
  });
  return image;
};
const mapMaterial = (table: TableScene): THREE.MeshStandardMaterial =>
  (table.scene.getObjectByName('map-artwork') as THREE.Mesh).material as THREE.MeshStandardMaterial;

describe('loaded public fixture artwork', () => {
  it('preserves scene/camera and disposes each replaced texture exactly once', () => {
    const t = make();
    t.apply(state);
    t.snapOblique();
    const camera = t.camera.position.clone();
    const target = t.controls.target.clone();
    const mesh = t.scene.getObjectByName('map-artwork');
    const fallback = vi.spyOn(mapMaterial(t).map!, 'dispose');
    const image = artwork();
    t.setArtwork(image);
    const first = mapMaterial(t).map!;
    const firstDisposed = vi.spyOn(first, 'dispose');
    t.setArtwork(image);
    expect(mapMaterial(t).map).toBe(first);
    expect(firstDisposed).not.toHaveBeenCalled();
    t.setArtwork(artwork());
    const finalDisposed = vi.spyOn(mapMaterial(t).map!, 'dispose');
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(firstDisposed).toHaveBeenCalledTimes(1);
    expect(t.scene.getObjectByName('map-artwork')).toBe(mesh);
    expect(t.camera.position).toEqual(camera);
    expect(t.controls.target).toEqual(target);
    t.dispose();
    expect(finalDisposed).toHaveBeenCalledTimes(1);
    expect(firstDisposed).toHaveBeenCalledTimes(1);
  });

  it('retains the last good artwork on incomplete, oversized, mismatched or unapproved input', () => {
    const t = make();
    t.apply(state);
    t.setArtwork(artwork());
    const previous = mapMaterial(t).map;
    const disposed = vi.spyOn(previous!, 'dispose');
    const incomplete = artwork(0, 0);
    for (const image of [
      incomplete,
      artwork(12000, 9000),
      artwork(100, 100),
      artwork(1200, 900, 'https://example.com/hq-preview.svg'),
      artwork(1200, 900, '/private-map.svg'),
      artwork(1200, 900, '/hq-preview.svg?token=secret'),
    ]) {
      expect(() => t.setArtwork(image)).toThrow(RangeError);
      expect(mapMaterial(t).map).toBe(previous);
    }
    expect(disposed).not.toHaveBeenCalled();
  });

  it('retains artwork and camera across same-dimension public map updates', () => {
    const t = make();
    t.apply(state);
    const image = artwork();
    t.setArtwork(image);
    t.snapOblique();
    const camera = t.camera.position.clone();
    const target = t.controls.target.clone();
    const oldDisposed = vi.spyOn(mapMaterial(t).map!, 'dispose');
    t.apply({ ...state, map: { ...state.map, features: state.map.features.slice(1) } });
    expect(oldDisposed).not.toHaveBeenCalled();
    expect(mapMaterial(t).map!.image).toBe(image);
    expect(t.camera.position).toEqual(camera);
    expect(t.controls.target).toEqual(target);
  });
});

describe('piece geometry', () => {
  it('draws the footprint at its true size, rotated by the compass facing', () => {
    const t = make();
    t.apply(state);
    const group = piecesOf(t);
    const blue1 = group.children.find((c) => c.userData.id === 'blue-1')!;
    const pos = blue1.position;
    expect(pos.x).toBeCloseTo(1850 - 2000);
    expect(pos.z).toBeCloseTo(2450 - 1500);
    const body = blue1.getObjectByName('body')!;
    const block = body.children[0] as THREE.Mesh;
    const box = new THREE.Box3().setFromObject(block);
    expect(box.max.x - box.min.x).toBeCloseTo(85);
  });

  it('draws an uncertainty circle of the wire radius for stale contacts only', () => {
    const t = make();
    t.apply(state);
    const group = piecesOf(t);
    const ghost = group.children.find((c) => c.userData.id === 'contact-1')!;
    const circle = ghost.getObjectByName('uncertainty') as THREE.Group;
    const box = new THREE.Box3().setFromObject(circle);
    expect(box.max.x - box.min.x).toBeCloseTo(6000);
    const own = group.children.find((c) => c.userData.id === 'blue-1')!;
    expect(own.getObjectByName('uncertainty')).toBeUndefined();
  });

  it('draws no uncertainty circle for a live sighting', () => {
    const t = make();
    t.apply({
      ...state,
      ghosts: [
        {
          kind: 'ghost',
          id: 'red-1',
          position: { x: 1950, y: 450 },
          facing: Math.PI,
          ageMs: 0,
          ageTag: 'just now',
          uncertaintyRadius: 0,
          footprint: { frontage: 80, depth: 10 },
        },
      ],
    });
    const live = piecesOf(t).children.find((c) => c.userData.id === 'red-1')!;
    expect(live.getObjectByName('uncertainty')).toBeUndefined();
  });

  it('applies the compass facing to the body in world space', () => {
    const t = make();
    t.apply(state);
    const group = piecesOf(t);
    group.updateMatrixWorld(true);
    const body = group.children.find((c) => c.userData.id === 'blue-2')!.getObjectByName('body')!;
    // Facing pi/4 is north-east: front is (sin, -cos) on the (x, z) plane.
    const front = new THREE.Vector3(0, 0, -1).transformDirection(body.matrixWorld);
    expect(front.x).toBeCloseTo(Math.SQRT1_2);
    expect(front.z).toBeCloseTo(-Math.SQRT1_2);
  });

  it('places skirmish markers where picking finds them', () => {
    const t = make();
    t.apply(state);
    const group = piecesOf(t);
    group.updateMatrixWorld(true);
    const u = state.own.find((p) => p.id === 'blue-4')!;
    const body = group.children.find((c) => c.userData.id === 'blue-4')!.getObjectByName('body')!;
    // body children: the bound, then a (marker, pick) pair per sub-position, then the footprint pick.
    const markers = u.shape!.map((_, i) => body.children[1 + 2 * i]!);
    u.shape!.forEach((s, i) => {
      const want = mapToWorld(fixtureMap, {
        x: u.position.x + s.x * Math.cos(u.facing) + s.y * Math.sin(u.facing),
        y: u.position.y + s.x * Math.sin(u.facing) - s.y * Math.cos(u.facing),
      });
      const got = markers[i]!.getWorldPosition(new THREE.Vector3());
      expect(got.x).toBeCloseTo(want.x, 3);
      expect(got.z).toBeCloseTo(want.z, 3);
    });
  });

  it('reports the map-plane point for a piece picked obliquely, not the mesh hit', () => {
    const t = make();
    t.apply(state);
    const w = mapToWorld(fixtureMap, { x: 1850, y: 2450 });
    t.camera.position.set(w.x, 600, w.z + 900);
    t.controls.target.set(w.x, 0, w.z);
    t.controls.update();
    const hit = t.pickNdc(new THREE.Vector2(0, 0));
    expect(hit).toMatchObject({ type: 'piece', id: 'blue-1' });
    if (hit.type === 'piece') {
      expect(hit.coord.x).toBeCloseTo(1850, 0);
      expect(hit.coord.y).toBeCloseTo(2450, 0);
    }
  });

  it('picks a piece through the scene with continuous metre coordinates', () => {
    const t = make();
    t.apply(state);
    t.snapTopDown();
    const hit = t.pickNdc(new THREE.Vector2(0, 0));
    expect(hit.type).toBe('point');
    if (hit.type === 'point') {
      expect(hit.coord.x).toBeCloseTo(2000, 0);
      expect(hit.coord.y).toBeCloseTo(1500, 0);
    }
    // Top-down on blue-1's centre picks it, via the piece mesh, at metre coordinates.
    const w = mapToWorld(fixtureMap, { x: 1850, y: 2450 });
    t.camera.position.set(w.x, 3000, w.z + 0.001);
    t.controls.target.set(w.x, 0, w.z);
    t.controls.update();
    expect(t.pickNdc(new THREE.Vector2(0, 0))).toMatchObject({
      type: 'piece',
      pieceKind: 'own',
      id: 'blue-1',
      coord: { x: expect.closeTo(1850, 0), y: expect.closeTo(2450, 0) },
    });
  });
});

describe('framing', () => {
  it('turns a compass bearing into a rotation about Y', () => {
    expect(facingToRotationY(0)).toBeCloseTo(0);
    // East (pi/2) takes the nose from -Z to +X.
    const nose = new THREE.Vector3(0, 0, -1).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      facingToRotationY(Math.PI / 2),
    );
    expect(nose.x).toBeCloseTo(1);
    expect(nose.z).toBeCloseTo(0);
  });

  it('fits the width on portrait screens and the height on landscape ones', () => {
    const landscape = fitDistance(4000, 3000, 45, 16 / 9);
    const portrait = fitDistance(4000, 3000, 45, 0.5);
    expect(portrait).toBeGreaterThan(landscape * 1.5);
    const halfV = Math.tan((45 * Math.PI) / 360);
    expect(portrait * halfV * 0.5).toBeGreaterThanOrEqual(2000);
  });
});

describe('map texture and types', () => {
  it('scales the texture so the larger side fits, whatever the map size in metres', () => {
    expect(MAX_TEXTURE_PX).toBe(2048);
    expect(pxPerMetre(fixtureMap) * 4000).toBeCloseTo(2048);
    expect(pxPerMetre({ width: 40_000, height: 100, features: [] }) * 40_000).toBeCloseTo(2048);
    const canvas = mapCanvas(fixtureMap);
    expect(Math.max(canvas.width, canvas.height)).toBe(2048);
  });

  it('paints areas under lines under crossings', () => {
    const order = paintOrder(fixtureMap.features).map((f) => f.kind);
    expect(order.indexOf('wood')).toBeLessThan(order.indexOf('river'));
    // A river cuts a road; a bridge carries it across (the engine's layer order).
    expect(order.indexOf('road')).toBeLessThan(order.indexOf('river'));
    expect(order.indexOf('river')).toBeLessThan(order.indexOf('bridge'));
  });

  it('paints a river over a road that crosses it with no bridge', () => {
    const line = (id: string, kind: 'road' | 'river') => ({
      id,
      kind,
      geometry: {
        shape: 'polyline' as const,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ],
        width: 10,
      },
    });
    // River listed first so only the layer table (not input order) puts it on top.
    const kinds = paintOrder([line('r', 'river'), line('d', 'road')]).map((f) => f.kind);
    expect(kinds).toEqual(['road', 'river']);
  });

  it("matches the engine's feature list", () => {
    const src = readFileSync(resolve(process.cwd(), '../packages/engine/src/types.ts'), 'utf8');
    const body = /export const FEATURE_KINDS = \[([^\]]*)\]/.exec(src)![1]!;
    const engine = [...body.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect([...FEATURE_KINDS]).toEqual(engine);
  });
});

describe('continuous reconciliation regressions', () => {
  const piece = (table: TableScene, id = 'blue-1') =>
    piecesOf(table).children.find((object) => object.userData.id === id)!;

  it('keeps the supplied thin depth exact and widens only the invisible target', () => {
    const table = make();
    table.apply(state);
    const group = piece(table);
    const block = group.getObjectByName('block') as THREE.Mesh<THREE.BoxGeometry>;
    const target = group.getObjectByName('pick') as THREE.Mesh<THREE.BoxGeometry>;
    const nose = group.getObjectByName('nose') as THREE.Mesh<THREE.BoxGeometry>;
    expect(block.geometry.parameters.width).toBe(85);
    expect(block.geometry.parameters.depth).toBe(8);
    expect(target.geometry.parameters.depth).toBe(50);
    expect((target.material as THREE.Material).visible).toBe(false);
    expect(nose.position.z - nose.geometry.parameters.depth / 2).toBeGreaterThanOrEqual(-4);
    expect(nose.position.z + nose.geometry.parameters.depth / 2).toBeLessThanOrEqual(4);
    expect(group.rotation.y).toBe(0);
    expect(group.getObjectByName('paper-tag')!.rotation.y).toBe(0);
  });

  it('reuses body and paper for a continuous move and arbitrary bearing', () => {
    const table = make();
    table.apply(state);
    table.snapOblique();
    const before = piece(table);
    const body = before.getObjectByName('body');
    const tag = before.getObjectByName('paper-tag') as THREE.Sprite;
    const texture = tag.material.map;
    const camera = table.camera.position.clone();
    const target = table.controls.target.clone();
    const unit = { ...state.own[0]!, position: { x: 1850.125, y: 2450.875 }, facing: 0.731 };
    table.apply({ ...state, own: [unit] });
    expect(piece(table)).toBe(before);
    expect(before.getObjectByName('body')).toBe(body);
    expect(tag.material.map).toBe(texture);
    expect(body!.rotation.y).toBeCloseTo(-0.731);
    expect(before.position.x).toBeCloseTo(-149.875);
    expect(before.position.z).toBeCloseTo(950.875);
    expect(table.camera.position).toEqual(camera);
    expect(table.controls.target).toEqual(target);
  });

  it('replaces changed footprint/shape/radius resources exactly once', () => {
    const table = make();
    table.apply(state);
    const old = piece(table);
    const block = old.getObjectByName('block') as THREE.Mesh;
    const geometryDisposed = vi.spyOn(block.geometry, 'dispose');
    const tagDisposed = vi.spyOn(
      (old.getObjectByName('paper-tag') as THREE.Sprite).material.map!,
      'dispose',
    );
    const ghost = piece(table, 'contact-1');
    const ring = ghost.getObjectByName('uncertainty')!.children[0] as THREE.Mesh;
    const ringDisposed = vi.spyOn(ring.geometry, 'dispose');
    const next = {
      ...state,
      own: [
        {
          ...state.own[0]!,
          footprint: { frontage: 120, depth: 70 },
          shape: [
            { x: -40, y: 10 },
            { x: 20, y: -30 },
          ],
        },
      ],
      ghosts: [{ ...state.ghosts[0]!, uncertaintyRadius: 175 }],
    };
    table.apply(next);
    expect(piece(table)).not.toBe(old);
    expect(
      (piece(table).getObjectByName('bound') as THREE.Mesh<THREE.BoxGeometry>).geometry.parameters
        .depth,
    ).toBe(70);
    expect(
      (
        piece(table, 'contact-1').getObjectByName('uncertainty')!
          .children[0] as THREE.Mesh<THREE.CircleGeometry>
      ).geometry.parameters.radius,
    ).toBe(175);
    table.apply(next);
    table.dispose();
    expect(geometryDisposed).toHaveBeenCalledTimes(1);
    expect(tagDisposed).toHaveBeenCalledTimes(1);
    expect(ringDisposed).toHaveBeenCalledTimes(1);
  });

  it('rejects combined invalid artwork before changing pieces, map, or camera', () => {
    const table = make();
    table.apply(state, artwork());
    table.snapOblique();
    const originalPiece = piece(table);
    const originalMap = table.scene.getObjectByName('map-artwork');
    const originalTexture = mapMaterial(table).map;
    const disposed = vi.spyOn(originalTexture!, 'dispose');
    const camera = table.camera.position.clone();
    const target = table.controls.target.clone();
    const next = {
      ...state,
      own: [{ ...state.own[0]!, position: { x: 1500, y: 2100 } }],
      ghosts: [],
    };
    for (const invalid of [
      artwork(1200, 480),
      artwork(2400, 1800),
      artwork(1200, 900, '/private-map.svg'),
      artwork(1200, 900, '/hq-preview.svg#x'),
    ]) {
      expect(() => table.apply(next, invalid)).toThrow(RangeError);
      expect(piece(table)).toBe(originalPiece);
      expect(table.pieceCount).toBe(state.own.length + state.ghosts.length);
      expect(table.scene.getObjectByName('map-artwork')).toBe(originalMap);
      expect(mapMaterial(table).map).toBe(originalTexture);
      expect(table.camera.position).toEqual(camera);
      expect(table.controls.target).toEqual(target);
    }
    expect(disposed).not.toHaveBeenCalled();
    table.apply(next, artwork());
    expect(table.pieceCount).toBe(1);
    expect(piece(table).position.z).toBe(600);
    expect(table.camera.position).toEqual(camera);
    expect(disposed).toHaveBeenCalledTimes(1);
  });

  it('releases staged replacements and retains the settled scene if preparing a tag fails', () => {
    const table = make();
    table.apply(state, artwork());
    const original = piece(table);
    const texture = mapMaterial(table).map;
    const disposed = vi.spyOn(texture!, 'dispose');
    const textureDisposals = vi.spyOn(THREE.Texture.prototype, 'dispose');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('Paper allocation failed');
    });
    expect(() =>
      table.apply({ ...state, own: [{ ...state.own[0]!, snapshotAtGame: 123 }] }, artwork()),
    ).toThrow('Paper allocation failed');
    expect(piece(table)).toBe(original);
    expect(mapMaterial(table).map).toBe(texture);
    expect(disposed).not.toHaveBeenCalled();
    expect(textureDisposals).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid first artwork without creating a presentation', () => {
    const table = make();
    const camera = table.camera.position.clone();
    expect(() => table.apply(state, artwork(1200, 480))).toThrow(RangeError);
    expect(table.pieceCount).toBe(0);
    expect(table.scene.getObjectByName('map-artwork')).toBeUndefined();
    expect(table.camera.position).toEqual(camera);
  });

  it('fits changed extents once, then retains the new camera', () => {
    const table = make();
    table.apply(state, artwork());
    const snap = vi.spyOn(table, 'snapTopDown');
    const next = { ...state, map: { width: 8000, height: 6000, features: [] } };
    table.apply(next, artwork());
    expect(snap).toHaveBeenCalledTimes(1);
    expect(mapMaterial(table).map!.image.naturalWidth).toBe(1200);
    table.snapOblique();
    const camera = table.camera.position.clone();
    table.apply(next);
    expect(snap).toHaveBeenCalledTimes(1);
    expect(table.camera.position).toEqual(camera);
  });

  it('resizes CSS dimensions and capped DPR without moving the settled camera', () => {
    const table = make();
    table.apply(state);
    table.snapOblique();
    table.controls.target.set(12, 0, 25);
    const camera = table.camera.position.clone();
    const target = table.controls.target.clone();
    const size = vi.spyOn(table.renderer, 'setSize');
    const ratio = vi.spyOn(table.renderer, 'setPixelRatio');
    const max = table.controls.maxDistance;
    table.resize(300, 900, 3);
    expect(size).toHaveBeenLastCalledWith(300, 900, false);
    expect(ratio).toHaveBeenLastCalledWith(2);
    expect(table.camera.aspect).toBeCloseTo(1 / 3);
    expect(table.camera.near).toBe(20);
    expect(table.camera.far).toBe(40000);
    expect(table.controls.minDistance).toBe(80);
    expect(table.controls.maxDistance).toBeGreaterThan(max);
    expect(table.camera.position).toEqual(camera);
    expect(table.controls.target).toEqual(target);
    expect(() => table.resize(0, 900, 1)).toThrow(RangeError);
    expect(table.camera.position).toEqual(camera);
  });

  it('clips uncertainty and generic ghosts at the map without changing supplied radius', () => {
    const table = make();
    table.apply(state);
    const ghost = piece(table, 'contact-1');
    const circle = ghost.getObjectByName('uncertainty')!;
    for (const child of circle.children) {
      const material = (child as THREE.Mesh).material as THREE.Material;
      expect(material.clippingPlanes).toHaveLength(4);
      const planes = material.clippingPlanes!;
      expect(planes.every((plane) => plane.distanceToPoint(new THREE.Vector3(0, 0, 0)) >= 0)).toBe(
        true,
      );
      expect(
        planes.some((plane) => plane.distanceToPoint(new THREE.Vector3(2000.001, 0, 0)) < 0),
      ).toBe(true);
      expect(
        planes.some((plane) => plane.distanceToPoint(new THREE.Vector3(0, 0, -1500.001)) < 0),
      ).toBe(true);
    }
    expect(
      (circle.children[0] as THREE.Mesh<THREE.CircleGeometry>).geometry.parameters.radius,
    ).toBe(3000);
    expect((ghost.getObjectByName('block') as THREE.Mesh).material).toHaveProperty(
      'clippingPlanes',
      expect.any(Array),
    );
    expect(table.renderer.localClippingEnabled).toBe(true);
  });

  it('contains all decorative bounds within its expanded board border', () => {
    const table = make();
    table.apply(state);
    table.scene.updateMatrixWorld(true);
    const board = new THREE.Box3().setFromObject(table.scene.getObjectByName('table-board')!);
    const dressing = table.scene.getObjectByName('table-dressing')!;
    expect(dressing.scale.x).toBe(100);
    for (const prop of dressing.children) {
      const bounds = new THREE.Box3().setFromObject(prop);
      expect(bounds.min.x).toBeGreaterThanOrEqual(board.min.x);
      expect(bounds.max.x).toBeLessThanOrEqual(board.max.x);
      expect(bounds.min.z).toBeGreaterThanOrEqual(board.min.z);
      expect(bounds.max.z).toBeLessThanOrEqual(board.max.z);
    }
  });

  it('rejects off-map plane hits even when a widened edge piece mesh is hit', () => {
    const table = make();
    table.apply({ ...state, own: [{ ...state.own[0]!, position: { x: 0, y: 1000 } }], ghosts: [] });
    const point = mapToWorld(fixtureMap, { x: -5, y: 1000 });
    table.camera.position.set(point.x, 1000, point.z + 0.001);
    table.controls.target.copy(point);
    table.controls.update();
    expect(table.pickNdc(new THREE.Vector2(0, 0))).toEqual({ type: 'none' });
    expect(table.pickNdc(new THREE.Vector2(1.00001, 0))).toEqual({ type: 'none' });
    const rect = { left: 10, top: 20, right: 810, bottom: 620, width: 800, height: 600 };
    vi.spyOn(table.canvas, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);
    expect(table.pickAt(9.999, 320)).toEqual({ type: 'none' });
    expect(table.pickAt(410, 620.001)).toEqual({ type: 'none' });
  });
});

describe('camera-projected map boundary picks', () => {
  const corners = [
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 0, y: 3000 },
    { x: 4000, y: 3000 },
  ];

  for (const view of ['top-down', 'oblique'] as const) {
    it(`round-trips visible ${view} corners through camera NDC and CSS after resize/DPR`, () => {
      const table = make();
      table.apply({ ...state, own: [], ghosts: [] });
      for (const [width, height, dpr] of [
        [1280, 720, 1],
        [900, 1200, 2],
        [1600, 1000, 3],
      ] as const) {
        table.resize(width, height, dpr);
        if (view === 'top-down') table.snapTopDown();
        else table.snapOblique();
        table.camera.updateMatrixWorld(true);
        const rect = {
          left: 37.5,
          top: 61.25,
          right: 37.5 + width,
          bottom: 61.25 + height,
          width,
          height,
        };
        vi.spyOn(table.canvas, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);
        let visible = 0;
        for (const corner of corners) {
          const projected = mapToWorld(fixtureMap, corner).project(table.camera);
          if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || Math.abs(projected.z) > 1)
            continue;
          visible++;
          const ndc = table.pickNdc(new THREE.Vector2(projected.x, projected.y));
          const css = table.pickAt(
            rect.left + ((projected.x + 1) * width) / 2,
            rect.top + ((1 - projected.y) * height) / 2,
          );
          for (const hit of [ndc, css]) {
            expect(hit.type, `${view} corner ${corner.x},${corner.y}, DPR ${dpr}`).toBe('point');
            if (hit.type !== 'point') throw new Error('Corner was not pickable');
            expect(hit.coord.x).toBeCloseTo(corner.x, 8);
            expect(hit.coord.y).toBeCloseTo(corner.y, 8);
            expect(hit.coord.x).toBeGreaterThanOrEqual(0);
            expect(hit.coord.x).toBeLessThanOrEqual(4000);
            expect(hit.coord.y).toBeGreaterThanOrEqual(0);
            expect(hit.coord.y).toBeLessThanOrEqual(3000);
          }
        }
        expect(visible).toBe(view === 'top-down' ? 4 : 2);
        // Canvas boundaries stay strict even though plane-intersection roundoff is stabilized.
        expect(table.pickAt(rect.left - 1e-6, rect.top + height / 2)).toEqual({ type: 'none' });
        expect(table.pickAt(rect.right + 1e-6, rect.top + height / 2)).toEqual({ type: 'none' });
        expect(table.pickAt(rect.left + width / 2, rect.top - 1e-6)).toEqual({ type: 'none' });
        expect(table.pickAt(rect.left + width / 2, rect.bottom + 1e-6)).toEqual({ type: 'none' });
      }
    });
  }

  it('rejects camera-projected deliberate 1e-6 metre misses on every map edge', () => {
    const table = make();
    table.apply({ ...state, own: [], ghosts: [] });
    table.resize(1200, 900, 2);
    const rect = { left: 23, top: 47, right: 1223, bottom: 947, width: 1200, height: 900 };
    vi.spyOn(table.canvas, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);
    for (const view of ['top-down', 'oblique']) {
      if (view === 'top-down') table.snapTopDown();
      else {
        table.snapOblique();
        table.camera.position.multiplyScalar(2);
        table.controls.update();
      }
      table.camera.updateMatrixWorld(true);
      for (const point of [
        { x: -1e-6, y: 1500 },
        { x: 4000 + 1e-6, y: 1500 },
        { x: 2000, y: -1e-6 },
        { x: 2000, y: 3000 + 1e-6 },
      ]) {
        const projected = mapToWorld(fixtureMap, point).project(table.camera);
        expect(Math.abs(projected.x)).toBeLessThan(1);
        expect(Math.abs(projected.y)).toBeLessThan(1);
        expect(table.pickNdc(new THREE.Vector2(projected.x, projected.y))).toEqual({
          type: 'none',
        });
        expect(
          table.pickAt(
            rect.left + ((projected.x + 1) * rect.width) / 2,
            rect.top + ((1 - projected.y) * rect.height) / 2,
          ),
        ).toEqual({ type: 'none' });
      }
    }
  });
});
