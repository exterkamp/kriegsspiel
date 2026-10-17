import type { GameState } from '@kriegsspiel/engine';

/**
 * The world as the playtest games were played (#408): their closing time-limit paper read
 * "on the High road,." (#538), a stray comma the engine no longer writes. The logged hashes are
 * of that text, so a test hashes `asPlayed(world)`, and a replay that differs anywhere else still
 * fails.
 */
const PLAYED_COMMA = /(has not taken the objective [^.]*, on [^.,]*)(\. The game is over)/;

export const asPlayed = (world: GameState): GameState => ({
  ...world,
  intel: Object.fromEntries(
    Object.entries(world.intel).map(([side, intel]) => [
      side,
      {
        ...intel,
        reports: intel.reports.map((r) =>
          r.from === "The umpire's ruling" && r.text && PLAYED_COMMA.test(r.text)
            ? { ...r, text: r.text.replace(PLAYED_COMMA, '$1,$2') }
            : r,
        ),
      },
    ]),
  ) as GameState['intel'],
});
