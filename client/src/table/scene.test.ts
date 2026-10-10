// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

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
import { paintOrder, pxPerMetre } from './mapTexture.js';
import { buildSceneState } from './sceneState.js';
import { TableScene } from './TableScene.js';
import { mapToWorld } from './picking.js';
import { FEATURE_KINDS } from './types.js';

const state = buildSceneState(fixtureView, fixtureMap);
const make = (): TableScene => new TableScene(document.createElement('canvas'));
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
    expect(raf).toHaveBeenCalledTimes(2);
    t.dispose();
    raf.mockRestore();
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
    const landscape = fitDistance(4000, 1600, 45, 16 / 9);
    const portrait = fitDistance(4000, 1600, 45, 0.5);
    expect(portrait).toBeGreaterThan(landscape * 2);
    const halfV = Math.tan((45 * Math.PI) / 360);
    expect(portrait * halfV * 0.5).toBeGreaterThanOrEqual(2000);
  });
});

describe('map texture and types', () => {
  it('scales the texture so the larger side fits, whatever the map size in metres', () => {
    expect(pxPerMetre(fixtureMap) * 4000).toBeLessThanOrEqual(4096);
    expect(pxPerMetre({ width: 40_000, height: 100, features: [] }) * 40_000).toBeLessThanOrEqual(
      4096,
    );
  });

  it('paints areas under lines under crossings', () => {
    const order = paintOrder(fixtureMap.features).map((f) => f.kind);
    expect(order.indexOf('wood')).toBeLessThan(order.indexOf('river'));
    expect(order.indexOf('river')).toBeLessThan(order.indexOf('road'));
    expect(order.indexOf('road')).toBeLessThan(order.indexOf('bridge'));
  });

  it('pins the feature list', () => {
    expect([...FEATURE_KINDS]).toEqual([
      'field',
      'wood',
      'marsh',
      'water',
      'road',
      'river',
      'stream',
      'bridge',
      'ford',
      'building',
    ]);
  });
});
