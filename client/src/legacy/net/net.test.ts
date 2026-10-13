// @vitest-environment jsdom
import { PROTOCOL_VERSION, type Dispatch, type ServerMessage } from '@kriegsspiel/protocol';
import { describe, expect, it } from 'vitest';
import { noticeText } from '../desk/orders.js';
import { fixtureView } from '../table/fixture.js';
import { Hud, buildOrderText, gameOverText, orderPrefix } from '../hud/hud.js';
import { parseSession, wsUrl } from '../session.js';
import { GameConnection, type WebSocketLike } from './connection.js';
import {
  applyServerMessage,
  formatGameTime,
  gameNowMs,
  initialState,
  withPendingOrder,
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

describe('shared drafts in the client state', () => {
  const draft = (over = {}) => ({
    id: 'd1',
    title: '',
    createdBy: 'a',
    rev: 0,
    text: 'abc',
    authors: [{ author: 'a', len: 3 }],
    comments: [],
    receipts: {},
    history: [],
    ...over,
  });

  it('keeps the drafts the server sends and follows its entries in rev order', () => {
    let s = applyServerMessage(initialState, { v, kind: 'drafts', drafts: [draft()] }, 0);
    s = applyServerMessage(
      s,
      {
        v,
        kind: 'draftEntry',
        draft: 'd1',
        entry: { kind: 'edit', rev: 1, author: 'b', at: 1, op: [3, 'd'] },
      },
      0,
    );
    expect(s.drafts[0]).toMatchObject({ rev: 1, text: 'abcd' });
    // The same entry again (a snapshot raced it) changes nothing.
    const again = applyServerMessage(
      s,
      {
        v,
        kind: 'draftEntry',
        draft: 'd1',
        entry: { kind: 'edit', rev: 1, author: 'b', at: 1, op: [3, 'd'] },
      },
      0,
    );
    expect(again).toBe(s);
  });

  it('marks the drafts stale when an entry skips a rev, and a snapshot clears it', () => {
    let s = applyServerMessage(initialState, { v, kind: 'drafts', drafts: [draft()] }, 0);
    s = applyServerMessage(
      s,
      {
        v,
        kind: 'draftEntry',
        draft: 'd1',
        entry: { kind: 'edit', rev: 3, author: 'b', at: 1, op: [3, 'd'] },
      },
      0,
    );
    expect(s.draftsStale).toBe(true);
    expect(s.drafts[0]!.rev).toBe(0);
    s = applyServerMessage(s, { v, kind: 'drafts', drafts: [draft({ rev: 3, text: 'abcd' })] }, 0);
    expect(s.draftsStale).toBe(false);
  });

  it('adds or replaces a draft from draftState, and records receipts and presence', () => {
    let s = applyServerMessage(initialState, { v, kind: 'draftState', draft: draft() }, 0);
    s = applyServerMessage(s, { v, kind: 'draftState', draft: draft({ title: 'Plan' }) }, 0);
    expect(s.drafts.map((d) => d.title)).toEqual(['Plan']);
    s = applyServerMessage(s, { v, kind: 'draftReceipt', draft: 'd1', reader: 'b', rev: 2 }, 0);
    expect(s.drafts[0]!.receipts).toEqual({ b: 2 });
    s = applyServerMessage(
      s,
      {
        v,
        kind: 'draftPresence',
        you: 'a',
        people: [{ id: 'b', label: 'Chief of staff', drafts: ['d1'] }],
      },
      0,
    );
    expect(s.draftPresence?.you).toBe('a');
    expect(s.draftLabels).toEqual({ b: 'Chief of staff' });
  });
});

describe('applyServerMessage', () => {
  it('rebuilds the sent orders from the server after a reload, without doubling a local one (#343)', () => {
    let s = withPendingOrder(initialState, { orderId: 'o1', text: 'hold', sentAtGame: 5 });
    s = applyServerMessage(
      s,
      {
        v,
        kind: 'sentOrders',
        orders: [
          { id: 'o1', text: 'hold', sentAtGame: 5 },
          { id: 'log-3', text: 'advance', sentAtGame: 2, toName: '1st Battalion' },
        ],
      },
      0,
    );
    expect(s.pending.map((p) => p.orderId)).toEqual(['log-3', 'o1']);
    expect(s.pending[0]).toMatchObject({ toName: '1st Battalion', sentAtGame: 2 });
    expect(applyServerMessage(s, { v, kind: 'sentOrders', orders: [] }, 0)).toBe(s);
  });

  it('keeps the open turn of a turn-mode game, replacing it on every turnState (D39)', () => {
    expect(initialState.turn).toBeUndefined();
    const held = [{ orderId: 'o1', to: 'blue-1', text: 'Hold the wood' }];
    let s = applyServerMessage(
      initialState,
      {
        v,
        kind: 'turnState',
        turn: 1,
        startsAt: 0,
        endsAt: 1_200_000,
        sent: [],
        resolving: false,
        held,
      },
      0,
    );
    expect(s.turn).toEqual({
      turn: 1,
      startsAt: 0,
      endsAt: 1_200_000,
      sent: [],
      resolving: false,
      held,
    });
    s = applyServerMessage(
      s,
      {
        v,
        kind: 'turnState',
        turn: 2,
        startsAt: 1_200_000,
        endsAt: 2_400_000,
        sent: ['red'],
        deadline: 99,
        resolving: false,
        held: [],
      },
      0,
    );
    expect(s.turn).toEqual({
      turn: 2,
      startsAt: 1_200_000,
      endsAt: 2_400_000,
      sent: ['red'],
      deadline: 99,
      resolving: false,
      held: [],
    });
    // The game is over: no turn follows the last one, which was still resolving.
    s = applyServerMessage(s, { v, kind: 'turnState', ...s.turn!, resolving: true }, 0);
    s = applyServerMessage(
      s,
      { v, kind: 'gameOver', winner: 'blue', reason: 'objective-held', atGame: 2_400_000 },
      0,
    );
    expect(s.turn).toBeUndefined();
    expect(s.gameOver).toBeDefined();
  });

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

  it("replaces a dispatch's text when the umpire's narration of it arrives under the same id", () => {
    let s = applyServerMessage(
      initialState,
      { v, kind: 'dispatch', dispatch: disp('d1', { text: 'template' }) },
      0,
    );
    s = applyServerMessage(
      s,
      {
        v,
        kind: 'viewUpdate',
        view: { ...fixtureView, dispatches: [disp('d1', { text: 'Sir, narrated.' })] },
      },
      0,
    );
    expect(s.dispatches.map((d) => [d.id, d.text])).toEqual([['d1', 'Sir, narrated.']]);
    // The same text again leaves the list as it was.
    const same = applyServerMessage(
      s,
      {
        v,
        kind: 'viewUpdate',
        view: { ...fixtureView, dispatches: [disp('d1', { text: 'Sir, narrated.' })] },
      },
      0,
    );
    expect(same.dispatches).toBe(s.dispatches);
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

describe('order clarification', () => {
  it('shows the question without the order id and drops the pending order', () => {
    let s = withPendingOrder(initialState, { orderId: 'o-lq3-1', text: 'x', sentAtGame: 0 });
    s = applyServerMessage(
      s,
      {
        v,
        kind: 'error',
        code: 'order_clarification',
        message: 'o-lq3-1: Which wood do you mean? (Northern wood)',
      },
      0,
    );
    expect(s.pending).toEqual([]);
    // The notice keeps the id so the desk can find the order's outcome; noticeText hides it.
    expect(noticeText(s.notices[0]!, s.outcomes)).toContain('Which wood do you mean?');
    expect(s.outcomes['o-lq3-1']?.reason).toContain('(Northern wood)');
    expect(noticeText(s.notices[0]!, s.outcomes)).not.toMatch(/o-lq3-1/);
  });

  it('leaves other errors as sent', () => {
    const s = applyServerMessage(
      initialState,
      { v, kind: 'error', code: 'bad_message', message: 'bad frame: not JSON' },
      0,
    );
    expect(s.notices[0]?.message).toBe('bad frame: not JSON');
  });
});

describe('server restart', () => {
  it('keeps a notice that the game came back paused', () => {
    const s = applyServerMessage(initialState, { v, kind: 'serverRestarted', downMs: 600_000 }, 0);
    expect(s.notices[0]?.code).toBe('server_restart');
    expect(s.notices[0]?.message).toContain('at least 10 min');
    expect(s.notices[0]?.message).toContain('paused');
  });
});

describe('notification', () => {
  it('shows what an away player would be sent', () => {
    const m: ServerMessage = {
      v,
      kind: 'notification',
      event: 'contact',
      title: 'Contact reported',
      text: 'Look to your desk.',
    };
    const s = applyServerMessage(initialState, m, 0);
    expect(s.notices[0]).toEqual({
      code: 'notify_contact',
      message: 'Contact reported. Look to your desk.',
    });
  });
});

describe('staff questions', () => {
  it('records the server’s charge by question id', () => {
    const s = applyServerMessage(
      initialState,
      {
        v,
        kind: 'staffQueued',
        questionId: 'q-1',
        role: 'engineer',
        askedAtGame: 1000,
        answerAtGame: 1000 + 1_200_000,
        costMs: 1_200_000,
      },
      0,
    );
    expect(s.staffCharges['q-1']).toEqual({
      askedAtGame: 1000,
      answerAtGame: 1_201_000,
      costMs: 1_200_000,
    });
  });
  it('quotes the player’s own words in a refusal, not the addressee prefix added to the text', () => {
    let s = withPendingOrder(initialState, {
      orderId: 'o-1',
      text: '1st Battalion, Move to the bridge.',
      words: 'Move to the bridge.',
      sentAtGame: 0,
    });
    s = applyServerMessage(
      s,
      { v, kind: 'error', code: 'order_rejected', message: 'o-1: No such place.' },
      0,
    );
    expect(s.outcomes['o-1']?.text).toBe('Move to the bridge.');
    expect(noticeText(s.notices[0]!, s.outcomes)).toContain('"Move to the bridge."');
    expect(noticeText(s.notices[0]!, s.outcomes)).not.toContain('1st Battalion, Move');
  });

  it('marks a refused question, by the id prefixing the error', () => {
    for (const code of ['staff_busy', 'game_over']) {
      const s = applyServerMessage(
        initialState,
        { v, kind: 'error', code, message: 'q-2: that officer is still answering' },
        0,
      );
      expect(s.staffCharges['q-2']).toBe('refused');
    }
  });
  it('notes an error that names no question, with the wall time', () => {
    const s = applyServerMessage(
      initialState,
      { v, kind: 'error', code: 'game_closed', message: 'this game is no longer running' },
      777,
    );
    expect(s.staffFaultAtWall).toBe(777);
    const other = applyServerMessage(
      initialState,
      { v, kind: 'error', code: 'not_implemented', message: 'nope' },
      5,
    );
    expect(other.staffFaultAtWall).toBeUndefined();
  });
});

describe('game over', () => {
  const over: ServerMessage = {
    v,
    kind: 'gameOver',
    winner: 'blue',
    reason: 'objective-held',
    atGame: 3_600_000,
  };

  it('stores the result and words it for the viewer’s side', () => {
    let s = applyServerMessage(initialState, { v, kind: 'viewUpdate', view: fixtureView }, 0);
    s = applyServerMessage(s, over, 0);
    expect(s.gameOver).toEqual({ winner: 'blue', reason: 'objective-held', atGame: 3_600_000 });
    const text = gameOverText(s)!;
    expect(text).toContain(fixtureView.side === 'blue' ? 'Victory' : 'Defeat');
    expect(text).toContain('Day 1 01:00');
    expect(gameOverText(initialState)).toBeUndefined();
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

  it('formats game time', () => {
    expect(formatGameTime(26 * 3_600_000 + 5 * 60_000)).toBe('Day 2 02:05');
  });
});

describe('session params', () => {
  it('picks join, create or fixture', () => {
    expect(parseSession('?game=g')).toEqual({ mode: 'join', game: 'g' });
    expect(parseSession('?game=g&side=red')).toEqual({ mode: 'join', game: 'g', side: 'red' });
    expect(parseSession('?new=1&rate=12')).toEqual({ mode: 'create', rate: 12 });
    expect(parseSession('?new=1&side=red')).toEqual({ mode: 'create', side: 'red' });
    expect(parseSession('')).toEqual({ mode: 'menu' });
    expect(parseSession('?mode=fixture')).toEqual({ mode: 'menu' });
    expect(wsUrl({ protocol: 'https:', host: 'a.b' }, 'g')).toBe('wss://a.b/games/g/ws');
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

  it('asks for the drafts snapshot when an edit gets bad_rev', () => {
    const { conn, sockets, messages } = setup();
    conn.start();
    sockets[0]!.open();
    sockets[0]!.onmessage?.({
      data: JSON.stringify({
        v,
        kind: 'error',
        code: 'bad_rev',
        message: 'rev 9 is not one of its',
      }),
    });
    expect(messages).toHaveLength(1);
    expect(sockets[0]!.sent.map((x) => JSON.parse(x))).toEqual([{ v, kind: 'syncDrafts' }]);
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

  it('gives up after the time limit and retries by hand', () => {
    let clock = 0;
    const sockets: FakeSocket[] = [];
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const statuses: string[] = [];
    const conn = new GameConnection({
      url: 'ws://x',
      onMessage: () => {},
      onStatus: (s) => statuses.push(s),
      createSocket: () => (sockets.push(new FakeSocket()), sockets.at(-1)!),
      setTimer: (fn, ms) => timers.push({ fn, ms }),
      clearTimer: () => {},
      now: () => clock,
      giveUpAfterMs: 10_000,
    });
    conn.start();
    sockets[0]!.close();
    expect(statuses.at(-1)).toBe('closed');
    clock = 9_000;
    timers.at(-1)!.fn();
    sockets[1]!.close();
    expect(statuses.at(-1)).toBe('closed');
    clock = 10_000;
    timers.at(-1)!.fn();
    sockets[2]!.close();
    expect(statuses.at(-1)).toBe('failed');
    const scheduled = timers.length;
    expect(scheduled).toBe(2);
    conn.retry();
    expect(sockets).toHaveLength(4);
    expect(statuses.at(-1)).toBe('connecting');
    sockets[3]!.close();
    expect(statuses.at(-1)).toBe('closed');
    expect(timers.at(-1)!.ms).toBe(500);
  });

  it('stops reconnecting once the server says the game is closed', () => {
    const { conn, sockets, timers, statuses } = setup();
    conn.start();
    sockets[0]!.open();
    sockets[0]!.onmessage?.({
      data: JSON.stringify({ v, kind: 'error', code: 'game_closed', message: 'gone' }),
    });
    sockets[0]!.close();
    expect(statuses.at(-1)).toBe('failed');
    expect(timers).toHaveLength(0);
  });

  it('does not reconnect after stop()', () => {
    const { conn, timers } = setup();
    conn.start();
    conn.stop();
    expect(timers).toHaveLength(0);
  });
});

describe('clock anchors', () => {
  const msg = (
    gameMsAtAnchor: number,
    rate = 10,
    status: 'running' | 'paused' | 'stopped' = 'running',
  ) => ({
    v: PROTOCOL_VERSION as 1,
    kind: 'clockState' as const,
    clock: { gameMsAtAnchor, wallMsAtAnchor: 1, rate, status },
  });

  it.each([1, 4, 12])('never steps back on a small lag while running at rate %i', (rate) => {
    let s = applyServerMessage(initialState, msg(1000, rate), 1000);
    // 100 ms later the display is 100 * rate ahead; an update anchored just behind it must not pull it back.
    const shown = 1000 + 100 * rate;
    s = applyServerMessage(s, msg(1000 + 50 * rate, rate), 1100);
    expect(gameNowMs(s.clock!, 1100)).toBe(shown);
    expect(gameNowMs(s.clock!, 1200)).toBe(shown + 100 * rate);
  });

  it.each([1, 4, 12])(
    'takes the server time after a stall that left a big lead at rate %i',
    (rate) => {
      let s = applyServerMessage(initialState, msg(60_000, rate), 1000);
      // The LLM barrier held game time for 30 s of wall time; the client ran on, then the server re-anchors.
      s = applyServerMessage(s, msg(60_000, rate), 31_000);
      expect(gameNowMs(s.clock!, 31_000)).toBe(60_000);
      expect(gameNowMs(s.clock!, 41_000)).toBe(60_000 + 10_000 * rate);
    },
  );

  it('takes a later anchor, and any anchor after a pause', () => {
    let s = applyServerMessage(initialState, msg(1000), 1000);
    s = applyServerMessage(s, msg(5000), 1100);
    expect(gameNowMs(s.clock!, 1100)).toBe(5000);
    s = applyServerMessage(s, msg(10, 10, 'paused'), 1200);
    expect(gameNowMs(s.clock!, 1300)).toBe(10);
  });

  it('takes a stopped anchor even when the running display was ahead', () => {
    let s = applyServerMessage(initialState, msg(1000, 4), 1000);
    s = applyServerMessage(s, msg(1200, 4, 'stopped'), 1100);
    expect(s.clock!.status).toBe('stopped');
    expect(gameNowMs(s.clock!, 5000)).toBe(1200);
  });
});

describe('Hud', () => {
  function mount() {
    document.body.innerHTML = '<div id="root"></div>';
    const sent: Array<[string | undefined, string]> = [];
    const hud = new Hud(document.getElementById('root')!, {
      onSendOrder: (u, t) => (sent.push([u, t]), undefined),
    });
    return { hud, sent };
  }

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
    hud.render(s);
    expect(document.querySelector('#pending')!.textContent).toContain('1st Battalion, advance');
  });

  it('sends the order box text with the chosen unit and clears it', () => {
    const { hud, sent } = mount();
    hud.render(applyServerMessage(initialState, { v, kind: 'viewUpdate', view: fixtureView }, 0));
    hud.selectUnit('blue-2');
    const text = document.querySelector<HTMLTextAreaElement>('#order-text')!;
    expect(text.value).toBe('2nd Battalion, ');
    text.value += 'advance to the bridge';
    document.querySelector<HTMLButtonElement>('#order-send')!.click();
    expect(sent).toEqual([['blue-2', '2nd Battalion, advance to the bridge']]);
    expect(text.value).toBe('');
    expect(orderPrefix(fixtureView, 'nope')).toBe('');
  });

  it('shows the result and stops accepting orders once the game is over', () => {
    const { hud, sent } = mount();
    const running = applyServerMessage(
      initialState,
      { v, kind: 'viewUpdate', view: fixtureView },
      0,
    );
    const q = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
    hud.render(running);
    expect(q('#order-text').hasAttribute('disabled')).toBe(false);
    expect(q('#order-send').hasAttribute('disabled')).toBe(false);
    expect(q('#order-unit').hasAttribute('disabled')).toBe(false);
    expect(q('#gameover').hidden).toBe(true);

    const over = applyServerMessage(
      running,
      { v, kind: 'gameOver', winner: 'blue', reason: 'objective-held', atGame: 3_600_000 },
      0,
    );
    hud.render(over);
    expect(q('#order-text').hasAttribute('disabled')).toBe(true);
    expect(q('#order-send').hasAttribute('disabled')).toBe(true);
    expect(q('#order-unit').hasAttribute('disabled')).toBe(true);
    expect(q('#gameover').hidden).toBe(false);
    expect(q('#gameover').textContent).toBe(gameOverText(over));

    const text = q<HTMLTextAreaElement>('#order-text');
    text.value = '1st Battalion, advance';
    q<HTMLButtonElement>('#order-send').click();
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
    expect(sent).toEqual([]);
  });

  it('replaces the auto-inserted prefix when another unit is selected, but keeps typed text', () => {
    const { hud } = mount();
    hud.render(applyServerMessage(initialState, { v, kind: 'viewUpdate', view: fixtureView }, 0));
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

describe('catch-up', () => {
  it('records what arrived while away and posts a notice', () => {
    const s = applyServerMessage(
      initialState,
      { v, kind: 'catchUp', sinceGame: 3_600_000, atGame: 7_200_000, dispatchIds: ['d1', 'd2'] },
      0,
    );
    expect(s.catchUp?.dispatchIds).toEqual(['d1', 'd2']);
    expect(s.notices[0]!.message).toContain('2 new dispatches');
    expect(s.notices[0]!.message).toContain('Day 1 01:00');
  });
});
