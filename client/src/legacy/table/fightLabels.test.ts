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
import { overlaps, placeFightLabels, type LabelRect } from './fightLabels.js';
import { buildSceneState } from './sceneState.js';
import { TableScene } from './TableScene.js';
import { worldToMap } from './picking.js';

const size = { w: 70, h: 17.5 };
const fight = (id: string, x: number, y: number) => ({ id, position: { x, y } });

const noneOverlap = (rects: LabelRect[]): boolean =>
  rects.every((a, i) => rects.every((b, j) => i === j || !overlaps(a, b)));

describe('placeFightLabels (#325)', () => {
  it('keeps the label north of the ring when nothing is in the way', () => {
    const at = placeFightLabels([fight('a', 1000, 1000)], [], size, 40).get('a')!;
    expect(at).toEqual({ x: 1000, y: 1000 - 40 - size.h / 2 });
  });

  it('moves a label off a unit tag that sits where it would go', () => {
    const tag: LabelRect = { x: 1000, y: 1000 - 40 - size.h / 2, ...size };
    const at = placeFightLabels([fight('a', 1000, 1000)], [tag], size, 40).get('a')!;
    expect(overlaps({ ...at, ...size }, tag)).toBe(false);
  });

  it('keeps two fights close together apart, and clear of the unit tags between them', () => {
    const fights = [fight('a', 1000, 1000), fight('b', 1040, 1010), fight('c', 1020, 1000)];
    const tags: LabelRect[] = [
      { x: 1000, y: 1100, ...size },
      { x: 1050, y: 1100, ...size },
      { x: 1020, y: 940, ...size },
    ];
    const placed = placeFightLabels(fights, tags, size, 40);
    const rects = [...placed.values()].map((c) => ({ ...c, ...size }));
    expect(rects).toHaveLength(3);
    expect(noneOverlap(rects)).toBe(true);
    for (const r of rects) for (const t of tags) expect(overlaps(r, t)).toBe(false);
  });

  it('falls back to the first candidate when every spot is taken', () => {
    const wall: LabelRect = { x: 1000, y: 1000, w: 4000, h: 4000 };
    const at = placeFightLabels([fight('a', 1000, 1000)], [{ ...wall }], size, 40).get('a')!;
    expect(at).toEqual({ x: 1000, y: 1000 - (40 + size.h / 2) });
  });

  it('is deterministic', () => {
    const f = [fight('a', 5, 5), fight('b', 20, 8)];
    expect(placeFightLabels(f, [], size, 40)).toEqual(placeFightLabels(f, [], size, 40));
  });
});

describe('fight labels on the table (#325)', () => {
  it('no label overlaps another label for battalions sitting close together', () => {
    const t = new TableScene(document.createElement('canvas'));
    const base = buildSceneState(fixtureView, fixtureMap);
    const [a, b] = base.own;
    // 1st and 2nd Battalion 60 m apart at the bridge, each fighting its own foe.
    const own = [
      { ...a!, position: { x: 1000, y: 1000 } },
      { ...b!, position: { x: 1060, y: 1000 } },
    ];
    const engagements = [
      { id: 'f1', position: { x: 1000, y: 1050 } },
      { id: 'f2', position: { x: 1060, y: 1050 } },
    ];
    t.apply({ ...base, own, ghosts: [], engagements });
    t.scene.updateMatrixWorld(true);
    const rects: LabelRect[] = [];
    t.scene.traverse((o) => {
      if (!(o instanceof THREE.Sprite)) return;
      const at = worldToMap(fixtureMap, o.getWorldPosition(new THREE.Vector3()));
      rects.push({ ...at, w: o.scale.x, h: o.scale.y });
    });
    expect(rects).toHaveLength(own.length + engagements.length);
    // The unit tags of battalions this close may touch each other; a fight label must never touch any tag.
    const [unitTags, fightTags] = [rects.slice(0, own.length), rects.slice(own.length)];
    for (const f of fightTags)
      for (const o of rects.filter((r) => r !== f)) {
        expect(overlaps(f, o)).toBe(false);
      }
    expect(unitTags).toHaveLength(2);
  });
});
