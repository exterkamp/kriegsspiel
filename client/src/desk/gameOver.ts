/** The game-over screen's pure logic: what the result means for the player's side, and the Play again request. */
import type { Side } from '@kriegsspiel/protocol';
import { formatGameTime, type GameOver } from '../net/state.js';
import type { GameInfo } from '../lobby/api.js';

export type Result = 'victory' | 'defeat' | 'draw';

/** Victory or defeat for `side`; no winner is a draw. */
export function resultFor(over: Pick<GameOver, 'winner'>, side: string | undefined): Result {
  if (over.winner === null) return 'draw';
  return over.winner === side ? 'victory' : 'defeat';
}

export const HEADLINE: Record<Result, string> = {
  victory: 'Victory',
  defeat: 'Defeat',
  draw: 'Draw',
};

const cap = (s: string): string => `${s[0]!.toUpperCase()}${s.slice(1)}`;

/** The reason in words, from the winner and the server's reason code, at the game time it happened. */
export function reasonText(over: GameOver): string {
  const at = formatGameTime(over.atGame);
  const w: string = over.winner === null ? 'Neither side' : cap(over.winner satisfies Side);
  switch (over.reason) {
    case 'objective-taken':
      return `${w} took the objective at ${at}.`;
    case 'objective-held':
      return `${w} held the objective at ${at}.`;
    case 'eliminated':
      return over.winner === null
        ? `Both sides were destroyed by ${at}.`
        : `The enemy was eliminated at ${at}.`;
    case 'withdrawn':
      return over.winner === null
        ? `Both sides withdrew by ${at}.`
        : `The enemy withdrew from the field at ${at}.`;
  }
}

/** The lines under the headline. */
export function summaryLines(over: GameOver): string[] {
  return [`Game time elapsed: ${formatGameTime(over.atGame)}`];
}

/** The body of the POST /games that repeats a finished game: same scenario, side, rate and session type. */
export function replayRequest(
  info: Pick<GameInfo, 'scenario' | 'rate' | 'sessionType'>,
  side: string | undefined,
) {
  return {
    scenario: info.scenario,
    rate: info.rate,
    sessionType: info.sessionType,
    ...(side ? { side } : {}),
  };
}
