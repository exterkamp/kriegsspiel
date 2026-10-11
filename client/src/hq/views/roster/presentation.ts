import { formatGameAge, formatGameTime } from '../../presentation/gameTime';
import type { GameMs, Knowledge, Scope } from '../../contracts';

export function sameScope(a: Scope, b: Scope): boolean {
  return a.gameId === b.gameId && a.sideId === b.sideId && a.playerId === b.playerId;
}

/** Display time is supplied by the coordinator; this view never runs a clock. */
export function snapshotAge(atGame: GameMs, gameMs: number | null): number | null {
  if (
    gameMs === null ||
    !Number.isSafeInteger(gameMs) ||
    !Number.isSafeInteger(atGame) ||
    atGame < 0 ||
    gameMs < atGame
  )
    return null;
  return gameMs - atGame;
}
export function provenance(atGame: GameMs, gameMs: number | null): string {
  const age = snapshotAge(atGame, gameMs);
  return `Snapshot at ${formatGameTime(atGame)} · ${formatGameAge(age)}`;
}
export function numberValue(knowledge: Knowledge<number>, percent = false): string {
  if (knowledge.kind === 'unknown') return 'Unknown';
  return percent ? `${Math.round(knowledge.value * 1000) / 10}%` : String(knowledge.value);
}

/** Only valid identical snapshot times can share the caption's provenance. */
export function sharesSnapshot(atGame: GameMs, snapshotAtGame: GameMs): boolean {
  return Number.isSafeInteger(atGame) && atGame >= 0 && atGame === snapshotAtGame;
}
