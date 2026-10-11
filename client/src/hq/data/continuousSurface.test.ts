// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapPresentation, PersonalMark } from '../contracts/index.js';
import { demoArtwork, demoScope, normalizeFixture } from './fixture.js';
import { fixtureView } from '../../table/fixture.js';
import { ContinuousSurface, inArtwork } from './continuousSurface.js';

const harness = vi.hoisted(() => ({ scenes: [] as unknown[] }));
vi.mock('../../table/FixtureTableScene.js', async () => {
  const THREE = await import('three');
  const { rayToMap } = await import('../../table/picking.js');
  class TableScene {
    readonly scene = new THREE.Scene();
    readonly camera = new THREE.PerspectiveCamera(45, 1, 20, 40000);
    readonly renderer = {
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
      render: vi.fn(),
    };
    readonly controls = {
      minDistance: 80,
      maxDistance: 10000,
      minPolarAngle: 0,
      maxPolarAngle: Math.PI * 0.42,
      target: new THREE.Vector3(),
      enabled: false,
      update: () => this.camera.lookAt(this.controls.target),
    };
    readonly dispose = vi.fn(() => {
      this.disposed = true;
      this.stop();
    });
    readonly apply = vi.fn();
    readonly setArtwork = vi.fn();
    running = false;
    renderOnStart = false;
    private disposed = false;
    private raf = 0;
    private generation = 0;
    constructor(readonly canvas: HTMLCanvasElement) {
      this.camera.position.set(0, 6000, 0.001);
      this.controls.update();
      harness.scenes.push(this);
    }
    start() {
      if (this.disposed || this.running) return;
      if (this.renderOnStart) {
        // Opt in to the real renderer's synchronous first frame and RAF lifetime.
        const generation = ++this.generation;
        const loop = () => {
          if (this.disposed || generation !== this.generation) return;
          this.controls.update();
          this.renderer.render(this.scene, this.camera);
          if (!this.disposed && generation === this.generation) {
            this.running = true;
            this.raf = requestAnimationFrame(loop);
          }
        };
        loop();
        return;
      }
      this.running = true;
    }
    stop() {
      this.generation++;
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.running = false;
    }
    snapTopDown() {
      this.camera.position.set(0, 6000, 0.001);
      this.controls.update();
    }
    snapOblique() {
      this.camera.position.set(0, 5000, 4000);
      this.controls.update();
    }
    resize(width = 800, height = 600, dpr = 1) {
      this.renderer.setPixelRatio(Math.min(dpr, 2));
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    pickAt(x: number, y: number) {
      const rect = this.canvas.getBoundingClientRect();
      this.camera.updateMatrixWorld();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          ((x - rect.left) / rect.width) * 2 - 1,
          (-(y - rect.top) / rect.height) * 2 + 1,
        ),
        this.camera,
      );
      const coord = rayToMap({ width: 4000, height: 3000, features: [] }, ray.ray);
      return coord ? { type: 'point', coord } : { type: 'none' };
    }
  }
  return { TableScene };
});
let autoLoad = true;
let latestImage: { onload: (() => void) | null } | null = null;
let frames: Map<number, FrameRequestCallback>;
const op = () => ({ signal: new AbortController().signal });
function presentation(ordinal = 1): MapPresentation {
  const raw = structuredClone(fixtureView);
  raw.lastKnownContacts = raw.lastKnownContacts.map((c) => ({
    ...c,
    ageMs: raw.atGame - c.observedAtGame,
  }));
  const s = normalizeFixture(raw, demoScope, 0, ordinal);
  return {
    scope: demoScope,
    revision: `p${ordinal}`,
    artwork: demoArtwork,
    mode: 'fixture-knowledge-preview',
    pieces: s.pieces,
    marks: [],
    selection: { kind: 'none' },
    snapshot: { atGame: s.atGame, epoch: s.epoch, ordinal },
  };
}
async function mounted() {
  const surface = new ContinuousSurface(demoScope);
  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    right: 810,
    bottom: 420,
    width: 800,
    height: 400,
    toJSON: () => ({}),
  });
  expect((await surface.mount(canvas, op())).ok).toBe(true);
  surface.resize(800, 400, 1);
  return { surface, canvas };
}
beforeEach(() => {
  harness.scenes.length = 0;
  autoLoad = true;
  latestImage = null;
  frames = new Map();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 1200;
      naturalHeight = 900;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        // Retain the fake browser resource to verify callback cleanup on disposal.
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        latestImage = this;
      }
      set src(value: string) {
        if (value && autoLoad) queueMicrotask(() => this.onload?.());
      }
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('continuous surface lifecycle', () => {
  it('restores the accepted scene when a newer presentation fails to restart', async () => {
    const { surface } = await mounted();
    const scene = harness.scenes[0] as {
      apply: ReturnType<typeof vi.fn>;
      renderOnStart: boolean;
      running: boolean;
      renderer: { render: ReturnType<typeof vi.fn> };
    };
    scene.renderOnStart = true;
    const accepted = presentation();
    const next = presentation(2);
    const newer = {
      ...next,
      pieces: next.pieces.map((piece, index) =>
        index === 0
          ? { ...piece, position: { ...piece.position, x: piece.position.x + 1 } }
          : piece,
      ),
    };
    expect((await surface.apply(accepted, op())).ok).toBe(true);
    const acceptedState = scene.apply.mock.calls.at(-1)![0];
    surface.setActive(false);
    scene.renderer.render.mockImplementationOnce(() => {
      throw new Error('Restart failed');
    });
    expect((await surface.apply(newer, op())).ok).toBe(false);
    expect(scene.apply.mock.calls.at(-1)![0]).toEqual(acceptedState);
    expect((await surface.apply(accepted, op())).ok).toBe(true);
    expect(surface.setActive(true).ok).toBe(true);
    expect(scene.apply.mock.calls.at(-1)![0]).toEqual(acceptedState);
    expect(scene.running).toBe(true);
    expect((await surface.apply(newer, op())).ok).toBe(true);
    expect(scene.apply.mock.calls.at(-1)![0]).not.toEqual(acceptedState);
    surface.dispose();
    expect(frames.size).toBe(0);
  });

  it.each(['abort', 'dispose'] as const)(
    'does not render after the final transition control callback %s',
    async (cancel) => {
      const { surface } = await mounted();
      await surface.apply(presentation(), op());
      const scene = harness.scenes[0] as {
        controls: { update: () => void };
        renderer: { render: ReturnType<typeof vi.fn> };
      };
      const controller = new AbortController();
      vi.spyOn(scene.controls, 'update')
        .mockImplementationOnce(() => {})
        .mockImplementationOnce(() => {
          if (cancel === 'abort') controller.abort();
          else surface.dispose();
        });
      const result = await surface.transitionTo('desk', true, { signal: controller.signal });
      expect(!result.ok && result.error.code).toBe(cancel === 'abort' ? 'aborted' : 'disposed');
      expect(scene.renderer.render).not.toHaveBeenCalled();
      expect(frames.size).toBe(0);
      surface.dispose();
    },
  );

  it('does not cache a failed initial activation and renders an identical retry', async () => {
    const { surface } = await mounted();
    const scene = harness.scenes[0] as {
      renderOnStart: boolean;
      running: boolean;
      renderer: { render: ReturnType<typeof vi.fn> };
    };
    scene.renderOnStart = true;
    scene.renderer.render.mockImplementationOnce(() => {
      throw new Error('Initial render failed');
    });
    const candidate = presentation();
    expect((await surface.apply(candidate, op())).ok).toBe(false);
    expect(scene.running).toBe(false);
    expect(frames.size).toBe(0);
    expect.soft(surface.getCamera().ok).toBe(false);
    expect((await surface.apply(candidate, op())).ok).toBe(true);
    expect(scene.renderer.render).toHaveBeenCalledTimes(2);
    expect(scene.running).toBe(true);
    expect(frames.size).toBe(1);
    surface.dispose();
    expect(frames.size).toBe(0);
  });

  it.each(['controls', 'render'] as const)(
    'returns disposed without caching or scheduling when initial activation disposes from %s',
    async (callback) => {
      const { surface } = await mounted();
      const scene = harness.scenes[0] as {
        renderOnStart: boolean;
        running: boolean;
        controls: { update: () => void };
        renderer: { render: ReturnType<typeof vi.fn> };
      };
      scene.renderOnStart = true;
      if (callback === 'controls')
        vi.spyOn(scene.controls, 'update').mockImplementationOnce(() => surface.dispose());
      else scene.renderer.render.mockImplementationOnce(() => surface.dispose());
      const candidate = presentation();
      const result = await surface.apply(candidate, op());
      expect(!result.ok && result.error.code).toBe('disposed');
      expect(surface.getCamera().ok).toBe(false);
      expect(scene.running).toBe(false);
      expect(frames.size).toBe(0);
      expect((await surface.apply(candidate, op())).ok).toBe(false);
    },
  );

  it.each(['abort', 'dispose'] as const)(
    'settles an intermediate control callback %s without another transition RAF',
    async (cancel) => {
      vi.spyOn(performance, 'now').mockReturnValue(100);
      const { surface } = await mounted();
      await surface.apply(presentation(), op());
      const scene = harness.scenes[0] as {
        camera: { position: import('three').Vector3 };
        controls: { target: import('three').Vector3; enabled: boolean; update: () => void };
        running: boolean;
      };
      const before = scene.camera.position.clone();
      const target = scene.controls.target.clone();
      const controller = new AbortController();
      const pending = surface.transitionTo('desk', false, { signal: controller.signal });
      let terminal = before;
      vi.spyOn(scene.controls, 'update').mockImplementationOnce(() => {
        expect(scene.camera.position).not.toEqual(before);
        if (cancel === 'abort') controller.abort();
        else surface.dispose();
        terminal = scene.camera.position.clone();
      });
      const [id, tick] = [...frames][0]!;
      frames.delete(id);
      tick(220); // Halfway through the 240 ms dolly, not its final frame.
      const result = await pending;
      expect(!result.ok && result.error.code).toBe(cancel === 'abort' ? 'aborted' : 'disposed');
      expect(frames.size).toBe(0);
      const requests = vi.spyOn(globalThis, 'requestAnimationFrame');
      tick(230); // A retained obsolete callback must also stay inert.
      expect(requests).not.toHaveBeenCalled();
      expect(scene.camera.position).toEqual(terminal);
      if (cancel === 'abort') {
        expect(scene.camera.position).toEqual(before);
        expect(scene.controls.target).toEqual(target);
        expect(scene.controls.enabled).toBe(true);
      } else {
        expect(scene.controls.enabled).toBe(false);
        expect(scene.running).toBe(false);
        expect(surface.getCamera().ok).toBe(false);
      }
      surface.dispose();
    },
  );

  it('keeps controls disabled when an update arrives during dolly and rejects time regression', async () => {
    const { surface } = await mounted();
    await surface.apply(presentation(), op());
    const controller = new AbortController();
    const pending = surface.transitionTo('desk', false, {
      signal: controller.signal,
    });
    expect((await surface.apply(presentation(2), op())).ok).toBe(true);
    const table = harness.scenes[0] as { controls: { enabled: boolean } };
    expect(table.controls.enabled).toBe(false);
    const regressed = presentation(3);
    const result = await surface.apply(
      {
        ...regressed,
        snapshot: {
          ...regressed.snapshot,
          atGame: regressed.snapshot.atGame - 1,
        },
        pieces: [],
      },
      op(),
    );
    expect(!result.ok && result.error.code).toBe('conflict');
    controller.abort();
    expect((await pending).ok).toBe(false);
    expect(table.controls.enabled).toBe(true);
    surface.dispose();
  });
  it('keeps one scene and the settled table camera across desk round trips', async () => {
    const { surface, canvas } = await mounted();
    expect((await surface.mount(canvas, op())).ok).toBe(false);
    expect((await surface.apply(presentation(), op())).ok).toBe(true);
    const before = surface.getCamera();
    expect((await surface.transitionTo('desk', true, op())).ok).toBe(true);
    expect(surface.getCamera()).toEqual(before);
    if (!before.ok) throw new Error('Missing bookmark');
    const changed = {
      ...before.value,
      target: { x: 1800, y: 700 },
      distanceM: 2400,
    };
    expect(surface.restoreCamera(changed).ok).toBe(true);
    const atDesk = surface.getCamera();
    expect(atDesk.ok).toBe(true);
    if (atDesk.ok) {
      expect(atDesk.value.target).toEqual(changed.target);
      expect(atDesk.value.mapRevision).toBe(changed.mapRevision);
      expect(atDesk.value.distanceM).toBeCloseTo(changed.distanceM, 8);
      expect(atDesk.value.tiltRad).toBeCloseTo(changed.tiltRad, 6);
    }
    expect((await surface.transitionTo('table', true, op())).ok).toBe(true);
    const restored = surface.getCamera();
    expect(restored.ok).toBe(true);
    if (restored.ok) {
      expect(restored.value.target).toEqual(changed.target);
      expect(restored.value.distanceM).toBeCloseTo(changed.distanceM);
    }
    expect(harness.scenes).toHaveLength(1);
    surface.dispose();
    surface.dispose();
    expect(surface.getCamera().ok).toBe(false);
    expect(
      (harness.scenes[0] as { dispose: ReturnType<typeof vi.fn> }).dispose,
    ).toHaveBeenCalledTimes(1);
  });
  it('rolls back cancelled dolly and stops pending callbacks on dispose', async () => {
    const { surface } = await mounted();
    await surface.apply(presentation(), op());
    const before = surface.getCamera();
    const controller = new AbortController();
    const transition = surface.transitionTo('desk', false, {
      signal: controller.signal,
    });
    expect(frames.size).toBe(1);
    controller.abort();
    expect((await transition).ok).toBe(false);
    expect(surface.getCamera()).toEqual(before);
    expect(frames.size).toBe(0);
    const pending = surface.transitionTo('desk', false, op());
    surface.dispose();
    const result = await pending;
    expect(!result.ok && result.error.code).toBe('disposed');
    expect(frames.size).toBe(0);
  });
  it.each([false, true])(
    'settles and restores the camera after a render failure (reduced=%s)',
    async (reduced) => {
      const { surface } = await mounted();
      await surface.apply(presentation(), op());
      const before = surface.getCamera();
      const scene = harness.scenes[0] as {
        renderer: { render: ReturnType<typeof vi.fn> };
        controls: { enabled: boolean };
      };
      scene.renderer.render.mockImplementationOnce(() => {
        throw new Error('renderer lost');
      });
      const pending = surface.transitionTo('desk', reduced, op());
      if (!reduced) {
        for (const [id, callback] of frames) {
          frames.delete(id);
          callback(performance.now() + 300);
        }
      }
      const result = await pending;
      expect(!result.ok && result.error.code).toBe('internal');
      expect(surface.getCamera()).toEqual(before);
      expect(scene.controls.enabled).toBe(true);
      expect(frames.size).toBe(0);
      expect((await surface.transitionTo('desk', true, op())).ok).toBe(true);
      surface.dispose();
    },
  );
  it('cancels artwork loading on disposal without committing or retaining callbacks', async () => {
    autoLoad = false;
    const { surface } = await mounted();
    const pending = surface.apply(presentation(), op());
    expect(latestImage?.onload).toBeTypeOf('function');
    surface.dispose();
    const result = await pending;
    expect(!result.ok && result.error.code).toBe('disposed');
    expect(latestImage?.onload).toBeNull();
    expect((harness.scenes[0] as { apply: ReturnType<typeof vi.fn> }).apply).not.toHaveBeenCalled();
  });
  it('does not publish success or restore presentation when disposal occurs during the scene commit', async () => {
    const { surface } = await mounted();
    const apply = (harness.scenes[0] as { apply: ReturnType<typeof vi.fn> }).apply;
    apply.mockImplementationOnce(() => surface.dispose());
    const result = await surface.apply(presentation(), op());
    expect(!result.ok && result.error.code).toBe('disposed');
    expect(surface.getCamera().ok).toBe(false);
    expect((await surface.apply(presentation(2), op())).ok).toBe(false);
  });
  it('validates personal marks and forwards only render geometry without scope or paper provenance', async () => {
    const { surface } = await mounted();
    const mark: PersonalMark = {
      id: 'mark-1',
      scope: demoScope,
      map: { id: demoArtwork.id, revision: demoArtwork.revision },
      label: '<script>plain label</script>',
      geometry: {
        kind: 'arrow',
        points: [
          { x: 325.75, y: 815.125 },
          { x: 1500.25, y: 1225.75 },
        ],
      },
      source: { kind: 'manual' },
      placedAtGame: null,
      editedAtGame: null,
    };
    const p = { ...presentation(), marks: [mark] };
    expect((await surface.apply(p, op())).ok).toBe(true);
    const apply = (harness.scenes[0] as { apply: ReturnType<typeof vi.fn> }).apply;
    const state = apply.mock.calls[0]![0];
    expect(state.marks).toEqual([{ id: mark.id, label: mark.label, geometry: mark.geometry }]);
    expect(Object.keys(state.marks[0]).sort()).toEqual(['geometry', 'id', 'label']);
    const invalid = [
      { ...mark, scope: { ...demoScope, playerId: 'other' } },
      { ...mark, map: { ...mark.map, revision: 'other' } },
      { ...mark, geometry: { kind: 'pin', at: { x: demoArtwork.widthM + 0.01, y: 100 } } },
      { ...mark, privateReliability: 'secret' },
    ];
    for (const bad of invalid)
      expect(
        (await surface.apply({ ...p, revision: 'changed', marks: [bad] as PersonalMark[] }, op()))
          .ok,
      ).toBe(false);
    expect(apply).toHaveBeenCalledTimes(1);
    expect((await surface.apply({ ...presentation(2), marks: [mark] }, op())).ok).toBe(true);
    expect(apply.mock.calls.at(-1)![0].marks[0].geometry).toEqual(mark.geometry);
    surface.dispose();
  });
  it('rejects hidden/malformed/stale presentations before changing the scene', async () => {
    const { surface } = await mounted();
    const p = presentation(2);
    expect((await surface.apply(p, op())).ok).toBe(true);
    const invalid = [
      { ...p, masterState: {} },
      { ...p, scope: { ...demoScope, playerId: 'other' } },
      { ...p, pieces: [...p.pieces, p.pieces[0]!] },
      {
        ...p,
        pieces: [
          {
            ...p.pieces[0]!,
            appearance: { ...p.pieces[0]!.appearance!, facingRad: NaN },
          },
        ],
      },
      {
        ...p,
        pieces: [
          {
            ...p.pieces[0]!,
            appearance: {
              ...p.pieces[0]!.appearance!,
              shape: [{ x: 1e9, y: 0 }],
            },
          },
        ],
      },
      {
        ...p,
        artwork: {
          ...demoArtwork,
          image: { ...demoArtwork.image, url: 'https://elsewhere.invalid/map' },
        },
      },
      presentation(1),
    ];
    for (const value of invalid)
      expect((await surface.apply(value as MapPresentation, op())).ok).toBe(false);
    expect((harness.scenes[0] as { apply: ReturnType<typeof vi.fn> }).apply).toHaveBeenCalledTimes(
      1,
    );
    const valid = presentation(3);
    const pieces = valid.pieces.map((piece, index) =>
      index === 0
        ? {
            ...piece,
            appearance: {
              ...piece.appearance!,
              shape: [
                { x: -10, y: -10 },
                { x: 10, y: 10 },
              ],
            },
          }
        : piece,
    );
    expect((await surface.apply({ ...valid, pieces }, op())).ok).toBe(true);
    surface.dispose();
  });
  it('round-trips CSS-pixel projection and metre picking on asymmetric bounds', async () => {
    const { surface } = await mounted();
    await surface.apply(presentation(), op());
    const at = { x: 1300, y: 530 };
    const projected = surface.project(at);
    if (!projected.ok || !projected.value) throw new Error('Expected visible point');
    const picked = surface.pickAt(projected.value.clientXCssPx, projected.value.clientYCssPx);
    if (!picked.ok || picked.value.kind !== 'map') throw new Error('Expected map pick');
    expect(picked.value.at.x).toBeCloseTo(at.x, 6);
    expect(picked.value.at.y).toBeCloseTo(at.y, 6);
    expect(inArtwork({ x: 4000, y: 3000 })).toBe(true);
    expect(inArtwork({ x: 4000.001, y: 3000 })).toBe(false);
    expect(surface.pickAt(9, 20)).toEqual({
      ok: true,
      value: { kind: 'none' },
    });
    surface.dispose();
  });
});

it('composes control leases across updates, transitions, rollback and terminal disposal', async () => {
  const { surface } = await mounted();
  await surface.apply(presentation(), op());
  const scene = harness.scenes[0] as { controls: { enabled: boolean }; running: boolean };
  const a = new AbortController();
  const first = surface.acquireControls({ signal: a.signal });
  const second = surface.acquireControls(op());
  expect(first.ok && second.ok).toBe(true);
  expect(scene.controls.enabled).toBe(false);
  expect(scene.running).toBe(true);
  await surface.apply(presentation(2), op());
  surface.setActive(true);
  expect(scene.controls.enabled).toBe(false);
  await surface.transitionTo('desk', true, op());
  expect(surface.pickAt(410, 220).ok).toBe(false);
  await surface.transitionTo('table', true, op());
  expect(scene.controls.enabled).toBe(false);
  a.abort();
  if (first.ok) first.value();
  expect(scene.controls.enabled).toBe(false);
  const transition = new AbortController();
  const moving = surface.transitionTo('desk', false, { signal: transition.signal });
  expect(surface.pickAt(410, 220).ok).toBe(false);
  transition.abort();
  expect((await moving).ok).toBe(false);
  expect(scene.controls.enabled).toBe(false);
  if (second.ok) second.value();
  expect(scene.controls.enabled).toBe(true);
  const third = surface.acquireControls(op());
  surface.dispose();
  if (third.ok) third.value();
  expect(scene.controls.enabled).toBe(false);
  expect(surface.acquireControls(op()).ok).toBe(false);
});

it('rejects camera gestures while placement owns controls and preaborted leases never lock', async () => {
  const { surface } = await mounted();
  await surface.apply(presentation(), op());
  const aborted = new AbortController();
  aborted.abort();
  expect(surface.acquireControls({ signal: aborted.signal }).ok).toBe(false);
  const lease = surface.acquireControls(op());
  expect(surface.snap('top-down').ok).toBe(false);
  expect((await surface.focusAt({ x: 1200, y: 600 }, op())).ok).toBe(false);
  expect(surface.pickAt(410, 220).ok).toBe(true);
  if (lease.ok) lease.value();
  expect(surface.snap('top-down').ok).toBe(true);
});

it('keeps transition readiness guarded through start and final render callbacks', async () => {
  const { surface } = await mounted();
  await surface.apply(presentation(), op());
  const scene = harness.scenes[0] as {
    start: () => void;
    controls: { enabled: boolean };
    renderer: { render: ReturnType<typeof vi.fn> };
  };
  const lease = surface.acquireControls(op());
  vi.spyOn(scene, 'start').mockImplementationOnce(() => {
    if (lease.ok) lease.value();
    expect(scene.controls.enabled).toBe(false);
    expect(surface.pickAt(410, 220).ok).toBe(false);
  });
  scene.renderer.render.mockImplementationOnce(() => {
    expect(surface.pickAt(410, 220).ok).toBe(false);
    expect(scene.controls.enabled).toBe(false);
  });
  expect((await surface.transitionTo('desk', true, op())).ok).toBe(true);
  expect(surface.pickAt(410, 220).ok).toBe(false);
  await surface.transitionTo('table', true, op());
  expect(scene.controls.enabled).toBe(true);
});
it('preserves a held lease through failed final rendering and refuses picks during delegated apply', async () => {
  const { surface } = await mounted();
  await surface.apply(presentation(), op());
  const scene = harness.scenes[0] as {
    apply: ReturnType<typeof vi.fn>;
    controls: { enabled: boolean };
    renderer: { render: ReturnType<typeof vi.fn> };
  };
  const lease = surface.acquireControls(op());
  scene.renderer.render.mockImplementationOnce(() => {
    throw new Error('renderer');
  });
  expect((await surface.transitionTo('desk', true, op())).ok).toBe(false);
  expect(scene.controls.enabled).toBe(false);
  scene.apply.mockImplementationOnce(() => {
    expect(surface.pickAt(410, 220).ok).toBe(false);
  });
  expect((await surface.apply(presentation(2), op())).ok).toBe(true);
  expect(scene.controls.enabled).toBe(false);
  if (lease.ok) lease.value();
  expect(scene.controls.enabled).toBe(true);
});

it('restores an inactive desk RAF and camera when start aborts synchronously', async () => {
  const { surface } = await mounted();
  await surface.apply(presentation(), op());
  await surface.transitionTo('desk', true, op());
  const before = surface.getCamera();
  const scene = harness.scenes[0] as {
    start: () => void;
    running: boolean;
    controls: { enabled: boolean };
  };
  const abort = new AbortController();
  vi.spyOn(scene, 'start').mockImplementationOnce(() => {
    scene.running = true;
    abort.abort();
  });
  const result = await surface.transitionTo('table', true, { signal: abort.signal });
  expect(result).toMatchObject({ ok: false, error: { code: 'aborted' } });
  expect(surface.getCamera()).toEqual(before);
  expect(scene.controls.enabled).toBe(false);
  expect(scene.running).toBe(false);
});
