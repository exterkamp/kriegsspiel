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
import type { ClockMode } from '../clock.js';
import { FakeTime } from './testing.js';

const BRIDGE = { x: 2_050_000, y: 1_500_000 };
const VOTERS = ['alice', 'bob'];

function registry() {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerCombat(r);
  registerOrders(r);
  registerVisibility(r);
  return r;
}

class GateParser implements OrderParser {
  gate: Promise<void> | undefined;
  async parse(text: string) {
    await this.gate;
    return {
      kind: 'intents' as const,
      text,
      unitId: 'blue-1',
      intents: [{ kind: 'move' as const, to: BRIDGE }],
    };
  }
}

let host: GameHost | undefined;
afterEach(async () => {
  await host?.shutdown();
  host = undefined;
});

async function newGame(
  opts: { rate?: number; maxPauseMs?: number; rule?: 'majority'; voters?: string[] } = {},
) {
  const time = new FakeTime();
  const store = new MemoryGameStore();
  const parser = new GateParser();
  host = new GameHost({
    store,
    parser,
    registry: registry(),
    wallNow: time.now,
    timers: time,
    pause: () => ({
      voters: opts.voters ?? VOTERS,
      voteTimeoutMs: 30_000,
      maxPauseMs: opts.maxPauseMs,
      rule: opts.rule,
    }),
  });
  const game = await host.create('g1', loadScenario(holdTheBridge), { rate: opts.rate });
  return { time, store, parser, game };
}

const order = { kind: 'order', side: 'blue', text: 'blue-1 march' } as const;
const blue1 = (g: GameActor) => g.state.world.units.find((u) => u.id === 'blue-1')!;

async function pauseGame(game: GameActor) {
  await game.submit({ kind: 'proposePause', by: 'alice', reason: 'door' });
  const proposal = game.pauseState!.proposal!.id;
  await game.submit({ kind: 'vote', by: 'bob', proposal, yes: true });
}

describe('pause voting in a game', () => {
  it('stops game time only once everyone agrees, and journals each step', async () => {
    const { time, game, store } = await newGame();
    await time.advance(10_000);
    await game.submit({ kind: 'proposePause', by: 'alice', reason: 'door' });
    expect(game.pauseState).toMatchObject({ phase: 'pause_proposed' });
    expect(game.gameClock.status).toBe('running');
    await time.advance(5_000);
    const proposal = game.pauseState!.proposal!.id;
    await game.submit({ kind: 'vote', by: 'bob', proposal, yes: true });
    expect(game.pauseState).toMatchObject({ phase: 'paused' });
    expect(game.gameClock.status).toBe('paused');
    const frozen = game.gameClock.now();
    expect(frozen).toBe(15_000);
    await time.advance(600_000);
    expect(game.gameClock.now()).toBe(frozen);

    const log = await store.inputLog('g1');
    expect(log.map((e) => e.command.kind)).toEqual(['proposePause', 'vote']);
    expect(log[0]!.pause).toMatchObject([{ from: 'running', to: 'pause_proposed', by: 'alice' }]);
    expect(log[1]!.pause).toMatchObject([{ to: 'paused', cause: 'all-yes' }]);
  });

  it('a single no keeps the game running', async () => {
    const { time, game } = await newGame();
    await game.submit({ kind: 'proposePause', by: 'alice' });
    const proposal = game.pauseState!.proposal!.id;
    await game.submit({ kind: 'vote', by: 'bob', proposal, yes: false });
    expect(game.pauseState).toMatchObject({ phase: 'running' });
    await time.advance(1000);
    expect(game.gameClock.now()).toBe(1000);
  });

  it('a vote that times out cancels, and is journaled', async () => {
    const { time, game, store } = await newGame();
    await game.submit({ kind: 'proposePause', by: 'alice' });
    await time.advance(29_999);
    expect(game.pauseState!.phase).toBe('pause_proposed');
    await time.advance(1);
    expect(game.pauseState!.phase).toBe('running');
    expect(game.gameClock.status).toBe('running');
    const log = await store.inputLog('g1');
    expect(log.at(-1)).toMatchObject({
      command: { kind: 'pauseExpire' },
      pause: [{ to: 'running', cause: 'timeout' }],
    });
  });

  it('majority mode: a majority is enough', async () => {
    const { game } = await newGame({ rule: 'majority', voters: ['alice', 'bob', 'carol'] });
    // Three voters: the proposer's yes is one of three, so not yet a majority.
    await game.submit({ kind: 'proposePause', by: 'alice' });
    expect(game.pauseState!.phase).toBe('pause_proposed');
    // A second yes is a majority; carol has not voted.
    await game.submit({
      kind: 'vote',
      by: 'bob',
      proposal: game.pauseState!.proposal!.id,
      yes: true,
    });
    expect(game.pauseState!.phase).toBe('paused');
    expect(game.gameClock.status).toBe('paused');
  });

  it('a plain host pause or resume settles any open proposal', async () => {
    const { game } = await newGame();
    await game.submit({ kind: 'proposePause', by: 'alice' });
    await game.submit({ kind: 'pause' });
    expect(game.pauseState!.phase).toBe('paused');
    expect(game.pauseState!.proposal).toBeUndefined();
    expect(game.gameClock.status).toBe('paused');

    await game.submit({ kind: 'proposeResume', by: 'alice' });
    expect(game.pauseState!.phase).toBe('resume_proposed');
    await game.submit({ kind: 'resume' });
    expect(game.pauseState!.phase).toBe('running');
    expect(game.pauseState!.proposal).toBeUndefined();
    expect(game.gameClock.status).toBe('running');
    // A fresh pause proposal is accepted again.
    await game.submit({ kind: 'proposePause', by: 'bob' });
    expect(game.pauseState!.phase).toBe('pause_proposed');
  });

  it('resumes by vote and by the maximum pause length', async () => {
    const { time, game } = await newGame({ maxPauseMs: 120_000 });
    await pauseGame(game);
    await game.submit({ kind: 'proposeResume', by: 'bob' });
    expect(game.pauseState!.phase).toBe('resume_proposed');
    expect(game.gameClock.status).toBe('paused');
    const proposal = game.pauseState!.proposal!.id;
    await game.submit({ kind: 'vote', by: 'alice', proposal, yes: false });
    expect(game.pauseState!.phase).toBe('paused');

    await time.advance(120_000);
    expect(game.pauseState!.phase).toBe('running');
    expect(game.gameClock.status).toBe('running');

    await pauseGame(game);
    await game.submit({ kind: 'proposeResume', by: 'bob' });
    await game.submit({
      kind: 'vote',
      by: 'alice',
      proposal: game.pauseState!.proposal!.id,
      yes: true,
    });
    expect(game.gameClock.status).toBe('running');
  });

  it('refuses votes from people who are not voters', async () => {
    const { game } = await newGame();
    const res = await game.submit({ kind: 'proposePause', by: 'mallory' });
    expect(res).toMatchObject({ ok: false });
    expect(game.pauseState!.phase).toBe('running');
  });

  it('pausing while the umpire is working holds the order until resume', async () => {
    const { time, game, parser } = await newGame();
    await time.advance(2_000);
    let release!: () => void;
    parser.gate = new Promise((r) => (release = r));
    const pending = game.submit(order);
    await time.advance(1_000);
    await pauseGame(game);
    expect(game.staffAtWork).toMatchObject({ working: true });
    release();
    expect(await pending).toMatchObject({ ok: true });
    await time.advance(3_600_000);
    // Stamped with the signing time, nothing moves while paused.
    expect(game.state.time).toBe(2_000);
    expect(blue1(game).intent.kind).toBe('idle');

    await game.submit({ kind: 'proposeResume', by: 'alice' });
    await game.submit({
      kind: 'vote',
      by: 'bob',
      proposal: game.pauseState!.proposal!.id,
      yes: true,
    });
    await time.advance(3_600_000);
    expect(blue1(game).center).toEqual(BRIDGE);
  });
});

describe('a pause does not change outcomes', () => {
  const cases: { name: string; rate: number; mode: ClockMode }[] = [
    { name: 'rate 1', rate: 1, mode: 'realtime' },
    { name: 'rate 4', rate: 4, mode: 'realtime' },
    { name: 'rate 12', rate: 12, mode: 'realtime' },
    { name: 'manual', rate: 1, mode: 'manual' },
    { name: 'fast-forward', rate: 1, mode: 'fast-forward' },
  ];

  for (const c of cases) {
    it(`${c.name}: same final state with and without a pause, and replay agrees`, async () => {
      const run = async (withPause: boolean) => {
        const { time, game, store } = await newGame({ rate: c.rate });
        await game.submit({ kind: 'setMode', mode: c.mode });
        await game.submit(order);
        if (c.mode === 'manual') await game.submit({ kind: 'advanceTo', gameMs: 60_000 });
        await time.advance(30_000);
        if (withPause) {
          await pauseGame(game);
          await time.advance(900_000);
          await game.submit({ kind: 'proposeResume', by: 'alice' });
          await game.submit({
            kind: 'vote',
            by: 'bob',
            proposal: game.pauseState!.proposal!.id,
            yes: true,
          });
        }
        if (c.mode === 'manual') await game.submit({ kind: 'advanceTo', gameMs: 900_000 });
        await time.advance(900_000);
        await game.submit({ kind: 'setMode', mode: 'manual' });
        await game.submit({ kind: 'advanceTo', gameMs: 900_000 });
        const log = await store.inputLog('g1');
        const replayed = replayLog(
          {
            gameId: 'g1',
            scenarioId: 'hold-the-bridge',
            seed: game.state.world.seed,
            rules: game.state.world.rules,
          },
          loadScenario(holdTheBridge),
          log,
          registry(),
        );
        await host?.shutdown();
        return { live: serialize(game.state), replayed: serialize(replayed.state) };
      };
      const plain = await run(false);
      const paused = await run(true);
      expect(paused.live).toBe(plain.live);
      expect(paused.replayed).toBe(paused.live);
    });
  }
});
