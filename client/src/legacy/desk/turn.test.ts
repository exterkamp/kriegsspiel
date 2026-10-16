import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type ServerMessage, type SideView } from '@kriegsspiel/protocol';
import { applyServerMessage, initialState, type ClientState } from '../net/state.js';
import { clockSummary, clockView } from './clock.js';
import {
  deadlineText,
  heldLine,
  howTurnsWork,
  lastTurnText,
  ordersButtonText,
  pursuitText,
  resolvedText,
  sidesSent,
  timeOfDay,
  turnEntry,
  turnLine,
  turnPhase,
  turnRights,
  turnSenderText,
  turnsInBattle,
} from './turn.js';

describe('who may hold and send the turn (#428)', () => {
  it('lets a commander, a subordinate and shared HQ send; staff hold; intelligence neither', () => {
    expect(turnRights(undefined)).toBe('send');
    expect(turnRights('commander')).toBe('send');
    expect(turnRights('subordinate')).toBe('send');
    expect(turnRights('chiefOfStaff')).toBe('hold');
    expect(turnRights('quartermaster')).toBe('hold');
    expect(turnRights('intelligence')).toBe('none');
  });

  it('says who sends to a seat that cannot, and nothing to one that can', () => {
    expect(turnSenderText('send')).toBeUndefined();
    expect(turnSenderText('hold')).toMatch(/Your commander sends/);
    expect(turnSenderText('none')).toMatch(/intelligence officer writes no orders/);
  });

  it('offers Send on the turn panel only to a seat that can send', () => {
    expect(ordersButtonText(0, 'send')).toBe('Write orders');
    expect(ordersButtonText(2, 'send')).toBe('Send orders (2 held)');
    expect(ordersButtonText(0, 'hold')).toBe('Write orders');
    expect(ordersButtonText(2, 'hold')).toBe('Orders (2 held)');
    expect(ordersButtonText(0, 'none')).toBe('See the orders');
    expect(ordersButtonText(1, 'none')).toBe('Orders (1 held)');
  });
});

const v = PROTOCOL_VERSION;
const MIN = 60_000;

const view = {
  side: 'blue',
  atGame: 0,
  ownUnits: [{ id: 'b1', name: '1st Battalion' }],
  visibleEnemies: [],
  lastKnownContacts: [],
  dispatches: [],
  clock: { gameMsAtAnchor: 0, wallMsAtAnchor: 0, rate: 1, status: 'paused' },
} as unknown as SideView;

type TurnStateMessage = Extract<ServerMessage, { kind: 'turnState' }>;
const turnState = (over: Partial<TurnStateMessage> = {}): TurnStateMessage => ({
  v,
  kind: 'turnState',
  turn: 3,
  startsAt: 8 * 60 * MIN + 20 * MIN,
  endsAt: 8 * 60 * MIN + 40 * MIN,
  sent: [],
  resolving: false,
  held: [],
  ...over,
});

const withView = (s: ClientState): ClientState => ({ ...s, view });

describe('turn lines', () => {
  it('names the turn and its slice of the day', () => {
    expect(timeOfDay(8 * 60 * MIN + 5 * MIN)).toBe('08:05');
    expect(turnLine({ turn: 3, startsAt: 500 * MIN, endsAt: 520 * MIN })).toBe(
      'Turn 3: 08:20 to 08:40',
    );
  });

  it('heads the diary once per turn, at its start', () => {
    const e = turnEntry({ turn: 2, startsAt: 20 * MIN, endsAt: 40 * MIN });
    expect(e).toEqual({
      id: 'turn:2',
      kind: 'turn',
      at: 20 * MIN,
      text: 'Turn 1 decided. Turn 2: 00:20 to 00:40 opens.',
    });
    expect(turnEntry({ turn: 1, startsAt: 0, endsAt: 20 * MIN }).text).toBe(
      'Turn 1: 00:00 to 00:20 opens.',
    );
  });

  it('counts the papers a decided turn brought', () => {
    expect(resolvedText(2, 0)).toBe('Turn 2 has been decided: no new papers in the in-tray.');
    expect(resolvedText(2, 1)).toBe('Turn 2 has been decided: 1 new paper in the in-tray.');
    expect(resolvedText(2, 3)).toBe('Turn 2 has been decided: 3 new papers in the in-tray.');
  });
});

describe('turnPhase', () => {
  it('follows the side from writing to sent to resolving, and ends with the game', () => {
    let s = withView(initialState);
    expect(turnPhase(s)).toBe('over');
    s = applyServerMessage(s, turnState(), 0);
    expect(turnPhase(s)).toBe('writing');
    s = applyServerMessage(s, turnState({ sent: ['red'] }), 0);
    expect(turnPhase(s)).toBe('writing');
    s = applyServerMessage(s, turnState({ sent: ['red', 'blue'] }), 0);
    expect(turnPhase(s)).toBe('sent');
    s = applyServerMessage(s, turnState({ sent: ['red', 'blue'], resolving: true }), 0);
    expect(turnPhase(s)).toBe('resolving');
    s = applyServerMessage(
      s,
      { v, kind: 'gameOver', winner: 'red', reason: 'objective', atGame: 0 } as never,
      0,
    );
    expect(turnPhase(s)).toBe('over');
  });
});

describe('sidesSent', () => {
  it('lists your side first, then every other side, with who has sent', () => {
    expect(sidesSent({ sent: ['red'] }, 'blue', ['red', 'blue'])).toEqual([
      { side: 'blue', name: 'Blue', you: true, sent: false },
      { side: 'red', name: 'Red', you: false, sent: true },
    ]);
  });

  it('still names a side that has sent when the game sides are not known yet', () => {
    expect(sidesSent({ sent: ['red'] }, 'blue').map((s) => s.side)).toEqual(['blue', 'red']);
  });
});

describe('deadlineText', () => {
  it('is absent when the turn waits for every side', () => {
    expect(deadlineText(undefined, 0)).toBeUndefined();
  });

  it('counts down in minutes, hours and days', () => {
    expect(deadlineText(10 * MIN, 0)).toBe('Orders due in 10 min.');
    expect(deadlineText(130 * MIN, 0)).toBe('Orders due in 2 h 10 min.');
    expect(deadlineText(120 * MIN, 0)).toBe('Orders due in 2 h.');
    expect(deadlineText(72 * 60 * MIN, 0)).toBe('Orders due in 3 days.');
    expect(deadlineText(60 * 60 * MIN, 0)).toBe('Orders due in 2 days.');
    expect(deadlineText(48 * 60 * MIN, 0)).toBe('Orders due in 2 days.');
    expect(deadlineText(0, 1)).toBe('Orders are due now; the turn closes at once.');
  });
});

describe('heldLine', () => {
  it('names the addressee and the courier', () => {
    const names = new Map([['b1', '1st Battalion']]);
    expect(heldLine({ orderId: 'a', to: 'b1', text: 'Hold' }, names)).toBe(
      'To 1st Battalion, by steady courier',
    );
    expect(heldLine({ orderId: 'a', to: 'b9', text: 'Hold', courier: 'fast' }, names)).toBe(
      'To b9, by fast rider',
    );
  });
});

describe('the clock in a turn-mode game', () => {
  it('shows the open turn and where the side stands, with no rate', () => {
    let s = applyServerMessage(withView(initialState), turnState(), 0);
    expect(clockView(s, 99_999)).toEqual({
      time: 'Turn 3: 08:20 to 08:40',
      turn: 'Turn 3: 08:20 to 08:40',
      rate: '',
      status: 'paused',
      staffAtWork: false,
      label: 'Writing orders',
    });
    expect(clockSummary(clockView(s, 0))).toBe('Turn 3: 08:20 to 08:40, writing orders');
    s = applyServerMessage(s, turnState({ sent: ['blue'], resolving: true }), 0);
    expect(clockView(s, 0).label).toBe('Turn being decided');
  });

  it('stands at the final moment after the game, and stays a turn game', () => {
    let s = applyServerMessage(withView(initialState), turnState(), 0);
    s = applyServerMessage(
      s,
      { v, kind: 'gameOver', winner: 'red', reason: 'objective', atGame: 520 * MIN } as never,
      0,
    );
    expect(s.turnMode).toBe(true);
    expect(clockView(s, 0)).toMatchObject({ time: 'Day 1 08:40', status: 'stopped', rate: '' });
  });

  it('leaves a real-time game alone', () => {
    expect(initialState.turnMode).toBeUndefined();
  });
});

describe('a sent turn in the client state', () => {
  it('keeps held orders as drafts until the side sends, then they join the sent orders', () => {
    const held = [
      { orderId: 't-1', to: 'b1', text: 'March to the bridge', courier: 'fast' as const },
    ];
    let s = applyServerMessage(withView(initialState), turnState({ held }), 0);
    expect(s.pending).toEqual([]);
    s = applyServerMessage(s, turnState({ held, sent: ['blue'] }), 0);
    expect(s.pending).toEqual([
      {
        orderId: 't-1',
        text: 'March to the bridge',
        sentAtGame: 500 * MIN,
        toName: '1st Battalion',
        courier: 'fast',
      },
    ]);
    // A later turnState (resolving) does not add it twice.
    s = applyServerMessage(s, turnState({ held, sent: ['blue'], resolving: true }), 0);
    expect(s.pending).toHaveLength(1);
  });

  it('does not take another side sending for its own', () => {
    const held = [{ orderId: 't-1', to: 'b1', text: 'Hold' }];
    const s = applyServerMessage(withView(initialState), turnState({ held, sent: ['red'] }), 0);
    expect(s.pending).toEqual([]);
  });
});

describe('the pursuit after a ruling (#438)', () => {
  it('keeps the time the game closes by from the turn state, and says the battle is decided', () => {
    let s = applyServerMessage(withView(initialState), turnState(), 0);
    expect(s.turn?.pursuitUntil).toBeUndefined();
    expect(pursuitText(s.turn)).toBeUndefined();
    s = applyServerMessage(s, turnState({ pursuitUntil: 8 * 60 * MIN + 51 * MIN }), 0);
    expect(s.turn?.pursuitUntil).toBe(8 * 60 * MIN + 51 * MIN);
    expect(pursuitText(s.turn)).toBe(
      'The battle is decided; this turn is the pursuit. The game closes by 08:51 at the latest. You may send this turn with no orders.',
    );
  });
});

describe('the turn explained (#439)', () => {
  it('counts the battle in turns, the last one short', () => {
    expect(turnsInBattle(50, 20)).toBe(3);
    expect(turnsInBattle(60, 20)).toBe(3);
    expect(turnsInBattle(undefined, 20)).toBeUndefined();
    expect(turnLine({ turn: 2, startsAt: 20 * MIN, endsAt: 40 * MIN }, 3)).toBe(
      'Turn 2 of about 3: 00:20 to 00:40',
    );
    expect(turnLine({ turn: 3, startsAt: 40 * MIN, endsAt: 50 * MIN }, 3)).toBe(
      'Turn 3 of 3: 00:40 to 00:50',
    );
  });

  it('says what a turn is and that each side sends once and the umpire decides', () => {
    const text = howTurnsWork(20, 50);
    expect(text).toContain('Each turn is 20 minutes of the battle.');
    expect(text).toContain('send them once for your whole side');
    expect(text).toContain('the umpire decides what happened in those 20 minutes');
    expect(text).toContain('about 50 minutes, so about 3 turns');
    expect(howTurnsWork(20)).not.toContain('battle lasts');
  });

  it('explains a short last turn, and names the last full one', () => {
    expect(lastTurnText({ turn: 3, startsAt: 40 * MIN, endsAt: 50 * MIN }, 20, 50)).toBe(
      "This is the last turn, and it is 10 minutes, not 20: the battle's time limit is at 00:50.",
    );
    expect(lastTurnText({ turn: 3, startsAt: 40 * MIN, endsAt: 60 * MIN }, 20, 60)).toBe(
      "This is the last turn: the battle's time limit is at 01:00.",
    );
    expect(lastTurnText({ turn: 2, startsAt: 20 * MIN, endsAt: 40 * MIN }, 20, 50)).toBeUndefined();
  });

  it('puts the count on the desk clock once the battle length is known', () => {
    const s = applyServerMessage(
      { ...withView(initialState), turnMinutes: 20, battleMinutes: 50 },
      turnState({ turn: 2, startsAt: 20 * MIN, endsAt: 40 * MIN }),
      0,
    );
    expect(clockView(s, 0).time).toBe('Turn 2 of about 3: 00:20 to 00:40');
  });
});
