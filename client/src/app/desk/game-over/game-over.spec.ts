import { describe, expect, it } from 'vitest';
import { lossesBetween, reasonText, replayRequest, resultFor, summaryLines } from './game-over';

describe('game over logic (from held PR #266)', () => {
  it('states a broken attack or defence as the reason (#315)', () => {
    expect(reasonText({ winner: 'blue', reason: 'attack-broken', atGame: 2_400_000 })).toMatch(
      /attack on the objective was broken; Blue holds the field/,
    );
    expect(reasonText({ winner: 'red', reason: 'defence-broken', atGame: 2_400_000 })).toMatch(
      /defence of the objective was broken; Red holds the field/,
    );
  });

  it('says when the losing force was wiped out (#320)', () => {
    expect(
      reasonText({
        winner: 'blue',
        reason: 'attack-broken',
        atGame: 2_400_000,
        loserOut: 'eliminated',
      }),
    ).toMatch(/was broken: Red was wiped out; Blue holds the field/);
  });

  it('says the survivors left the field when the losing force was not wiped out (#323)', () => {
    expect(
      reasonText({
        winner: 'blue',
        reason: 'attack-broken',
        atGame: 2_400_000,
        loserOut: 'withdrawn',
      }),
    ).toMatch(/was broken: Red's survivors had all left the field; Blue holds the field/);
  });

  it('maps the winner to a result for each side', () => {
    expect(resultFor({ winner: 'blue' }, 'blue')).toBe('victory');
    expect(resultFor({ winner: 'blue' }, 'red')).toBe('defeat');
    expect(resultFor({ winner: 'red' }, 'red')).toBe('victory');
    expect(resultFor({ winner: 'red' }, 'blue')).toBe('defeat');
    expect(resultFor({ winner: null }, 'blue')).toBe('draw');
    expect(resultFor({ winner: null }, 'red')).toBe('draw');
  });
  it('words the reason', () => {
    expect(reasonText({ winner: 'red', reason: 'objective-held', atGame: 3_600_000 })).toMatch(
      /^Red held the objective at /,
    );
  });
  it('counts losses per side between two frames', () => {
    const u = (id: string, side: string, strength: number) => ({ id, side, strength });
    const start = { units: [u('a', 'blue', 100), u('b', 'red', 80), u('c', 'red', 50)] };
    const end = { units: [u('a', 'blue', 70), u('b', 'red', 0), u('c', 'red', 50)] };
    expect(lossesBetween(start, end, 'blue')).toEqual({ own: 30, enemy: 80 });
    expect(lossesBetween(start, end, 'red')).toEqual({ own: 80, enemy: 30 });
    expect(
      summaryLines({ winner: 'blue', reason: 'eliminated', atGame: 0 }, { own: 30, enemy: 80 }),
    ).toContain('Enemy losses: 80');
  });
  it('repeats scenario, rate, session type and side', () => {
    expect(replayRequest({ scenario: 's', rate: 12, sessionType: 'hot_seat' }, 'red')).toEqual({
      scenario: 's',
      rate: 12,
      sessionType: 'hot_seat',
      side: 'red',
    });
    const pause = { mode: 'x' } as never;
    expect(
      replayRequest({ scenario: 's', rate: 12, sessionType: 'hot_seat', pause }, undefined).pause,
    ).toBe(pause);
  });
  it('repeats the umpire dial and persona, and a turn-mode game as one (D39)', () => {
    const umpire = {
      dial: 'free',
      persona: 'dramatic',
      mode: 'turns',
      turnMinutes: 30,
      turnDeadlineHours: 24,
    } as const;
    expect(
      replayRequest({ scenario: 's', rate: 1, sessionType: 'team_vs_team', umpire }, 'blue'),
    ).toEqual({
      scenario: 's',
      rate: 1,
      sessionType: 'team_vs_team',
      dial: 'free',
      persona: 'dramatic',
      mode: 'turns',
      turnMinutes: 30,
      turnDeadlineHours: 24,
      side: 'blue',
    });
    const rt = replayRequest(
      {
        scenario: 's',
        rate: 4,
        sessionType: 'team_vs_team',
        umpire: { dial: 'rigid', persona: 'dry' },
      },
      undefined,
    );
    expect(rt).toEqual({
      scenario: 's',
      rate: 4,
      sessionType: 'team_vs_team',
      dial: 'rigid',
      persona: 'dry',
    });
  });
});
