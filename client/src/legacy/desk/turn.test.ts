import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type SideView } from '@kriegsspiel/protocol';
import { applyServerMessage, initialState, type ClientState } from '../net/state.js';
import { clockSummary, clockView } from './clock.js';
import {
  deadlineText,
  heldLine,
  resolvedText,
  sidesSent,
  timeOfDay,
  turnEntry,
  turnLine,
  turnPhase,
} from './turn.js';

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

const turnState = (
  over: Partial<Extract<Parameters<typeof applyServerMessage>[1], { kind: 'turnState' }>> = {},
) =>
  ({
    v,
    kind: 'turnState',
    turn: 3,
    startsAt: 8 * 60 * MIN + 20 * MIN,
    endsAt: 8 * 60 * MIN + 40 * MIN,
    sent: [],
    resolving: false,
    held: [],
    ...over,
  }) as const;

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
      text: 'Turn 2: 00:20 to 00:40 opens.',
    });
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
    s = applyServerMessage(s, { v, kind: 'gameOver', winner: 'red', reason: 'objective', atGame: 0 } as never, 0);
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
    const held = [{ orderId: 't-1', to: 'b1', text: 'March to the bridge', courier: 'fast' as const }];
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
