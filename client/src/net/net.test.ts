// @vitest-environment jsdom
import { PROTOCOL_VERSION, type Dispatch, type ServerMessage } from '@kriegsspiel/protocol';
import { describe, expect, it } from 'vitest';
import { fixtureView } from '../table/fixture.js';
import { Hud, buildOrderText, clockText, orderPrefix } from '../hud/hud.js';
import { parseSession, wsUrl } from '../session.js';
import { GameConnection, type WebSocketLike } from './connection.js';
import {
  applyServerMessage,
  formatGameTime,
  gameNowMs,
  initialState,
  withPendingOrder,
  withRead,
} from './state.js';

const v = PROTOCOL_VERSION;
const disp = (id: string, extra: Partial<Dispatch> = {}): Dispatch => ({
  id,
  from: 'Lt. Weber',
  writtenAtGame: 60_000,
  receivedAtGame: 120_000,
  category: 'scouts',
  text: 'Enemy seen.',
  ...extra,
});

describe('applyServerMessage', () => {
  it('stores the view, merges its dispatches and anchors the clock', () => {
    const view = { ...fixtureView, dispatches: [disp('d1')] };
    const s = applyServerMessage(initialState, { v, kind: 'viewUpdate', view }, 1000);
    expect(s.view).toBe(view);
    expect(s.dispatches.map((d) => d.id)).toEqual(['d1']);
    expect(s.clock).toMatchObject({ gameMs: 3_600_000, localWallMs: 1000, status: 'paused' });
  });

  it('does not duplicate a dispatch that arrives twice (reconnect resends the view)', () => {
    let s = applyServerMessage(initialState, { v, kind: 'dispatch', dispatch: disp('d1') }, 0);
    s = applyServerMessage(s, { v, kind: 'dispatch', dispatch: disp('d1') }, 0);
    s = applyServerMessage(
      s,
      { v, kind: 'viewUpdate', view: { ...fixtureView, dispatches: [disp('d1'), disp('d2')] } },
      0,
    );
    expect(s.dispatches.map((d) => d.id).sort()).toEqual(['d1', 'd2']);
  });

  it('follows clockState changes and staff-at-work', () => {
    let s = applyServerMessage(
      initialState,
      {
        v,
        kind: 'clockState',
        clock: { gameMsAtAnchor: 5000, wallMsAtAnchor: 1, rate: 12, status: 'running' },
      },
      200,
    );
    expect(s.clock).toEqual({ gameMs: 5000, localWallMs: 200, rate: 12, status: 'running' });
    s = applyServerMessage(s, { v, kind: 'staffAtWork', working: true }, 0);
    expect(s.staffAtWork).toBe(true);
  });

  it('drops the pending order a rejection names and keeps a notice', () => {
    let s = withPendingOrder(initialState, { orderId: 'o1', text: 'x', sentAtGame: 0 });
    s = withPendingOrder(s, { orderId: 'o2', text: 'y', sentAtGame: 0 });
    const m: ServerMessage = {
      v,
      kind: 'error',
      code: 'order_rejected',
      message: 'o1: no such unit',
    };
    s = applyServerMessage(s, m, 0);
    expect(s.pending.map((p) => p.orderId)).toEqual(['o2']);
    expect(s.notices[0]?.message).toBe('o1: no such unit');
  });
});

describe('clock', () => {
  it('runs forward at the rate while running, and holds while paused', () => {
    expect(gameNowMs({ gameMs: 1000, localWallMs: 0, rate: 12, status: 'running' }, 500)).toBe(
      7000,
    );
    expect(gameNowMs({ gameMs: 1000, localWallMs: 0, rate: 1, status: 'running' }, 500)).toBe(1500);
    expect(gameNowMs({ gameMs: 1000, localWallMs: 0, rate: 12, status: 'paused' }, 500)).toBe(1000);
  });

  it('formats game time and the clock panel', () => {
    expect(formatGameTime(26 * 3_600_000 + 5 * 60_000)).toBe('Day 2 02:05');
    const s = applyServerMessage(
      initialState,
      {
        v,
        kind: 'clockState',
        clock: { gameMsAtAnchor: 0, wallMsAtAnchor: 0, rate: 4, status: 'running' },
      },
      0,
    );
    expect(clockText(s, 60_000)).toBe('Day 1 00:04 · 4:1 · running');
  });
});

describe('session params', () => {
  it('picks join, create or fixture', () => {
    expect(parseSession('?game=g&token=t')).toEqual({ mode: 'join', game: 'g', token: 't' });
    expect(parseSession('?new=1&rate=12')).toEqual({ mode: 'create', side: 'blue', rate: 12 });
    expect(parseSession('')).toEqual({ mode: 'fixture' });
    expect(wsUrl({ protocol: 'https:', host: 'a.b' }, 'g', 't')).toBe(
      'wss://a.b/games/g/ws?token=t',
    );
  });
});

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}

describe('GameConnection', () => {
  function setup() {
    const sockets: FakeSocket[] = [];
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const messages: ServerMessage[] = [];
    const statuses: string[] = [];
    const conn = new GameConnection({
      url: 'ws://x',
      onMessage: (m) => messages.push(m),
      onStatus: (s) => statuses.push(s),
      createSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      setTimer: (fn, ms) => timers.push({ fn, ms }),
      clearTimer: () => {},
    });
    return { conn, sockets, timers, messages, statuses };
  }

  it('parses server messages and sends orders as issueOrder commands', () => {
    const { conn, sockets, messages } = setup();
    conn.start();
    expect(conn.sendOrder('o1', 'advance')).toBe(false);
    sockets[0]!.open();
    sockets[0]!.onmessage?.({ data: JSON.stringify({ v, kind: 'staffAtWork', working: false }) });
    sockets[0]!.onmessage?.({ data: 'not json' });
    expect(messages).toHaveLength(1);
    expect(conn.sendOrder('o1', 'advance')).toBe(true);
    expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual({
      v,
      kind: 'issueOrder',
      orderId: 'o1',
      text: 'advance',
    });
  });

  it('reconnects with backoff after a drop and resets after opening', () => {
    const { conn, sockets, timers, statuses } = setup();
    conn.start();
    sockets[0]!.close();
    expect(timers.map((t) => t.ms)).toEqual([500]);
    timers[0]!.fn();
    expect(sockets).toHaveLength(2);
    sockets[1]!.close();
    expect(timers.map((t) => t.ms)).toEqual([500, 1000]);
    timers[1]!.fn();
    sockets[2]!.open();
    sockets[2]!.close();
    expect(timers.map((t) => t.ms)).toEqual([500, 1000, 500]);
    expect(statuses).toContain('open');
  });

  it('does not reconnect after stop()', () => {
    const { conn, timers } = setup();
    conn.start();
    conn.stop();
    expect(timers).toHaveLength(0);
  });
});

describe('Hud', () => {
  function mount() {
    document.body.innerHTML = '<div id="root"></div>';
    const sent: Array<[string | undefined, string]> = [];
    const opened: Dispatch[] = [];
    const hud = new Hud(document.getElementById('root')!, {
      onSendOrder: (u, t) => (sent.push([u, t]), undefined),
      onOpenDispatch: (d) => opened.push(d),
    });
    return { hud, sent, opened };
  }

  it('lists dispatches with written and received times and read state, and opens on click', () => {
    const { hud, opened } = mount();
    let s = applyServerMessage(
      initialState,
      {
        v,
        kind: 'viewUpdate',
        view: { ...fixtureView, dispatches: [disp('d1', { location: { x: 5, y: 6 } })] },
      },
      0,
    );
    hud.render(s, 0);
    const li = document.querySelector<HTMLElement>('#tray-list li')!;
    expect(li.className).toBe('unread');
    expect(li.textContent).toContain('written Day 1 00:01');
    expect(li.textContent).toContain('received Day 1 00:02');
    li.click();
    expect(opened.map((d) => d.id)).toEqual(['d1']);
    s = withRead(s, 'd1');
    hud.render(s, 0);
    expect(document.querySelector('#tray-list li')!.className).toBe('read');
  });

  it('escapes dispatch text and shows pending orders and the clock', () => {
    const { hud } = mount();
    let s = applyServerMessage(
      initialState,
      {
        v,
        kind: 'viewUpdate',
        view: {
          ...fixtureView,
          dispatches: [disp('d1', { text: '<img src=x onerror=alert(1)>' })],
        },
      },
      0,
    );
    s = withPendingOrder(s, { orderId: 'o1', text: '1st Battalion, advance', sentAtGame: 60_000 });
    hud.render(s, 0);
    expect(document.querySelector('#tray-list img')).toBeNull();
    expect(document.querySelector('#pending')!.textContent).toContain('1st Battalion, advance');
    expect(document.querySelector('#clock-text')!.textContent).toBe('Day 1 01:00 · 1:1 · paused');
  });

  it('sends the order box text with the chosen unit and clears it', () => {
    const { hud, sent } = mount();
    hud.render(
      applyServerMessage(initialState, { v, kind: 'viewUpdate', view: fixtureView }, 0),
      0,
    );
    hud.selectUnit('blue-2');
    const text = document.querySelector<HTMLTextAreaElement>('#order-text')!;
    expect(text.value).toBe('2nd Battalion, ');
    text.value += 'advance to the bridge';
    document.querySelector<HTMLButtonElement>('#order-send')!.click();
    expect(sent).toEqual([['blue-2', '2nd Battalion, advance to the bridge']]);
    expect(text.value).toBe('');
    expect(orderPrefix(fixtureView, 'nope')).toBe('');
  });

  it('replaces the auto-inserted prefix when another unit is selected, but keeps typed text', () => {
    const { hud } = mount();
    hud.render(
      applyServerMessage(initialState, { v, kind: 'viewUpdate', view: fixtureView }, 0),
      0,
    );
    const text = document.querySelector<HTMLTextAreaElement>('#order-text')!;
    hud.selectUnit('blue-1');
    hud.selectUnit('blue-2');
    expect(text.value).toBe('2nd Battalion, ');
    text.value += 'advance';
    hud.selectUnit('blue-1');
    expect(text.value).toBe('2nd Battalion, advance');
  });

  it('buildOrderText prefixes bare text once and never doubles a unit name', () => {
    expect(buildOrderText(fixtureView, 'blue-2', 'advance')).toBe('2nd Battalion, advance');
    expect(buildOrderText(fixtureView, 'blue-2', '2nd Battalion, advance')).toBe(
      '2nd Battalion, advance',
    );
    expect(buildOrderText(fixtureView, 'blue-2', '1st Battalion, advance')).toBe(
      '1st Battalion, advance',
    );
    expect(buildOrderText(fixtureView, undefined, 'advance')).toBe('advance');
  });
});
