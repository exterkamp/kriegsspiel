// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminPage } from './admin.js';
import { adminToken, apiUrl, backoffMs, pickGame, panelForKey, stepPanel } from './model.js';

const games = [
  { id: 'aaaaaaaa-1', open: true, clock: { rate: 4 }, entries: 3 },
  { id: 'bbbbbbbb-2', open: false, entries: 0 },
];

class FakeES {
  static last: FakeES | undefined;
  static CLOSED = 2;
  readyState = 1;
  onopen?: () => void;
  onerror?: () => void;
  onmessage?: () => void;
  closed = false;
  constructor(public url: string) {
    FakeES.last = this;
  }
  close() {
    this.closed = true;
  }
}

const ok = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: async () => body }) as never;
const flush = () => vi.advanceTimersByTimeAsync(0);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('model', () => {
  it('moves between panels with wraparound and digit keys', () => {
    expect(stepPanel('State', -1)).toBe('Replay');
    expect(stepPanel('Replay', 1)).toBe('State');
    expect(panelForKey('3')).toBe('Requests');
    expect(panelForKey('9')).toBeUndefined();
    expect(panelForKey('x')).toBeUndefined();
  });
  it('keeps the selected game while it exists', () => {
    expect(pickGame(games, 'bbbbbbbb-2')).toBe('bbbbbbbb-2');
    expect(pickGame(games, 'gone')).toBe('aaaaaaaa-1');
    expect(pickGame([], 'x')).toBeUndefined();
  });
  it('builds admin URLs with the token, and backs off to a cap', () => {
    expect(adminToken('?token=abc')).toBe('abc');
    expect(apiUrl('games', 'abc')).toBe('/admin/api/games?token=abc');
    expect(apiUrl('games', undefined)).toBe('/admin/api/games');
    expect([0, 1, 2, 10].map(backoffMs)).toEqual([1000, 2000, 4000, 10_000]);
  });
});

describe('AdminPage', () => {
  function mount(fetchFn: typeof fetch) {
    vi.stubGlobal('EventSource', FakeES);
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="app"></div>';
    return new AdminPage(document.getElementById('app')!, '', fetchFn);
  }

  it('renders five empty panels and shows one at a time', () => {
    mount(vi.fn());
    const secs = [...document.querySelectorAll<HTMLElement>('section')];
    expect(secs.map((s) => s.dataset.panel)).toEqual([
      'State',
      'Events',
      'Requests',
      'LLM',
      'Replay',
    ]);
    expect(secs.filter((s) => !s.hidden)).toHaveLength(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '4' }));
    expect(secs.find((s) => !s.hidden)!.dataset.panel).toBe('LLM');
  });

  it('lists games, streams the first and goes live when the stream opens', async () => {
    const page = mount(vi.fn(() => ok({ games })));
    page.start();
    await flush();
    expect([...document.querySelectorAll('option')].map((o) => o.value)).toEqual([
      'aaaaaaaa-1',
      'bbbbbbbb-2',
    ]);
    expect(FakeES.last!.url).toBe('/admin/api/games/aaaaaaaa-1/stream');
    FakeES.last!.onopen!();
    expect(document.querySelector<HTMLElement>('#live')!.dataset.status).toBe('live');
    FakeES.last!.onerror!();
    expect(page.linkStatus).toBe('reconnecting');
    page.stop();
  });

  it('shows disabled on 404', async () => {
    const page = mount(vi.fn(() => Promise.resolve({ ok: false, status: 404 }) as never));
    page.start();
    await flush();
    expect(page.linkStatus).toBe('disabled');
    page.stop();
  });

  it('shows reconnecting when the server is down', async () => {
    const page = mount(vi.fn(() => Promise.reject(new Error('down'))) as never);
    page.start();
    await flush();
    expect(page.linkStatus).toBe('reconnecting');
    page.stop();
  });

  it('reopens the stream once the server is back', async () => {
    let up = false;
    const page = mount(
      vi.fn(() => (up ? ok({ games }) : Promise.reject(new Error('down')))) as never,
    );
    page.start();
    await flush();
    expect(page.linkStatus).toBe('reconnecting');
    up = true;
    await vi.advanceTimersByTimeAsync(1100);
    expect(FakeES.last!.url).toBe('/admin/api/games/aaaaaaaa-1/stream');
    page.stop();
  });

  it('reopens a live stream after the server goes down and comes back', async () => {
    let up = true;
    const page = mount(
      vi.fn(() => (up ? ok({ games }) : Promise.reject(new Error('down')))) as never,
    );
    page.start();
    await flush();
    const first = FakeES.last!;
    first.onopen!();
    expect(page.linkStatus).toBe('live');
    up = false;
    await vi.advanceTimersByTimeAsync(3000);
    expect(first.closed).toBe(true);
    expect(page.linkStatus).toBe('reconnecting');
    up = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeES.last).not.toBe(first);
    FakeES.last!.onopen!();
    expect(page.linkStatus).toBe('live');
    page.stop();
  });

  it('recovers from a 404 once the API is enabled', async () => {
    let status = 404;
    const page = mount(
      vi.fn(() =>
        status === 404 ? Promise.resolve({ ok: false, status }) : ok({ games }),
      ) as never,
    );
    page.start();
    await flush();
    expect(page.linkStatus).toBe('disabled');
    status = 200;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(page.linkStatus).toBe('connecting');
    page.stop();
  });

  it('stays on unauthorized after a 401', async () => {
    const fetchFn = vi.fn(() => Promise.resolve({ ok: false, status: 401 }) as never);
    const page = mount(fetchFn);
    page.start();
    await flush();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(page.linkStatus).toBe('unauthorized');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    page.stop();
  });

  it('reopens a stream the browser gave up on', async () => {
    const page = mount(vi.fn(() => ok({ games })));
    page.start();
    await flush();
    const first = FakeES.last!;
    first.readyState = FakeES.CLOSED;
    first.onerror!();
    expect(first.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(FakeES.last).not.toBe(first);
    page.stop();
  });

  it('shows connecting when switching to another game', async () => {
    const page = mount(vi.fn(() => ok({ games })));
    page.start();
    await flush();
    FakeES.last!.onopen!();
    expect(page.linkStatus).toBe('live');
    const picker = document.querySelector<HTMLSelectElement>('#game')!;
    picker.value = 'bbbbbbbb-2';
    picker.dispatchEvent(new Event('change'));
    expect(page.linkStatus).toBe('connecting');
    expect(FakeES.last!.url).toBe('/admin/api/games/bbbbbbbb-2/stream');
    page.stop();
  });

  it('loads the state of the selected game and refreshes it on stream entries', async () => {
    const stateBody = {
      id: 'aaaaaaaa-1',
      engine: { time: 1000, rng: 1, nextSeq: 1, queue: [], world: { seed: 5, units: [] } },
      sideViews: {},
    };
    const fetchFn = vi.fn((url: string) => ok(url.includes('/state') ? stateBody : { games }));
    const page = mount(fetchFn as never);
    page.start();
    await flush();
    expect(fetchFn).toHaveBeenCalledWith('/admin/api/games/aaaaaaaa-1/state');
    expect(document.querySelector('section[data-panel="State"]')!.textContent).toContain('1000 ms');
    stateBody.engine.time = 2000;
    FakeES.last!.onmessage!();
    await vi.advanceTimersByTimeAsync(300);
    expect(document.querySelector('section[data-panel="State"]')!.textContent).toContain('2000 ms');
    page.stop();
  });
});
