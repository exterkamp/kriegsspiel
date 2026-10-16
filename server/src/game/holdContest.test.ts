/**
 * A contested objective (#528): under rules 3 the objective's hold counts only while no standing
 * enemy is in contact with a holder or within `CONTEST_RADIUS_M` of it. It changes outcomes, so it
 * is a rules version, and a game logged under rules 2 replays as it was played. The fixture is two
 * games logged by the server before #528 (rules 2: a real-time game and a rigid turn game of 20
 * minutes, Hold the Bridge, seed 12, no Blue orders), with the state each ended in. In both Red
 * takes the bridge while Blue's idle battalions fire on it from the south bank.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { RULES_VERSION, holdTheBridge, loadScenario, type GameState } from '@kriegsspiel/engine';
import { describe, expect, it } from 'vitest';
import { createRegistry, replayLog, startingState } from './index.js';
import type { InputLogEntry, InputLogHeader } from './store.js';

interface Final {
  time: number;
  rng: number;
  outcome: GameState['outcome'];
  units: { id: string; x: number; y: number; strength: number; status: string }[];
  worldSha256: string;
}
type Logged = { header: InputLogHeader; entries: InputLogEntry[]; final: Final };

const before528 = JSON.parse(
  readFileSync(new URL('./holdContest.before528.json', import.meta.url), 'utf8'),
) as { realtime: Logged; turns: Logged };

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
  worldSha256: createHash('sha256').update(JSON.stringify(state.world)).digest('hex'),
});

const replay = (game: Logged, header: InputLogHeader = game.header) =>
  replayLog(
    header,
    { ...loadScenario(holdTheBridge), seed: 12 },
    game.entries,
    createRegistry(),
    undefined,
    startingState,
  );

describe('a contested objective, versioned (#528)', () => {
  it('is rules 3', () => {
    expect(RULES_VERSION).toBe(3);
  });

  it.each(['realtime', 'turns'] as const)(
    'replays a %s game logged under rules 2 to the state it ended in',
    (kind) => {
      const game = before528[kind];
      expect(game.header.rules).toBe(2);
      expect(game.final.outcome).toMatchObject({ winner: 'red', reason: 'objective-taken' });
      const replayed = replay(game).state;
      expect(replayed.world.rules).toBe(2);
      expect(summary(replayed)).toEqual(game.final);
    },
  );

  it('would part from it under rules 3, which is why the log header carries the rules', () => {
    // Real time: the same inputs, but Red's hold under Blue's fire no longer counts.
    const rt = before528.realtime;
    const under3 = replay(rt, { ...rt.header, rules: 3 }).state;
    expect(under3.world.outcome).not.toEqual(rt.final.outcome);
    expect(under3.world.outcome).toMatchObject({ winner: 'blue' });
    // The turn game: its last turn no longer ends it at the minute it was logged as won.
    const turns = before528.turns;
    const turns3 = replay(turns, { ...turns.header, rules: 3 }).state;
    expect(turns3.time).toBe(turns.final.time);
    expect(turns3.world.outcome).toBeNull();
  });
});
