import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameService } from './game.service';

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

  it('opens a socket for ?game, relays link status, and closes it on disconnect', () => {
    const svc = TestBed.inject(GameService);
    svc.connect(loc('?game=abc'));
    expect(FakeSocket.all).toHaveLength(1);
    expect(FakeSocket.all[0]!.url).toContain('abc');
    FakeSocket.all[0]!.onopen?.({});
    expect(svc.state().link).toBe('open');
    svc.disconnect();
    expect(FakeSocket.all[0]!.closed).toBe(true);
  });

  it('knows a turn-mode game from its settings, also once it is over (#429)', async () => {
    const info = (umpire: unknown) => ({
      ok: true,
      status: 200,
      json: async () => ({ sides: [{ side: 'blue' }, { side: 'red' }], umpire }),
    });
    const svc = TestBed.inject(GameService);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => info({ dial: 'rigid', persona: 'dry', mode: 'turns', turnMinutes: 30 })),
    );
    svc.connect(loc('?game=t1'));
    await vi.waitFor(() => expect(svc.sides()).toEqual(['blue', 'red']));
    expect(svc.state()).toMatchObject({ turnMode: true, turnMinutes: 30 });
  });

  it('leaves a real-time game in real-time dress when its settings arrive', async () => {
    const svc = TestBed.inject(GameService);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          sides: [{ side: 'blue' }],
          umpire: { dial: 'standard', persona: 'dry' },
        }),
      })),
    );
    svc.connect(loc('?game=r1'));
    await vi.waitFor(() => expect(svc.sides()).toEqual(['blue']));
    expect(svc.state().turnMode).toBeUndefined();
    expect(svc.state().turnMinutes).toBeUndefined();
  });

  it('closes the previous socket when connecting again', () => {
    const svc = TestBed.inject(GameService);
    svc.connect(loc('?game=a'));
    svc.connect(loc('?game=b'));
    expect(FakeSocket.all[0]!.closed).toBe(true);
    expect(FakeSocket.all).toHaveLength(2);
  });
});

describe('GameService commands and page cache', () => {
  beforeEach(() => {
    FakeSocket.all = [];
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    TestBed.inject(GameService).disconnect();
    vi.unstubAllGlobals();
  });

  const open = (svc: GameService, search = '?game=g1'): FakeSocket => {
    svc.connect(loc(search));
    const sock = FakeSocket.all.at(-1)!;
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

  it('sends an order and records it as pending with its extras', () => {
    const svc = TestBed.inject(GameService);
    const sock = open(svc);
    expect(svc.sendOrder('advance', { toName: 'Ney' }, 'fast')).toBeUndefined();
    expect(sock.sent).toHaveLength(1);
    expect(sock.sent[0]).toContain('advance');
    const p = svc.state().pending;
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ text: 'advance', toName: 'Ney' });
  });

  it('reports a down link and records nothing when the socket is not open', () => {
    const svc = TestBed.inject(GameService);
    svc.connect(loc('?game=g1'));
    expect(svc.sendOrder('advance')).toMatch(/Not connected\. Try again/);
    expect(svc.state().pending).toHaveLength(0);
  });

  it('marks dispatches read and merges saved ones', () => {
    const svc = TestBed.inject(GameService);
    svc.markRead('a');
    svc.mergeRead(['b', 'c']);
    expect([...svc.state().read].sort()).toEqual(['a', 'b', 'c']);
  });

  it('stops on pagehide and restarts only on a persisted pageshow', () => {
    const svc = TestBed.inject(GameService);
    open(svc);
    window.dispatchEvent(new Event('pagehide'));
    expect(FakeSocket.all[0]!.closed).toBe(true);
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
    expect(FakeSocket.all).toHaveLength(1);
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    expect(FakeSocket.all).toHaveLength(2);
  });

  it('removes the page listeners on disconnect', () => {
    const svc = TestBed.inject(GameService);
    open(svc);
    svc.disconnect();
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    expect(FakeSocket.all).toHaveLength(1);
  });
});
