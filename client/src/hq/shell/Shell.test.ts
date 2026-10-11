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
const nativeShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const nativeClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
const flush = async () => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
    await tick();
  }
};
const button = (label: string) =>
  Array.from(target.querySelectorAll('button')).find((el) => el.textContent?.includes(label))!;
const heading = () => target.querySelector('main h2[data-heading]')?.textContent;
beforeEach(() => {
  target = document.createElement('div');
  document.body.append(target);
  // jsdom lacks native modal methods; only tests stub the browser's open/close lifecycle.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.open = true;
    }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    }),
  });
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
  for (const [method, descriptor] of [
    ['showModal', nativeShowModal],
    ['close', nativeClose],
  ] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, method, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, method);
  }
  vi.restoreAllMocks();
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
      expect(document.activeElement).toBe(target.querySelector('main h2[data-heading]'));
      expect(target.textContent).toContain('unavailable');
      button('Return to map table').click();
      await flush();
      expect(document.activeElement).toBe(initiating);
      expect(target.querySelector('canvas')).toBe(canvas);
    }
    expect(ports.surface.mount).toHaveBeenCalledTimes(1);
    expect(target.textContent).toContain('Fixture / demo');
    expect(target.textContent).not.toContain('Degraded legacy preview');
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
  it('opens labelled native Settings from the header and returns focus on explicit or native close', async () => {
    await render();
    const trigger = target.querySelector<HTMLButtonElement>('header button')!;
    expect(trigger.textContent).toBe('Settings');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    const dialog = target.querySelector('dialog')!;
    expect(dialog.open).toBe(false);
    expect(target.querySelector('footer')).toBeNull();
    expect(target.querySelector('header [role="status"]')).toBeNull();
    expect(target.querySelector('header')?.textContent).not.toContain('Preferences');
    trigger.focus();
    trigger.click();
    await flush();
    expect(dialog.showModal).toHaveBeenCalledOnce();
    expect(dialog.open).toBe(true);
    const title = target.querySelector(`#${dialog.getAttribute('aria-labelledby')}`);
    expect(title?.tagName).toBe('H2');
    expect(title?.textContent).toBe('Settings');
    const controls = dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(controls).toHaveLength(3);
    expect(
      Array.from(dialog.querySelectorAll('label')).map((label) => label.textContent?.trim()),
    ).toEqual(['Enable letter shortcuts (this session)', 'High contrast', 'Reduce motion']);
    expect(document.activeElement).toBe(controls[0]);
    expect(dialog.querySelector('[role="status"]')?.textContent).toContain('Preferences saved');
    button('Close settings').click();
    await flush();
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
    trigger.click();
    dialog.close();
    await flush();
    expect(document.activeElement).toBe(trigger);
  });
  it('leaves Escape to native dialog cancellation and isolates desk keys until closed', async () => {
    const ports = await render();
    button('Orders').click();
    await flush();
    button('Settings').click();
    await flush();
    const dialog = target.querySelector('dialog')!;
    const transitions = vi.mocked(ports.surface.transitionTo).mock.calls.length;
    for (const key of ['r', 'm', 'Escape']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      dialog.dispatchEvent(event);
      await flush();
      expect(event.defaultPrevented).toBe(false);
      expect(heading()).toBe('Orders');
      expect(dialog.open).toBe(true);
    }
    // The real browser supplies this default Escape action; jsdom has no native dialog lifecycle.
    const cancel = new Event('cancel', { cancelable: true });
    expect(dialog.dispatchEvent(cancel)).toBe(true);
    dialog.close();
    await flush();
    expect(document.activeElement).toBe(button('Settings'));
    expect(ports.surface.transitionTo).toHaveBeenCalledTimes(transitions);
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
    await flush();
    expect(heading()).toBe('Roster');
  });
  it('persists scoped contrast/motion choices while shortcuts reset for a new session', async () => {
    const ports = await render();
    button('Settings').click();
    const controls = target.querySelectorAll<HTMLInputElement>('dialog input');
    controls.forEach((control) => control.click());
    await flush();
    const saved = ports.getDocument();
    expect(saved).toMatchObject({ scope, highContrast: true, reducedMotion: true });
    expect(saved).not.toHaveProperty('letterShortcuts');
    expect(target.querySelector('.hq')?.classList.contains('high-contrast')).toBe(true);
    expect(target.querySelector('.hq')?.classList.contains('reduced-motion')).toBe(true);
    button('Close settings').click();
    button('Orders').click();
    await flush();
    expect(ports.surface.transitionTo).toHaveBeenLastCalledWith('desk', true, expect.anything());
    await unmount(component!);
    component = null;
    const next = makePorts();
    next.setDocument(ports.getDocument());
    await render(next);
    button('Settings').click();
    await flush();
    const restored = target.querySelectorAll<HTMLInputElement>('dialog input');
    expect(Array.from(restored).map((control) => control.checked)).toEqual([true, true, true]);
  });
  it('retains a closed-dialog save error and retries against the preserved revision', async () => {
    const ports = await render();
    const revision = ports.getDocument().revision;
    vi.mocked(ports.repository.save).mockResolvedValueOnce(fail('quota-exceeded'));
    button('Settings').click();
    const contrast = target.querySelectorAll<HTMLInputElement>('dialog input')[1]!;
    contrast.click();
    await flush();
    expect(ports.getDocument().revision).toBe(revision);
    expect(target.querySelector('dialog [role="status"]')?.textContent).toContain('quota-exceeded');
    button('Close settings').click();
    await flush();
    expect(target.querySelector('header .preference-notice')?.textContent).toContain(
      'Preferences not saved: quota-exceeded',
    );
    expect(target.querySelector('.hq')?.classList.contains('high-contrast')).toBe(true);
    button('Settings').click();
    contrast.click();
    contrast.click();
    await flush();
    expect(ports.getDocument().highContrast).toBe(true);
    expect(vi.mocked(ports.repository.save).mock.calls.at(-2)?.[1]).toBe(revision);
    button('Close settings').click();
    await flush();
    expect(target.querySelector('header .preference-notice')).toBeNull();
    expect(target.querySelector('dialog [role="status"]')?.textContent).toContain(
      'Preferences saved',
    );
    expect(target.querySelector('footer')).toBeNull();
  });
  it('keeps storage conflicts discoverable after closing and does not overwrite the competing revision', async () => {
    const ports = await render();
    const competing = { ...ports.getDocument(), revision: 'other-writer' };
    ports.setDocument(competing);
    button('Settings').click();
    target.querySelectorAll<HTMLInputElement>('dialog input')[1]!.click();
    await flush();
    button('Close settings').click();
    expect(target.querySelector('header .preference-notice')?.textContent).toContain('conflict');
    const calls = vi.mocked(ports.repository.save).mock.calls.length;
    button('Settings').click();
    target.querySelectorAll<HTMLInputElement>('dialog input')[2]!.click();
    await flush();
    expect(ports.repository.save).toHaveBeenCalledTimes(calls);
    expect(ports.getDocument()).toEqual(competing);
  });
  it('keeps focus inside open Settings when delayed navigation hands off to a destination', async () => {
    const ports = await render();
    let complete: ((result: Result<void>) => void) | undefined;
    vi.mocked(ports.surface.transitionTo).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    button('Roster').click();
    await flush();
    button('Settings').click();
    await flush();
    const first = target.querySelector('dialog input');
    complete!(ok(undefined));
    await flush();
    expect(heading()).toBe('Roster');
    expect(document.activeElement).toBe(first);
    button('Close settings').click();
    await flush();
    expect(document.activeElement).toBe(button('Settings'));
  });
  it('hands mouse and keyboard navigation to a semantic heading followed by the return action', async () => {
    await render();
    for (const input of ['mouse', 'keyboard']) {
      if (input === 'mouse') button('Roster').click();
      else target.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
      await flush();
      const destination = target.querySelector<HTMLElement>('main h2[data-heading="roster"]')!;
      expect(destination.tagName).toBe('H2');
      expect(destination.getAttribute('tabindex')).toBe('-1');
      expect(destination.getAttribute('role')).toBeNull();
      expect(destination.getAttribute('aria-expanded')).toBeNull();
      expect(document.activeElement).toBe(destination);
      const next = destination.nextElementSibling as HTMLButtonElement;
      expect(next.tagName).toBe('BUTTON');
      expect(next.textContent).toBe('Return to map table');
      expect(next.tabIndex).toBe(0);
      expect(target.querySelector('dialog')?.open).toBe(false);
      next.click();
      await flush();
    }
  });
  it('separates the source connection and snapshot timestamp without losing precise duration metadata', async () => {
    await render();
    const sourceLine = Array.from(target.querySelectorAll('header p')).find((p) =>
      p.textContent?.startsWith('Source:'),
    )!;
    expect(sourceLine.textContent).toBe('Source: ready · snapshot at 00:00:00');
    expect(sourceLine.querySelector('time')?.getAttribute('datetime')).toBe('PT0.01S');
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
    expect(target.querySelector('header .preference-notice')?.textContent).toContain(
      `Preferences unavailable: ${code}`,
    );
    expect(target.querySelector('dialog')?.open).toBe(false);
    expect(target.querySelector('footer')).toBeNull();
    button('Orders').click();
    await flush();
    expect(ports.repository.save).not.toHaveBeenCalled();
  });
  it('shows save failure, retaining the real repository revision', async () => {
    const ports = await render();
    vi.mocked(ports.repository.save).mockResolvedValue(fail('quota-exceeded'));
    button('Orders').click();
    await flush();
    expect(target.querySelector('header .preference-notice')?.textContent).toContain(
      'Preferences not saved: quota-exceeded',
    );
    expect(target.querySelector('footer')).toBeNull();
  });
  it('rolls back failed transition and keeps canvas/focus usable', async () => {
    const ports = await render();
    const canvas = target.querySelector('canvas');
    vi.mocked(ports.surface.transitionTo).mockResolvedValueOnce(fail('internal'));
    button('Orders').click();
    await flush();
    expect(heading()).toBe('Map table');
    expect(target.querySelector('header .error')?.textContent).toContain('internal');
    expect(target.querySelector('footer')).toBeNull();
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
    expect(document.activeElement).toBe(target.querySelector('main h2[data-heading]'));
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
    expect(target.querySelector('header time')?.getAttribute('datetime')).toBe('PT0.01S');
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
    expect(target.querySelector('header time')?.getAttribute('datetime')).toBe('PT0.02S');
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
    expect(target.querySelector('header time')?.getAttribute('datetime')).toBe('PT0.01S');
    expect(target.textContent).not.toContain('Pending formation');
    complete!(fail('invalid-data'));
    await flush();
    expect(target.querySelector('header time')?.getAttribute('datetime')).toBe('PT0.01S');
    expect(target.textContent).not.toContain('Pending formation');
    ports.emit({ connection: 'ready', stale: false, snapshot: candidate, error: null });
    await flush();
    expect(target.querySelector('header time')?.getAttribute('datetime')).toBe('PT0.02S');
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
    expect(target.querySelector('header time')?.getAttribute('datetime')).toBe('PT0.03S');
    expect(target.querySelector('header time')?.getAttribute('datetime')).not.toBe('PT0.02S');
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
    button('Settings').click();
    const contrast = Array.from(target.querySelectorAll('dialog label'))
      .find((label) => label.textContent?.includes('High contrast'))!
      .querySelector<HTMLInputElement>('input')!;
    const motion = Array.from(target.querySelectorAll('dialog label'))
      .find((label) => label.textContent?.includes('Reduce motion'))!
      .querySelector<HTMLInputElement>('input')!;
    contrast.click();
    contrast.click();
    motion.click();
    motion.click();
    button('Close settings').click();
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

it('lets players disable letter shortcuts while retaining keyboard buttons and Escape', async () => {
  await render();
  button('Settings').click();
  const setting = Array.from(target.querySelectorAll('dialog label'))
    .find((label) => label.textContent?.includes('Enable letter shortcuts'))!
    .querySelector<HTMLInputElement>('input')!;
  setting.click();
  button('Close settings').click();
  await flush();
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', bubbles: true }));
  await flush();
  expect(heading()).toBe('Map table');
  button('Orders').focus();
  button('Orders').click();
  await flush();
  expect(heading()).toBe('Orders');
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flush();
  expect(heading()).toBe('Map table');
  expect(document.activeElement).toBe(button('Orders'));
});
