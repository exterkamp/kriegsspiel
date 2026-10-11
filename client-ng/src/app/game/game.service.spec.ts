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
  send(): void {}
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
  afterEach(() => vi.unstubAllGlobals());

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

  it('closes the previous socket when connecting again', () => {
    const svc = TestBed.inject(GameService);
    svc.connect(loc('?game=a'));
    svc.connect(loc('?game=b'));
    expect(FakeSocket.all[0]!.closed).toBe(true);
    expect(FakeSocket.all).toHaveLength(2);
  });
});
