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
import { MAX_TEXTURE_PX, mapCanvas, paintOrder, pxPerMetre } from './mapTexture.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    const landscape = fitDistance(4000, 1600, 45, 16 / 9);
    const portrait = fitDistance(4000, 1600, 45, 0.5);
    expect(portrait).toBeGreaterThan(landscape * 2);
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
        shape: 'line' as const,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ],
        width: 10,
      },
    });
    // River listed first so only the layer table (not input order) puts it on top.
    const kinds = paintOrder([line('r', 'river'), line('d', 'road')] as never).map((f) => f.kind);
    expect(kinds).toEqual(['road', 'river']);
  });

  it("matches the engine's feature list", () => {
    const src = readFileSync(resolve(process.cwd(), '../packages/engine/src/types.ts'), 'utf8');
    const body = /export const FEATURE_KINDS = \[([^\]]*)\]/.exec(src)![1]!;
    const engine = [...body.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect([...FEATURE_KINDS]).toEqual(engine);
  });
});
