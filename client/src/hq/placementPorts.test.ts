// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { createPlacementPorts, type PlacementEnvironment } from './placementPorts';
import { artwork, makePorts, ok, scope } from './shell/fakes';
import { createHqNavigation } from './shell/navigation';
import type { PersonalMarksController } from './data/marks';
function setup() {
  const ports = makePorts();
  let alive = true;
  let busy = false;
  const marks: PersonalMarksController = {
    scope,
    artwork,
    getState: () => ({
      phase: 'ready',
      marks: [],
      busy,
      dirty: false,
      writable: true,
      error: null,
    }),
    subscribe: () => () => {},
    initialize: async () => ok(undefined),
    create: vi.fn(() => ok(undefined)),
    edit: () => ok(undefined),
    remove: () => ok(undefined),
    save: async () => ok(undefined),
    reload: async () => ok(undefined),
    dispose: () => {},
  };
  const hub = document.createElement('div');
  const canvas = document.createElement('canvas');
  hub.append(canvas);
  document.body.append(hub);
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left: 10,
    top: 20,
    right: 110,
    bottom: 70,
    width: 100,
    height: 50,
    x: 10,
    y: 20,
    toJSON: () => ({}),
  });
  const navigation = createHqNavigation({
    surface: ports.surface,
    reducedMotion: () => true,
    focus: () => {},
  });
  let env: PlacementEnvironment | null = {
    hub,
    canvas,
    context: {
      surface: ports.surface,
      navigation,
      state: { scope, view: 'table', selection: { kind: 'none' } },
      sourceState: { connection: 'offline', stale: true, error: null, snapshot: ports.snapshot },
      capabilities: ports.source.capabilities,
      mapReady: true,
    },
  };
  const bridge = createPlacementPorts({
    scope,
    artwork,
    surface: ports.surface,
    marks,
    alive: () => alive,
    environment: () => env,
  });
  return {
    ...ports,
    bridge,
    marks,
    hub,
    canvas,
    getEnv: () => env!,
    setEnv: (next: PlacementEnvironment | null) => {
      env = next;
    },
    setBusy: (next: boolean) => {
      busy = next;
    },
    close: () => {
      alive = false;
      hub.remove();
    },
  };
}
it('refuses drops through panels and outside CSS bounds; forwards exact map picks', () => {
  const setup = setupPort();
  const { bridge, canvas, surface } = setup;
  const hit = vi.fn((): Element | null => canvas);
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hit });
  vi.mocked(surface.pickAt).mockReturnValue(ok({ kind: 'map', at: { x: 1200.25, y: 300.5 } }));
  expect(bridge.pickAt(40.5, 35.25)).toEqual(ok({ kind: 'map', at: { x: 1200.25, y: 300.5 } }));
  expect(surface.pickAt).toHaveBeenCalledWith(40.5, 35.25);
  hit.mockReturnValue(document.createElement('button'));
  expect(bridge.pickAt(40.5, 35.25)).toEqual(ok({ kind: 'none' }));
  hit.mockReturnValue(canvas);
  expect(bridge.pickAt(111, 35)).toEqual(ok({ kind: 'none' }));
  expect(surface.pickAt).toHaveBeenCalledOnce();
  setup.close();
});
function setupPort() {
  return setup();
}
it('requires settled presentation and writable marks, while approved stale knowledge stays usable', () => {
  const s = setup();
  expect(s.bridge.check('place').ok).toBe(true);
  s.setEnv({ ...s.getEnv(), context: { ...s.getEnv().context, mapReady: false } });
  expect(s.bridge.check('place').ok).toBe(false);
  expect(s.bridge.check('start').ok).toBe(true);
  s.setBusy(true);
  expect(s.bridge.check('start').ok).toBe(false);
  s.close();
  expect(s.bridge.check('start').ok).toBe(false);
});
it('creates directly from the frozen capture without navigation or Save after RAM commit', () => {
  const s = setup();
  const capture = { snapshot: structuredClone(s.snapshot), paperId: 'old-paper', gameMs: 10 };
  expect(s.bridge.createPin(capture, { x: 400.25, y: 900.5 }, 'Explicit point').ok).toBe(true);
  expect(s.marks.create).toHaveBeenCalledWith(
    {
      label: 'Explicit point',
      geometry: { kind: 'pin', at: { x: 400.25, y: 900.5 } },
      source: { kind: 'paper', paperId: 'old-paper' },
    },
    capture.snapshot,
    10,
  );
  expect(s.surface.transitionTo).not.toHaveBeenCalled();
  s.close();
});
it('owns recycled pointer captures so stale release cannot release a successor', () => {
  const s = setup();
  let held = false;
  Object.assign(s.hub, {
    setPointerCapture: vi.fn(() => {
      held = true;
    }),
    hasPointerCapture: vi.fn(() => held),
    releasePointerCapture: vi.fn(() => {
      held = false;
    }),
  });
  const first = s.bridge.capturePointer(7);
  const second = s.bridge.capturePointer(7);
  if (first.ok) first.value();
  expect(held).toBe(true);
  if (second.ok) second.value();
  expect(held).toBe(false);
  if (second.ok) second.value();
  expect(s.hub.releasePointerCapture).toHaveBeenCalledOnce();
  s.close();
});

it('releases a distinct obsolete pointer acquired before a reentrant successor', () => {
  const s = setup();
  const held = new Set<number>();
  let successor: ReturnType<typeof s.bridge.capturePointer> | null = null;
  Object.assign(s.hub, {
    setPointerCapture: (id: number) => {
      held.add(id);
      if (id === 7) successor = s.bridge.capturePointer(8);
    },
    hasPointerCapture: (id: number) => held.has(id),
    releasePointerCapture: (id: number) => {
      held.delete(id);
    },
  });
  const obsolete = s.bridge.capturePointer(7);
  if (obsolete.ok) obsolete.value();
  expect([...held]).toEqual([8]);
  const latest = successor as ReturnType<typeof s.bridge.capturePointer> | null;
  if (latest?.ok) latest.value();
  expect(held.size).toBe(0);
  s.close();
});
