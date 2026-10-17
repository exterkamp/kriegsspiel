/**
 * Interception needs reach (#531): under rules 4 an enemy takes a courier only if it could ride to
 * it, never across the river except by a crossing within reach that the courier's side does not
 * hold. It changes outcomes, so it is a rules version, and a game logged under rules 3 replays as it
 * was played. The fixtures are the 11.12 playtest's three games (#408, rules 3, `playtest408/`):
 * in both umpire games Blue's cavalry, south of the bridge Red held, took Red's courier riding on the
 * north bank; in the rigid game the same squadron, standing on the north bank, took one there.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { RULES_VERSION, type GameState } from '@kriegsspiel/engine';
import { describe, expect, it } from 'vitest';
import { createRegistry, loadScenarioById, replayLog, startingState } from './index.js';
import type { InputLogEntry, InputLogHeader } from './store.js';
import { asPlayed } from './playtest408/asPlayed.js';

interface Final {
  time: number;
  rng: number;
  outcome: GameState['outcome'];
  units: { id: string; x: number; y: number; strength: number; status: string }[];
  worldSha256: string;
}
type Logged = { header: InputLogHeader; entries: InputLogEntry[]; final: Final };

const load = (name: string): Logged =>
  JSON.parse(
    readFileSync(new URL(`./playtest408/${name}.json`, import.meta.url), 'utf8'),
  ) as Logged;

const summary = (state: { time: number; rng: number; world: GameState }): Final => ({
  time: state.time,
  rng: state.rng,
  outcome: state.world.outcome,
  units: state.world.units.map((u) => ({
    id: u.id,
    x: u.center.x,
    y: u.center.y,
    strength: u.strength,
    status: u.status,
  })),
  // The logged hashes are of the world as played, with #538's old comma (asPlayed).
  worldSha256: createHash('sha256')
    .update(JSON.stringify(asPlayed(state.world)))
    .digest('hex'),
});

const replay = (game: Logged, header: InputLogHeader = game.header) =>
  replayLog(
    header,
    loadScenarioById(game.header.scenarioId),
    game.entries,
    createRegistry(),
    undefined,
    startingState,
  );

/** The documents Blue took from Red's couriers, by the minute and place they were taken. */
const captured = (world: GameState) =>
  world.intel.blue.documents
    .filter((d) => d.kind === 'capturedDispatch')
    .map((d) => ({
      minute: d.capturedAt / 60_000,
      x: d.location.x / 1000,
      y: d.location.y / 1000,
    }));

describe('interception needs reach, versioned (#531)', () => {
  it('is rules 5', () => {
    expect(RULES_VERSION).toBe(5);
  });

  it.each(['standard', 'free', 'rigid'] as const)(
    '%s: replays a game logged under rules 3 to the state it ended in, its interception included',
    (name) => {
      const game = load(name);
      expect(game.header.rules).toBe(3);
      const replayed = replay(game).state;
      expect(replayed.world.rules).toBe(3);
      expect(summary(replayed)).toEqual(game.final);
      expect(captured(replayed.world)).toEqual([
        name === 'rigid' ? { minute: 21, x: 2050, y: 843.539 } : { minute: 41, x: 2050, y: 1250 },
      ]);
    },
  );

  it.each(['standard', 'free'] as const)(
    '%s: would part from it under rules 4: the cavalry south of the held bridge takes nothing',
    (name) => {
      // The umpire's turn 3 was logged with the courier pass of rules 3 (Red's order to its Hussars
      // "intercepted by blue-3"); under rules 4 the pass delivers it, and replay refuses the turn.
      const game = load(name);
      expect(() => replay(game, { ...game.header, rules: 4 })).toThrow(
        /^turn 3: the courier pass differs/,
      );
    },
  );

  it('rigid: the same under rules 4, since the cavalry that took the courier stood on its bank', () => {
    const game = load('rigid');
    const under4 = replay(game, { ...game.header, rules: 4 }).state;
    expect(under4.world.rules).toBe(4);
    expect(captured(under4.world)).toEqual([{ minute: 21, x: 2050, y: 843.539 }]);
    expect({ ...summary(under4), worldSha256: undefined }).toEqual({
      ...game.final,
      worldSha256: undefined,
    });
  });
});
