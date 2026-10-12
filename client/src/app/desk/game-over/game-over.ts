/** The game-over screen's pure logic: what the result means for the player's side, and the Play again request. */
import type { Side } from '@kriegsspiel/protocol';
import { formatGameTime, type GameOver } from '@legacy/net/state';
import type { GameInfo } from '@legacy/lobby/api';

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
    case 'attack-broken':
      return `The attack on the objective was broken; ${w} holds the field at ${at}.`;
    case 'defence-broken':
      return `The defence of the objective was broken; ${w} holds the field at ${at}.`;
    case 'withdrawn':
      return over.winner === null
        ? `Both sides withdrew by ${at}.`
        : `The enemy withdrew from the field at ${at}.`;
  }
}

/** Strength lost per side between two true-position frames of the umpire's window. */
export function lossesBetween(
  start: { units: { id: string; side: string; strength: number }[] },
  end: { units: { id: string; side: string; strength: number }[] },
  side: string,
): { own: number; enemy: number } {
  const endById = new Map(end.units.map((u) => [u.id, u.strength]));
  const lost = { own: 0, enemy: 0 };
  for (const u of start.units) {
    const l = Math.max(0, u.strength - (endById.get(u.id) ?? 0));
    lost[u.side === side ? 'own' : 'enemy'] += Math.round(l);
  }
  return lost;
}

/** The lines under the headline; losses appear once the umpire's reveal has been read. */
export function summaryLines(over: GameOver, losses?: { own: number; enemy: number }): string[] {
  const lines = [`Game time elapsed: ${formatGameTime(over.atGame)}`];
  if (losses) lines.push(`Your losses: ${losses.own}`, `Enemy losses: ${losses.enemy}`);
  return lines;
}

/** The body of the POST /games that repeats a finished game: same scenario, side, rate, session type and pause settings. */
export function replayRequest(
  info: Pick<GameInfo, 'scenario' | 'rate' | 'sessionType'> & Partial<Pick<GameInfo, 'pause'>>,
  side: string | undefined,
) {
  return {
    scenario: info.scenario,
    rate: info.rate,
    sessionType: info.sessionType,
    ...(info.pause ? { pause: info.pause } : {}),
    ...(side ? { side } : {}),
  };
}
