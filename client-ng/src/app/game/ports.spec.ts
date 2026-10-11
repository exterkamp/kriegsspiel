import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameService } from './game.service';
import { CONFERENCE_SENDER, ORDER_SENDER, PAUSE_ACTIONS } from './ports';

describe('injection tokens', () => {
  beforeEach(() => vi.stubGlobal('WebSocket', class {}));
  afterEach(() => vi.unstubAllGlobals());

  it('default to GameService and report a missing connection', () => {
    expect(
      TestBed.inject(ORDER_SENDER).send({
        text: 't',
        toName: 'n',
        courier: 'safe',
        eta: undefined,
      }),
    ).toMatch(/Not connected/);
    expect(TestBed.inject(CONFERENCE_SENDER)('q', 'chiefOfStaff', 'x')).toBe(false);
    expect(TestBed.inject(PAUSE_ACTIONS).vote('p', true)).toBe(false);
  });

  it('can be replaced', () => {
    const send = vi.fn(() => undefined);
    TestBed.configureTestingModule({ providers: [{ provide: ORDER_SENDER, useValue: { send } }] });
    TestBed.inject(ORDER_SENDER).send({ text: 't', toName: 'n', courier: 'fast', eta: 5 });
    expect(send).toHaveBeenCalledOnce();
    expect(TestBed.inject(GameService).state().pending).toHaveLength(0);
  });
});

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 1;
  onopen: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  sent: string[] = [];
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(d: string): void {
    this.sent.push(d);
  }
  close(): void {}
}

describe('ORDER_SENDER with a connection', () => {
  beforeEach(() => {
    FakeSocket.all = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    TestBed.inject(GameService).connect({
      protocol: 'http:',
      host: 'localhost:4200',
      search: '?game=g1',
    });
    FakeSocket.all[0]!.onopen?.({});
  });
  afterEach(() => {
    TestBed.inject(GameService).disconnect();
    vi.unstubAllGlobals();
  });

  it('maps the desk order onto the pending order (addressee, courier, ETA)', () => {
    const err = TestBed.inject(ORDER_SENDER).send({
      text: 'advance',
      toName: 'Ney',
      courier: 'fast',
      eta: 5,
    });
    expect(err).toBeUndefined();
    expect(FakeSocket.all[0]!.sent).toHaveLength(1);
    expect(FakeSocket.all[0]!.sent[0]).toContain('fast');
    const p = TestBed.inject(GameService).state().pending;
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ text: 'advance', toName: 'Ney', courier: 'fast', etaGame: 5 });
  });

  it('leaves etaGame absent when there is no estimate', () => {
    TestBed.inject(ORDER_SENDER).send({
      text: 'hold',
      toName: 'Soult',
      courier: 'safe',
      eta: undefined,
    });
    const p = TestBed.inject(GameService).state().pending[0]!;
    expect(p).toMatchObject({ toName: 'Soult', courier: 'safe' });
    expect('etaGame' in p).toBe(false);
  });
});
