// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminPage } from './admin.js';
import {
  adminGame,
  adminToken,
  apiUrl,
  backoffMs,
  pickGame,
  panelForKey,
  stepPanel,
} from './model.js';

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
  onmessage?: (e: { data: string }) => void;
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
    expect(stepPanel('State', -1)).toBe('Orders');
    expect(stepPanel('Orders', 1)).toBe('State');
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
    expect(adminGame('?game=g%201&token=x')).toBe('g 1');
    expect(adminGame('')).toBeUndefined();
    expect(apiUrl('games', 'abc')).toBe('/admin/api/games?token=abc');
    expect(apiUrl('games', undefined)).toBe('/admin/api/games');
    expect([0, 1, 2, 10].map(backoffMs)).toEqual([1000, 2000, 4000, 10_000]);
  });
});

/** A trace frame that only signals "something changed"; the State panel refetches on any entry. */
const frame = () => ({ data: JSON.stringify({ seq: 1, ts: 1, kind: 'engine', data: {} }) });

describe('AdminPage', () => {
  function mount(fetchFn: typeof fetch, search = '') {
    vi.stubGlobal('EventSource', FakeES);
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="app"></div>';
    return new AdminPage(document.getElementById('app')!, search, fetchFn);
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
      'Orders',
    ]);
    expect(secs.filter((s) => !s.hidden)).toHaveLength(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '4' }));
    expect(secs.find((s) => !s.hidden)!.dataset.panel).toBe('LLM');
  });

  it('lists games, streams the first and goes live when the stream opens', async () => {
    const page = mount(vi.fn(() => ok({ games })));
    page.start();
    await flush();
    expect([...document.querySelectorAll('#game option')].map((o) => o.value)).toEqual([
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

  it('opens on the ?game= game when it is not the first (#387)', async () => {
    const page = mount(
      vi.fn(() => ok({ games })),
      '?game=bbbbbbbb-2',
    );
    page.start();
    await flush();
    expect(document.querySelector<HTMLSelectElement>('#game')!.value).toBe('bbbbbbbb-2');
    expect(FakeES.last!.url).toBe('/admin/api/games/bbbbbbbb-2/stream');
    page.stop();
  });

  it('falls back to the first game when ?game= is unknown (#387)', async () => {
    const page = mount(
      vi.fn(() => ok({ games })),
      '?game=gone',
    );
    page.start();
    await flush();
    expect(document.querySelector<HTMLSelectElement>('#game')!.value).toBe('aaaaaaaa-1');
    expect(FakeES.last!.url).toBe('/admin/api/games/aaaaaaaa-1/stream');
    page.stop();
  });

  it('fills the LLM panel from streamed entries and clears it on a game switch', async () => {
    const page = mount(vi.fn(() => ok({ games })));
    page.start();
    await flush();
    const msg = (seq: number, kind: string) => ({
      data: JSON.stringify({ seq, ts: 1, kind, data: { stage: 'judge', ok: true } }),
    });
    FakeES.last!.onmessage!(msg(1, 'llm'));
    FakeES.last!.onmessage!(msg(2, 'engine'));
    FakeES.last!.onmessage!({ data: 'not json' });
    const rows = () => document.querySelectorAll('section[data-panel="LLM"] tbody tr[data-seq]');
    expect(rows()).toHaveLength(1);
    const picker = document.querySelector<HTMLSelectElement>('#game')!;
    picker.value = 'bbbbbbbb-2';
    picker.dispatchEvent(new Event('change'));
    expect(rows()).toHaveLength(0);
    page.stop();
  });

  it('loads the replay timeline when the Replay tab is opened after picking a game', async () => {
    const fetchFn = vi.fn((url: string) =>
      ok(url.endsWith('/replay') ? { endMs: 1000, marks: [] } : { games }),
    );
    const page = mount(fetchFn as never);
    page.start();
    await flush();
    expect(fetchFn).not.toHaveBeenCalledWith('/admin/api/games/aaaaaaaa-1/replay');
    page.show('Replay');
    await flush();
    expect(fetchFn).toHaveBeenCalledWith('/admin/api/games/aaaaaaaa-1/replay');
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

  it('asks for the token after a 401, retries with it, and keeps it for the session', async () => {
    const fetchFn = vi.fn((url: string) =>
      url.includes('token=s3cret')
        ? ok({ games })
        : (Promise.resolve({ ok: false, status: 401 }) as never),
    );
    const page = mount(fetchFn as never);
    page.start();
    await flush();
    const form = document.querySelector<HTMLFormElement>('#tokenform')!;
    expect(form.hidden).toBe(false);
    document.querySelector<HTMLInputElement>('#token')!.value = ' s3cret ';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    const stored = sessionStorage.getItem('ks-admin-token');
    sessionStorage.clear();
    expect(fetchFn).toHaveBeenCalledWith('/admin/api/games?token=s3cret');
    expect(page.linkStatus).not.toBe('unauthorized');
    expect(form.hidden).toBe(true);
    expect(stored).toBe('s3cret');
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
    FakeES.last!.onmessage!(frame());
    await vi.advanceTimersByTimeAsync(300);
    expect(document.querySelector('section[data-panel="State"]')!.textContent).toContain('2000 ms');
    page.stop();
  });

  describe('state refresh races', () => {
    const body = (game: string, time: number) => ({
      id: game,
      engine: { time, rng: 1, nextSeq: 1, queue: [], world: { seed: 5, units: [] } },
      sideViews: {},
    });
    const panel = () => document.querySelector('section[data-panel="State"]')!;

    it('drops a slow response for a game that is no longer selected', async () => {
      let release!: (v: never) => void;
      const slow = new Promise<never>((r) => (release = r));
      const fetchFn = vi.fn((url: string) => {
        if (!url.includes('/state')) return ok({ games: [games[0], { ...games[1], open: true }] });
        return url.includes('aaaaaaaa-1') ? slow : ok(body('bbbbbbbb-2', 2222));
      });
      const page = mount(fetchFn as never);
      page.start();
      await flush();
      const picker = document.querySelector<HTMLSelectElement>('#game')!;
      picker.value = 'bbbbbbbb-2';
      picker.dispatchEvent(new Event('change'));
      await flush();
      expect(panel().textContent).toContain('2222 ms');
      release({ ok: true, status: 200, json: async () => body('aaaaaaaa-1', 1111) } as never);
      await flush();
      expect(panel().textContent).toContain('2222 ms');
      expect(panel().textContent).not.toContain('1111 ms');
      page.stop();
    });

    it('drops an older response that resolves after a newer one', async () => {
      const pending: Array<(v: never) => void> = [];
      let first = true;
      const fetchFn = vi.fn((url: string) => {
        if (!url.includes('/state')) return ok({ games });
        if (first) {
          first = false;
          return new Promise<never>((r) => pending.push(r));
        }
        return ok(body('aaaaaaaa-1', 3000));
      });
      const page = mount(fetchFn as never);
      page.start();
      await flush();
      FakeES.last!.onmessage!(frame());
      await vi.advanceTimersByTimeAsync(300);
      expect(panel().textContent).toContain('3000 ms');
      pending[0]!({ ok: true, status: 200, json: async () => body('aaaaaaaa-1', 1000) } as never);
      await flush();
      expect(panel().textContent).toContain('3000 ms');
      page.stop();
    });

    it('dims the last good state when a refresh fails, and clears it on recovery', async () => {
      let fail = false;
      const fetchFn = vi.fn((url: string) => {
        if (!url.includes('/state')) return ok({ games });
        return fail
          ? (Promise.resolve({ ok: false, status: 500 }) as never)
          : ok(body('aaaaaaaa-1', 1000));
      });
      const page = mount(fetchFn as never);
      page.start();
      await flush();
      const root = panel().querySelector('[data-stale]') ?? panel();
      expect(document.querySelector('[data-stale="true"]')).toBeNull();
      fail = true;
      FakeES.last!.onmessage!(frame());
      await vi.advanceTimersByTimeAsync(300);
      expect(document.querySelector('[data-stale="true"]')).not.toBeNull();
      expect(root.textContent).toContain('1000 ms');
      fail = false;
      FakeES.last!.onmessage!(frame());
      await vi.advanceTimersByTimeAsync(300);
      expect(document.querySelector('[data-stale="true"]')).toBeNull();
      page.stop();
    });
  });
});
