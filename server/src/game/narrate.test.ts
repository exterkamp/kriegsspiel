import {
  EventRegistry,
  holdTheBridge,
  loadScenario,
  registerCombat,
  registerMovement,
  registerOrders,
  registerVisibility,
  viewFor,
  type GameState,
} from '@kriegsspiel/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { sideViewOf } from '../api/sideView.js';
import type { OrderParser } from '../orders/index.js';
import type { UmpireClient, UmpireRequest, UmpireResponse } from '../umpire/index.js';
import { NARRATE_WINDOW_BASE_MS } from '../umpire/index.js';
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

const BRIDGE = { x: 2_050_000, y: 1_500_000 };
const parser: OrderParser = {
  parse: async (text) => ({
    kind: 'intents',
    text,
    unitId: 'blue-1',
    intents: [{ kind: 'move', to: BRIDGE }],
  }),
};

/** Narrates each report on its own, quoting the officer, once the gate (if any) opens. */
class StubUmpire implements UmpireClient {
  requests: UmpireRequest[] = [];
  gate: Promise<void> | undefined;
  async call<T>(request: UmpireRequest): Promise<UmpireResponse<T>> {
    this.requests.push(request);
    await this.gate;
    const { reports } = request.input as { reports: { id: string; from: string }[] };
    const output = {
      dispatches: reports.map((r) => ({ reportIds: [r.id], text: `Sir, ${r.from} writes.` })),
    };
    return {
      output: output as T,
      record: {
        stage: 'narrate',
        model: 'stub',
        promptVersion: request.promptVersion,
        system: request.system,
        input: request.input,
        rawOutput: JSON.stringify(output),
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        costUsd: null,
        attempts: 1,
      },
    };
  }
}

let host: GameHost | undefined;
afterEach(async () => {
  await host?.shutdown();
  host = undefined;
});

async function newGame(umpire?: StubUmpire) {
  const time = new FakeTime();
  const store = new MemoryGameStore();
  host = new GameHost({
    store,
    parser,
    registry: registry(),
    wallNow: time.now,
    timers: time,
    narrator: umpire && (() => umpire),
  });
  const game = await host.create('g1', loadScenario(holdTheBridge), { rate: 1 });
  return { time, store, game };
}

/** Sign an order and run on until it is delivered, which gives blue a report. */
async function runUntilReport(time: FakeTime, game: Awaited<ReturnType<typeof newGame>>['game']) {
  await game.submit({ kind: 'order', side: 'blue', text: 'blue-1 march' });
  for (let i = 0; i < 60; i++) {
    await time.advance(NARRATE_WINDOW_BASE_MS);
    // Any command brings the world up to "now"; without a narrator nothing else does.
    await game.submit({ kind: 'setRate', rate: 1 });
    if (viewFor(game.state.world, 'blue', game.state.time).reports.length > 0) return 'blue';
  }
  throw new Error('no report in 60 windows');
}

describe('narrate stage in the actor', () => {
  it('narrates a side once per window, logs the calls and shows the text', async () => {
    const umpire = new StubUmpire();
    const { time, store, game } = await newGame(umpire);
    const side = await runUntilReport(time, game);
    await time.advance(NARRATE_WINDOW_BASE_MS);

    expect(umpire.requests.length).toBeGreaterThan(0);
    const view = sideViewOf(
      game.state,
      side as 'blue',
      game.gameClock.snapshot(),
      undefined,
      [],
      game.narrationFor(side),
    );
    const narrated = view.dispatches.filter((d) => d.text.startsWith('Sir, '));
    expect(narrated.length).toBeGreaterThan(0);

    const log = await store.inputLog('g1');
    const entries = log.filter((e) => e.command.kind === 'narrate');
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]!.calls?.[0]).toMatchObject({ stage: 'narrate', model: 'stub' });
  });

  it('holds game time while the model works', async () => {
    const umpire = new StubUmpire();
    let open!: () => void;
    umpire.gate = new Promise((r) => (open = r));
    const { time, game } = await newGame(umpire);
    await game.submit({ kind: 'order', side: 'blue', text: 'blue-1 march' });
    for (let i = 0; i < 60 && !game.staffAtWork.working; i++) {
      await time.advance(NARRATE_WINDOW_BASE_MS);
    }
    expect(game.staffAtWork.working).toBe(true);
    expect(umpire.requests).toHaveLength(1);
    const at = game.gameClock.now();
    await time.advance(30_000);
    expect(game.gameClock.now()).toBe(at);
    open();
    await time.flush();
    expect(game.staffAtWork.working).toBe(false);
  });

  it('keeps template text when no umpire is set', async () => {
    const { time, game } = await newGame();
    const side = await runUntilReport(time, game);
    expect(game.narrationFor(side)).toBeUndefined();
  });
});
