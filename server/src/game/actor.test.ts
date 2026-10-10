import {
  COURIER_MS_PER_TILE,
  EventRegistry,
  holdTheBridge,
  loadScenario,
  registerMovement,
  registerOrders,
  type EmittedEvent,
  type GameState,
} from '@kriegsspiel/engine';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrderParser, ParseResult } from '../orders/index.js';
import { GameHost, MemoryGameStore, type GameActor } from './index.js';
import { FakeTime } from './testing.js';

// Blue HQ (20,29) to blue-1 (18,24): 9 half-units of courier travel.
const DELIVERY_MS = (9 * COURIER_MS_PER_TILE) / 2;

function registry() {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerOrders(r);
  return r;
}

/** Always understands the order as "blue-1 moves to (20,20)". */
class FixedParser implements OrderParser {
  calls: string[] = [];
  gate: Promise<void> | undefined;
  result: ParseResult | undefined;
  async parse(text: string): Promise<ParseResult> {
    this.calls.push(text);
    await this.gate;
    return (
      this.result ?? {
        kind: 'intents',
        text,
        unitId: 'blue-1',
        intents: [{ kind: 'move', to: { x: 20, y: 20 } }],
      }
    );
  }
}

function setup() {
  const time = new FakeTime();
  const store = new MemoryGameStore();
  const parser = new FixedParser();
  const errors: unknown[] = [];
  const host = new GameHost({
    store,
    parser,
    registry: registry(),
    wallNow: time.now,
    timers: time,
    onError: (_id, e) => errors.push(e),
  });
  return { time, store, parser, host, errors };
}

const order = { kind: 'order', side: 'blue', text: 'blue-1 march' } as const;
const blue1 = (g: GameActor) => g.state.world.units.find((u) => u.id === 'blue-1')!;

let host: GameHost | undefined;
afterEach(async () => {
  await host?.shutdown();
  host = undefined;
});

async function newGame(rate = 1) {
  const s = setup();
  host = s.host;
  const events: EmittedEvent[] = [];
  const game = await s.host.create('g1', loadScenario(holdTheBridge), { rate });
  return { ...s, game, events };
}

describe('order delivery on a fake clock', () => {
  it('delivers and moves as wall time passes', async () => {
    const { time, game } = await newGame(1);
    expect(await game.submit(order)).toEqual({ ok: true, orderId: 'g1-o1' });
    expect(blue1(game).intent).toEqual({ kind: 'idle' });

    await time.advance(DELIVERY_MS - 1);
    expect(blue1(game).intent.kind).toBe('idle');

    await time.advance(1);
    expect(blue1(game).intent).toMatchObject({ kind: 'move', startedAt: DELIVERY_MS });

    await time.advance(5 * 60_000);
    expect(blue1(game).position).not.toEqual({ x: 18, y: 24 });
    // The world is advanced lazily; any command brings it up to "now".
    await game.submit({ kind: 'pause' });
    expect(game.state.time).toBe(DELIVERY_MS + 5 * 60_000);
  });

  it('runs 12 times faster at rate 12', async () => {
    const { time, game } = await newGame(12);
    await game.submit(order);
    await time.advance(DELIVERY_MS / 12 - 1);
    expect(blue1(game).intent.kind).toBe('idle');
    await time.advance(1);
    expect(blue1(game).intent.kind).toBe('move');
  });

  it('reports engine events as they fire', async () => {
    const s = setup();
    host = s.host;
    const events: EmittedEvent[] = [];
    const h = new GameHost({
      store: s.store,
      parser: s.parser,
      registry: registry(),
      wallNow: s.time.now,
      timers: s.time,
      onEmitted: (_id, e) => events.push(...e),
    });
    host = h;
    const game = await h.create('g1', loadScenario(holdTheBridge));
    await game.submit(order);
    await s.time.advance(DELIVERY_MS);
    expect(events.map((e) => e.type)).toContain('order_delivered');
  });
});

describe('clock changes wake the scheduler', () => {
  it('re-times a pending delivery when the rate changes', async () => {
    const { time, game } = await newGame(1);
    await game.submit(order);
    await time.advance(30_000);
    await game.submit({ kind: 'setRate', rate: 12 });
    // 37,500 game ms remain, which is 3,125 wall ms at 12x.
    await time.advance(3_124);
    expect(blue1(game).intent.kind).toBe('idle');
    await time.advance(1);
    expect(blue1(game).intent).toMatchObject({ kind: 'move', startedAt: DELIVERY_MS });
  });

  it('stops while paused and resumes where it left off', async () => {
    const { time, game } = await newGame(1);
    await game.submit(order);
    await time.advance(10_000);
    await game.submit({ kind: 'pause' });
    expect(time.pendingTimers).toBe(0);
    await time.advance(3_600_000);
    expect(blue1(game).intent.kind).toBe('idle');
    expect(game.state.time).toBe(10_000);

    await game.submit({ kind: 'resume' });
    await time.advance(DELIVERY_MS - 10_000 - 1);
    expect(blue1(game).intent.kind).toBe('idle');
    await time.advance(1);
    expect(blue1(game).intent.kind).toBe('move');
  });

  it('stamps an order signed during a pause with the paused time', async () => {
    const { time, game } = await newGame(1);
    await time.advance(5_000);
    await game.submit({ kind: 'pause' });
    await game.submit(order);
    await time.advance(DELIVERY_MS * 2);
    expect(blue1(game).intent.kind).toBe('idle');
    await game.submit({ kind: 'resume' });
    await time.advance(DELIVERY_MS);
    expect(blue1(game).intent).toMatchObject({ kind: 'move', startedAt: 5_000 + DELIVERY_MS });
  });

  it('manual mode only moves on advanceTo, with no timers', async () => {
    const { time, game } = await newGame(1);
    await game.submit({ kind: 'setMode', mode: 'manual' });
    await game.submit(order);
    expect(time.pendingTimers).toBe(0);
    await time.advance(DELIVERY_MS * 10);
    expect(blue1(game).intent.kind).toBe('idle');

    await game.submit({ kind: 'advanceTo', gameMs: DELIVERY_MS });
    expect(blue1(game).intent.kind).toBe('move');
    expect(time.pendingTimers).toBe(0);
  });

  it('fast-forward runs to the end of the queue without waiting', async () => {
    const { time, game } = await newGame(1);
    await game.submit(order);
    await game.submit({ kind: 'setMode', mode: 'fast-forward' });
    await time.advance(0);
    // The march ran to its end without any wall time passing.
    expect(blue1(game).position).toEqual({ x: 20, y: 20 });
    expect(game.state.queue.length).toBe(0);
    expect(game.state.time).toBeGreaterThan(DELIVERY_MS);
    expect(time.pendingTimers).toBe(0);
  });

  it('refuses advanceTo in realtime mode and records the error', async () => {
    const { game, store } = await newGame(1);
    const res = await game.submit({ kind: 'advanceTo', gameMs: 5 });
    expect(res.ok).toBe(false);
    const log = await store.inputLog('g1');
    expect(log[0]?.error).toMatch(/manual or fast-forward/);
  });
});

describe('order parsing', () => {
  it('waits for the parse before the courier leaves', async () => {
    const { time, game, parser } = await newGame(1);
    await time.advance(1_000);
    let release!: () => void;
    parser.gate = new Promise((r) => (release = r));
    const pending = game.submit(order);
    await time.advance(DELIVERY_MS * 2);
    // The parse is still out: no courier, and the engine has not moved past the signing time.
    expect(game.state.queue).toEqual([]);
    expect(game.state.time).toBe(1_000);

    release();
    expect(await pending).toEqual({ ok: true, orderId: 'g1-o1' });
    expect(game.state.time).toBeGreaterThan(1_000 + DELIVERY_MS);
    // Signed at 1,000, so it was delivered at 1,000 + the courier ride, not at parse time.
    expect(blue1(game).intent).toMatchObject({ kind: 'move', startedAt: 1_000 + DELIVERY_MS });
  });

  it('does not issue clarifications, rejections or parser failures', async () => {
    const { time, game, parser, store } = await newGame(1);
    parser.result = { kind: 'clarification', text: 'x', question: 'Where to?' };
    expect(await game.submit(order)).toMatchObject({ ok: false, kind: 'clarification' });
    parser.result = { kind: 'rejection', text: 'x', reason: 'nonsense' };
    expect(await game.submit(order)).toEqual({ ok: false, kind: 'rejection', reason: 'nonsense' });
    parser.result = {
      kind: 'intents',
      text: 'x',
      unitId: 'blue-1',
      intents: [{ kind: 'attack', target: { x: 1, y: 1 } }],
    };
    expect(await game.submit(order)).toMatchObject({ ok: false, kind: 'rejection' });
    parser.parse = () => Promise.reject(new Error('boom'));
    expect(await game.submit(order)).toMatchObject({ ok: false, reason: 'parser failed: boom' });

    await time.advance(DELIVERY_MS * 2);
    expect(blue1(game).intent.kind).toBe('idle');
    expect((await store.inputLog('g1')).map((e) => e.seq)).toEqual([1, 2, 3, 4]);
  });

  it('logs commands with their parse results for replay', async () => {
    const { time, game, store } = await newGame(1);
    await time.advance(2_000);
    await game.submit(order);
    const [entry] = await store.inputLog('g1');
    expect(entry).toMatchObject({
      seq: 1,
      gameMs: 2_000,
      command: order,
      parse: { kind: 'intents', unitId: 'blue-1' },
    });
  });

  it('applies commands in arrival order', async () => {
    const { game, store } = await newGame(1);
    await Promise.all([
      game.submit({ kind: 'setRate', rate: 4 }),
      game.submit({ kind: 'setRate', rate: 12 }),
      game.submit({ kind: 'pause' }),
    ]);
    expect((await store.inputLog('g1')).map((e) => e.command.kind)).toEqual([
      'setRate',
      'setRate',
      'pause',
    ]);
    expect(game.gameClock.rate).toBe(12);
    expect(game.gameClock.status).toBe('paused');
  });
});

describe('many games, restore and shutdown', () => {
  it('keeps games independent in one process', async () => {
    const s = setup();
    host = s.host;
    const a = await s.host.create('a', loadScenario(holdTheBridge), { rate: 1 });
    const b = await s.host.create('b', loadScenario(holdTheBridge), { rate: 12 });
    await a.submit(order);
    await b.submit(order);
    await s.time.advance(DELIVERY_MS / 12);
    expect(blue1(b).intent.kind).toBe('move');
    expect(blue1(a).intent.kind).toBe('idle');
  });

  it('rejects a duplicate game id', async () => {
    const { host: h } = await newGame();
    await expect(h.create('g1', loadScenario(holdTheBridge))).rejects.toThrow(/already exists/);
  });

  it('returns one actor for concurrent opens of the same game', async () => {
    const { host: h, store, time } = await newGame(1);
    await h.close('g1');
    const s2 = new GameHost({
      store,
      parser: new FixedParser(),
      registry: registry(),
      wallNow: time.now,
      timers: time,
    });
    host = s2;
    const [a, b] = await Promise.all([s2.open('g1'), s2.open('g1')]);
    expect(a).toBe(b);
    expect(s2.size).toBe(1);
    await s2.shutdown();
    expect(time.pendingTimers).toBe(0);
  });

  it('lets only one of two concurrent creates of the same id win', async () => {
    const s = setup();
    host = s.host;
    const results = await Promise.allSettled([
      s.host.create('g', loadScenario(holdTheBridge)),
      s.host.create('g', loadScenario(holdTheBridge)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(s.host.size).toBe(1);
    await s.host.shutdown();
    expect(s.time.pendingTimers).toBe(0);
  });

  it('keeps the scheduler armed when the store fails to save after a command', async () => {
    const { time, store, game } = await newGame(1);
    await game.submit(order);
    await game.submit({ kind: 'pause' });
    expect(time.pendingTimers).toBe(0);
    const save = store.saveSnapshot.bind(store);
    store.saveSnapshot = () => Promise.reject(new Error('disk full'));
    await expect(game.submit({ kind: 'resume' })).rejects.toThrow(/disk full/);
    expect(game.gameClock.status).toBe('running');
    expect(time.pendingTimers).toBe(1);
    store.saveSnapshot = save;
  });

  it('leaves no timers after shutdown, and refuses new commands', async () => {
    const { time, host: h, game } = await newGame(1);
    await game.submit(order);
    expect(time.pendingTimers).toBe(1);
    await h.shutdown();
    expect(time.pendingTimers).toBe(0);
    expect(h.size).toBe(0);
    await expect(game.submit({ kind: 'pause' })).rejects.toThrow(/closed/);
    await time.advance(DELIVERY_MS * 2);
    expect(time.pendingTimers).toBe(0);
  });

  it('reopens a stored game paused, with no game time lost or gained', async () => {
    const { time, host: h, store, game } = await newGame(4);
    await game.submit(order);
    await time.advance(5_000);
    await h.close('g1');
    const savedAt = game.state.time;

    await time.advance(3_600_000);
    const s2 = new GameHost({
      store,
      parser: new FixedParser(),
      registry: registry(),
      wallNow: time.now,
      timers: time,
    });
    host = s2;
    const reopened = await s2.open('g1');
    expect(reopened.gameClock.status).toBe('paused');
    expect(reopened.state.time).toBe(savedAt);
    expect(reopened.state.queue.length).toBe(game.state.queue.length);
    await time.advance(DELIVERY_MS);
    expect(reopened.state.time).toBe(savedAt);

    await reopened.submit({ kind: 'resume' });
    await time.advance(DELIVERY_MS);
    expect(blue1(reopened).intent.kind).toBe('move');
    expect((await store.inputLog('g1')).map((e) => e.seq)).toEqual([1, 2]);
  });
});
