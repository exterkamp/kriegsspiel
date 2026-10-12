import { describe, expect, it } from 'vitest';
import type { GameSummary } from '../lobby/api.js';
import { ago, continueRows, gameStatus, unfinished, type PlayedGame } from './continueList.js';

const base: GameSummary = {
  id: 'a',
  scenario: 'hold-the-bridge',
  status: 'started',
  sessionType: 'team_vs_team',
  rate: 12,
  side: 'blue',
  creator: true,
  createdAtMs: 0,
};
const game = (over: Partial<PlayedGame>): PlayedGame => ({
  ...base,
  finished: false,
  gameTimeMs: 90 * 60_000,
  lastPlayedMs: 1_000_000,
  ...over,
});

describe('continue list', () => {
  it('keeps only started games that are not finished', () => {
    const rows = unfinished([
      game({ id: 'live' }),
      game({ id: 'done', finished: true }),
      game({ id: 'lobby', status: 'lobby' }),
      base,
    ]);
    expect(rows.map((g) => g.id)).toEqual(['live']);
  });
  it('labels each row with scenario, side, game time and last played, most recent first', () => {
    const rows = continueRows(
      [
        game({ id: 'old', lastPlayedMs: 0 }),
        game({ id: 'new', lastPlayedMs: 3_600_000, side: null }),
      ],
      { 'hold-the-bridge': 'Hold the Bridge' },
      2 * 3_600_000,
    );
    expect(rows.map((r) => r.id)).toEqual(['new', 'old']);
    expect(rows[0]!.label).toBe(
      'Hold the Bridge, playing both sides, game time Day 1 01:30, last played 1 hour ago',
    );
    expect(rows[1]!.lastPlayed).toBe('2 hours ago');
  });
  it('words elapsed time', () => {
    expect(ago(1000, 1500)).toBe('just now');
    expect(ago(0, 5 * 60_000)).toBe('5 minutes ago');
    expect(ago(0, 2 * 86_400_000)).toBe('2 days ago');
  });
});

describe('gameStatus (#325)', () => {
  const g = (o: Partial<PlayedGame>): PlayedGame => ({
    id: 'g',
    scenario: 's',
    status: 'started',
    sessionType: 'team_vs_team',
    rate: 4,
    side: 'blue',
    creator: true,
    createdAtMs: 0,
    finished: false,
    gameTimeMs: 0,
    lastPlayedMs: 0,
    ...o,
  });
  it('says lobby, started, won, lost or ended', () => {
    expect(gameStatus(g({ status: 'lobby' }))).toBe('in the lobby, you are blue');
    expect(gameStatus(g({}))).toBe('started, you are blue');
    expect(gameStatus(g({ finished: true, winner: 'blue' }))).toBe('won, you are blue');
    expect(gameStatus(g({ finished: true, winner: 'red' }))).toBe('lost, you are blue');
    expect(gameStatus(g({ finished: true, winner: null }))).toBe(
      'ended, both sides broken, you are blue',
    );
    expect(gameStatus(g({ finished: true }))).toBe('ended, you are blue');
    expect(gameStatus(g({ finished: true, winner: 'red', side: null }))).toBe('ended, red won');
  });
  it('a finished game is never called started and stays out of Continue', () => {
    const done = g({ finished: true, winner: 'blue' });
    expect(gameStatus(done)).not.toMatch(/started/);
    expect(unfinished([done])).toEqual([]);
  });
});
