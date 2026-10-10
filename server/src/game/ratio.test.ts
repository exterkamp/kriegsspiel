import {
  EventRegistry,
  holdTheBridge,
  loadScenario,
  registerCombat,
  registerMovement,
  registerOrders,
  registerVisibility,
  serialize,
  type GameState,
} from '@kriegsspiel/engine';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrderParser } from '../orders/index.js';
import { replayLog } from './replay.js';
import { GameHost, MemoryGameStore, type GameActor } from './index.js';
import { FakeTime } from './testing.js';

const BRIDGE = { x: 2_050_000, y: 1_500_000 };

function registry() {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerCombat(r);
  registerOrders(r);
  registerVisibility(r);
  return r;
}

const parser: OrderParser = {
  async parse(text: string) {
    return {
      kind: 'intents' as const,
      text,
      unitId: 'blue-1',
      intents: [{ kind: 'move' as const, to: BRIDGE }],
    };
  },
};

let host: GameHost | undefined;
afterEach(async () => {
  await host?.shutdown();
  host = undefined;
});

async function newGame(opts: { rate?: number; rule?: 'majority' } = {}) {
  const time = new FakeTime();
  const store = new MemoryGameStore();
  host = new GameHost({
    store,
    parser,
    registry: registry(),
    wallNow: time.now,
    timers: time,
    pause: () => ({ voters: ['alice', 'bob'], voteTimeoutMs: 30_000, rule: opts.rule }),
  });
  const game = await host.create('g1', loadScenario(holdTheBridge), { rate: opts.rate ?? 1 });
  return { time, store, game };
}

async function changeRate(game: GameActor, rate: number) {
  await game.submit({ kind: 'proposeRate', by: 'alice', rate });
  const proposal = game.ratioState!.proposal!.id;
  return game.submit({ kind: 'rateVote', by: 'bob', proposal, yes: true });
}

describe('ratio change by vote', () => {
  it('changes the rate only once everyone agrees, without a jump in game time', async () => {
    const { time, game, store } = await newGame();
    await time.advance(10_000);
    await game.submit({ kind: 'proposeRate', by: 'alice', rate: 12 });
    expect(game.ratioState!.proposal).toMatchObject({ rate: 12, by: 'alice' });
    expect(game.gameClock.rate).toBe(1);
    await time.advance(5_000);
    expect(game.gameClock.now()).toBe(15_000);

    await game.submit({
      kind: 'rateVote',
      by: 'bob',
      proposal: game.ratioState!.proposal!.id,
      yes: true,
    });
    expect(game.gameClock.rate).toBe(12);
    // Re-anchored at the moment the vote passed: no jump, then 12 game s per wall s.
    expect(game.gameClock.now()).toBe(15_000);
    await time.advance(1_000);
    expect(game.gameClock.now()).toBe(15_000 + 12_000);

    const log = await store.inputLog('g1');
    expect(log.map((e) => e.command.kind)).toEqual(['proposeRate', 'rateVote']);
    expect(log[0]!.ratio).toMatchObject([{ outcome: 'proposed', rate: 12, by: 'alice' }]);
    expect(log[1]!.ratio).toMatchObject([{ outcome: 'passed', rate: 12, cause: 'all-yes' }]);
    expect(log[1]!.gameMs).toBe(15_000);
  });

  it('a no or a timeout keeps the rate', async () => {
    const { time, game, store } = await newGame();
    await game.submit({ kind: 'proposeRate', by: 'alice', rate: 4 });
    await game.submit({
      kind: 'rateVote',
      by: 'bob',
      proposal: game.ratioState!.proposal!.id,
      yes: false,
    });
    expect(game.gameClock.rate).toBe(1);
    expect(game.ratioState!.proposal).toBeUndefined();

    await game.submit({ kind: 'proposeRate', by: 'bob', rate: 4 });
    await time.advance(30_000);
    expect(game.ratioState!.proposal).toBeUndefined();
    expect(game.gameClock.rate).toBe(1);
    const log = await store.inputLog('g1');
    expect(log.at(-1)).toMatchObject({
      command: { kind: 'rateExpire' },
      ratio: [{ outcome: 'timeout', rate: 4 }],
    });
  });

  it('works while paused, and the new rate applies on resume', async () => {
    const { time, game } = await newGame();
    await time.advance(5_000);
    await game.submit({ kind: 'pause' });
    await changeRate(game, 4);
    expect(game.gameClock.rate).toBe(4);
    expect(game.gameClock.status).toBe('paused');
    await time.advance(60_000);
    expect(game.gameClock.now()).toBe(5_000);
    await game.submit({ kind: 'resume' });
    await time.advance(1_000);
    expect(game.gameClock.now()).toBe(9_000);
  });

  it('refuses non-voters, bad rates, the current rate and a second open vote', async () => {
    const { game } = await newGame();
    expect(await game.submit({ kind: 'proposeRate', by: 'mallory', rate: 4 })).toMatchObject({
      ok: false,
    });
    expect(await game.submit({ kind: 'proposeRate', by: 'alice', rate: -1 })).toMatchObject({
      ok: false,
    });
    expect(await game.submit({ kind: 'proposeRate', by: 'alice', rate: 1 })).toMatchObject({
      ok: false,
    });
    await game.submit({ kind: 'proposeRate', by: 'alice', rate: 4 });
    expect(await game.submit({ kind: 'proposeRate', by: 'bob', rate: 8 })).toMatchObject({
      ok: false,
    });
    expect(game.ratioState!.proposal).toMatchObject({ rate: 4 });
  });

  it('is refused without voters configured', async () => {
    const time = new FakeTime();
    host = new GameHost({
      store: new MemoryGameStore(),
      parser,
      registry: registry(),
      wallNow: time.now,
      timers: time,
    });
    const game = await host.create('g2', loadScenario(holdTheBridge), {});
    expect(await game.submit({ kind: 'proposeRate', by: 'alice', rate: 4 })).toMatchObject({
      ok: false,
    });
  });

  for (const mode of ['realtime', 'manual', 'fast-forward'] as const) {
    it(`${mode}: replay of a game with a ratio change matches the live state`, async () => {
      const { time, game, store } = await newGame({ rate: 4 });
      await game.submit({ kind: 'setMode', mode });
      await game.submit({ kind: 'order', side: 'blue', text: 'blue-1 march' });
      if (mode === 'manual') await game.submit({ kind: 'advanceTo', gameMs: 60_000 });
      await time.advance(20_000);
      await changeRate(game, 12);
      if (mode === 'manual') await game.submit({ kind: 'advanceTo', gameMs: 600_000 });
      await time.advance(600_000);
      await game.submit({ kind: 'setMode', mode: 'manual' });
      await game.submit({ kind: 'advanceTo', gameMs: 900_000 });
      const replayed = replayLog(
        { gameId: 'g1', scenarioId: 'hold-the-bridge', seed: game.state.world.seed },
        loadScenario(holdTheBridge),
        await store.inputLog('g1'),
        registry(),
      );
      expect(serialize(replayed.state)).toBe(serialize(game.state));
    });
  }

  it('a reopened game keeps the voted rate', async () => {
    const { time, game, store } = await newGame();
    await time.advance(1_000);
    await changeRate(game, 12);
    await host!.close('g1');
    const reopened = await host!.open('g1');
    expect(reopened.gameClock.rate).toBe(12);
    expect(store).toBeDefined();
  });
});
