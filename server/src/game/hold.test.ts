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
const HOLD_MS = 60_000;

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
  opts: { rate?: number; holdsPerPlayer?: number; holdsPerGame?: number; earlyMs?: number } = {},
) {
  const time = new FakeTime();
  // Real timers run on the monotonic clock and can wake a millisecond before Date.now() reaches
  // the deadline they were set for: `earlyMs` makes every timer longer than that wake so early.
  const early = opts.earlyMs ?? 0;
  const timers = {
    setTimeout: (fn: () => void, ms: number) => time.setTimeout(fn, ms > early ? ms - early : ms),
    clearTimeout: (handle: unknown) => time.clearTimeout(handle),
  };
  const store = new MemoryGameStore();
  const parser = new GateParser();
  host = new GameHost({
    store,
    parser,
    registry: registry(),
    wallNow: time.now,
    timers,
    snapshotEvery: 100,
    pause: () => ({
      voters: VOTERS,
      voteTimeoutMs: 30_000,
      holdMs: HOLD_MS,
      holdsPerPlayer: opts.holdsPerPlayer,
      holdsPerGame: opts.holdsPerGame,
    }),
  });
  const game = await host.create('g1', loadScenario(holdTheBridge), { rate: opts.rate });
  return { time, store, parser, game };
}

const order = { kind: 'order', side: 'blue', text: 'blue-1 march' } as const;
const blue1 = (g: GameActor) => g.state.world.units.find((u) => u.id === 'blue-1')!;
const hold = (g: GameActor, by = 'alice') => g.submit({ kind: 'proposeHold', by, reason: 'door' });
const ratify = (g: GameActor, yes = true) =>
  g.submit({ kind: 'vote', by: 'bob', proposal: g.pauseState!.proposal!.id, yes });

describe('emergency hold in a game', () => {
  it('stops the clock at once and lapses, resuming where it stopped', async () => {
    const { time, game, store } = await newGame();
    await time.advance(10_000);
    expect(await hold(game)).toMatchObject({ ok: true });
    expect(game.pauseState).toMatchObject({ phase: 'pause_proposed' });
    expect(game.pauseState!.proposal).toMatchObject({ hold: true, by: 'alice' });
    expect(game.gameClock.status).toBe('paused');
    await time.advance(HOLD_MS - 1);
    expect(game.gameClock.now()).toBe(10_000);
    expect(game.gameClock.status).toBe('paused');
    await time.advance(1);
    expect(game.pauseState!.phase).toBe('running');
    expect(game.gameClock.status).toBe('running');
    await time.advance(5_000);
    expect(game.gameClock.now()).toBe(15_000);

    const log = await store.inputLog('g1');
    expect(log.map((e) => e.command.kind)).toEqual(['proposeHold', 'pauseExpire']);
    expect(log[0]!.pause).toMatchObject([{ to: 'pause_proposed', cause: 'proposed', hold: true }]);
    expect(log[1]!.pause).toMatchObject([{ to: 'running', cause: 'timeout', hold: true }]);
    expect(log[1]!.wallMs - log[0]!.wallMs).toBe(HOLD_MS);
  });

  it('still lapses when its timer wakes just before the wall clock reaches the deadline (#503)', async () => {
    const { time, game, store } = await newGame({ earlyMs: 1 });
    await hold(game);
    await time.advance(HOLD_MS - 1);
    // The timer has fired, a millisecond early: nothing was due yet, so it must sleep again.
    expect(game.pauseState!.phase).toBe('pause_proposed');
    await time.advance(1);
    expect(game.pauseState!.phase).toBe('running');
    expect(game.gameClock.status).toBe('running');
    const log = await store.inputLog('g1');
    expect(log.map((e) => e.command.kind)).toEqual(['proposeHold', 'pauseExpire']);
    expect(log[1]!.wallMs - log[0]!.wallMs).toBe(HOLD_MS);
  });

  it('a ratifying vote turns it into an ordinary pause that outlasts the hold', async () => {
    const { time, game, store } = await newGame();
    await time.advance(10_000);
    await hold(game);
    await time.advance(20_000);
    expect(await ratify(game)).toMatchObject({ ok: true });
    expect(game.pauseState).toMatchObject({ phase: 'paused' });
    expect(game.pauseState!.proposal).toBeUndefined();
    await time.advance(3_600_000);
    expect(game.gameClock.status).toBe('paused');
    expect(game.gameClock.now()).toBe(10_000);
    const log = await store.inputLog('g1');
    expect(log.at(-1)!.pause).toMatchObject([{ to: 'paused', cause: 'all-yes', hold: true }]);
  });

  it('a refusing vote ends the hold and the clock runs again', async () => {
    const { time, game } = await newGame();
    await time.advance(10_000);
    await hold(game);
    await ratify(game, false);
    expect(game.pauseState!.phase).toBe('running');
    expect(game.gameClock.status).toBe('running');
    await time.advance(1_000);
    expect(game.gameClock.now()).toBe(11_000);
  });

  it('limits holds per player and per game, and a refusal changes nothing', async () => {
    const { time, game } = await newGame({ holdsPerPlayer: 1, holdsPerGame: 2 });
    await hold(game);
    await time.advance(HOLD_MS);
    expect(game.holdsLeftFor('alice')).toBe(0);
    expect(game.holdsLeftFor('bob')).toBe(1);
    const again = await hold(game);
    expect(again).toMatchObject({ ok: false });
    expect(game.pauseState!.phase).toBe('running');
    expect(game.gameClock.status).toBe('running');
    expect(await hold(game, 'bob')).toMatchObject({ ok: true });
    await time.advance(HOLD_MS);
    expect(game.holdsLeftFor('bob')).toBe(0);
    expect(await hold(game, 'bob')).toMatchObject({ ok: false });
  });

  it('is refused for a non-voter and while a pause is already open or in force', async () => {
    const { game } = await newGame();
    expect(await hold(game, 'mallory')).toMatchObject({ ok: false });
    await game.submit({ kind: 'proposePause', by: 'alice' });
    expect(await hold(game, 'bob')).toMatchObject({ ok: false });
    await ratify(game);
    expect(game.pauseState!.phase).toBe('paused');
    expect(await hold(game, 'bob')).toMatchObject({ ok: false });
  });

  it('during an LLM wait the barrier is untouched: nothing moves until the hold lapses', async () => {
    const { time, game, parser } = await newGame();
    await time.advance(2_000);
    let release!: () => void;
    parser.gate = new Promise((r) => (release = r));
    const pending = game.submit(order);
    await time.advance(1_000);
    await hold(game);
    expect(game.staffAtWork).toMatchObject({ working: true });
    release();
    expect(await pending).toMatchObject({ ok: true });
    await time.advance(HOLD_MS - 1);
    expect(game.gameClock.status).toBe('paused');
    expect(blue1(game).intent.kind).toBe('idle');
    await time.advance(1);
    expect(game.gameClock.status).toBe('running');
    await time.advance(3_600_000);
    expect(blue1(game).center).toEqual(BRIDGE);
  });

  it('a restart while held comes back paused and does not refund the hold', async () => {
    const { time, game, store } = await newGame({ holdsPerPlayer: 1 });
    await time.advance(10_000);
    await hold(game);
    await host!.close('g1');
    time.advance(5_000);
    const reopened = await host!.open('g1');
    expect(reopened.pauseState).toMatchObject({ phase: 'paused' });
    expect(reopened.pauseState!.proposal).toBeUndefined();
    expect(reopened.gameClock.status).toBe('paused');
    expect(reopened.gameClock.now()).toBe(10_000);
    expect(reopened.holdsLeftFor('alice')).toBe(0);
    expect(reopened.holdsLeftFor('bob')).toBe(1);
    // Resume by vote, then alice may not hold again.
    await reopened.submit({ kind: 'proposeResume', by: 'alice' });
    await reopened.submit({
      kind: 'vote',
      by: 'bob',
      proposal: reopened.pauseState!.proposal!.id,
      yes: true,
    });
    expect(await hold(reopened)).toMatchObject({ ok: false });
    expect(
      (await store.inputLog('g1')).filter((e) => e.command.kind === 'proposeHold' && !e.error),
    ).toHaveLength(1);
  });
});

describe('a hold does not change outcomes', () => {
  const cases: { name: string; rate: number; mode: ClockMode }[] = [
    { name: 'rate 1', rate: 1, mode: 'realtime' },
    { name: 'rate 4', rate: 4, mode: 'realtime' },
    { name: 'rate 12', rate: 12, mode: 'realtime' },
    { name: 'manual', rate: 1, mode: 'manual' },
    { name: 'fast-forward', rate: 1, mode: 'fast-forward' },
  ];

  for (const c of cases) {
    it(`${c.name}: same final state whether the hold lapses or is ratified, and replay agrees`, async () => {
      const run = async (how: 'none' | 'lapse' | 'ratify') => {
        const { time, game, store } = await newGame({ rate: c.rate });
        await game.submit({ kind: 'setMode', mode: c.mode });
        await game.submit(order);
        if (c.mode === 'manual') await game.submit({ kind: 'advanceTo', gameMs: 60_000 });
        await time.advance(30_000);
        if (how !== 'none') {
          await hold(game);
          if (how === 'lapse') {
            await time.advance(HOLD_MS);
          } else {
            await ratify(game);
            await time.advance(900_000);
            await game.submit({ kind: 'proposeResume', by: 'alice' });
            await ratify(game);
          }
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
      const plain = await run('none');
      const lapsed = await run('lapse');
      const ratified = await run('ratify');
      expect(lapsed.live).toBe(plain.live);
      expect(ratified.live).toBe(plain.live);
      expect(lapsed.replayed).toBe(lapsed.live);
      expect(ratified.replayed).toBe(ratified.live);
    });
  }
});
