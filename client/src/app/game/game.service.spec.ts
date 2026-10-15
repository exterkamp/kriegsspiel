import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameService, GAME_BATTLEFIELD_LOADER, GAME_INFO_LOADER } from './game.service';
import { type fetchGame, type GameInfo } from '@legacy/lobby/api';
import { type fetchGameBattlefield, type GameBattlefield } from '@legacy/lobby/battlefield';
import { fixtureMap } from '@legacy/table/fixture';
const loadInfo = vi.fn<typeof fetchGame>();
const loadBattlefield = vi.fn<typeof fetchGameBattlefield>();
function info(
  id: string,
  umpire: GameInfo['umpire'] = { dial: 'standard', persona: 'dry' },
): GameInfo {
  return {
    id,
    scenario: 'hold-the-bridge',
    sides: [
      { side: 'blue', taken: true, ready: true },
      { side: 'red', taken: true, ready: true },
    ],
    umpire,
  } as GameInfo;
}
function terrain(id: string, width = 4000): GameBattlefield {
  return {
    gameId: id,
    scenarioId: 'hold-the-bridge',
    map: { ...structuredClone(fixtureMap), width, height: 3000 },
  } as GameBattlefield;
}
function defaults() {
  TestBed.configureTestingModule({
    providers: [
      { provide: GAME_INFO_LOADER, useValue: loadInfo },
      { provide: GAME_BATTLEFIELD_LOADER, useValue: loadBattlefield },
    ],
  });
  loadInfo.mockReset().mockImplementation(async (id) => info(id));
  loadBattlefield.mockReset().mockImplementation(async (id) => terrain(id));
}
async function socketAfter(svc: GameService, search = '?game=g1') {
  const count = FakeSocket.all.length;
  svc.connect(loc(search));
  expect(FakeSocket.all).toHaveLength(count);
  await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(count + 1));
  return FakeSocket.all.at(-1)!;
}

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  closed = false;
  onopen: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  sent: string[] = [];
  send(d: string): void {
    this.sent.push(d);
  }
  close(): void {
    this.closed = true;
  }
}

const loc = (search: string) => ({ protocol: 'http:', host: 'localhost:4200', search });

describe('GameService', () => {
  beforeEach(() => {
    defaults();
    FakeSocket.all = [];
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    TestBed.inject(GameService).disconnect();
    vi.unstubAllGlobals();
  });

  it('shows the offline fixture without a game id and opens no socket', () => {
    const svc = TestBed.inject(GameService);
    svc.connect(loc(''));
    expect(svc.state().link).toBe('offline');
    expect(svc.view()).toBeDefined();
    expect(FakeSocket.all).toHaveLength(0);
  });

  it('opens a socket after checked terrain, relays link status, and closes it on disconnect', async () => {
    const svc = TestBed.inject(GameService);
    await socketAfter(svc, '?game=abc');
    expect(svc.map()?.width).toBe(4000);
    expect(FakeSocket.all[0]!.url).toContain('battlefieldVersion=1');
    expect(FakeSocket.all[0]!.url).toContain('abc');
    FakeSocket.all[0]!.onopen?.({});
    expect(svc.state().link).toBe('open');
    svc.disconnect();
    expect(FakeSocket.all[0]!.closed).toBe(true);
  });

  it('knows a turn-mode game from its settings, also once it is over (#429)', async () => {
    const svc = TestBed.inject(GameService);
    loadInfo.mockResolvedValueOnce(
      info('t1', { dial: 'rigid', persona: 'dry', mode: 'turns', turnMinutes: 30 }),
    );
    svc.connect(loc('?game=t1'));
    await vi.waitFor(() => expect(svc.sides()).toEqual(['blue', 'red']));
    expect(svc.state()).toMatchObject({ turnMode: true, turnMinutes: 30 });
  });

  it('leaves a real-time game in real-time dress when its settings arrive', async () => {
    const svc = TestBed.inject(GameService);
    loadInfo.mockResolvedValueOnce({
      ...info('r1'),
      sides: [{ side: 'blue', taken: true, ready: true }],
    });
    svc.connect(loc('?game=r1'));
    await vi.waitFor(() => expect(svc.sides()).toEqual(['blue']));
    expect(svc.state().turnMode).toBeUndefined();
    expect(svc.state().turnMinutes).toBeUndefined();
  });

  it('closes the previous socket when connecting again', async () => {
    const svc = TestBed.inject(GameService);
    await socketAfter(svc, '?game=a');
    await socketAfter(svc, '?game=b');
    expect(FakeSocket.all[0]!.closed).toBe(true);
    expect(FakeSocket.all).toHaveLength(2);
  });
});

describe('GameService commands and page cache', () => {
  beforeEach(() => {
    defaults();
    FakeSocket.all = [];
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    TestBed.inject(GameService).disconnect();
    vi.unstubAllGlobals();
  });

  const open = async (svc: GameService, search = '?game=g1'): Promise<FakeSocket> => {
    const sock = await socketAfter(svc, search);
    sock.readyState = 1;
    sock.onopen?.({});
    return sock;
  };

  it('exposes the game id and clears it offline', () => {
    const svc = TestBed.inject(GameService);
    svc.connect(loc('?game=g1'));
    expect(svc.gameId()).toBe('g1');
    svc.connect(loc(''));
    expect(svc.gameId()).toBeUndefined();
  });

  it('refuses an order with no connection', () => {
    const svc = TestBed.inject(GameService);
    expect(svc.sendOrder('advance')).toMatch(/Not connected to a game/);
    expect(svc.proposeResume()).toBe(false);
    expect(svc.askStaff('q', 'chiefOfStaff', 'hi')).toBe(false);
  });

  it('sends an order and records it as pending with its extras', async () => {
    const svc = TestBed.inject(GameService);
    const sock = await open(svc);
    expect(svc.sendOrder('advance', { toName: 'Ney' }, 'fast')).toBeUndefined();
    expect(sock.sent).toHaveLength(1);
    expect(sock.sent[0]).toContain('advance');
    const p = svc.state().pending;
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ text: 'advance', toName: 'Ney' });
  });

  it('reports a down link and records nothing when the socket is not open', async () => {
    const svc = TestBed.inject(GameService);
    await socketAfter(svc);
    expect(svc.sendOrder('advance')).toMatch(/Not connected\. Try again/);
    expect(svc.state().pending).toHaveLength(0);
  });

  it('marks dispatches read and merges saved ones', () => {
    const svc = TestBed.inject(GameService);
    svc.markRead('a');
    svc.mergeRead(['b', 'c']);
    expect([...svc.state().read].sort()).toEqual(['a', 'b', 'c']);
  });

  it('stops on pagehide and restarts only on a persisted pageshow', async () => {
    const svc = TestBed.inject(GameService);
    await open(svc);
    window.dispatchEvent(new Event('pagehide'));
    expect(FakeSocket.all[0]!.closed).toBe(true);
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
    expect(FakeSocket.all).toHaveLength(1);
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    expect(FakeSocket.all).toHaveLength(2);
  });

  it('removes the page listeners on disconnect', async () => {
    const svc = TestBed.inject(GameService);
    await open(svc);
    svc.disconnect();
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    expect(FakeSocket.all).toHaveLength(1);
  });
});

describe('checked terrain connection lifetimes', () => {
  beforeEach(() => {
    defaults();
    FakeSocket.all = [];
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    TestBed.inject(GameService).disconnect();
    vi.unstubAllGlobals();
  });
  it('does not open a stream or retain old units before map validation, and retries failures', async () => {
    const svc = TestBed.inject(GameService);
    loadBattlefield.mockRejectedValueOnce(new Error('invalid map'));
    svc.connect(loc('?game=bad'));
    expect(svc.map()).toBeUndefined();
    expect(svc.mapLoading()).toBe(true);
    expect(svc.view()).toBeUndefined();
    expect(FakeSocket.all).toHaveLength(0);
    await vi.waitFor(() => expect(svc.mapError()).toMatch(/could not be loaded/));
    expect(FakeSocket.all).toHaveLength(0);
    expect(svc.map()).toBeUndefined();
    svc.retry();
    await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(1));
    expect(svc.mapError()).toBe('');
    expect(svc.mapLoading()).toBe(false);
  });
  it('ignores a stale resolution for a previous connection even when game IDs match', async () => {
    let resolve!: (value: GameBattlefield) => void;
    const late = new Promise<GameBattlefield>((r) => {
      resolve = r;
    });
    loadBattlefield.mockReturnValueOnce(late);
    const svc = TestBed.inject(GameService);
    svc.connect(loc('?game=same&side=blue'));
    const oldSignal = loadBattlefield.mock.calls[0]![1];
    await socketAfter(svc, '?game=same&side=red');
    expect(oldSignal.aborted).toBe(true);
    resolve(terrain('same', 9000));
    await late;
    await Promise.resolve();
    expect(svc.map()?.width).toBe(4000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(FakeSocket.all[0]!.url).toContain('side=red');
  });
  it('disconnect aborts pending loads and late old socket callbacks cannot alter another visit', async () => {
    const svc = TestBed.inject(GameService);
    const old = await socketAfter(svc, '?game=old');
    const signal = loadBattlefield.mock.calls[0]![1];
    svc.connect(loc(''));
    expect(signal.aborted).toBe(true);
    old.onopen?.({});
    old.onmessage?.({ data: JSON.stringify({ type: 'unrecognized' }) });
    expect(svc.state().link).toBe('offline');
    expect(svc.map()).toBe(fixtureMap);
  });
  it('rejects independently inconsistent game settings without opening a stream', async () => {
    loadInfo.mockResolvedValueOnce({ ...info('id'), scenario: 'foreign' });
    const svc = TestBed.inject(GameService);
    svc.connect(loc('?game=id'));
    await vi.waitFor(() => expect(svc.mapError()).not.toBe(''));
    expect(svc.map()).toBeUndefined();
    expect(FakeSocket.all).toHaveLength(0);
  });
});

describe('parallel map-load failure retirement', () => {
  beforeEach(() => {
    defaults();
    FakeSocket.all = [];
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    TestBed.inject(GameService).disconnect();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it.each(['terrain', 'info'])('aborts a pending sibling when %s fails first', async (which) => {
    let sibling: AbortSignal | undefined;
    const wait = (signal: AbortSignal) =>
      new Promise<never>((_resolve, reject) => {
        sibling = signal;
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
          once: true,
        });
      });
    if (which === 'terrain') {
      loadBattlefield.mockRejectedValueOnce(new Error('terrain failed'));
      loadInfo.mockImplementationOnce((_id, _fetch, signal) => wait(signal!));
    } else {
      loadInfo.mockRejectedValueOnce(new Error('info failed'));
      loadBattlefield.mockImplementationOnce((_id, signal) => wait(signal));
    }
    const svc = TestBed.inject(GameService);
    svc.connect(loc('?game=failed'));
    await vi.waitFor(() => expect(svc.mapError()).not.toBe(''));
    expect(sibling!.aborted).toBe(true);
    expect(svc.mapLoading()).toBe(false);
    expect(FakeSocket.all).toHaveLength(0);
  });
  it('aborts a stalled load at its deadline and does not expire a successful stream', async () => {
    vi.useFakeTimers();
    const svc = TestBed.inject(GameService);
    loadBattlefield.mockImplementationOnce(
      (_id, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('deadline', 'AbortError')),
            { once: true },
          ),
        ),
    );
    svc.connect(loc('?game=slow'));
    const stalled = loadBattlefield.mock.calls[0]![1];
    await vi.advanceTimersByTimeAsync(30000);
    expect(stalled.aborted).toBe(true);
    expect(svc.mapLoading()).toBe(false);
    expect(svc.mapError()).not.toBe('');
    expect(vi.getTimerCount()).toBe(0);
    svc.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeSocket.all).toHaveLength(1);
    const socket = FakeSocket.all[0]!;
    socket.readyState = 1;
    socket.onopen?.({});
    const accepted = loadBattlefield.mock.calls[1]![1];
    await vi.advanceTimersByTimeAsync(30000);
    expect(accepted.aborted).toBe(false);
    expect(svc.state().link).toBe('open');
    expect(vi.getTimerCount()).toBe(0);
    svc.disconnect();
    expect(accepted.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
