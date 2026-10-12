/** The Continue list: the player's unfinished games, newest play first, with labels for each row. */
import type { GameSummary } from '../lobby/api.js';
import { formatGameTime } from '../net/state.js';

export interface PlayedGame extends GameSummary {
  finished: boolean;
  gameTimeMs: number;
  lastPlayedMs: number;
  /** Once finished: the winning side, or null when both sides were put out together. */
  winner?: string | null;
}

export interface ContinueRow {
  id: string;
  scenario: string;
  side: string;
  gameTime: string;
  lastPlayed: string;
  label: string;
}

const isPlayed = (g: GameSummary | PlayedGame): g is PlayedGame => 'finished' in g;

/** How a game stands in "Your games": in the lobby, started, or over with its result from the player's side (#325). */
export function gameStatus(g: GameSummary | PlayedGame): string {
  const seat = g.side ? `, you are ${g.side}` : '';
  if (g.status === 'lobby') return `in the lobby${seat}`;
  if (!isPlayed(g) || !g.finished) return `started${seat}`;
  if (g.winner === undefined) return `ended${seat}`;
  if (g.winner === null) return `ended, both sides broken${seat}`;
  if (!g.side) return `ended, ${g.winner} won`;
  return `${g.winner === g.side ? 'won' : 'lost'}${seat}`;
}

/** Started games that are not over. Lobby games have not begun and finished games have nothing to continue. */
export const unfinished = (games: Array<GameSummary | PlayedGame>): PlayedGame[] =>
  games.filter(isPlayed).filter((g) => g.status === 'started' && !g.finished);

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago". `nowMs` is passed in so tests need no clock. */
export function ago(thenMs: number, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - thenMs) / 1000));
  if (s < 60) return 'just now';
  const unit = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'} ago`;
  if (s < 3600) return unit(Math.floor(s / 60), 'minute');
  if (s < 86_400) return unit(Math.floor(s / 3600), 'hour');
  return unit(Math.floor(s / 86_400), 'day');
}

export function continueRows(
  games: Array<GameSummary | PlayedGame>,
  scenarioNames: Record<string, string>,
  nowMs: number,
): ContinueRow[] {
  return unfinished(games)
    .sort((a, b) => b.lastPlayedMs - a.lastPlayedMs)
    .map((g) => {
      const scenario = scenarioNames[g.scenario] ?? g.scenario;
      const side = g.side ?? 'both sides';
      const gameTime = formatGameTime(g.gameTimeMs);
      const lastPlayed = ago(g.lastPlayedMs, nowMs);
      return {
        id: g.id,
        scenario,
        side,
        gameTime,
        lastPlayed,
        label: `${scenario}, playing ${side}, game time ${gameTime}, last played ${lastPlayed}`,
      };
    });
}
