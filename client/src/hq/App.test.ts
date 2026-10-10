// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import App from './App.svelte';
import { artwork, makePorts } from './shell/fakes';
let component: ReturnType<typeof mount> | null = null;
let target: HTMLDivElement;
const flush = async () => {
  for (let i = 0; i < 15; i++) {
    await Promise.resolve();
    await tick();
  }
};
afterEach(async () => {
  if (component) await unmount(component);
  component = null;
  target?.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('shares the parent display time between the compact table clock and roster and freezes on a barrier', async () => {
  vi.useFakeTimers();
  let sample = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => sample);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const ports = makePorts();
  Object.assign(ports.snapshot.clock, {
    receivedMonotonicMs: 1000,
    rate: 12,
    status: 'running',
    mode: 'realtime',
    barrier: { kind: 'clear' },
    coherence: 'fixture-atomic',
  });
  Object.assign(ports.snapshot, {
    roster: [
      {
        unitId: 'one',
        name: 'Clock formation',
        commander: { kind: 'unknown', reason: 'Unavailable' },
        position: { kind: 'snapshot', value: { x: 350, y: 250 }, atGame: 10 },
        strength: { kind: 'snapshot', value: 0, atGame: 10 },
        morale: { kind: 'unknown', reason: 'Unavailable' },
        supply: { kind: 'unknown', reason: 'Unavailable' },
      },
    ],
  });
  target = document.createElement('div');
  document.body.append(target);
  component = mount(App, { target, props: { ...ports, artwork } });
  await flush();
  expect(target.querySelector('[aria-label="HQ game clock"]')?.classList.contains('compact')).toBe(
    true,
  );
  sample = 1250;
  await vi.advanceTimersByTimeAsync(250);
  await flush();
  expect(target.querySelector('[aria-label="HQ game clock"]')?.textContent).toContain(
    '3010 game ms',
  );
  Array.from(target.querySelectorAll('button'))
    .find((button) => button.textContent?.includes('Roster'))!
    .click();
  await flush();
  expect(target.querySelector('[aria-label="HQ game clock"]')?.classList.contains('compact')).toBe(
    false,
  );
  expect(target.textContent).toContain('3 s old');
  const snapshot = {
    ...ports.snapshot,
    ordinal: 2,
    clock: { ...ports.snapshot.clock, barrier: { kind: 'working' as const, needAtGame: 10 } },
  };
  ports.emit({ connection: 'ready', stale: false, snapshot, error: null });
  await flush();
  expect(target.querySelector('[aria-label="HQ game clock"]')?.textContent).toContain('10 game ms');
  expect(target.textContent).toContain('Staff at work');
});
it('focuses a formation after navigation unmounts the roster and cancels on HQ teardown', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const ports = makePorts();
  const known = <T>(value: T) => ({ kind: 'snapshot' as const, value, atGame: 10 });
  Object.assign(ports.snapshot, {
    roster: [
      {
        unitId: 'one',
        name: 'First formation',
        commander: { kind: 'unknown', reason: 'Unavailable' },
        position: known({ x: 350, y: 250 }),
        strength: known(0),
        morale: known(1),
        supply: known(0.2),
      },
    ],
  });
  let focusSignal: AbortSignal | undefined;
  vi.mocked(ports.surface.focusAt).mockImplementation(async (_point, op) => {
    focusSignal = op.signal;
    return await new Promise((resolve) =>
      op.signal.addEventListener(
        'abort',
        () =>
          resolve({ ok: false, error: { code: 'aborted', message: 'Canceled', retry: 'never' } }),
        { once: true },
      ),
    );
  });
  target = document.createElement('div');
  document.body.append(target);
  component = mount(App, { target, props: { ...ports, artwork } });
  await flush();
  Array.from(target.querySelectorAll('button'))
    .find((button) => button.textContent?.includes('Roster'))!
    .click();
  await flush();
  const focus = Array.from(target.querySelectorAll('button')).find((button) =>
    button.getAttribute('aria-label')?.includes('First formation'),
  );
  expect(focus).toBeTruthy();
  focus!.click();
  await flush();
  expect(target.querySelector('h2')?.textContent).toBe('Map table');
  expect(ports.surface.focusAt).toHaveBeenCalledWith({ x: 350, y: 250 }, expect.anything());
  expect(focusSignal?.aborted).toBe(false);
  await unmount(component);
  component = null;
  expect(focusSignal?.aborted).toBe(true);
  expect(ports.surface.dispose).toHaveBeenCalledOnce();
});

it('keeps personal marks through source refresh, saves explicitly and restores them in the next HQ session', async () => {
  const { BrowserPersonalMarksRepository } = await import('./data/marks');
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const records = new Map<string, string>();
  const storage = {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => {
      records.set(key, value);
    },
  };
  let revision = 0;
  const ports = makePorts();
  target = document.createElement('div');
  document.body.append(target);
  const repository = new BrowserPersonalMarksRepository(
    ports.source.scope,
    artwork,
    () => storage,
    () => `marks-${++revision}`,
  );
  component = mount(App, { target, props: { ...ports, artwork, marksRepository: repository } });
  await flush();
  const panel = target.querySelector('[aria-label="Personal fixture marks"]')!;
  for (const [name, value] of Object.entries({ label: 'Road watch', x: '325.75', y: '815.125' })) {
    const input = panel.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  panel
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  expect(records.size).toBe(0);
  expect(vi.mocked(ports.surface.apply).mock.calls.at(-1)![0].marks[0]?.geometry).toEqual({
    kind: 'pin',
    at: { x: 325.75, y: 815.125 },
  });
  ports.emit({
    connection: 'ready',
    stale: false,
    snapshot: { ...ports.snapshot, ordinal: 2, atGame: 20 },
    error: null,
  });
  await flush();
  expect(vi.mocked(ports.surface.apply).mock.calls.at(-1)![0].marks[0]?.label).toBe('Road watch');
  Array.from(panel.querySelectorAll('button'))
    .find((b) => b.textContent === 'Save local marks')!
    .click();
  await flush();
  expect(records.size).toBe(1);
  await unmount(component);
  component = null;
  const next = makePorts();
  component = mount(App, {
    target,
    props: {
      ...next,
      artwork,
      marksRepository: new BrowserPersonalMarksRepository(
        next.source.scope,
        artwork,
        () => storage,
        () => `marks-${++revision}`,
      ),
    },
  });
  await flush();
  expect(vi.mocked(next.surface.apply).mock.calls.at(-1)![0].marks[0]?.label).toBe('Road watch');
  expect(target.textContent).toContain('No unsaved local mark changes.');
});

it('reports a late mark-focus failure in persistent session feedback after the mark panel unmounts', async () => {
  const { BrowserPersonalMarksRepository } = await import('./data/marks');
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const ports = makePorts();
  const saved = {
    schemaVersion: 1,
    scope: ports.source.scope,
    map: { id: artwork.id, revision: artwork.revision },
    revision: 'saved-1',
    marks: [
      {
        id: 'watch',
        scope: ports.source.scope,
        map: { id: artwork.id, revision: artwork.revision },
        label: 'Watch point',
        geometry: { kind: 'pin', at: { x: 325.75, y: 815.125 } },
        source: { kind: 'manual' },
        placedAtGame: null,
        editedAtGame: null,
      },
    ],
  };
  const repository = new BrowserPersonalMarksRepository(ports.source.scope, artwork, () => ({
    getItem: () => JSON.stringify(saved),
    setItem: () => {},
  }));
  target = document.createElement('div');
  document.body.append(target);
  let finish!: (result: import('./contracts').Result<void>) => void;
  vi.mocked(ports.surface.focusAt).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  component = mount(App, { target, props: { ...ports, artwork, marksRepository: repository } });
  await flush();
  target.querySelector<HTMLButtonElement>('[aria-label="Focus mark Watch point"]')!.click();
  await flush();
  Array.from(target.querySelectorAll('nav button'))
    .find((b) => b.textContent?.includes('Journal'))!
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flush();
  expect(target.querySelector('[aria-label="Personal fixture marks"]')).toBeNull();
  finish({
    ok: false,
    error: { code: 'internal', message: 'The map could not focus this mark.', retry: 'never' },
  });
  await flush();
  expect(target.querySelector('.session-feedback')?.textContent).toContain(
    'The map could not focus this mark.',
  );
});

it('plots only by explicit paper action and retains frozen provenance through later source refresh', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const ports = makePorts();
  const paper = {
    id: 'plot-paper',
    from: 'Plotting scout',
    category: 'scouts' as const,
    writtenAtGame: 0,
    receivedAtGame: 0,
    observedAtGame: null,
    location: { x: 1200.25, y: 300.5 },
    unitId: null,
    sizeEstimate: null,
    confidence: null,
    text: 'Older report, explicitly plotted.',
  };
  Object.assign(ports.snapshot, { papers: [paper] });
  const { BrowserPersonalMarksRepository } = await import('./data/marks');
  component = mount(App, {
    target: (target = document.body.appendChild(document.createElement('div'))),
    props: {
      ...ports,
      artwork,
      marksRepository: new BrowserPersonalMarksRepository(ports.source.scope, artwork, () => ({
        getItem: () => null,
        setItem: () => {},
      })),
    },
  });
  await flush();
  Array.from(target.querySelectorAll<HTMLButtonElement>('nav.desk button'))
    .find((b) => b.textContent?.includes('In-tray'))!
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flush();
  Array.from(target.querySelectorAll('button'))
    .find((b) => b.textContent?.includes('Open plot-paper'))!
    .click();
  await flush();
  expect(vi.mocked(ports.surface.apply).mock.calls.at(-1)![0].marks).toHaveLength(0);
  Array.from(target.querySelectorAll('button'))
    .find((b) => b.textContent?.trim() === 'Plot paper')!
    .click();
  await flush();
  expect(target.querySelector('h2')?.textContent).toBe('Map table');
  const plotted = vi.mocked(ports.surface.apply).mock.calls.at(-1)![0].marks[0]!;
  expect(plotted.geometry).toEqual({ kind: 'pin', at: paper.location });
  expect(plotted.source).toMatchObject({
    kind: 'paper',
    paperId: paper.id,
    writtenAtGame: 0,
    receivedAtGame: 0,
    observedAtGame: null,
    reportedLocation: paper.location,
    excerpt: paper.text,
  });
  ports.emit({
    connection: 'ready',
    stale: false,
    snapshot: {
      ...ports.snapshot,
      ordinal: 2,
      atGame: 20,
      clock: { ...ports.snapshot.clock, authoritativeGameMs: 20 },
      papers: [
        paper,
        {
          ...paper,
          id: 'newer-paper',
          writtenAtGame: 10,
          receivedAtGame: 20,
          text: 'Fresher prose.',
          location: { x: 1500, y: 700 },
        },
      ],
    },
    error: null,
  });
  await flush();
  expect(vi.mocked(ports.surface.apply).mock.calls.at(-1)![0].marks[0]).toEqual(plotted);
});

async function mountPlottingApp(beforeMount?: (ports: ReturnType<typeof makePorts>) => void) {
  const { BrowserPersonalMarksRepository } = await import('./data/marks');
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const ports = makePorts();
  const marksStorage = { getItem: () => null, setItem: vi.fn() };
  Object.assign(ports.snapshot, {
    papers: [
      {
        id: 'root-plot',
        from: 'Root scout',
        category: 'scouts',
        writtenAtGame: 0,
        receivedAtGame: 0,
        observedAtGame: null,
        location: { x: 1200.25, y: 300.5 },
        unitId: null,
        sizeEstimate: null,
        confidence: null,
        text: 'Captured report.',
      },
    ],
  });
  beforeMount?.(ports);
  target = document.body.appendChild(document.createElement('div'));
  component = mount(App, {
    target,
    props: {
      ...ports,
      artwork,
      marksRepository: new BrowserPersonalMarksRepository(
        ports.source.scope,
        artwork,
        () => marksStorage,
      ),
    },
  });
  await flush();
  Array.from(target.querySelectorAll<HTMLButtonElement>('nav.desk button'))
    .find((b) => b.textContent?.includes('In-tray'))!
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flush();
  Array.from(target.querySelectorAll('button'))
    .find((b) => b.textContent?.includes('Open root-plot'))!
    .click();
  await flush();
  return { ...ports, marksStorage };
}
it('creates one report mark when subsequent navigation fails and explains the partial result persistently', async () => {
  const ports = await mountPlottingApp();
  vi.mocked(ports.surface.transitionTo).mockResolvedValueOnce({
    ok: false,
    error: { code: 'internal', message: 'Map navigation failed.', retry: 'never' },
  });
  Array.from(target.querySelectorAll('button'))
    .find((b) => b.textContent?.trim() === 'Plot paper')!
    .click();
  await flush();
  expect(target.querySelector('h2')?.textContent).toBe('In-tray');
  expect(vi.mocked(ports.surface.apply).mock.calls.at(-1)![0].marks).toHaveLength(1);
  expect(target.querySelector('.session-feedback')?.textContent).toContain(
    'Report mark created locally.',
  );
  expect(target.querySelector('.session-feedback')?.textContent).toContain(
    'Map navigation failed.',
  );
});
it.each([false, true])(
  'preserves session plot feedback after panel teardown and ignores superseded focus (new action=%s)',
  async (supersede) => {
    const ports = await mountPlottingApp();
    let finish!: (result: import('./contracts').Result<void>) => void;
    vi.mocked(ports.surface.focusAt).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    Array.from(target.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === 'Plot paper')!
      .click();
    await flush();
    expect(target.querySelector('[aria-label="In-tray"]')).toBeNull();
    if (supersede) {
      target
        .querySelector<HTMLButtonElement>('[aria-label="Focus mark Root scout: report"]')!
        .click();
      await flush();
      expect(target.querySelector('.session-feedback')?.textContent).toContain(
        'Personal mark located',
      );
    }
    finish({
      ok: false,
      error: { code: 'internal', message: 'Old plot focus failed.', retry: 'never' },
    });
    await flush();
    expect(target.querySelector('.session-feedback')?.textContent).toContain(
      supersede ? 'Personal mark located' : 'Old plot focus failed.',
    );
    if (supersede)
      expect(target.querySelector('.session-feedback')?.textContent).not.toContain(
        'Old plot focus failed.',
      );
    expect(vi.mocked(ports.surface.apply).mock.calls.at(-1)![0].marks).toHaveLength(1);
  },
);

it('autosaves the last order keystroke across desk navigation without enabling signing', async () => {
  window.localStorage.clear();
  await mountPlottingApp();
  const navigate = async (label: string) => {
    Array.from(target.querySelectorAll<HTMLButtonElement>('nav.desk button'))
      .find((button) => button.textContent?.includes(label))!
      .click();
    await flush();
  };
  await navigate('Orders');
  const draft = target.querySelector<HTMLTextAreaElement>(
    '[aria-label="Local order draft"] textarea',
  )!;
  draft.value = 'Hold the bridge until further orders.';
  draft.dispatchEvent(new Event('input', { bubbles: true }));
  await flush();
  await navigate('Journal');
  expect(target.querySelector('[aria-label="Local order draft"]')).toBeNull();
  await navigate('Orders');
  expect(
    target.querySelector<HTMLTextAreaElement>('[aria-label="Local order draft"] textarea')!.value,
  ).toBe('Hold the bridge until further orders.');
  const sign = Array.from(target.querySelectorAll('button')).find(
    (button) => button.textContent === 'Sign and send',
  )!;
  expect(sign.disabled).toBe(true);
  window.localStorage.clear();
});

it('places a captured report at chosen keyboard coordinates after report refresh without saving automatically', async () => {
  const ports = await mountPlottingApp();
  Array.from(target.querySelectorAll('button'))
    .find((button) => button.textContent === 'Choose report coordinates')!
    .click();
  await flush();
  expect(target.querySelector('h2[data-heading]')?.textContent?.trim()).toBe('Map table');
  const panel = target.querySelector('[aria-label="Report placement"]')!;
  expect(document.activeElement).toBe(panel.querySelector('input[name="east"]'));
  const oldPaper = ports.snapshot.papers[0]!;
  ports.emit({
    connection: 'ready',
    stale: false,
    error: null,
    snapshot: {
      ...ports.snapshot,
      ordinal: 2,
      atGame: 20,
      clock: { ...ports.snapshot.clock, authoritativeGameMs: 20 },
      papers: [{ ...oldPaper, text: 'Fresher report text.', location: { x: 1500, y: 700 } }],
    },
  });
  await flush();
  for (const [name, value] of Object.entries({
    east: '400.25',
    south: '900.5',
    label: 'Chosen belief',
  })) {
    const input = panel.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  panel
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  const marks = vi.mocked(ports.surface.apply).mock.calls.at(-1)![0].marks;
  expect(marks).toHaveLength(1);
  expect(marks[0]!.geometry).toEqual({ kind: 'pin', at: { x: 400.25, y: 900.5 } });
  expect(marks[0]!.source).toMatchObject({
    paperId: 'root-plot',
    reportedLocation: { x: 1200.25, y: 300.5 },
    excerpt: 'Captured report.',
  });
  expect(marks[0]!.placedAtGame).toBe(10);
  expect(panel.textContent).toContain('Created locally; unsaved.');
  expect(ports.marksStorage.setItem).not.toHaveBeenCalled();
});

it('retains a captured drag across InTray teardown and commits only an exposed final CSS drop', async () => {
  const ports = await mountPlottingApp();
  const hub = target.querySelector<HTMLElement>('.hq')!;
  const canvas = target.querySelector('canvas')!;
  let capture = false;
  Object.assign(hub, {
    setPointerCapture: vi.fn(() => {
      capture = true;
    }),
    hasPointerCapture: vi.fn(() => capture),
    releasePointerCapture: vi.fn(() => {
      capture = false;
    }),
  });
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 800,
    bottom: 400,
    width: 800,
    height: 400,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => canvas });
  vi.mocked(ports.surface.pickAt).mockReturnValue({
    ok: true,
    value: { kind: 'map', at: { x: 2000.75, y: 800.25 } },
  });
  const pointer = (element: Element, type: string, x: number, y: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
      pointerId: 12,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      clientX: x,
      clientY: y,
    });
    element.dispatchEvent(event);
  };
  const handle = Array.from(target.querySelectorAll('button')).find(
    (button) => button.textContent === 'Drag report to map',
  )!;
  pointer(handle, 'pointerdown', 200, 150);
  await flush();
  expect(target.querySelector('[aria-label="In-tray"]')).toBeNull();
  expect(capture).toBe(true);
  pointer(hub, 'pointermove', 250, 180);
  pointer(hub, 'pointerup', 300, 190);
  await flush();
  expect(capture).toBe(false);
  expect(ports.surface.pickAt).toHaveBeenLastCalledWith(300, 190);
  expect(vi.mocked(ports.surface.apply).mock.calls.at(-1)![0].marks[0]!.geometry).toEqual({
    kind: 'pin',
    at: { x: 2000.75, y: 800.25 },
  });
  canvas.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      detail: 1,
      clientX: 300,
      clientY: 190,
    }),
  );
  await flush();
  expect(vi.mocked(ports.surface.apply).mock.calls.at(-1)![0].marks).toHaveLength(1);
  delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
});

it('keeps delayed preference restoration from moving a camera reserved by report placement', async () => {
  let complete!: () => void;
  const ports = await mountPlottingApp((p) => {
    const document = {
      ...p.getDocument(),
      camera: {
        mapId: artwork.id,
        mapRevision: artwork.revision,
        target: { x: 100, y: 100 },
        distanceM: 1000,
        azimuthRad: 0,
        tiltRad: 0,
      },
    };
    vi.mocked(p.repository.load).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = () => resolve({ ok: true, value: { document, durability: 'session-memory' } });
        }),
    );
  });
  Array.from(target.querySelectorAll('button'))
    .find((button) => button.textContent === 'Choose report coordinates')!
    .click();
  await flush();
  expect(target.querySelector('h2[data-heading]')?.textContent?.trim()).toBe('Map table');
  const restorations = vi.mocked(ports.surface.restoreCamera).mock.calls.length;
  complete();
  await flush();
  expect(ports.surface.restoreCamera).toHaveBeenCalledTimes(restorations);
  expect(target.querySelector('[aria-label="Report placement"]')?.textContent).toContain(
    'Choose a map contact',
  );
});
