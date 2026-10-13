import { holdTheBridge, loadScenario } from '@kriegsspiel/engine';
import type { UmpireSettings } from '@kriegsspiel/protocol';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrderParser } from '../orders/index.js';
import { sideViewOf } from '../api/sideView.js';
import { GameHost, MemoryGameStore, createRegistry, startingState } from './index.js';
import { loadReplayInput, replayAt, replayTimeline } from '../admin/replayView.js';
import type { InputLogEntry, InputLogHeader } from './store.js';
import { FakeTime } from './testing.js';

const MINUTE = 60_000;
const HOUR = 3_600_000;

type Scenario = ReturnType<typeof loadScenario>;

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
 * Hold the Bridge with Blue's one battalion far from the river and the rest left out, so the
 * scripted Red marches onto the bridge unopposed: no fight can break its attack, and its hold
 * starts at 00:15 whenever its sides think (#435). The game-end rules are what these tests prove,
 * not who wins the fight for the bridge.
 */
function unopposed(victory: { holdMs?: number; takeMs?: number } = {}): Scenario {
  const units = holdTheBridge.units
    .filter((u) => u.side === 'red' || u.id === 'blue-1')
    .map((u) => (u.id === 'blue-1' ? { ...u, at: { x: 200, y: 2900 } } : u));
  const s = loadScenario({ ...holdTheBridge, units });
  return { ...s, seed: 1815, victory: { ...s.victory, ...victory } };
}

/** When Red's hold on the bridge starts in `unopposed`, to the game minute (#435). */
const HOLD_FROM = 15 * MINUTE;

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
  log: readonly InputLogEntry[];
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

const opened = (log: readonly InputLogEntry[]) =>
  log.flatMap((e) => (e.command.kind === 'openTurn' && !e.error ? [e.command] : []));
const resolved = (log: readonly InputLogEntry[]) =>
  log.flatMap((e) => (e.command.kind === 'resolveTurn' && !e.error ? [e] : []));

/** The game is over everywhere a player looks: state, clock, view and the turn shown. */
function expectOver(game: Awaited<ReturnType<GameHost['create']>>, at: number): void {
  expect(game.state.world.outcome?.time).toBe(at);
  expect(game.state.time).toBe(at);
  expect(game.gameClock.status).toBe('stopped');
  expect(game.gameClock.now()).toBe(at);
  expect(game.turnStateFor('blue')).toBeUndefined();
  expect(game.turnStateFor('red')).toBeUndefined();
  for (const side of ['blue', 'red'] as const) {
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
      // First check when Red's hold on the bridge starts (it starts part-way through a minute).
      const probe = await play(unopposed({ holdMs: 4 * HOUR, takeMs: 3 * HOUR }), turnMinutes);
      const since = probe.heldSince.find((s) => typeof s === 'number')!;
      expect(since).toBe(HOLD_FROM);
      // Then make the hold complete at the end of a turn: counted to the game minute, as the
      // clock shows it, the take falls on the turn end and decides that turn.
      const minute = Math.floor(since / MINUTE) * MINUTE;
      let end = Math.ceil((minute + MINUTE) / turnMs) * turnMs;
      if (end - minute < 2 * MINUTE) end += turnMs;
      const { game, log } = await play(
        unopposed({ holdMs: 4 * HOUR, takeMs: end - minute }),
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

  it('ends a 20-minute game at 00:40 with turn 2 when the take falls at its end, as in the QA game', async () => {
    // The QA game's hold completed in the minute turn 2 ended at; here the hold starts at 00:15
    // and takes 25 minutes, so it completes at 00:40 too.
    const { game, log } = await play(unopposed({ takeMs: 40 * MINUTE - HOLD_FROM }), 20);
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
    const { game, log } = await play(unopposed(), 10);
    expect(game.state.world.outcome).toMatchObject({ winner: 'red', reason: 'objective-taken' });
    const at = game.state.world.outcome!.time;
    const last = opened(log).at(-1)!;
    expect(last.turn).toBe(3);
    expect(at).toBeGreaterThan(last.startMs);
    expect(at).toBeLessThan(last.endMs);
    expectOver(game, at);
    expect(resolved(log).at(-1)?.endGameMs).toBe(at);
  });

  it('replays a turn log from before #429 to the corrected end, past its phantom turn', async () => {
    // The 20-minute game as main logged it: the hold fell 0.268 s into turn 3, which was opened,
    // sent and resolved. Replayed under the minute rule the game is over at 00:40, and the logged
    // turn 3 is not applied to the stopped world.
    const { header, entries } = JSON.parse(
      readFileSync(new URL('./turnEnd.before429.json', import.meta.url), 'utf8'),
    ) as { header: InputLogHeader; entries: InputLogEntry[] };
    expect(opened(entries).map((t) => t.turn)).toEqual([1, 2, 3]);
    const store = new MemoryGameStore();
    await store.saveLogHeader(header);
    for (const e of entries) await store.appendInput(header.gameId, e);
    const input = (await loadReplayInput(store, header.gameId))!;
    const tl = replayTimeline(input);
    expect(tl.outcome).toMatchObject({
      winner: 'red',
      reason: 'objective-taken',
      time: 40 * MINUTE,
    });
    expect(tl.endMs).toBe(40 * MINUTE);
    expect(replayAt(input, tl.endMs).views.blue).toBeDefined();
  });
});
