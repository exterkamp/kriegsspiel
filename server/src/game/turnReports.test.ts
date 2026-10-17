/**
 * The papers of a rigid turn game, as the first playtest of 11.12 read them (#438): Hold the Bridge
 * against the scripted Red, at turns of 10, 20 and 30 minutes and several seeds, once with Blue
 * sending nothing and once with orders to all three units by fast rider in the second turn.
 */
import { holdTheBridge, loadScenario, type EmittedEvent } from '@kriegsspiel/engine';
import type { Dispatch, UmpireSettings } from '@kriegsspiel/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrderParser } from '../orders/index.js';
import { sideViewOf } from '../api/sideView.js';
import { GameHost, MemoryGameStore, createRegistry, startingState } from './index.js';
import { FakeTime } from './testing.js';

const MINUTE = 60_000;

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

interface Played {
  game: Awaited<ReturnType<GameHost['create']>>;
  emitted: EmittedEvent[];
  /** Blue's in-tray as it stood at the end of each turn. */
  trays: { end: number; dispatches: Dispatch[] }[];
  /** Blue's turn state as each turn opened. */
  turns: NonNullable<ReturnType<Played['game']['turnStateFor']>>[];
}

/** A rigid turn game; with `orders`, Blue writes to its three units in turn 2. */
async function play(
  seed: number,
  turnMinutes: number,
  orders: boolean,
  /** The engine rules to play under; absent: the current ones. */
  rules?: number,
): Promise<Played> {
  await host?.shutdown();
  const time = new FakeTime();
  const emitted: EmittedEvent[] = [];
  host = new GameHost({
    store: new MemoryGameStore(),
    parser,
    registry: createRegistry(),
    wallNow: time.now,
    timers: time,
    init: startingState,
    scriptedOpponents: true,
    onEmitted: (_id, events) => emitted.push(...events),
  });
  const settings: UmpireSettings = { dial: 'rigid', persona: 'dry', mode: 'turns', turnMinutes };
  const game = await host.create(
    'g1',
    { ...loadScenario(holdTheBridge), seed, ...(rules === undefined ? {} : { rules }) },
    { settings },
  );
  const trays: Played['trays'] = [];
  const turns: Played['turns'] = [];
  for (let n = 1; n <= 20 && game.turnStateFor('blue'); n++) {
    turns.push(game.turnStateFor('blue')!);
    if (orders && n === 2) {
      for (const [i, to] of ['blue-1', 'blue-3', 'blue-2'].entries()) {
        const order = {
          orderId: `o${i}`,
          to,
          text: 'March to the bridge',
          courier: 'fast' as const,
        };
        await game.submit({ kind: 'turnOrder', side: 'blue', turn: 0, order });
      }
    }
    await game.submit({ kind: 'sendTurn', side: 'blue', turn: 0, orders: [] });
    await time.flush();
    const view = sideViewOf(game.state, 'blue', game.gameClock.snapshot());
    trays.push({ end: game.state.time, dispatches: view.dispatches });
  }
  return { game, emitted, trays, turns };
}

const CASES = [10, 20, 30].flatMap((turnMinutes) =>
  [1, 2, 4, 1815].flatMap((seed) => [false, true].map((orders) => ({ turnMinutes, seed, orders }))),
);

/** What a unit says when it claims to stand its ground. */
const HOLDS = /\bwe (hold|stand)\b|will not give ground|hold our ground|the men stand well/i;

describe('turn mode: the turn reports (#438)', () => {
  it.each(CASES)(
    '$turnMinutes-minute turns, seed $seed, orders $orders: papers agree with what happened',
    async ({ turnMinutes, seed, orders }) => {
      const { game, emitted, trays } = await play(seed, turnMinutes, orders);
      const world = game.state.world;
      const end = world.outcome?.time ?? game.state.time;
      const last = trays.at(-1)!.dispatches;

      // (2) Nothing is written after it is received, nor after the game ended.
      for (const d of last) {
        expect(d.writtenAtGame, `${d.id}: ${d.text}`).toBeLessThanOrEqual(d.receivedAtGame);
        expect(d.writtenAtGame, `${d.id}: ${d.text}`).toBeLessThanOrEqual(end);
      }

      // (1) No lost-courier paper for an order that reached its unit. In the master record too.
      for (const side of ['blue', 'red'] as const) {
        for (const r of world.intel[side].reports) {
          if (r.kind !== 'courierLost') continue;
          const unit = world.units.find((u) => u.side === side && u.name === r.from)!;
          const delivered = emitted.find(
            (e) =>
              e.type === 'order_delivered' &&
              (e.payload as { unitId?: string }).unitId === unit.id &&
              e.time === r.orderDueAt,
          );
          expect(delivered, `${side} ${r.id} ${r.from}`).toBeUndefined();
        }
      }

      // (1) Each acknowledgement and lost-courier paper names the desk's order it is about, and says
      // what really became of that order, so the journal never has to guess.
      const deliveredIds = new Set(
        emitted
          .filter((e) => e.type === 'order_delivered')
          .map((e) => (e.payload as { orderId?: string }).orderId),
      );
      for (const d of last.filter((x) => x.kind === 'orderDelivered' || x.kind === 'courierLost')) {
        expect(d.orderId, `${d.id} ${d.kind}`).toMatch(/^o[0-2]$/);
        expect(deliveredIds.has(`blue-${d.orderId}`), `${d.id} ${d.kind}`).toBe(
          d.kind === 'orderDelivered',
        );
      }
      if (!orders)
        expect(last.filter((x) => x.kind === 'orderDelivered' || x.kind === 'courierLost')).toEqual(
          [],
        );

      // (3) A unit that broke says it holds only once it has rallied, and then it says so.
      for (const u of world.units.filter((x) => x.side === 'blue')) {
        const mine = last
          .filter((d) => d.from === u.name)
          .sort((a, b) => a.writtenAtGame - b.writtenAtGame);
        let routed = false;
        for (const d of mine) {
          if (/rallied/i.test(d.text)) routed = false;
          if (routed) expect(d.text, `${u.name} ${d.id}`).not.toMatch(HOLDS);
          if (d.kind === 'broke') routed = true;
        }
      }

      // (6) What happened in a turn is in that turn's papers: nothing written in a finished turn
      // is still on the road when the next one opens.
      for (const r of world.intel.blue.reports) {
        if (r.kind === 'courierLost' || r.observedAt >= end) continue;
        const turnEnd = Math.min(
          Math.ceil((r.observedAt + 1) / (turnMinutes * MINUTE)) * turnMinutes * MINUTE,
          end,
        );
        expect(
          r.deliverAt,
          `${r.id} ${r.kind} written ${r.observedAt / MINUTE}`,
        ).toBeLessThanOrEqual(turnEnd);
      }
    },
  );

  it('reports the enemy at the bridge in turn 1 when Blue gave no orders (seed 1815, 20 minutes)', async () => {
    const { trays } = await play(1815, 20, false);
    const first = trays[0]!;
    expect(first.end).toBe(20 * MINUTE);
    const seen = first.dispatches.filter((d) => d.category === 'scouts');
    expect(seen.length).toBeGreaterThan(0);
    for (const d of seen) expect(d.receivedAtGame).toBeLessThanOrEqual(20 * MINUTE);
  });

  it('tells the players that a turn after the ruling is the pursuit, and until when (D13, D39)', async () => {
    // Played under rules 4: under rules 5 (#446) none of the CASES games is decided by a ruling
    // inside the scenario's limits (the fight at the contact line runs long), so there is no
    // pursuit turn to report. The pursuit papers themselves are rules-independent.
    let pursuits = 0;
    for (const { turnMinutes, seed, orders } of CASES) {
      const { game, turns } = await play(seed, turnMinutes, orders, 4);
      const battle = game.state.world.battle;
      for (const t of turns) {
        if (battle && battle.declaredAt < t.startsAt) {
          pursuits++;
          // The game closes 20 game minutes after the ruling, counted from its minute, or at the
          // time limit if that comes first.
          const limit = game.state.world.victory.holdMs;
          const closes = Math.min(
            Math.floor(battle.declaredAt / MINUTE) * MINUTE + 20 * MINUTE,
            limit,
          );
          const label = `${turnMinutes} min, seed ${seed}, turn ${t.turn}`;
          expect(t.pursuitUntil, label).toBe(closes);
          expect(t.pursuitUntil!, label).toBeLessThanOrEqual(limit);
          expect(game.state.world.outcome!.time).toBeLessThanOrEqual(closes);
        } else {
          expect(t.pursuitUntil).toBeUndefined();
        }
      }
    }
    expect(pursuits).toBeGreaterThan(0);
  });
});
