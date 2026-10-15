import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { Dispatch, Mark, WindowAt } from '@kriegsspiel/protocol';
import type { TableScene } from '@legacy/table/TableScene';
import { fixtureMap, fixtureView } from '@legacy/table/fixture';
import type { BaseMap } from '@legacy/table/types';
import { DeskStore } from '../desk/desk.store';
import { fakeGame } from '../desk/fake-game';
import { MarksService } from './marks.service';
import { TableService } from './table.service';

function setup(marks: Mark[] = [], terrain: { map: BaseMap | undefined } = { map: fixtureMap }) {
  const g = fakeGame({ marks, view: fixtureView });
  const map = signal(terrain.map);
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: g.provide, useValue: { ...g.fake, map: map.asReadonly() } },
    ],
  });
  const svc = TestBed.inject(MarksService);
  const desk = TestBed.inject(DeskStore);
  const table = TestBed.inject(TableService);
  let at = { x: 0, y: 0 };
  const scene = {
    pickAt: vi.fn(() => ({ type: 'point', coord: at })),
  } as unknown as TableScene;
  const canvas = { setPointerCapture: vi.fn() } as unknown as HTMLElement;
  const p = (x: number, y = 0, button = 0) => {
    at = { x, y };
    return { clientX: x, clientY: y, button, pointerId: 1 };
  };
  return { g, svc, desk, table, scene, canvas, p, map };
}

describe('MarksService', () => {
  it('uses the current map span for selection tolerance and minimum gesture distance', () => {
    const pin: Mark = { id: 'm1', kind: 'pin', at: { x: 1000, y: 1000 }, madeAtGame: 0 };
    const { svc, scene, canvas, p, map, g } = setup([pin], {
      map: { width: 8000, height: 3000, features: [] },
    });
    svc.setTool('select');
    svc.pointerDown(scene, canvas, p(1075, 1000));
    expect(svc.selectedId()).toBe('m1');
    svc.pointerCancel();
    map.set(fixtureMap);
    svc.pointerDown(scene, canvas, p(1075, 1000));
    expect(svc.selectedId()).toBeUndefined();
    svc.pointerCancel();
    map.set({ width: 8000, height: 3000, features: [] });
    svc.setTool('arrow');
    svc.pointerDown(scene, canvas, p(0, 0));
    svc.pointerUp(scene, p(25, 0));
    expect(g.fake.putMark).not.toHaveBeenCalled();
    svc.pointerDown(scene, canvas, p(0, 0));
    svc.pointerUp(scene, p(40, 0));
    expect(g.fake.putMark).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'arrow', to: { x: 40, y: 0 } }),
    );
  });

  it('blocks all drawing, picking, plotting and deletion while no checked map is available', () => {
    const { svc, scene, canvas, p, g, desk, table } = setup([], { map: undefined });
    svc.setTool('pin');
    svc.selectedId.set('old-selection');
    desk.viewedDispatch.set({ id: 'old-report', location: { x: 1, y: 2 } } as Dispatch);
    TestBed.tick();
    expect(svc.plottable()).toBe(false);
    svc.plotReport();
    svc.deleteSelected();
    svc.pointerDown(scene, canvas, p(1, 2));
    svc.pointerMove(scene, p(3, 4));
    svc.pointerUp(scene, p(3, 4));
    desk.windowFrame.set({} as WindowAt);
    svc.pointerMove(scene, p(3, 4));
    expect(scene.pickAt).not.toHaveBeenCalled();
    expect(canvas.setPointerCapture).not.toHaveBeenCalled();
    expect(svc.draft()).toBeUndefined();
    expect(svc.shown()).toEqual([]);
    expect(g.fake.putMark).not.toHaveBeenCalled();
    expect(g.fake.deleteMark).not.toHaveBeenCalled();
    expect(table.status()).toBe('Click the map');
  });

  it.each(['missing', 'same-ID replacement'])(
    'cancels captured gestures synchronously for a %s map before effects/rendering',
    (change) => {
      const { svc, scene, canvas, p, g, map, desk, table } = setup();
      const release = vi.fn();
      canvas.hasPointerCapture = () => true;
      canvas.releasePointerCapture = release;
      svc.setTool('pin');
      svc.label.set('Keep this unfinished note');
      svc.pointerDown(scene, canvas, p(500, 500));
      expect(svc.draft()).toMatchObject({ kind: 'pin' });
      svc.selectedId.set('old-mark');
      desk.windowHover.set('old-unit');
      table.status.set('old actionable coordinate');
      (scene.pickAt as ReturnType<typeof vi.fn>).mockClear();
      map.set(
        change === 'missing'
          ? undefined
          : { ...fixtureMap, features: fixtureMap.features.map((feature) => ({ ...feature })) },
      );
      expect(svc.draft()).toBeUndefined();
      expect(svc.selectedId()).toBeUndefined();
      svc.pointerUp(scene, p(501, 501));
      svc.pointerMove(scene, p(502, 502));
      expect(scene.pickAt).not.toHaveBeenCalled();
      expect(g.fake.putMark).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledWith(1);
      expect(desk.windowHover()).toBeUndefined();
      expect(table.status()).toBe('Click the map');
      expect(svc.label()).toBe('Keep this unfinished note');
      if (change !== 'missing') {
        svc.pointerDown(scene, canvas, p(700, 700));
        svc.pointerUp(scene, p(700, 700));
        expect(g.fake.putMark).toHaveBeenCalledTimes(1);
      }
    },
  );

  it('cancels a pending click on replacement and clears an old report instead of plotting it on new terrain', () => {
    const { svc, scene, canvas, p, g, map, desk } = setup();
    desk.viewedDispatch.set({ id: 'report', location: { x: 1, y: 2 } } as Dispatch);
    TestBed.tick();
    expect(svc.plottable()).toBe(true);
    svc.pointerDown(scene, canvas, p(1, 2));
    (scene.pickAt as ReturnType<typeof vi.fn>).mockClear();
    map.set({ width: 8000, height: 3000, features: [] });
    svc.pointerUp(scene, p(1, 2));
    svc.plotReport();
    expect(scene.pickAt).not.toHaveBeenCalled();
    expect(g.fake.putMark).not.toHaveBeenCalled();
    expect(svc.plottable()).toBe(false);
  });

  it('cannot finish a live gesture after the read-only umpire window opens', () => {
    const { svc, scene, canvas, p, g, desk } = setup();
    svc.setTool('pin');
    svc.pointerDown(scene, canvas, p(1, 2));
    desk.windowFrame.set({} as WindowAt);
    svc.pointerUp(scene, p(1, 2));
    expect(g.fake.putMark).not.toHaveBeenCalled();
    expect(svc.draft()).toBeUndefined();
  });
  it('draws a pin with the typed note, sends it and clears the note', () => {
    const { g, svc, scene, canvas, p } = setup();
    svc.setTool('pin');
    svc.label.set(' ford ');
    svc.pointerDown(scene, canvas, p(500, 500));
    expect(svc.draft()?.kind).toBe('pin');
    svc.pointerUp(scene, p(500, 500));
    expect(g.fake.putMark).toHaveBeenCalledTimes(1);
    const sent = g.fake.putMark.mock.calls[0]![0] as Mark;
    expect(sent).toMatchObject({ kind: 'pin', at: { x: 500, y: 500 }, label: 'ford' });
    expect(svc.draft()).toBeUndefined();
    expect(svc.label()).toBe('');
  });

  it('shows the draft among the marks while dragging an arrow, and cancel drops it', () => {
    const { svc, scene, canvas, p } = setup();
    svc.setTool('arrow');
    svc.pointerDown(scene, canvas, p(0, 0));
    svc.pointerMove(scene, p(5000, 0));
    expect(svc.shown().some((m) => m.kind === 'arrow')).toBe(true);
    svc.pointerCancel();
    expect(svc.draft()).toBeUndefined();
    expect(svc.shown()).toEqual([]);
  });

  it('does nothing on the Look tool, a non-left button, or while a desk view is open', () => {
    const { svc, desk, scene, canvas, p } = setup();
    svc.pointerDown(scene, canvas, p(1, 1));
    expect(svc.draft()).toBeUndefined();
    svc.setTool('pin');
    svc.pointerDown(scene, canvas, p(1, 1, 2));
    expect(svc.draft()).toBeUndefined();
    desk.activeView.set('journal');
    svc.pointerDown(scene, canvas, p(1, 1));
    expect(svc.draft()).toBeUndefined();
  });

  it('goes back to Look when a desk view opens', () => {
    const { svc, desk } = setup();
    TestBed.tick();
    svc.setTool('pin');
    TestBed.tick();
    expect(svc.tool()).toBe('pin');
    desk.activeView.set('orders');
    TestBed.tick();
    expect(svc.tool()).toBe('view');
  });

  it('selects a mark with Move and deletes it with the Delete key, but not while typing', () => {
    const pin: Mark = { id: 'm1', kind: 'pin', at: { x: 10, y: 10 }, madeAtGame: 0 };
    const { g, svc, scene, canvas, p } = setup([pin]);
    svc.setTool('select');
    svc.pointerDown(scene, canvas, p(10, 10));
    svc.pointerUp(scene, p(10, 10));
    expect(svc.selectedId()).toBe('m1');
    svc.onKey({
      key: 'Delete',
      target: document.createElement('textarea'),
    } as unknown as KeyboardEvent);
    expect(g.fake.deleteMark).not.toHaveBeenCalled();
    svc.onKey({ key: 'Delete', target: document.body } as unknown as KeyboardEvent);
    expect(g.fake.deleteMark).toHaveBeenCalledWith('m1');
    expect(svc.selectedId()).toBeUndefined();
  });

  it('says so when a mark could not be sent', () => {
    const { g, svc, table, scene, canvas, p } = setup();
    g.fake.putMark.mockReturnValue(false);
    svc.setTool('pin');
    svc.pointerDown(scene, canvas, p(5, 5));
    svc.pointerUp(scene, p(5, 5));
    expect(table.status()).toMatch(/not saved/);
  });

  it('plots the last located report once, and moves the pin if plotted again', () => {
    const { g, svc, desk } = setup();
    expect(svc.plottable()).toBe(false);
    const report = {
      id: 'd1',
      from: 'Scout',
      unit: 'cavalry',
      location: { x: 7, y: 8 },
    } as unknown as Dispatch;
    desk.viewedDispatch.set(report);
    TestBed.tick();
    expect(svc.plottable()).toBe(true);
    svc.plotReport();
    const first = g.fake.putMark.mock.calls[0]![0] as Mark;
    expect(first).toMatchObject({
      kind: 'pin',
      at: { x: 7, y: 8 },
      sourceReport: 'd1',
      label: 'cavalry',
    });
    g.fake.set({ marks: [first] });
    svc.plotReport();
    expect((g.fake.putMark.mock.calls[1]![0] as Mark).id).toBe(first.id);
  });

  it('reads the unit under the pointer for the umpire window, and a click pins it', () => {
    const { svc, desk, scene, canvas, p } = setup();
    desk.windowFrame.set({} as never);
    (scene.pickAt as ReturnType<typeof vi.fn>).mockReturnValue({
      type: 'piece',
      pieceKind: 'own',
      id: 'u1',
      coord: { x: 0, y: 0 },
    });
    svc.pointerMove(scene, p(0));
    expect(desk.windowHover()).toBe('u1');
    desk.windowHover.set(undefined);
    svc.pointerDown(scene, canvas, p(0));
    svc.pointerUp(scene, p(0));
    expect(desk.windowHover()).toBe('u1');
  });
});
