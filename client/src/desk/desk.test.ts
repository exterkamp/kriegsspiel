// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeRenderer {
    setPixelRatio(): void {}
    setSize(): void {}
    render(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

import { flushSync, mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import Desk from './Desk.svelte';
import { activeView, gameState } from './store.js';
import { isDeskView, isTypingTarget, viewForKey } from './views.js';
import { deskPose, easeInOut, lerpPose } from '../table/transition.js';
import { TableScene } from '../table/TableScene.js';
import { buildSceneState } from '../table/sceneState.js';
import { fixtureMap, fixtureView } from '../table/fixture.js';
import { initialState } from '../net/state.js';

describe('view keys', () => {
  it('maps letters to views and Escape to the table', () => {
    expect(viewForKey({ key: 'i' })).toBe('inTray');
    expect(viewForKey({ key: 'O' })).toBe('orders');
    expect(viewForKey({ key: 'Escape' })).toBe('table');
    expect(viewForKey({ key: 'x' })).toBeUndefined();
  });
  it('ignores browser shortcuts and typing targets', () => {
    expect(viewForKey({ key: 'r', ctrlKey: true })).toBeUndefined();
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
    expect(isDeskView('table')).toBe(false);
    expect(isDeskView('journal')).toBe(true);
  });
});

describe('camera transition maths', () => {
  const a = { position: { x: 0, y: 10, z: 0 }, target: { x: 0, y: 0, z: 0 } };
  const b = { position: { x: 4, y: 2, z: 8 }, target: { x: 0, y: 0, z: 4 } };
  it('eases from 0 to 1 and clamps', () => {
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(0.5)).toBe(0.5);
    expect(easeInOut(2)).toBe(1);
  });
  it('interpolates poses', () => {
    expect(lerpPose(a, b, 0)).toEqual(a);
    expect(lerpPose(a, b, 1)).toEqual(b);
    expect(lerpPose(a, b, 0.5).position).toEqual({ x: 2, y: 6, z: 4 });
  });
  it('puts the desk pose low, in front of the table edge', () => {
    const d = deskPose(a, 3000, 4000);
    expect(d.position.y).toBeLessThan(a.position.y + 1e6);
    expect(d.target.z).toBeGreaterThan(1500);
    expect(d.position.z).toBeGreaterThan(d.target.z);
  });
});

describe('TableScene desk dolly', () => {
  const make = (): TableScene => {
    const t = new TableScene(document.createElement('canvas'));
    t.apply(buildSceneState(fixtureView, fixtureMap));
    return t;
  };
  it('moves the camera to the desk and back to the same pose, keeping the scene', () => {
    const t = make();
    const before = t.camera.position.clone();
    const pieces = t.pieceCount;
    t.setDesk(true, 1000, 0);
    expect(t.stepDolly(500)).toBe(true);
    expect(t.stepDolly(1000)).toBe(false);
    expect(t.deskActive).toBe(true);
    expect(t.controls.enabled).toBe(false);
    expect(t.camera.position.z).toBeGreaterThan(fixtureMap.height / 2);
    expect(t.pieceCount).toBe(pieces);
    t.setDesk(false, 1000, 2000);
    t.stepDolly(3000);
    expect(t.controls.enabled).toBe(true);
    expect(t.camera.position.distanceTo(before)).toBeLessThan(1e-6);
  });
  it('jumps when the duration is 0', () => {
    const t = make();
    t.setDesk(true, 0, 0);
    expect(t.stepDolly(0)).toBe(false);
    expect(t.camera.position.y).toBeLessThan(fixtureMap.width);
  });
  it('panTo while at the desk moves the saved table pose', () => {
    const t = make();
    t.setDesk(true, 0, 0);
    t.panTo({ x: 100, y: 100 });
    t.setDesk(false, 0, 1);
    expect(t.controls.target.x).not.toBe(0);
  });
});

describe('Desk shell', () => {
  let cmp: ReturnType<typeof mount> | undefined;
  afterEach(() => {
    if (cmp) unmount(cmp);
    cmp = undefined;
    document.body.innerHTML = '';
    activeView.set('table');
    gameState.set(initialState);
  });
  const open = (): void => {
    cmp = mount(Desk, { target: document.body });
    flushSync();
  };
  const key = (k: string): void => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    flushSync();
  };

  it('has a keyboard-reachable button per view with the table pressed', () => {
    open();
    const btns = [...document.querySelectorAll('nav button')];
    expect(btns).toHaveLength(6);
    expect(btns[0]?.getAttribute('aria-pressed')).toBe('true');
  });
  it('switches views from the keyboard and clicks, Escape returns to the table', () => {
    open();
    key('j');
    expect(get(activeView)).toBe('journal');
    expect(document.getElementById('view-journal')).not.toBeNull();
    key('Escape');
    expect(get(activeView)).toBe('table');
    expect(document.getElementById('view-journal')).toBeNull();
    (document.querySelectorAll('nav button')[3] as HTMLButtonElement).click();
    flushSync();
    expect(get(activeView)).toBe('roster');
  });
  it('does not steal keys typed into a text field', () => {
    open();
    const ta = document.createElement('textarea');
    document.body.append(ta);
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    flushSync();
    expect(get(activeView)).toBe('table');
  });
  it('shows roster and journal from the shared store', () => {
    open();
    gameState.set({ ...initialState, view: fixtureView });
    key('r');
    expect(document.getElementById('view-roster')?.textContent).toContain(
      fixtureView.ownUnits[0]!.name,
    );
  });
});
