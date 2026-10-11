// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import { writable } from 'svelte/store';
import Clock from './Clock.svelte';
import TestHarness from './TestHarness.svelte';
import type { HqClock, SourceState } from '../../contracts';
import { projectGameTime } from '../../data/fixture';
import { clockDisplay, formatGameTime } from './presentation';

function source(
  clock: Partial<HqClock> = {},
  overrides: Partial<SourceState> = {},
  atGame = 60000,
): SourceState {
  return {
    connection: 'ready',
    stale: false,
    error: null,
    snapshot: {
      scope: { gameId: 'fixture', sideId: 'blue', playerId: 'one' },
      epoch: 'fixture',
      ordinal: 1,
      authorityRevision: null,
      atGame,
      roster: [],
      papers: [],
      pieces: [],
      clock: {
        authoritativeGameMs: atGame,
        receivedMonotonicMs: 100,
        coherence: 'fixture-atomic',
        rate: 1,
        status: 'running',
        mode: 'realtime',
        barrier: { kind: 'clear' },
        ...clock,
      },
    },
    ...overrides,
  };
}
let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
const flush = async () => {
  await tick();
  await tick();
};
beforeEach(() => {
  target = document.createElement('div');
  document.body.append(target);
});
afterEach(async () => {
  if (component) await unmount(component);
  component = null;
  target.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function render(
  state = source(),
  gameMs: number | null = 65000,
  kind: 'fixture' | 'live' = 'fixture',
  compact = false,
) {
  component = mount(Clock, { target, props: { state, kind, gameMs, compact } });
  await flush();
}
function field(label: string) {
  return [...target.querySelectorAll('dl > div')]
    .find((el) => el.querySelector('dt')?.textContent === label)
    ?.querySelector('dd')?.textContent;
}
const text = () => target.textContent?.replace(/\s+/g, ' ');
function expectTime(time: number) {
  expect(field('Game time')).toBe(formatGameTime(time));
}

describe('bounded clock DOM', () => {
  it('retains exact clock projection and anchor precision behind the floored display', async () => {
    const state = source({}, {}, 60007);
    expect(clockDisplay(state, 'fixture', 65009)).toEqual({
      time: 65009,
      eligible: true,
      projected: true,
    });
    expect(clockDisplay(state, 'fixture', 60006)).toEqual({
      time: 60007,
      eligible: true,
      projected: false,
    });
    expect(clockDisplay(source({ status: 'paused' }, {}, 60007), 'fixture', 65009)).toEqual({
      time: 60007,
      eligible: false,
      projected: false,
    });
    await render(state, 65009);
    expect(field('Game time')).toBe('00:01:05');
    expect(state.snapshot!.clock.authoritativeGameMs).toBe(60007);
  });
  it.each([1, 4, 12, 1000])(
    'uses parent projection at supplied rate %s without owning the ticker',
    async (rate) => {
      const state = source({ rate });
      const time = projectGameTime(state, 'fixture', 1100);
      await render(state, time);
      expectTime(60000 + 1000 * rate);
      expect(field('Supplied rate')).toBe(`${rate}:1`);
      expect(field('Supplied status')).toBe('running');
      expect(field('Mode')).toBe('realtime');
      expect(text()).toContain('Fixture clock');
      expect(text()).toContain('Shared parent display time');
      expect(target.querySelector('button')).toBeNull();
    },
  );
  it.each(['manual', 'fast-forward', 'unknown'] as const)(
    'freezes %s mode at the authoritative snapshot even when parent time is ahead',
    async (mode) => {
      const state = source({ mode });
      await render(state, 999999);
      expectTime(projectGameTime(state, 'fixture', state.snapshot!.clock.receivedMonotonicMs)!);
      expect(field('Mode')).toBe(mode);
      expect(text()).toContain('Frozen at supplied authoritative game time');
    },
  );
  it.each(['paused', 'stopped'] as const)('freezes supplied %s status', async (status) => {
    await render(source({ status, rate: 12 }), 999999);
    expectTime(60000);
    expect(field('Supplied status')).toBe(status);
    expect(field('Supplied rate')).toBe('12:1');
  });
  it.each([null, 60000, 90000])(
    'shows staff at work with supplied need time %s and freezes display',
    async (needAtGame) => {
      await render(source({ barrier: { kind: 'working', needAtGame } }), 999999);
      expectTime(60000);
      expect(text()).toContain('Staff at work');
      if (needAtGame === null) {
        expect(text()).toContain('Need time unavailable');
        expect(text()).not.toContain('Supplied need time:');
      } else expect(text()).toContain(`Supplied need time: ${formatGameTime(needAtGame)}.`);
    },
  );
  it.each([-1, NaN, Infinity, 1000])(
    'does not invent a usable barrier need time from invalid/pre-anchor %s',
    async (needAtGame) => {
      await render(source({ barrier: { kind: 'working', needAtGame } }), 999999);
      expectTime(60000);
      expect(text()).toContain('Need time unavailable');
      expect(text()).not.toContain('Supplied need time:');
    },
  );
  it('shows an explicit unknown barrier, with no assumption that staff finished', async () => {
    await render(source({ barrier: { kind: 'unknown' } }), 999999);
    expectTime(60000);
    expect(text()).toContain('Barrier unknown');
    expect(text()).not.toContain('Barrier clear');
    expect(text()).not.toContain('Staff at work');
  });
  it.each(['idle', 'opening', 'offline', 'error', 'disposed'] as const)(
    'shows %s connection and freezes retained snapshot',
    async (connection) => {
      await render(source({}, { connection, stale: true }), 999999);
      expectTime(60000);
      expect(field('Connection')).toBe(connection);
      expect(field('Freshness')).toBe('Stale observation');
      expect(text()).toContain('Frozen at supplied authoritative game time');
    },
  );
  it('freezes a stale observation even if connection is ready', async () => {
    await render(source({}, { stale: true }), 999999);
    expectTime(60000);
    expect(field('Connection')).toBe('ready');
    expect(field('Freshness')).toBe('Stale observation');
  });
  it.each(['fixture', 'live'] as const)(
    'shows absent snapshot as unavailable for %s without defaulting to zero',
    async (kind) => {
      await render(source({}, { connection: 'opening', snapshot: null }), 999999, kind);
      expect(field('Game time')).toBe('Time unavailable');
      expect(field('Supplied rate')).toBe('Unavailable');
      expect(field('Supplied status')).toBe('unknown');
      expect(field('Mode')).toBe('unknown');
      expect(text()).toContain('Barrier unknown');
      expect(field('Game time')).not.toBe('00:00:00');
    },
  );
  it.each([null, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, 59999])(
    'rejects absent/invalid/pre-anchor parent time %s and uses frozen fallback',
    async (gameMs) => {
      await render(source(), gameMs);
      expectTime(60000);
      expect(text()).toContain('Frozen at supplied authoritative game time');
    },
  );
  it.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'shows invalid authoritative time %s as unavailable even if parent value looks valid',
    async (authoritativeGameMs) => {
      await render(source({ authoritativeGameMs }), 999999);
      expect(field('Game time')).toBe('Time unavailable');
      expect(field('Game time')).not.toBe('00:00:00');
      expect(text()).not.toContain('Shared parent display time');
    },
  );
  it.each([0, -1, NaN, Infinity])('invalid rate %s cannot enable projection', async (rate) => {
    await render(source({ rate }), 999999);
    expectTime(60000);
    expect(field('Supplied rate')).toBe('Unavailable');
  });
  it.each([NaN, Infinity])(
    'invalid monotonic receipt %s cannot enable projection',
    async (receivedMonotonicMs) => {
      await render(source({ receivedMonotonicMs }), 999999);
      expectTime(60000);
      expect(text()).not.toContain('Shared parent display time');
    },
  );
  it('freezes unverified clocks and inconsistent snapshot anchors', async () => {
    const packet = writable({
      state: source({ coherence: 'unverified' }),
      kind: 'fixture' as const,
      gameMs: 999999,
    });
    component = mount(TestHarness, { target, props: { packet } });
    await flush();
    expectTime(60000);
    packet.set({ state: source({ authoritativeGameMs: 90000 }), kind: 'fixture', gameMs: 999999 });
    await flush();
    expectTime(90000);
    expect(text()).toContain('Frozen at supplied authoritative game time');
  });
  it('keeps live compact table mode frozen even if a fixture-shaped clock is passed', async () => {
    await render(source(), 999999, 'live', true);
    expectTime(60000);
    expect(target.querySelector('.compact')).not.toBeNull();
    expect(text()).toContain('Live clock observation');
    expect(text()).toContain('Live clock projection is unavailable');
    expect(text()).not.toContain('Shared parent display time');
    expect(field('Supplied rate')).toBe('1:1');
    expect(text()).toContain('Barrier clear in supplied observation');
    expect(target.querySelector('button')).toBeNull();
  });
  it('accepts genuine zero and formats elapsed game hours without treating them as wall dates', async () => {
    await render(source({}, {}, 0), 0);
    expectTime(0);
    expect(field('Game time')).toBe('00:00:00');
  });
  it('shows hours beyond 24 and floors visible seconds', async () => {
    await render(source({ mode: 'manual' }, {}, 90061007), null);
    expect(field('Game time')).toBe('25:01:01');
  });
  it('reacts to disconnect, barrier, resume and a newer anchor with no paused-duration catch-up', async () => {
    const packet = writable({
      state: source({ rate: 12 }),
      kind: 'fixture' as const,
      gameMs: 72000,
      compact: true,
    });
    component = mount(TestHarness, { target, props: { packet } });
    await flush();
    expectTime(72000);
    packet.set({
      state: source({ rate: 12 }, { connection: 'offline', stale: true }),
      kind: 'fixture',
      gameMs: 144000,
      compact: true,
    });
    await flush();
    expectTime(60000);
    const working = source(
      { rate: 12, barrier: { kind: 'working', needAtGame: 72000 } },
      {},
      72000,
    );
    packet.set({ state: working, kind: 'fixture', gameMs: 144000, compact: true });
    await flush();
    expectTime(72000);
    expect(text()).toContain('Staff at work');
    const resumed = source({ rate: 4, receivedMonotonicMs: 10000 }, {}, 72000);
    packet.set({
      state: resumed,
      kind: 'fixture',
      gameMs: projectGameTime(resumed, 'fixture', 10000)!,
      compact: true,
    });
    await flush();
    expectTime(72000);
    expect(text()).toContain('Barrier clear');
    packet.update((value) => ({ ...value, gameMs: projectGameTime(resumed, 'fixture', 11000)! }));
    await flush();
    expectTime(76000);
    const newer = source({ receivedMonotonicMs: 12000 }, {}, 100000);
    packet.set({ state: newer, kind: 'fixture', gameMs: 76000, compact: true });
    await flush();
    expectTime(100000);
  });
  it('manual and fast-forward follow only received anchors', async () => {
    const packet = writable({
      state: source({ mode: 'manual' }),
      kind: 'fixture' as const,
      gameMs: 999999,
    });
    component = mount(TestHarness, { target, props: { packet } });
    await flush();
    expectTime(60000);
    packet.set({ state: source({ mode: 'manual' }, {}, 120000), kind: 'fixture', gameMs: 999999 });
    await flush();
    expectTime(120000);
    packet.set({
      state: source({ mode: 'fast-forward', rate: 1000 }, {}, 3600000),
      kind: 'fixture',
      gameMs: 9999999,
    });
    await flush();
    expectTime(3600000);
    expect(field('Mode')).toBe('fast-forward');
  });
  it('has no timer, subscription or automatic advance between parent updates', async () => {
    vi.useFakeTimers();
    await render(source(), 65000);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(3600000);
    await flush();
    expectTime(65000);
    expect(vi.getTimerCount()).toBe(0);
    await unmount(component!);
    component = null;
    expect(vi.getTimerCount()).toBe(0);
  });
});
