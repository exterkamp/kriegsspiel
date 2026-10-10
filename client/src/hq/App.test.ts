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
