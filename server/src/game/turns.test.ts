import { holdTheBridge, loadScenario, type GameState } from '@kriegsspiel/engine';
import type { TurnOrder, UmpireSettings } from '@kriegsspiel/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { SideAgent } from '../opponent/index.js';
import type { OrderParser } from '../orders/index.js';
import { TURN_APPEND_ATTEMPTS, TURN_MODE_REFUSAL } from './actor.js';
import { GameHost, MemoryGameStore, createRegistry, startingState } from './index.js';
import { replayLog } from './replay.js';
import type { InputLogEntry } from './store.js';
import { FakeTime } from './testing.js';
import {
  openTurnFromLog,
  registerTurnAdjudicator,
  turnBounds,
  type TurnInput,
  type TurnResolver,
} from './turns.js';

const MINUTE = 60_000;
const HOUR = 3_600_000;

const parser: OrderParser = {
  parse: async () => {
    throw new Error('turn mode never calls the parser');
  },
};

/**
 * A fake adjudicator: it moves the first ordered unit 100 m east per order. Its output is all replay
 * needs, so a replay that reproduces the move made no resolver call.
 */
registerTurnAdjudicator('fake-east', (state, turn) => {
  const moves = (turn.output as { unitId: string; dx: number }[] | undefined) ?? [];
  let world: GameState = state.world;
  for (const m of moves) {
    world = {
      ...world,
      units: world.units.map((u) =>
        u.id === m.unitId ? { ...u, center: { x: u.center.x + m.dx, y: u.center.y } } : u,
      ),
    };
  }
  return { ...state, world };
});

class FakeResolver implements TurnResolver {
  readonly calls: TurnInput[] = [];
  async resolve(_state: unknown, input: TurnInput) {
    this.calls.push(structuredClone(input) as TurnInput);
    return {
      adjudicator: 'fake-east',
      output: input.orders.map((o) => ({ unitId: o.to, dx: 100 })),
    };
  }
}

const order = (orderId: string, to: string, text = 'advance'): TurnOrder => ({ orderId, to, text });

let host: GameHost | undefined;
afterEach(async () => {
  await host?.shutdown();
  host = undefined;
});

function setUp(settings: Partial<UmpireSettings> = {}, store = new MemoryGameStore()) {
  const time = new FakeTime();
  const resolver = new FakeResolver();
  host = new GameHost({
    store,
    parser,
    registry: createRegistry(),
    wallNow: time.now,
    timers: time,
    init: startingState,
    turnResolver: () => resolver,
  });
  const full: UmpireSettings = {
    dial: 'rigid',
    persona: 'dry',
    mode: 'turns',
    turnMinutes: 20,
    ...settings,
  };
  return { time, store, resolver, host, settings: full };
}

async function create(settings: Partial<UmpireSettings> = {}) {
  const t = setUp(settings);
  const game = await t.host.create('g1', loadScenario(holdTheBridge), {
    rate: 12,
    settings: t.settings,
  });
  return { ...t, game };
}

describe('turn mode: the turn clock (D39, 11.3)', () => {
  it('keeps game time still until both sides send, then advances exactly turnMinutes', async () => {
    const { game, time, resolver } = await create();
    expect(game.gameClock.mode).toBe('manual');
    await time.advance(5 * HOUR);
    expect(game.gameClock.now()).toBe(0);
    expect(game.turnStateFor('blue')).toMatchObject({ turn: 1, startsAt: 0, endsAt: 20 * MINUTE });

    expect(
      await game.submit({ kind: 'turnOrder', side: 'blue', turn: 0, order: order('b1', 'blue-1') }),
    ).toMatchObject({ ok: true });
    expect(await game.submit({ kind: 'sendTurn', side: 'blue', turn: 0, orders: [] })).toEqual({
      ok: true,
    });
    await time.advance(HOUR);
    expect(game.gameClock.now()).toBe(0);
    expect(game.state.time).toBe(0);
    expect(game.turnStateFor('red')?.sent).toEqual(['blue']);
    expect(resolver.calls).toHaveLength(0);

    await game.submit({ kind: 'sendTurn', side: 'red', turn: 0, orders: [] });
    await time.flush();
    expect(resolver.calls).toHaveLength(1);
    expect(resolver.calls[0]).toMatchObject({
      n: 1,
      startMs: 0,
      endMs: 20 * MINUTE,
      cause: 'all-sent',
      sent: ['blue', 'red'],
      orders: [{ orderId: 'b1', to: 'blue-1', text: 'advance', side: 'blue' }],
    });
    expect(game.state.time).toBe(20 * MINUTE);
    expect(game.gameClock.now()).toBe(20 * MINUTE);
    expect(game.turnStateFor('blue')).toMatchObject({
      turn: 2,
      startsAt: 20 * MINUTE,
      endsAt: 40 * MINUTE,
      sent: [],
      resolving: false,
      held: [],
    });
    // Wall time passing still moves nothing.
    await time.advance(HOUR);
    expect(game.state.time).toBe(20 * MINUTE);
  });

  it('applies the resolver output at the turn start through the named adjudicator', async () => {
    const { game, time } = await create();
    const x0 = game.state.world.units.find((u) => u.id === 'blue-2')!.center.x;
    await game.submit({ kind: 'turnOrder', side: 'blue', turn: 0, order: order('b1', 'blue-2') });
    await game.submit({ kind: 'sendTurn', side: 'blue', turn: 0, orders: [] });
    await game.submit({ kind: 'sendTurn', side: 'red', turn: 0, orders: [] });
    await time.flush();
    // blue-2 holds no order of its own, so only the adjudicator moved it.
    expect(game.state.world.units.find((u) => u.id === 'blue-2')!.center.x).toBe(x0 + 100);
  });

  it('resolves at the deadline with whatever was sent; a side that sent nothing keeps its intents', async () => {
    const { game, time, resolver } = await create({ turnDeadlineHours: 2 });
    const deadline = game.turnStateFor('blue')!.deadline!;
    expect(deadline).toBe(time.now() + 2 * HOUR);
    const redIntents = game.state.world.units
      .filter((u) => u.side === 'red')
      .map((u) => [u.id, u.intent]);
    await game.submit({ kind: 'turnOrder', side: 'blue', turn: 0, order: order('b1', 'blue-1') });
    await game.submit({ kind: 'sendTurn', side: 'blue', turn: 0, orders: [] });
    await time.advance(2 * HOUR - 1);
    expect(resolver.calls).toHaveLength(0);
    await time.advance(1);
    expect(resolver.calls).toHaveLength(1);
    expect(resolver.calls[0]).toMatchObject({ cause: 'deadline', sent: ['blue'] });
    expect(resolver.calls[0]!.orders.every((o) => o.side === 'blue')).toBe(true);
    expect(game.state.time).toBe(20 * MINUTE);
    // Red sent nothing: nothing new was given to its units, which carry on as they were.
    const now = new Map(game.state.world.units.map((u) => [u.id, u.intent]));
    for (const [id, intent] of redIntents) expect(now.get(id as string)).toEqual(intent);
    // The next turn has its own deadline.
    expect(game.turnStateFor('blue')!.deadline).toBe(time.now() + 2 * HOUR);
  });

  it('shows held orders to their own side only, and they can be replaced or withdrawn until sending', async () => {
    const { game, store } = await create();
    await game.submit({
      kind: 'turnOrder',
      side: 'blue',
      turn: 0,
      order: order('b1', 'blue-1', 'hold the wood'),
    });
    await game.submit({ kind: 'turnOrder', side: 'blue', turn: 0, order: order('b2', 'blue-2') });
    await game.submit({
      kind: 'turnOrder',
      side: 'blue',
      turn: 0,
      order: order('b1', 'blue-1', 'take the bridge'),
    });
    expect(game.turnStateFor('blue')!.held).toEqual([
      order('b1', 'blue-1', 'take the bridge'),
      order('b2', 'blue-2'),
    ]);
    expect(game.turnStateFor('red')!.held).toEqual([]);
    expect(
      await game.submit({ kind: 'withdrawTurnOrder', side: 'blue', turn: 0, orderId: 'b2' }),
    ).toEqual({ ok: true });
    expect(game.turnStateFor('blue')!.held).toEqual([order('b1', 'blue-1', 'take the bridge')]);

    // An order to another side's unit is refused.
    const foreign = await game.submit({
      kind: 'turnOrder',
      side: 'blue',
      turn: 0,
      order: order('b3', 'red-1'),
    });
    expect(foreign).toMatchObject({ ok: false, kind: 'rejection' });

    await game.submit({ kind: 'sendTurn', side: 'blue', turn: 0, orders: [] });
    const late = await game.submit({
      kind: 'turnOrder',
      side: 'blue',
      turn: 0,
      order: order('b4', 'blue-3'),
    });
    expect(late).toMatchObject({
      ok: false,
      reason: 'your side has sent its orders for this turn',
    });
    expect(
      await game.submit({ kind: 'withdrawTurnOrder', side: 'blue', turn: 0, orderId: 'b1' }),
    ).toMatchObject({ ok: false });
    expect(
      await game.submit({ kind: 'sendTurn', side: 'blue', turn: 0, orders: [] }),
    ).toMatchObject({ ok: false });

    // The log has the turn number filled in and the orders as sent.
    const log = await store.inputLog('g1');
    const sent = log.find((e) => e.command.kind === 'sendTurn' && !e.error)!;
    expect(sent.command).toEqual({
      kind: 'sendTurn',
      side: 'blue',
      turn: 1,
      orders: [order('b1', 'blue-1', 'take the bridge')],
    });
  });

  it('refuses a send whose signer may not sign for an addressee (D6a)', async () => {
    const { game } = await create();
    await game.submit({ kind: 'turnOrder', side: 'blue', turn: 0, order: order('b1', 'blue-2') });
    const res = await game.submit({
      kind: 'sendTurn',
      side: 'blue',
      turn: 0,
      orders: [],
      signer: { role: 'subordinate', units: ['blue-1'] },
    });
    expect(res).toMatchObject({ ok: false, kind: 'rejection' });
    expect(game.turnStateFor('blue')!.sent).toEqual([]);
  });

  it('refuses clock and vote commands and real-time orders with a fixed refusal', async () => {
    const { game } = await create();
    for (const command of [
      { kind: 'setRate', rate: 4 },
      { kind: 'pause' },
      { kind: 'resume' },
      { kind: 'setMode', mode: 'realtime' },
      { kind: 'advanceTo', gameMs: MINUTE },
      { kind: 'step', ms: MINUTE },
      { kind: 'proposePause', by: 'u1' },
      { kind: 'proposeRate', by: 'u1', rate: 4 },
    ] as const) {
      expect(await game.submit(command)).toEqual({
        ok: false,
        kind: 'rejection',
        reason: TURN_MODE_REFUSAL,
      });
    }
    expect(await game.submit({ kind: 'order', side: 'blue', text: 'blue-1 march' })).toMatchObject({
      ok: false,
    });
    expect(await game.submit({ kind: 'resolveTurn', turn: 1, cause: 'all-sent' })).toMatchObject({
      ok: false,
    });
    expect(game.gameClock.now()).toBe(0);
    expect(game.pauseState).toBeUndefined();
  });

  it('ends the last turn at the scenario time limit and stops when the game is over', async () => {
    const { game, time } = await create();
    const ends: number[] = [];
    for (let i = 0; i < 3; i++) {
      ends.push(game.turnStateFor('blue')!.endsAt);
      await game.submit({ kind: 'sendTurn', side: 'blue', turn: 0, orders: [] });
      await game.submit({ kind: 'sendTurn', side: 'red', turn: 0, orders: [] });
      await time.flush();
    }
    // Hold the Bridge's limit is 50 minutes: 20, 40, then a 10-minute turn.
    expect(ends).toEqual([20 * MINUTE, 40 * MINUTE, 50 * MINUTE]);
    expect(game.state.world.outcome).toBeDefined();
    expect(game.state.time).toBe(50 * MINUTE);
    expect(game.turnStateFor('blue')).toBeUndefined();
    expect(game.gameClock.status).toBe('stopped');
  });

  it('replays a turn-mode log to the same state with no resolver call', async () => {
    const { game, time, store, resolver, settings } = await create();
    for (let i = 0; i < 2; i++) {
      await game.submit({
        kind: 'turnOrder',
        side: 'blue',
        turn: 0,
        order: order(`b${i}`, 'blue-1'),
      });
      await game.submit({
        kind: 'turnOrder',
        side: 'red',
        turn: 0,
        order: order(`r${i}`, 'red-2'),
      });
      await game.submit({ kind: 'sendTurn', side: 'red', turn: 0, orders: [] });
      await game.submit({ kind: 'sendTurn', side: 'blue', turn: 0, orders: [] });
      await time.flush();
    }
    const live = JSON.stringify(game.state.world);
    const calls = resolver.calls.length;
    expect(calls).toBe(2);
    const header = (await store.logHeader('g1'))!;
    expect(header.settings).toEqual(settings);
    const log = await store.inputLog('g1');
    const resolved = log.filter((e) => e.command.kind === 'resolveTurn');
    expect(resolved.map((e) => [e.gameMs, e.endGameMs, e.turn?.adjudicator])).toEqual([
      [0, 20 * MINUTE, 'fake-east'],
      [20 * MINUTE, 40 * MINUTE, 'fake-east'],
    ]);
    const replayed = replayLog(
      header,
      loadScenario(holdTheBridge),
      log,
      createRegistry(),
      undefined,
      startingState,
    );
    expect(replayed.state.time).toBe(40 * MINUTE);
    expect(JSON.stringify(replayed.state.world)).toBe(live);
    expect(resolver.calls.length).toBe(calls);
  });

  it('reopens with the open turn, its held and sent orders and its deadline', async () => {
    const store = new MemoryGameStore();
    const first = setUp({ turnDeadlineHours: 3 }, store);
    const game = await first.host.create('g1', loadScenario(holdTheBridge), {
      settings: first.settings,
    });
    await game.submit({ kind: 'turnOrder', side: 'blue', turn: 0, order: order('b1', 'blue-1') });
    await game.submit({ kind: 'sendTurn', side: 'blue', turn: 0, orders: [] });
    await game.submit({ kind: 'turnOrder', side: 'red', turn: 0, order: order('r1', 'red-1') });
    const before = game.turnStateFor('red');
    await first.host.shutdown();

    host = new GameHost({
      store,
      parser,
      registry: createRegistry(),
      wallNow: first.time.now,
      timers: first.time,
      init: startingState,
      turnResolver: () => first.resolver,
    });
    const back = await host.open('g1');
    expect(back.gameClock.mode).toBe('manual');
    expect(back.gameClock.status).toBe('running');
    expect(back.turnStateFor('red')).toEqual(before);
    expect(back.turnStateFor('blue')!.held).toEqual([order('b1', 'blue-1')]);
    // The deadline is the one set when the turn opened, not reset by the restart.
    await first.time.advance(3 * HOUR);
    expect(first.resolver.calls).toHaveLength(1);
    expect(first.resolver.calls[0]).toMatchObject({ cause: 'deadline', sent: ['blue'] });
    expect(back.state.time).toBe(20 * MINUTE);
  });

  it('reopens a game whose sides had all sent and resolves that turn at once', async () => {
    const store = new MemoryGameStore();
    const first = setUp({}, store);
    // The first server never answers: it goes down while the turn is being resolved.
    const stuck: TurnResolver = { resolve: () => new Promise(() => {}) };
    await first.host.shutdown();
    const down = new GameHost({
      store,
      parser,
      registry: createRegistry(),
      wallNow: first.time.now,
      timers: first.time,
      init: startingState,
      turnResolver: () => stuck,
    });
    const game = await down.create('g1', loadScenario(holdTheBridge), {
      settings: first.settings,
    });
    await game.submit({ kind: 'turnOrder', side: 'blue', turn: 0, order: order('b1', 'blue-1') });
    await game.submit({ kind: 'sendTurn', side: 'blue', turn: 0, orders: [] });
    await game.submit({ kind: 'sendTurn', side: 'red', turn: 0, orders: [] });
    await first.time.flush();
    expect(game.turnStateFor('blue')).toMatchObject({ turn: 1, resolving: true });
    await down.shutdown();

    host = new GameHost({
      store,
      parser,
      registry: createRegistry(),
      wallNow: first.time.now,
      timers: first.time,
      init: startingState,
      turnResolver: () => first.resolver,
    });
    const back = await host.open('g1');
    await first.time.flush();
    expect(first.resolver.calls).toHaveLength(1);
    expect(first.resolver.calls[0]).toMatchObject({
      n: 1,
      cause: 'all-sent',
      sent: ['blue', 'red'],
      orders: [{ orderId: 'b1', to: 'blue-1' }],
    });
    expect(back.state.time).toBe(20 * MINUTE);
    expect(back.turnStateFor('blue')).toMatchObject({ turn: 2, resolving: false });
  });

  it('opens the next turn even when the store fails to take the resolved one', async () => {
    // Fails every offer of the resolved turn until `failures` run out (#416: it is retried).
    class FlakyStore extends MemoryGameStore {
      failures = TURN_APPEND_ATTEMPTS;
      failed = false;
      override async appendInput(gameId: string, entry: InputLogEntry): Promise<void> {
        if (entry.command.kind === 'resolveTurn' && this.failures > 0) {
          this.failures--;
          this.failed = true;
          throw new Error('disk full');
        }
        return super.appendInput(gameId, entry);
      }
    }
    const store = new FlakyStore();
    const t = setUp({}, store);
    await t.host.shutdown();
    const errors: unknown[] = [];
    host = new GameHost({
      store,
      parser,
      registry: createRegistry(),
      wallNow: t.time.now,
      timers: t.time,
      init: startingState,
      turnResolver: () => t.resolver,
      onError: (_id, e) => errors.push(e),
    });
    const game = await host.create('g1', loadScenario(holdTheBridge), { settings: t.settings });
    await game.submit({ kind: 'sendTurn', side: 'blue', turn: 0, orders: [] });
    await game.submit({ kind: 'sendTurn', side: 'red', turn: 0, orders: [] });
    await t.time.flush();
    expect(store.failed).toBe(true);
    expect(errors).toHaveLength(1);
    expect(game.state.time).toBe(20 * MINUTE);
    expect(game.turnStateFor('blue')).toMatchObject({ turn: 2, resolving: false });
    expect(
      await game.submit({ kind: 'turnOrder', side: 'blue', turn: 0, order: order('b1', 'blue-1') }),
    ).toMatchObject({ ok: true });
    // The store took the turn on the next append, ahead of everything logged after it (#416).
    const kinds = (await store.inputLog('g1')).map((e) => e.command.kind);
    expect(kinds.slice(kinds.indexOf('resolveTurn'))).toEqual([
      'resolveTurn',
      'openTurn',
      'turnOrder',
    ]);
  });

  it('lets a seat hold or withdraw only orders to units it may draft for (D6a)', async () => {
    const { game } = await create();
    const sub = { role: 'subordinate', units: ['blue-1'] } as const;
    expect(
      await game.submit({
        kind: 'turnOrder',
        side: 'blue',
        turn: 0,
        order: order('s1', 'blue-1'),
        by: { ...sub, units: [...sub.units] },
      }),
    ).toMatchObject({ ok: true });
    const outside = await game.submit({
      kind: 'turnOrder',
      side: 'blue',
      turn: 0,
      order: order('s2', 'blue-2'),
      by: { ...sub, units: [...sub.units] },
    });
    expect(outside).toMatchObject({ ok: false, kind: 'rejection' });
    expect((outside as { reason: string }).reason).toMatch(/^You may not write orders to /);
    // The commander's order to another formation cannot be replaced or withdrawn by the subordinate.
    await game.submit({
      kind: 'turnOrder',
      side: 'blue',
      turn: 0,
      order: order('c1', 'blue-2'),
      by: { role: 'commander' },
    });
    expect(
      await game.submit({
        kind: 'turnOrder',
        side: 'blue',
        turn: 0,
        order: order('c1', 'blue-2', 'retreat'),
        by: { ...sub, units: [...sub.units] },
      }),
    ).toMatchObject({ ok: false });
    expect(
      await game.submit({
        kind: 'withdrawTurnOrder',
        side: 'blue',
        turn: 0,
        orderId: 'c1',
        by: { ...sub, units: [...sub.units] },
      }),
    ).toMatchObject({ ok: false });
    expect(game.turnStateFor('blue')!.held).toEqual([order('s1', 'blue-1'), order('c1', 'blue-2')]);
  });

  it('refuses an order id the side already sent in an earlier turn, across a reopen', async () => {
    const store = new MemoryGameStore();
    const first = setUp({}, store);
    const game = await first.host.create('g1', loadScenario(holdTheBridge), {
      settings: first.settings,
    });
    await game.submit({ kind: 'turnOrder', side: 'blue', turn: 0, order: order('o1', 'blue-1') });
    await game.submit({ kind: 'sendTurn', side: 'blue', turn: 0, orders: [] });
    await game.submit({ kind: 'sendTurn', side: 'red', turn: 0, orders: [] });
    await first.time.flush();
    const reuse = {
      kind: 'turnOrder',
      side: 'blue',
      turn: 0,
      order: order('o1', 'blue-2'),
    } as const;
    expect(await game.submit(reuse)).toEqual({
      ok: false,
      kind: 'rejection',
      reason: 'that order id was already sent in an earlier turn',
    });
    // Red never sent o1, so red may use it.
    expect(
      await game.submit({ kind: 'turnOrder', side: 'red', turn: 0, order: order('o1', 'red-1') }),
    ).toMatchObject({ ok: true });
    await first.host.shutdown();

    host = new GameHost({
      store,
      parser,
      registry: createRegistry(),
      wallNow: first.time.now,
      timers: first.time,
      init: startingState,
      turnResolver: () => first.resolver,
    });
    const back = await host.open('g1');
    expect(await back.submit(reuse)).toMatchObject({ ok: false });
  });

  it('counts only human sides: a scripted side does not have to send', async () => {
    const store = new MemoryGameStore();
    const time = new FakeTime();
    const resolver = new FakeResolver();
    host = new GameHost({
      store,
      parser,
      registry: createRegistry(),
      wallNow: time.now,
      timers: time,
      init: startingState,
      scriptedOpponents: true,
      turnResolver: () => resolver,
    });
    const game = await host.create('g1', loadScenario(holdTheBridge), {
      settings: { dial: 'rigid', persona: 'dry', mode: 'turns', turnMinutes: 20 },
    });
    await game.submit({ kind: 'sendTurn', side: 'blue', turn: 0, orders: [] });
    await time.flush();
    expect(resolver.calls).toHaveLength(1);
    expect(game.state.time).toBe(20 * MINUTE);
    // The scripted side's orders, issued as the turn ran, replay to the same world.
    const log = await store.inputLog('g1');
    const replayed = replayLog(
      (await store.logHeader('g1'))!,
      loadScenario(holdTheBridge),
      log,
      createRegistry(),
      undefined,
      startingState,
    );
    expect(JSON.stringify(replayed.state.world)).toBe(JSON.stringify(game.state.world));
  });
});

describe('turn bookkeeping', () => {
  const world = loadScenario(holdTheBridge);

  it('a turn ends turnMs later or at the time limit, whichever is first', () => {
    expect(turnBounds(0, 20 * MINUTE, world)).toEqual({ startMs: 0, endMs: 20 * MINUTE });
    expect(turnBounds(40 * MINUTE, 20 * MINUTE, world)).toEqual({
      startMs: 40 * MINUTE,
      endMs: 50 * MINUTE,
    });
  });

  it('rebuilds the open turn from the log, ignoring resolved turns and failed entries', () => {
    const e = (seq: number, command: InputLogEntry['command'], error?: string): InputLogEntry => ({
      seq,
      wallMs: 0,
      gameMs: 0,
      command,
      ...(error ? { error } : {}),
    });
    const log: InputLogEntry[] = [
      e(1, { kind: 'openTurn', turn: 1, startMs: 0, endMs: 20 * MINUTE }),
      e(2, { kind: 'sendTurn', side: 'blue', turn: 1, orders: [] }),
      e(3, { kind: 'resolveTurn', turn: 1, cause: 'all-sent' }),
      e(4, {
        kind: 'openTurn',
        turn: 2,
        startMs: 20 * MINUTE,
        endMs: 40 * MINUTE,
        deadlineWallMs: 9,
      }),
      e(5, { kind: 'turnOrder', side: 'red', turn: 2, order: order('r1', 'red-1') }),
      e(6, { kind: 'turnOrder', side: 'red', turn: 2, order: order('r2', 'red-2') }, 'refused'),
      e(7, { kind: 'turnOrder', side: 'blue', turn: 2, order: order('b1', 'blue-1') }),
      e(8, { kind: 'withdrawTurnOrder', side: 'blue', turn: 2, orderId: 'b1' }),
    ];
    const t = openTurnFromLog(log)!;
    expect(t).toMatchObject({ n: 2, startMs: 20 * MINUTE, deadlineWallMs: 9, resolving: false });
    expect(t.held.get('red')).toEqual([order('r1', 'red-1')]);
    expect(t.held.get('blue')).toEqual([]);
    expect([...t.sent.keys()]).toEqual([]);
    expect(openTurnFromLog(log.slice(0, 3))).toBeUndefined();
    // A turn whose adjudicator failed was still closed and resolved: it is not reopened.
    const failed = [
      ...log.slice(0, 2),
      e(3, { kind: 'resolveTurn', turn: 1, cause: 'all-sent' }, 'unknown adjudicator'),
    ];
    expect(openTurnFromLog(failed)).toBeUndefined();
  });
});

describe('turn mode: scripted sides across a reopen (#430)', () => {
  it('does not think again at minute 0 when the game is reopened with turn 1 open', async () => {
    const store = new MemoryGameStore();
    const time = new FakeTime();
    const thinks: number[] = [];
    const agent = (): SideAgent => ({
      side: 'red',
      intervalMs: 5 * MINUTE,
      think: (view) => {
        thinks.push(view.time);
        return [];
      },
      settled: () => false,
    });
    const make = () =>
      new GameHost({
        store,
        parser,
        registry: createRegistry(),
        wallNow: time.now,
        timers: time,
        init: startingState,
        scriptedOpponents: true,
        aiAgents: () => [agent()],
        turnResolver: () => new FakeResolver(),
      });
    const settings: UmpireSettings = {
      dial: 'rigid',
      persona: 'dry',
      mode: 'turns',
      turnMinutes: 20,
    };
    const first = make();
    host = first;
    await first.create('g1', loadScenario(holdTheBridge), { settings });
    expect(thinks).toEqual([0]);
    await first.shutdown();

    host = make();
    const back = await host.open('g1');
    await back.submit({ kind: 'turnOrder', side: 'blue', turn: 0, order: order('b1', 'blue-1') });
    await time.advance(HOUR);
    // Its minute-0 decision is already logged: the reopened game does not make it again.
    expect(thinks).toEqual([0]);
  });
});
