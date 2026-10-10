// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRawSnippet, mount, tick, unmount } from 'svelte';
import Shell from './Shell.svelte';
import { artwork, fail, makePorts, ok, scope } from './fakes';
import { createHqNavigation } from './navigation';
import type { Operation, Result } from '../contracts';
import type { ShellViewContext } from './types';

let component: ReturnType<typeof mount> | null = null;
let target: HTMLDivElement;
const flush = async () => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
    await tick();
  }
};
const button = (label: string) =>
  Array.from(target.querySelectorAll('button')).find((el) => el.textContent?.includes(label))!;
const heading = () => target.querySelector('h2')?.textContent;
beforeEach(() => {
  target = document.createElement('div');
  document.body.append(target);
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
});
afterEach(async () => {
  if (component) await unmount(component);
  component = null;
  target.remove();
  vi.unstubAllGlobals();
});
async function render(ports = makePorts()) {
  component = mount(Shell, { target, props: { ...ports, artwork } });
  await flush();
  return ports;
}

function makeRunningClockPorts() {
  const ports = makePorts();
  const snapshot = {
    ...ports.snapshot,
    clock: {
      ...ports.snapshot.clock,
      status: 'running' as const,
      mode: 'realtime' as const,
      barrier: { kind: 'clear' as const },
    },
  };
  ports.emit({ connection: 'ready', stale: false, snapshot, error: null });
  vi.mocked(ports.source.open).mockResolvedValue(ok(snapshot));
  return { ...ports, snapshot };
}

describe('fixture desk DOM', () => {
  it('keeps one canvas through all desk routes and restores initiating object focus', async () => {
    const ports = await render();
    const canvas = target.querySelector('canvas');
    for (const label of [
      'In-tray',
      'Orders',
      'Roster',
      'Journal',
      'Conference',
      'Terrain studies',
      'Replay',
    ]) {
      const initiating = button(label);
      initiating.focus();
      initiating.click();
      await flush();
      expect(heading()).toBe(label);
      expect(document.activeElement).toBe(target.querySelector('h2'));
      expect(target.textContent).toContain('unavailable');
      button('Return to map table').click();
      await flush();
      expect(document.activeElement).toBe(initiating);
      expect(target.querySelector('canvas')).toBe(canvas);
    }
    expect(ports.surface.mount).toHaveBeenCalledTimes(1);
    expect(target.textContent).toContain('Fixture / demo');
    expect(target.textContent).toContain('Degraded legacy preview');
  });
  it('suppresses typing and modal shortcuts, and routes ordinary keys', async () => {
    await render();
    for (const tag of ['input', 'textarea', 'div']) {
      const input = document.createElement(tag);
      if (tag === 'div') input.setAttribute('contenteditable', 'true');
      target.append(input);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', bubbles: true }));
      await flush();
      expect(heading()).toBe('Map table');
      input.remove();
    }
    const dialog = document.createElement('dialog');
    dialog.open = true;
    target.append(dialog);
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', bubbles: true }));
    await flush();
    expect(heading()).toBe('Map table');
    dialog.remove();
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', bubbles: true }));
    await flush();
    expect(heading()).toBe('Orders');
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    expect(heading()).toBe('Map table');
  });
  it('shares only own selection with the map and clears removed IDs', async () => {
    const ports = await render();
    const select = target.querySelector('select')!;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'one']);
    select.value = 'one';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    button('Roster').click();
    await flush();
    expect(target.textContent).toContain('unit one');
    button('Return to map table').click();
    await flush();
    expect(vi.mocked(ports.surface.apply).mock.calls.at(-1)?.[0].selection).toEqual({
      kind: 'unit',
      id: 'one',
      scope,
    });
    ports.emit({
      connection: 'ready',
      stale: false,
      error: null,
      snapshot: { ...ports.snapshot, ordinal: 2, pieces: [] },
    });
    await flush();
    expect(target.textContent).toContain('Shared selection: none');
  });
  it('bounds presentation revisions with long selection IDs and scope fields', async () => {
    const longScope = {
      gameId: 'g'.repeat(128),
      sideId: 's'.repeat(128),
      playerId: 'p'.repeat(128),
    };
    const ports = await render(makePorts(longScope));
    const unitId = 'u'.repeat(124);
    const snapshot = {
      ...ports.snapshot,
      ordinal: 2,
      pieces: [{ ...ports.snapshot.pieces[0]!, key: `own:${unitId}`, unitId }],
    };
    ports.emit({ connection: 'ready', stale: false, snapshot, error: null });
    await flush();
    const before = vi.mocked(ports.surface.apply).mock.calls.at(-1)![0];
    const select = target.querySelector('select')!;
    select.value = unitId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    const selected = vi.mocked(ports.surface.apply).mock.calls.at(-1)![0];
    expect(selected.selection).toEqual({ kind: 'unit', id: unitId, scope: longScope });
    expect(selected.snapshot).toEqual({
      atGame: snapshot.atGame,
      epoch: snapshot.epoch,
      ordinal: 2,
    });
    expect(selected.revision).not.toBe(before.revision);
    for (const [presentation] of vi.mocked(ports.surface.apply).mock.calls) {
      expect(presentation.revision.length).toBeGreaterThan(0);
      expect(presentation.revision.length).toBeLessThanOrEqual(128);
    }
  });

  it('uses immediate reduced-motion transitions and suspends after the final desk frame', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }));
    const ports = await render();
    button('Orders').click();
    await flush();
    expect(ports.surface.transitionTo).toHaveBeenLastCalledWith('desk', true, expect.anything());
    expect(ports.surface.setActive).toHaveBeenLastCalledWith(false);
    button('Return to map table').click();
    await flush();
    expect(ports.surface.setActive).toHaveBeenLastCalledWith(true);
  });
  it.each([
    'storage-unavailable',
    'quota-exceeded',
    'invalid-data',
    'migration-required',
    'conflict',
  ] as const)('shows repository %s without overwriting rejected data', async (code) => {
    const ports = makePorts();
    vi.mocked(ports.repository.load).mockResolvedValue(fail(code));
    await render(ports);
    expect(target.textContent).toContain(`Preferences unavailable: ${code}`);
    button('Orders').click();
    await flush();
    expect(ports.repository.save).not.toHaveBeenCalled();
  });
  it('shows save failure, retaining the real repository revision', async () => {
    const ports = await render();
    vi.mocked(ports.repository.save).mockResolvedValue(fail('quota-exceeded'));
    button('Orders').click();
    await flush();
    expect(target.textContent).toContain('Preferences not saved: quota-exceeded');
  });
  it('rolls back failed transition and keeps canvas/focus usable', async () => {
    const ports = await render();
    const canvas = target.querySelector('canvas');
    vi.mocked(ports.surface.transitionTo).mockResolvedValueOnce(fail('internal'));
    button('Orders').click();
    await flush();
    expect(heading()).toBe('Map table');
    expect(target.textContent).toContain('internal');
    expect(target.querySelector('canvas')).toBe(canvas);
    expect(ports.surface.restoreCamera).toHaveBeenCalled();
    expect(ports.surface.setActive).toHaveBeenLastCalledWith(true);
  });
  it('aborts rapid navigation before the next transition and commits only the latest DOM', async () => {
    const ports = await render();
    vi.mocked(ports.surface.transitionTo).mockImplementationOnce(
      (_view, _motion, op) =>
        new Promise((resolve) =>
          op.signal.addEventListener('abort', () => resolve(fail('aborted')), { once: true }),
        ),
    );
    button('Orders').click();
    await flush();
    button('Journal').click();
    await flush();
    expect(heading()).toBe('Journal');
    expect(document.activeElement).toBe(target.querySelector('h2'));
    expect(ports.surface.mount).toHaveBeenCalledTimes(1);
  });
  it('disposes all ports and subscriptions without late DOM updates', async () => {
    const ports = await render();
    await unmount(component!);
    component = null;
    expect(ports.listeners.size).toBe(0);
    expect(ports.surface.dispose).toHaveBeenCalledTimes(1);
    expect(ports.source.dispose).toHaveBeenCalledTimes(1);
    expect(ports.repository.dispose).toHaveBeenCalledTimes(1);
    ports.emit({ connection: 'offline', stale: true, snapshot: ports.snapshot, error: null });
    await flush();
    expect(target.children.length).toBe(0);
  });
  it.each(['blue', 'red'])(
    'isolates both %s players and rejects mismatched ports',
    async (sideId) => {
      const ports = makePorts({ ...scope, sideId, playerId: 'two' });
      ports.repository = { ...ports.repository, scope };
      await render(ports);
      expect(target.textContent).toContain('different game, side or player');
      expect(ports.surface.mount).not.toHaveBeenCalled();
    },
  );
  it('renders a coordinator snippet without replacing the persistent canvas', async () => {
    const ports = makePorts();
    const view = createRawSnippet(() => ({ render: () => '<p>Integrated view component</p>' }));
    component = mount(Shell, { target, props: { ...ports, artwork, view } });
    await flush();
    const canvas = target.querySelector('canvas');
    button('Orders').click();
    await flush();
    expect(target.textContent).toContain('Integrated view component');
    expect(target.querySelector('canvas')).toBe(canvas);
  });
  it('keeps the coordinator clock slot in the persistent header on table and every desk route', async () => {
    const ports = makePorts();
    let currentContext: (() => ShellViewContext) | undefined;
    const disposedClock = vi.fn();
    const setupClock = vi.fn(() => disposedClock);
    const clock = createRawSnippet<[ShellViewContext]>((getContext) => {
      currentContext = getContext;
      return { render: () => '<p data-clock>Coordinator clock</p>', setup: setupClock };
    });
    component = mount(Shell, { target, props: { ...ports, artwork, clock } });
    await flush();
    const canvas = target.querySelector('canvas');
    const clockElement = target.querySelector('[data-clock]');
    expect(clockElement?.closest('header')).not.toBeNull();
    expect(currentContext!().state.view).toBe('table');
    for (const label of [
      'In-tray',
      'Orders',
      'Roster',
      'Journal',
      'Conference',
      'Terrain studies',
      'Replay',
      'Map table',
    ]) {
      button(label).click();
      await flush();
      expect(target.querySelector('[data-clock]')).toBe(clockElement);
      expect(target.querySelector('canvas')).toBe(canvas);
      expect(currentContext!().sourceState.snapshot).toEqual(ports.snapshot);
      expect(currentContext!().surface).toBe(ports.surface);
      expect(currentContext!().capabilities).toBe(ports.source.capabilities);
    }
    expect(setupClock).toHaveBeenCalledTimes(1);
    expect(disposedClock).not.toHaveBeenCalled();
    expect(ports.surface.mount).toHaveBeenCalledTimes(1);
    await unmount(component!);
    component = null;
    expect(disposedClock).toHaveBeenCalledTimes(1);
  });
  it('restores preferences and clears an unknown selected ID without using an obsolete map bookmark', async () => {
    const ports = makePorts();
    ports.setDocument({
      ...ports.getDocument(),
      view: 'roster',
      highContrast: true,
      selection: { kind: 'unit', id: 'missing', scope },
      camera: {
        mapId: artwork.id,
        mapRevision: 'old-map',
        target: { x: 0, y: 0 },
        distanceM: 1000,
        azimuthRad: 0,
        tiltRad: 0,
      },
    });
    await render(ports);
    expect(heading()).toBe('Roster');
    expect(target.textContent).toContain('Shared selection: none');
    expect(target.querySelector('.hq')?.classList.contains('high-contrast')).toBe(true);
    expect(ports.surface.restoreCamera).not.toHaveBeenCalled();
  });
  it('shows empty/offline/error source state while retaining a readable desk', async () => {
    const ports = await render();
    ports.emit({ connection: 'offline', stale: true, snapshot: ports.snapshot, error: null });
    await flush();
    expect(target.textContent).toContain('offline · stale snapshot');
    ports.emit({
      connection: 'error',
      stale: true,
      snapshot: null,
      error: { code: 'offline', message: 'Fixture read unavailable.', retry: 'read-only' },
    });
    await flush();
    expect(target.textContent).toContain('snapshot at 10 game ms');
    expect(target.textContent).toContain('stale snapshot');
    expect(target.textContent).toContain('Fixture read unavailable.');
    button('Orders').click();
    await flush();
    expect(heading()).toBe('Orders');
  });
  it.each([
    { epoch: 'different-epoch', ordinal: 3, atGame: 30 },
    { epoch: 'epoch', ordinal: 1, atGame: 30 },
    { epoch: 'epoch', ordinal: 3, atGame: 5 },
  ])('rejects obsolete desk data before publishing: %j', async (observation) => {
    const ports = await render();
    const fresh = {
      ...ports.snapshot,
      ordinal: 2,
      atGame: 20,
      pieces: [{ ...ports.snapshot.pieces[0]!, label: 'Accepted formation' }],
    };
    ports.emit({ connection: 'ready', stale: false, snapshot: fresh, error: null });
    await flush();
    const calls = vi.mocked(ports.surface.apply).mock.calls.length;
    ports.emit({
      connection: 'ready',
      stale: false,
      snapshot: {
        ...fresh,
        ...observation,
        pieces: [{ ...fresh.pieces[0]!, label: 'Obsolete formation' }],
      },
      error: null,
    });
    await flush();
    expect(target.textContent).toContain('snapshot at 20 game ms');
    expect(target.textContent).toContain('Accepted formation');
    expect(target.textContent).not.toContain('Obsolete formation');
    expect(ports.surface.apply).toHaveBeenCalledTimes(calls);
  });
  it('publishes candidate desk data only after successful map apply and retains prior data on failure', async () => {
    const ports = await render();
    let complete: ((result: Result<void>) => void) | undefined;
    vi.mocked(ports.surface.apply).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const candidate = {
      ...ports.snapshot,
      ordinal: 2,
      atGame: 20,
      pieces: [{ ...ports.snapshot.pieces[0]!, label: 'Pending formation' }],
    };
    ports.emit({ connection: 'ready', stale: false, snapshot: candidate, error: null });
    await flush();
    expect(target.textContent).toContain('snapshot at 10 game ms');
    expect(target.textContent).not.toContain('Pending formation');
    complete!(fail('invalid-data'));
    await flush();
    expect(target.textContent).toContain('snapshot at 10 game ms');
    expect(target.textContent).not.toContain('Pending formation');
    ports.emit({ connection: 'ready', stale: false, snapshot: candidate, error: null });
    await flush();
    expect(target.textContent).toContain('snapshot at 20 game ms');
    expect(target.textContent).toContain('Pending formation');
  });
  it('does not clear a selection for a candidate whose map apply fails', async () => {
    const ports = await render();
    const select = target.querySelector('select')!;
    select.value = 'one';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    vi.mocked(ports.surface.apply).mockResolvedValueOnce(fail('invalid-data'));
    ports.emit({
      connection: 'ready',
      stale: false,
      snapshot: { ...ports.snapshot, ordinal: 2, pieces: [] },
      error: null,
    });
    await flush();
    expect(target.textContent).toContain('Shared selection: unit one');
    expect(select.value).toBe('one');
  });
  it('ignores late application completion when a newer source observation is queued', async () => {
    const ports = await render();
    let complete: ((result: Result<void>) => void) | undefined;
    vi.mocked(ports.surface.apply).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    ports.emit({
      connection: 'ready',
      stale: false,
      snapshot: { ...ports.snapshot, ordinal: 2, atGame: 20 },
      error: null,
    });
    await flush();
    ports.emit({
      connection: 'ready',
      stale: false,
      snapshot: { ...ports.snapshot, ordinal: 3, atGame: 30 },
      error: null,
    });
    await flush();
    complete!(ok(undefined));
    await flush();
    expect(target.textContent).toContain('snapshot at 30 game ms');
    expect(target.textContent).not.toContain('snapshot at 20 game ms');
  });
  it.each(['deferred', 'immediate'] as const)(
    'publishes offline clock health before a %s renderer failure while retaining accepted knowledge',
    async (mode) => {
      const ports = makeRunningClockPorts();
      let context: (() => ShellViewContext) | undefined;
      const clock = createRawSnippet<[ShellViewContext]>((getContext) => {
        context = getContext;
        return { render: () => '<p>Clock health fixture</p>' };
      });
      component = mount(Shell, { target, props: { ...ports, artwork, clock } });
      await flush();
      expect(context!().sourceState.stale).toBe(false);
      let complete: ((result: Result<void>) => void) | undefined;
      if (mode === 'deferred')
        vi.mocked(ports.surface.apply).mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              complete = resolve;
            }),
        );
      else vi.mocked(ports.surface.apply).mockResolvedValueOnce(fail('invalid-data'));
      const sourceError = {
        code: 'offline' as const,
        message: 'Source disconnected.',
        retry: 'read-only' as const,
      };
      ports.emit({
        connection: 'offline',
        stale: true,
        snapshot: { ...ports.snapshot, ordinal: 2, atGame: 20 },
        error: sourceError,
      });
      await tick();
      expect(context!().sourceState).toMatchObject({
        connection: 'offline',
        stale: true,
        error: sourceError,
        snapshot: { ordinal: 1, atGame: 10 },
      });
      await flush();
      if (complete) complete(fail('invalid-data'));
      await flush();
      expect(context!().sourceState).toMatchObject({
        connection: 'offline',
        stale: true,
        error: sourceError,
        snapshot: { ordinal: 1, atGame: 10 },
      });
    },
  );
  it('freezes a newer ready clock/barrier observation until its current presentation succeeds', async () => {
    const ports = makeRunningClockPorts();
    let context: (() => ShellViewContext) | undefined;
    const clock = createRawSnippet<[ShellViewContext]>((getContext) => {
      context = getContext;
      return { render: () => '<p>Clock health fixture</p>' };
    });
    component = mount(Shell, { target, props: { ...ports, artwork, clock } });
    await flush();
    let complete: ((result: Result<void>) => void) | undefined;
    vi.mocked(ports.surface.apply).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const next = {
      ...ports.snapshot,
      ordinal: 2,
      atGame: 20,
      clock: {
        ...ports.snapshot.clock,
        authoritativeGameMs: 20,
        rate: 12,
        barrier: { kind: 'working' as const, needAtGame: 20 },
      },
    };
    ports.emit({ connection: 'ready', stale: false, snapshot: next, error: null });
    await flush();
    expect(context!().sourceState).toMatchObject({
      connection: 'ready',
      stale: true,
      snapshot: { ordinal: 1, clock: { rate: 1 } },
    });
    complete!(ok(undefined));
    await flush();
    expect(context!().sourceState).toMatchObject({
      connection: 'ready',
      stale: false,
      snapshot: { ordinal: 2, clock: { rate: 12, barrier: { kind: 'working' } } },
    });
  });
  it('does not allow a late ready apply to restore freshness after a newer offline renderer failure', async () => {
    const ports = makeRunningClockPorts();
    let context: (() => ShellViewContext) | undefined;
    const clock = createRawSnippet<[ShellViewContext]>((getContext) => {
      context = getContext;
      return { render: () => '<p>Clock health fixture</p>' };
    });
    component = mount(Shell, { target, props: { ...ports, artwork, clock } });
    await flush();
    let complete: ((result: Result<void>) => void) | undefined;
    vi.mocked(ports.surface.apply)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      )
      .mockResolvedValueOnce(fail('invalid-data'));
    ports.emit({
      connection: 'ready',
      stale: false,
      snapshot: { ...ports.snapshot, ordinal: 2, atGame: 20 },
      error: null,
    });
    await flush();
    ports.emit({
      connection: 'offline',
      stale: true,
      snapshot: { ...ports.snapshot, ordinal: 3, atGame: 30 },
      error: null,
    });
    await tick();
    expect(context!().sourceState).toMatchObject({
      connection: 'offline',
      stale: true,
      snapshot: { ordinal: 1 },
    });
    complete!(ok(undefined));
    await flush();
    expect(context!().sourceState).toMatchObject({
      connection: 'offline',
      stale: true,
      snapshot: { ordinal: 1 },
    });
  });
  it('uses the current source state when delayed preferences outlive a superseded open result', async () => {
    const ports = makeRunningClockPorts();
    let context: (() => ShellViewContext) | undefined;
    let finishLoad:
      ((result: Awaited<ReturnType<typeof ports.repository.load>>) => void) | undefined;
    vi.mocked(ports.repository.load).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLoad = resolve;
        }),
    );
    const clock = createRawSnippet<[ShellViewContext]>((getContext) => {
      context = getContext;
      return { render: () => '<p>Clock supersession fixture</p>' };
    });
    component = mount(Shell, { target, props: { ...ports, artwork, clock } });
    await flush();
    // open() has returned observation 1, while initialization is still awaiting load().
    const current = {
      ...ports.snapshot,
      ordinal: 2,
      atGame: 20,
      clock: { ...ports.snapshot.clock, authoritativeGameMs: 20 },
    };
    ports.emit({ connection: 'ready', stale: false, snapshot: current, error: null });
    await flush();
    expect(context!().sourceState).toMatchObject({
      connection: 'ready',
      stale: false,
      snapshot: { ordinal: 2 },
    });
    finishLoad!(ok({ document: ports.getDocument(), durability: 'session-memory' }));
    await flush();
    expect(context!().sourceState).toMatchObject({
      connection: 'ready',
      stale: false,
      error: null,
      snapshot: { ordinal: 2, atGame: 20 },
    });
    expect(target.textContent).not.toContain('Obsolete snapshot rejected');
    expect(vi.mocked(ports.surface.apply).mock.calls.at(-1)![0].snapshot.ordinal).toBe(2);
  });
  it.each(['ordinal', 'epoch', 'time', 'scope', 'conflict'] as const)(
    'rejects %s observations without overwriting accepted healthy clock metadata',
    async (kind) => {
      const ports = makeRunningClockPorts();
      let context: (() => ShellViewContext) | undefined;
      const clock = createRawSnippet<[ShellViewContext]>((getContext) => {
        context = getContext;
        return { render: () => '<p>Clock rejection fixture</p>' };
      });
      component = mount(Shell, { target, props: { ...ports, artwork, clock } });
      await flush();
      const current = {
        ...ports.snapshot,
        ordinal: 2,
        atGame: 20,
        clock: { ...ports.snapshot.clock, authoritativeGameMs: 20 },
      };
      ports.emit({ connection: 'ready', stale: false, snapshot: current, error: null });
      await flush();
      const calls = vi.mocked(ports.surface.apply).mock.calls.length;
      const invalid =
        kind === 'ordinal'
          ? { ...current, ordinal: 1 }
          : kind === 'epoch'
            ? { ...current, epoch: 'other', ordinal: 3 }
            : kind === 'time'
              ? { ...current, ordinal: 3, atGame: 5 }
              : kind === 'scope'
                ? { ...current, scope: { ...scope, playerId: 'other' }, ordinal: 3 }
                : { ...current, pieces: [] };
      ports.emit({
        connection: 'offline',
        stale: true,
        error: { code: 'offline', message: 'Rejected health claim', retry: 'read-only' },
        snapshot: invalid,
      });
      await flush();
      expect(context!().sourceState).toMatchObject({
        connection: 'ready',
        stale: false,
        error: null,
        snapshot: { ordinal: 2, atGame: 20 },
      });
      expect(ports.surface.apply).toHaveBeenCalledTimes(calls);
    },
  );
  it('keeps newer user view, selection and preference choices when repository load finishes late', async () => {
    const ports = makePorts();
    let complete: ((result: Awaited<ReturnType<typeof ports.repository.load>>) => void) | undefined;
    const saved = {
      ...ports.getDocument(),
      view: 'roster' as const,
      highContrast: true,
      reducedMotion: true,
    };
    ports.setDocument(saved);
    vi.mocked(ports.repository.load).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await render(ports);
    const select = target.querySelector('select')!;
    select.value = 'one';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    const contrast = target.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0]!;
    const motion = target.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]!;
    contrast.click();
    contrast.click();
    motion.click();
    motion.click();
    button('Orders').click();
    await flush();
    complete!(ok({ document: saved, durability: 'session-memory' }));
    await flush();
    expect(heading()).toBe('Orders');
    expect(target.textContent).toContain('Shared selection: unit one');
    expect(contrast.checked).toBe(false);
    expect(motion.checked).toBe(false);
    expect(ports.getDocument()).toMatchObject({
      view: 'orders',
      selection: { kind: 'unit', id: 'one' },
      highContrast: false,
      reducedMotion: false,
    });
  });
  it('restores untouched preferences but preserves the view chosen during a delayed load', async () => {
    const ports = makePorts();
    let complete: ((result: Awaited<ReturnType<typeof ports.repository.load>>) => void) | undefined;
    const saved = {
      ...ports.getDocument(),
      view: 'roster' as const,
      selection: { kind: 'unit' as const, id: 'one', scope },
      highContrast: true,
    };
    ports.setDocument(saved);
    vi.mocked(ports.repository.load).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await render(ports);
    button('Orders').click();
    await flush();
    complete!(ok({ document: saved, durability: 'session-memory' }));
    await flush();
    expect(heading()).toBe('Orders');
    expect(target.textContent).toContain('Shared selection: unit one');
    expect(target.querySelector('.hq')?.classList.contains('high-contrast')).toBe(true);
  });
  it('does not revive controls or DOM after disposal during a transition', async () => {
    const ports = await render();
    vi.mocked(ports.surface.transitionTo).mockImplementationOnce(
      (_view, _motion, op) =>
        new Promise((resolve) =>
          op.signal.addEventListener('abort', () => resolve(fail('aborted')), { once: true }),
        ),
    );
    button('Orders').click();
    await flush();
    const calls = vi.mocked(ports.surface.setActive).mock.calls.length;
    await unmount(component!);
    component = null;
    await flush();
    expect(ports.surface.setActive).toHaveBeenCalledTimes(calls);
    expect(target.children.length).toBe(0);
  });
});

it('navigation rejects cross-player selections, canceled operations and disposed requests', async () => {
  const ports = makePorts();
  const focus = vi.fn();
  const nav = createHqNavigation({ surface: ports.surface, reducedMotion: () => true, focus });
  expect(nav.select({ kind: 'unit', id: 'one', scope: { ...scope, playerId: 'two' } })).toEqual(
    fail('scope-mismatch', 'Selection belongs to another HQ session.'),
  );
  let complete: ((result: Result<void>) => void) | undefined;
  vi.mocked(ports.surface.transitionTo).mockImplementationOnce(
    (_view, _motion, op: Operation) =>
      new Promise((resolve) => {
        complete = resolve;
        op.signal.addEventListener('abort', () => resolve(fail('aborted')), { once: true });
      }),
  );
  const controller = new AbortController();
  const request = nav.navigate('orders', 'orders', { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  complete?.(ok(undefined));
  expect((await request).ok).toBe(false);
  expect(nav.getState().view).toBe('table');
  expect(focus).toHaveBeenCalledExactlyOnceWith('table', 'orders', expect.any(AbortSignal));
  nav.dispose();
  expect((await nav.navigate('table', null, { signal: controller.signal })).ok).toBe(false);
});
