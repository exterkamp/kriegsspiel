import { holdTheBridge, loadScenario, type Scenario } from '@kriegsspiel/engine';
import type { UmpireSettings } from '@kriegsspiel/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrderParser } from '../orders/index.js';
import { sideViewOf } from '../api/sideView.js';
import { GameHost, MemoryGameStore, createRegistry, startingState } from './index.js';
import type { InputLogEntry } from './store.js';
import { FakeTime } from './testing.js';

const MINUTE = 60_000;
const HOUR = 3_600_000;

const parser: OrderParser = {
  parse: async () => {
    throw new Error('a rigid turn-mode game calls no model');
  },
};

let host: GameHost | undefined;
afterEach(async () => {
  await host?.shutdown();
  host = undefined;
});

/** Hold the Bridge against the scripted Red, with the time limit and the hold time given. */
function scenario(victory: { holdMs?: number; takeMs?: number } = {}): Scenario {
  const s = loadScenario(holdTheBridge);
  return { ...s, seed: 1815, victory: { ...s.victory, ...victory } };
}

/**
 * Play a rigid turn game with Blue sending nothing: each turn closes when Blue sends, or, with a
 * deadline, when the deadline passes. Stops when the game is over, or after `maxTurns`.
 */
async function play(
  sc: Scenario,
  turnMinutes: number,
  deadlineHours?: number,
  maxTurns = 40,
): Promise<{
  game: Awaited<ReturnType<GameHost['create']>>;
  log: InputLogEntry[];
  heldSince: (number | null | undefined)[];
}> {
  await host?.shutdown();
  const time = new FakeTime();
  const store = new MemoryGameStore();
  host = new GameHost({
    store,
    parser,
    registry: createRegistry(),
    wallNow: time.now,
    timers: time,
    init: startingState,
    scriptedOpponents: true,
  });
  const settings: UmpireSettings = {
    dial: 'rigid',
    persona: 'dry',
    mode: 'turns',
    turnMinutes,
    ...(deadlineHours === undefined ? {} : { turnDeadlineHours: deadlineHours }),
  };
  const game = await host.create('g1', sc, { settings });
  const heldSince: (number | null | undefined)[] = [];
  for (let n = 0; n < maxTurns && game.turnStateFor('blue'); n++) {
    if (deadlineHours === undefined) {
      expect(await game.submit({ kind: 'sendTurn', side: 'blue', turn: 0, orders: [] })).toEqual({
        ok: true,
      });
      await time.flush();
    } else {
      await time.advance(deadlineHours * HOUR + MINUTE);
      await time.flush();
    }
    heldSince.push(game.state.world.heldSince);
  }
  return { game, log: await store.inputLog('g1'), heldSince };
}

const opened = (log: InputLogEntry[]) =>
  log.flatMap((e) => (e.command.kind === 'openTurn' && !e.error ? [e.command] : []));
const resolved = (log: InputLogEntry[]) =>
  log.flatMap((e) => (e.command.kind === 'resolveTurn' && !e.error ? [e] : []));

/** The game is over everywhere a player looks: state, clock, view and the turn shown. */
function expectOver(game: Awaited<ReturnType<GameHost['create']>>, at: number): void {
  expect(game.state.world.outcome?.time).toBe(at);
  expect(game.state.time).toBe(at);
  expect(game.gameClock.status).toBe('stopped');
  expect(game.gameClock.now()).toBe(at);
  expect(game.turnStateFor('blue')).toBeUndefined();
  expect(game.turnStateFor('red')).toBeUndefined();
  for (const side of ['blue', 'red']) {
    const view = sideViewOf(game.state, side, game.gameClock.snapshot());
    expect(view.atGame).toBe(at);
    expect(view.clock.status).toBe('stopped');
    // The decisive turn's last paper is the umpire's ruling on the outcome, in both in-trays.
    const papers = view.dispatches.filter((d) => d.text.includes('The game is over'));
    expect(papers).toHaveLength(1);
    expect(papers[0]).toMatchObject({ from: "The umpire's ruling", receivedAtGame: at });
  }
}

describe('turn mode: the game ends in the turn that decides it (#429)', () => {
  const cases = [10, 20, 30].flatMap((m) => [
    { turnMinutes: m, deadlineHours: undefined },
    { turnMinutes: m, deadlineHours: 2 },
  ]);

  it.each(cases)(
    'opens no further turn when the objective falls at the end of a $turnMinutes-minute turn (deadline $deadlineHours h)',
    async ({ turnMinutes, deadlineHours }) => {
      const turnMs = turnMinutes * MINUTE;
      // First find when Red's hold on the bridge starts (it starts part-way through a minute).
      const probe = await play(scenario({ holdMs: 4 * HOUR, takeMs: 3 * HOUR }), turnMinutes);
      const since = probe.heldSince.find((s) => typeof s === 'number')!;
      expect(since).toBeTypeOf('number');
      // Then make the hold complete at the end of a turn: counted to the game minute, as the
      // clock shows it, the take falls on the turn end and decides that turn.
      const minute = Math.floor(since / MINUTE) * MINUTE;
      let end = Math.ceil((minute + MINUTE) / turnMs) * turnMs;
      if (end - minute < 2 * MINUTE) end += turnMs;
      const { game, log } = await play(
        scenario({ holdMs: 4 * HOUR, takeMs: end - minute }),
        turnMinutes,
        deadlineHours,
      );
      expect(game.state.world.outcome).toMatchObject({
        winner: 'red',
        reason: 'objective-taken',
        time: end,
      });
      expectOver(game, end);
      // The turn that ended at the take was the last: no turn was opened after it.
      expect(opened(log).at(-1)).toMatchObject({ endMs: end });
      expect(resolved(log).at(-1)?.endGameMs).toBe(end);
    },
  );

  it.each([10, 20, 30])(
    'ends at the time limit with the last %i-minute turn and opens no other',
    async (turnMinutes) => {
      // Red cannot take the bridge in time: the defender wins at the time limit.
      const holdMs = 50 * MINUTE;
      const { game, log } = await play(scenario({ holdMs, takeMs: 3 * HOUR }), turnMinutes);
      expect(game.state.world.outcome).toMatchObject({ reason: 'objective-held', time: holdMs });
      expectOver(game, holdMs);
      expect(opened(log).at(-1)).toMatchObject({ endMs: holdMs });
    },
  );

  it('ends the 20-minute Hold the Bridge game at 00:40 with turn 2, as in the QA game', async () => {
    const { game, log } = await play(scenario(), 20);
    expect(game.state.world.outcome).toMatchObject({
      winner: 'red',
      reason: 'objective-taken',
      time: 40 * MINUTE,
    });
    expectOver(game, 40 * MINUTE);
    expect(opened(log).map((t) => t.turn)).toEqual([1, 2]);
  });

  it('ends a turn at the victory when it falls inside the turn', async () => {
    // 10-minute turns: Red's hold starts at 00:15 and completes at 00:25, inside turn 3.
    const { game, log } = await play(scenario(), 10);
    const at = game.state.world.outcome!.time;
    const last = opened(log).at(-1)!;
    expect(last.turn).toBe(3);
    expect(at).toBeGreaterThan(last.startMs);
    expect(at).toBeLessThan(last.endMs);
    expectOver(game, at);
    expect(resolved(log).at(-1)?.endGameMs).toBe(at);
  });
});
