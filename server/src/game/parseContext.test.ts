import {
  EventRegistry,
  holdTheBridge,
  loadScenario,
  registerCombat,
  registerMovement,
  registerOrders,
  registerVisibility,
  type GameState,
} from '@kriegsspiel/engine';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrderParser, ParseContext } from '../orders/index.js';
import { hiddenTerms } from '../umpire/leakGuard.js';
import { GameHost, MemoryGameStore } from './index.js';
import { FakeTime } from './testing.js';

function registry() {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerCombat(r);
  registerOrders(r);
  registerVisibility(r);
  return r;
}

let host: GameHost | undefined;
afterEach(async () => {
  await host?.shutdown();
  host = undefined;
});

describe('the parse context the actor builds (#354)', () => {
  for (const side of ['blue', 'red'] as const) {
    it(`gives the ${side} parser the other side's unit names and officers as hidden terms`, async () => {
      const contexts: ParseContext[] = [];
      const parser: OrderParser = {
        parse: async (text, context) => {
          contexts.push(context);
          return { kind: 'rejected', text, reason: 'No order found.' } as never;
        },
      };
      const time = new FakeTime();
      host = new GameHost({
        store: new MemoryGameStore(),
        parser,
        registry: registry(),
        wallNow: time.now,
        timers: time,
      });
      const game = await host.create('g1', loadScenario(holdTheBridge), { rate: 1 });
      await game.submit({ kind: 'order', side, text: 'hold the bridge' });

      expect(contexts).toHaveLength(1);
      const expected = hiddenTerms(game.state.world, side);
      const enemy = game.state.world.units.find((u) => u.side !== side && u.commander);
      expect(enemy).toBeDefined();
      // Non-empty and carrying the enemy officer, so a lower-case commander can be refused.
      expect(expected).toContain(enemy!.commander);
      expect(contexts[0]!.hidden).toEqual(expected);
    });
  }
});
