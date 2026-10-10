// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import Roster from './Roster.svelte';
import { failure, formation, known, makePorts, ok, scope, snapshot, unknown } from './fakes';
import type { HqSnapshot, Result } from '../../contracts';
import { provenance, snapshotAge } from './presentation';

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
const flush = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
    await tick();
  }
};
const focusButton = (name = 'First formation') =>
  target.querySelector<HTMLButtonElement>(`button[aria-label="Focus ${name} on map table"]`)!;
beforeEach(() => {
  target = document.createElement('div');
  document.body.append(target);
});
afterEach(async () => {
  if (component) await unmount(component);
  component = null;
  target.remove();
});
async function render(
  value: HqSnapshot | null = snapshot(),
  props: { gameMs?: number | null; onFocusUnit?: (unitId: string) => Promise<Result<void>> } = {},
  ports = makePorts(),
) {
  component = mount(Roster, {
    target,
    props: { snapshot: value, ...ports, gameMs: 60000, ...props },
  });
  await flush();
  return ports;
}

describe('fixture roster', () => {
  it('shows separate missing and empty states with no invented formations', async () => {
    await render(null);
    expect(target.textContent).toContain('Waiting for a supplied snapshot');
    expect(target.querySelector('table')).toBeNull();
    await unmount(component!);
    component = null;
    await render(snapshot([]));
    expect(target.textContent).toContain('No own formations supplied');
    expect(target.querySelector('table')).toBeNull();
  });
  it('renders own roster only, snapshot provenance, and explicitly unavailable commanders/report dates', async () => {
    await render();
    expect(target.textContent).toContain('First formation');
    expect(target.textContent).not.toContain('Enemy contact');
    expect(target.textContent).toContain('Report dates unavailable');
    expect(target.textContent).toContain('Snapshot at 60000 game ms');
    expect(target.textContent).not.toContain('last-reported');
    expect(target.querySelectorAll('thead th')).toHaveLength(7);
    expect(target.querySelector('tbody th')?.getAttribute('scope')).toBe('row');
    expect(target.querySelector('tbody td')?.textContent).toContain('Unknown');
  });
  it('distinguishes unknown fields from zero strength, morale and supply', async () => {
    const missing = {
      ...formation('unknown', 'Unknown formation'),
      position: unknown<{ x: number; y: number }>(),
      strength: unknown<number>(),
      morale: unknown<number>(),
      supply: unknown<number>(),
    };
    const zero = {
      ...formation('zero', 'Zero formation'),
      strength: known(0),
      morale: known(0),
      supply: known(0),
    };
    await render(snapshot([missing, zero]));
    const rows = target.querySelectorAll('tbody tr');
    expect(Array.from(rows[0]!.querySelectorAll('td strong')).map((el) => el.textContent)).toEqual([
      'Unknown',
      'Unknown',
      'Unknown',
      'Unknown',
      'Unknown',
    ]);
    expect(
      Array.from(rows[1]!.querySelectorAll('td strong'))
        .slice(1, 4)
        .map((el) => el.textContent),
    ).toEqual(['0', '0%', '0%']);
    expect(focusButton('Unknown formation').disabled).toBe(true);
    expect(focusButton('Zero formation').disabled).toBe(false);
  });
  it.each([1, 12])(
    'uses supplied display time for stale snapshot ages at rate %s',
    async (rate) => {
      const value = snapshot();
      const display = value.atGame + 5000 * rate;
      await render(
        {
          ...value,
          clock: {
            ...value.clock,
            rate,
            status: 'running',
            mode: 'realtime',
            barrier: { kind: 'clear' },
          },
        },
        { gameMs: display },
      );
      expect(target.textContent).toContain(`${5 * rate} s old`);
      expect(target.querySelectorAll('.stale').length).toBeGreaterThan(0);
    },
  );
  it.each(['paused', 'manual', 'barrier'])(
    'freezes age at coordinator authoritative time for %s',
    async (mode) => {
      const value = snapshot();
      await render(
        {
          ...value,
          clock: {
            ...value.clock,
            rate: 12,
            mode: mode === 'manual' ? 'manual' : 'realtime',
            status: mode === 'paused' ? 'paused' : 'running',
            barrier:
              mode === 'barrier'
                ? { kind: 'working', needAtGame: value.atGame }
                : { kind: 'clear' },
          },
        },
        { gameMs: value.atGame },
      );
      expect(target.textContent).toContain('current snapshot');
      await new Promise((resolve) => setTimeout(resolve, 5));
      await flush();
      expect(target.textContent).not.toContain('s old');
    },
  );
  it('keeps unavailable display ages honest and uses per-field snapshot times', async () => {
    const row = { ...formation(), strength: known(100, 10000) };
    await render(snapshot([row]), { gameMs: 60000 });
    expect(target.textContent).toContain('Snapshot at 10000 game ms · 50 s old');
    expect(provenance(60000, null)).toContain('age unavailable');
    expect(snapshotAge(60000, 1)).toBeNull();
    expect(snapshotAge(60000, NaN)).toBeNull();
  });
  it('selects by scoped ID, waits for navigation, then focuses only the supplied position', async () => {
    const ports = await render();
    focusButton().focus();
    expect(document.activeElement).toBe(focusButton());
    focusButton().click();
    await flush();
    expect(ports.navigation.select).toHaveBeenCalledWith({ kind: 'unit', id: 'own-1', scope });
    expect(ports.navigation.navigate).toHaveBeenCalledWith('table', null, expect.anything());
    expect(ports.surface.focusAt).toHaveBeenCalledWith({ x: 350, y: 250 }, expect.anything());
    expect(vi.mocked(ports.navigation.select).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(ports.navigation.navigate).mock.invocationCallOrder[0]!,
    );
    expect(vi.mocked(ports.navigation.navigate).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(ports.surface.focusAt).mock.invocationCallOrder[0]!,
    );
    expect(target.textContent).toContain('focused at its supplied snapshot position');
    expect(ports.listeners.size).toBe(0);
  });
  it('rejects another player scope before displaying or selecting a formation', async () => {
    const value = { ...snapshot(), scope: { ...scope, playerId: 'other' } };
    const ports = await render(value);
    expect(target.textContent).toContain('different HQ sessions');
    expect(target.textContent).not.toContain('First formation');
    expect(ports.navigation.select).not.toHaveBeenCalled();
  });
  it.each(['selection', 'navigation', 'focus'] as const)(
    'shows %s failures and skips subsequent actions',
    async (stage) => {
      const ports = makePorts();
      if (stage === 'selection')
        vi.mocked(ports.navigation.select).mockReturnValue(failure('Selection unavailable'));
      if (stage === 'navigation')
        vi.mocked(ports.navigation.navigate).mockResolvedValue(failure('Navigation unavailable'));
      if (stage === 'focus')
        vi.mocked(ports.surface.focusAt).mockResolvedValue(failure('Focus unavailable'));
      await render(snapshot(), {}, ports);
      focusButton().click();
      await flush();
      expect(target.querySelector('[role="status"]')?.textContent).toContain('unavailable');
      if (stage !== 'focus') expect(ports.surface.focusAt).not.toHaveBeenCalled();
    },
  );
  it('shows loading, permits cancellation, and never focuses a canceled navigation', async () => {
    const ports = makePorts();
    vi.mocked(ports.navigation.navigate).mockImplementationOnce(
      (_view, _key, op) =>
        new Promise((resolve) =>
          op.signal.addEventListener('abort', () => resolve(failure('Canceled', 'aborted')), {
            once: true,
          }),
        ),
    );
    await render(snapshot(), {}, ports);
    focusButton().click();
    await flush();
    expect(target.textContent).toContain('Opening the map table');
    Array.from(target.querySelectorAll('button'))
      .find((el) => el.textContent === 'Cancel formation focus')!
      .click();
    await flush();
    expect(target.textContent).toContain('Formation focus canceled');
    expect(ports.surface.focusAt).not.toHaveBeenCalled();
    expect(ports.listeners.size).toBe(0);
  });
  it('aborts direct focus on teardown without disposing borrowed ports or accepting late completion', async () => {
    const ports = makePorts();
    let signal: AbortSignal | undefined;
    let complete: ((result: Result<void>) => void) | undefined;
    vi.mocked(ports.surface.focusAt).mockImplementationOnce((_at, op) => {
      signal = op.signal;
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    await render(snapshot(), {}, ports);
    focusButton().click();
    await flush();
    await unmount(component!);
    component = null;
    expect(signal?.aborted).toBe(true);
    expect(ports.listeners.size).toBe(0);
    complete?.(ok(undefined));
    await flush();
    expect(target.children.length).toBe(0);
    expect(ports.surface.dispose).not.toHaveBeenCalled();
    expect(ports.navigation.dispose).not.toHaveBeenCalled();
  });
  it('hands off to the session callback and ignores completion after roster teardown', async () => {
    let complete: ((result: Result<void>) => void) | undefined;
    const onFocusUnit = vi.fn(
      () =>
        new Promise<Result<void>>((resolve) => {
          complete = resolve;
        }),
    );
    const ports = await render(snapshot(), { onFocusUnit });
    focusButton().click();
    await flush();
    expect(onFocusUnit).toHaveBeenCalledWith('own-1');
    expect(ports.navigation.select).not.toHaveBeenCalled();
    expect(ports.surface.focusAt).not.toHaveBeenCalled();
    expect(target.textContent).not.toContain('Cancel formation focus');
    expect(focusButton().disabled).toBe(true);
    await unmount(component!);
    component = null;
    complete?.(ok(undefined));
    await flush();
    expect(target.children.length).toBe(0);
  });
  it('allows the root action to navigate, unmount the roster, and then focus with its session signal', async () => {
    const ports = makePorts();
    const rootSession = new AbortController();
    vi.mocked(ports.navigation.navigate).mockImplementationOnce(async (view) => {
      ports.emit({ ...ports.navigation.getState(), view });
      await unmount(component!);
      component = null;
      return ok(ports.navigation.getState());
    });
    const onFocusUnit = vi.fn(async (unitId: string): Promise<Result<void>> => {
      const selection = ports.navigation.select({ kind: 'unit', id: unitId, scope });
      if (selection.ok === false) return selection;
      const moved = await ports.navigation.navigate('table', null, { signal: rootSession.signal });
      if (moved.ok === false) return moved;
      return ports.surface.focusAt({ x: 350, y: 250 }, { signal: rootSession.signal });
    });
    await render(snapshot(), { onFocusUnit }, ports);
    focusButton().click();
    await flush();
    expect(rootSession.signal.aborted).toBe(false);
    expect(ports.surface.focusAt).toHaveBeenCalledWith(
      { x: 350, y: 250 },
      { signal: rootSession.signal },
    );
    expect(target.children.length).toBe(0);
  });
  it('supersedes a direct navigation before focusing the newest selected formation', async () => {
    const ports = makePorts();
    vi.mocked(ports.navigation.navigate).mockImplementationOnce(
      (_view, _key, op) =>
        new Promise((resolve) =>
          op.signal.addEventListener('abort', () => resolve(failure('Canceled', 'aborted')), {
            once: true,
          }),
        ),
    );
    const second = {
      ...formation('own-2', 'Second formation'),
      position: known({ x: 3100, y: 1200 }),
    };
    await render(snapshot([formation(), second]), {}, ports);
    focusButton().click();
    await flush();
    focusButton('Second formation').click();
    await flush();
    expect(ports.surface.focusAt).toHaveBeenCalledTimes(1);
    expect(ports.surface.focusAt).toHaveBeenCalledWith({ x: 3100, y: 1200 }, expect.anything());
    expect(target.textContent).toContain('Second formation focused');
    expect(ports.listeners.size).toBe(0);
  });
  it('surfaces a thrown callback failure without exposing its exception', async () => {
    const onFocusUnit = vi.fn(async (): Promise<Result<void>> => {
      throw new Error('private stack');
    });
    await render(snapshot(), { onFocusUnit });
    focusButton().click();
    await flush();
    expect(target.textContent).toContain('Formation focus failed');
    expect(target.textContent).not.toContain('private stack');
  });
  it.each(['aborted', 'internal'] as const)(
    'shows callback %s when still mounted',
    async (code) => {
      const onFocusUnit = vi.fn(async () => failure('Session focus unavailable', code));
      await render(snapshot(), { onFocusUnit });
      focusButton().click();
      await flush();
      expect(target.textContent).toContain(
        code === 'aborted' ? 'Formation focus canceled' : 'Session focus unavailable',
      );
    },
  );
});
