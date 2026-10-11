import { describe, expect, it } from 'vitest';
import { parseCommand } from '@kriegsspiel/protocol';
import { GameClock } from '../clock.js';
import { STAFF_QUESTION_COST_MS, StaffDesk } from './conference.js';

function fakeWall() {
  let t = 1_000_000;
  const fn = () => t;
  fn.advance = (ms: number) => {
    t += ms;
  };
  return fn;
}

const COST = STAFF_QUESTION_COST_MS.chiefOfStaff;

describe('staff question cost', () => {
  it.each([1, 4, 12])('charges the same game time at rate %d', (rate) => {
    const wall = fakeWall();
    const clock = new GameClock(wall, { rate, gameMs: 60_000 });
    const desk = new StaffDesk();
    const first = desk.ask('g', 'blue', 'chiefOfStaff', clock.now());
    expect(first).toEqual({
      ok: true,
      askedAtGame: 60_000,
      answerAtGame: 60_000 + COST,
      costMs: COST,
    });
    // Just before the cost has elapsed in game time, the officer is still busy.
    wall.advance((COST - 1000) / rate);
    expect(desk.ask('g', 'blue', 'chiefOfStaff', clock.now()).ok).toBe(false);
    // Once it has, the officer takes another.
    wall.advance(1000 / rate);
    expect(desk.ask('g', 'blue', 'chiefOfStaff', clock.now()).ok).toBe(true);
  });

  it('does not run down while the game is paused', () => {
    const wall = fakeWall();
    const clock = new GameClock(wall, { rate: 12 });
    const desk = new StaffDesk();
    expect(desk.ask('g', 'blue', 'chiefOfStaff', clock.now()).ok).toBe(true);
    clock.pause();
    wall.advance(10 * 60 * 60_000);
    const again = desk.ask('g', 'blue', 'chiefOfStaff', clock.now());
    expect(again).toEqual({ ok: false, busyUntilGame: COST });
    clock.resume();
    wall.advance(COST / 12);
    expect(desk.ask('g', 'blue', 'chiefOfStaff', clock.now()).ok).toBe(true);
  });

  it("keeps each side, officer and game apart, with each officer's own cost", () => {
    const desk = new StaffDesk();
    desk.ask('g', 'blue', 'chiefOfStaff', 0);
    expect(desk.ask('g', 'red', 'chiefOfStaff', 0).ok).toBe(true);
    expect(desk.ask('h', 'blue', 'chiefOfStaff', 0).ok).toBe(true);
    const eng = desk.ask('g', 'blue', 'engineer', 0);
    expect(eng).toMatchObject({ ok: true, costMs: STAFF_QUESTION_COST_MS.engineer });
  });
});

describe('askStaff command', () => {
  it('parses over the wire and rejects a bad role or empty question', () => {
    const ok = {
      v: 1,
      kind: 'askStaff',
      questionId: 'q1',
      role: 'engineer',
      question: 'Is the bridge sound?',
    };
    expect(parseCommand(JSON.stringify(ok)).ok).toBe(true);
    expect(parseCommand(JSON.stringify({ ...ok, role: 'cook' })).ok).toBe(false);
    expect(parseCommand(JSON.stringify({ ...ok, question: '  ' })).ok).toBe(false);
  });
});
