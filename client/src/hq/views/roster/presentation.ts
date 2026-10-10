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
  return `Snapshot at ${atGame} game ms · ${age === null ? 'age unavailable' : age === 0 ? 'current snapshot' : `${Math.floor(age / 1000)} s old`}`;
}
export function numberValue(knowledge: Knowledge<number>, percent = false): string {
  if (knowledge.kind === 'unknown') return 'Unknown';
  return percent ? `${Math.round(knowledge.value * 1000) / 10}%` : String(knowledge.value);
}
