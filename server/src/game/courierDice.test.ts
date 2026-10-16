/**
 * Courier dice on their own stream (#432): rules 2 changes what a seed draws, so it is versioned.
 * A new game is made under it and says so in its log header; a log from before it has no rules
 * and replays under rules 1, as it was played. The fixture is two games logged by the server
 * before #432 (a real-time game and a rigid turn game, Hold the Bridge, seed 1815), with the
 * state each ended in.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { RULES_VERSION, holdTheBridge, loadScenario, type GameState } from '@kriegsspiel/engine';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrderParser } from '../orders/index.js';
import { GameHost, MemoryGameStore, createRegistry, replayLog, startingState } from './index.js';
import type { InputLogEntry, InputLogHeader } from './store.js';
import { FakeTime } from './testing.js';

interface Final {
  time: number;
  rng: number;
  outcome: GameState['outcome'];
  units: { id: string; x: number; y: number; strength: number; status: string }[];
  worldSha256: string;
}
type Logged = { header: InputLogHeader; entries: InputLogEntry[]; final: Final };

const before432 = JSON.parse(
  readFileSync(new URL('./courierDice.before432.json', import.meta.url), 'utf8'),
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
    loadScenario(holdTheBridge),
    game.entries,
    createRegistry(),
    undefined,
    startingState,
  );

let host: GameHost | undefined;
afterEach(async () => {
  await host?.shutdown();
  host = undefined;
});

describe('courier dice on their own stream, versioned (#432)', () => {
  it.each(['realtime', 'turns'] as const)(
    'replays a %s game logged before #432 to the state it ended in',
    (kind) => {
      const game = before432[kind];
      expect(game.header).not.toHaveProperty('rules');
      const replayed = replay(game).state;
      expect(replayed.world.rules).toBeUndefined();
      expect(summary(replayed)).toEqual(game.final);
    },
  );

  it('would part from it under rules 2, which is why the log header carries the rules', () => {
    // Real time: the same inputs, other dice, another battle.
    const rt = before432.realtime;
    const under2 = replay(rt, { ...rt.header, rules: RULES_VERSION }).state;
    expect(summary(under2).worldSha256).not.toBe(rt.final.worldSha256);
    // A turn game: its logged couriers no longer match the pass, and replay refuses the turn.
    const turns = before432.turns;
    expect(() => replay(turns, { ...turns.header, rules: RULES_VERSION })).toThrow(
      /the courier pass differs from the logged couriers/,
    );
  });

  it('makes a new game under the current rules, logs them and replays under them', async () => {
    const time = new FakeTime();
    const store = new MemoryGameStore();
    const parser: OrderParser = {
      parse: async () => {
        throw new Error('a rigid turn-mode game calls no model');
      },
    };
    host = new GameHost({
      store,
      parser,
      registry: createRegistry(),
      wallNow: time.now,
      timers: time,
      init: startingState,
      scriptedOpponents: true,
    });
    const game = await host.create(
      'g',
      { ...loadScenario(holdTheBridge), seed: 1815 },
      { settings: { dial: 'rigid', persona: 'dry', mode: 'turns', turnMinutes: 20 } },
    );
    expect(game.state.world.rules).toBe(RULES_VERSION);
    const header = (await store.logHeader('g'))!;
    expect(header.rules).toBe(RULES_VERSION);
    for (let n = 0; n < 10 && !game.state.world.outcome; n++) {
      if (n === 0) {
        const order = { orderId: 'b2', to: 'blue-2', text: 'March to the bridge' };
        await game.submit({ kind: 'turnOrder', side: 'blue', turn: 0, order });
      }
      await game.submit({ kind: 'sendTurn', side: 'blue', turn: 0, orders: [] });
      await time.flush();
    }
    const log = await store.inputLog('g');
    const replayed = replayLog(
      header,
      loadScenario(holdTheBridge),
      log,
      createRegistry(),
      undefined,
      startingState,
    ).state;
    expect(JSON.stringify(replayed.world)).toBe(JSON.stringify(game.state.world));
  });
});
