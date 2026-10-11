import { describe, expect, it } from 'vitest';
import type { GameSummary } from '../lobby/api.js';
import { ago, continueRows, unfinished, type PlayedGame } from './continueList.js';

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
