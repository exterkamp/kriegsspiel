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
import { PERSONAS, type UmpirePersona } from '@kriegsspiel/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrderParser } from '../orders/index.js';
import type { UmpireClient, UmpireRequest, UmpireResponse } from '../umpire/index.js';
import { NARRATE_WINDOW_BASE_MS } from '../umpire/index.js';
import { GameHost, MemoryGameStore, createRegistry, startingState } from './index.js';
import { replayLog } from './replay.js';
import { FakeTime } from './testing.js';

const BRIDGE = { x: 2_050_000, y: 1_500_000 };
const parser: OrderParser = {
  parse: async (text) => ({
    kind: 'intents',
    text,
    unitId: 'blue-1',
    intents: [{ kind: 'move', to: BRIDGE }],
  }),
};

function registry() {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerCombat(r);
  registerOrders(r);
  registerVisibility(r);
  return r;
}

/** A narrator whose answer does not depend on the request's system prompt, which is all a persona changes. */
class Stub implements UmpireClient {
  systems: string[] = [];
  async call<T>(request: UmpireRequest): Promise<UmpireResponse<T>> {
    this.systems.push(request.system);
    const { reports } = request.input as { reports: { id: string; from: string }[] };
    const output = {
      dispatches: reports.map((r) => ({ reportIds: [r.id], text: `Sir, ${r.from} writes.` })),
    };
    return {
      output: output as T,
      record: {
        stage: request.stage,
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

async function play(rate: number, persona: UmpirePersona, dial: 'rigid' | 'standard' | 'free') {
  const time = new FakeTime();
  const store = new MemoryGameStore();
  const umpire = new Stub();
  host = new GameHost({
    store,
    parser,
    registry: registry(),
    wallNow: time.now,
    timers: time,
    narrator: () => umpire,
  });
  const game = await host.create('g1', loadScenario(holdTheBridge), {
    rate,
    settings: { dial, persona },
  });
  await game.submit({ kind: 'order', side: 'blue', text: 'blue-1 march' });
  for (let i = 0; i < 12; i++) {
    await time.advance(NARRATE_WINDOW_BASE_MS);
    await game.submit({ kind: 'setRate', rate });
  }
  const world = JSON.stringify(game.state.world);
  await host.shutdown();
  host = undefined;
  return { world, umpire, store };
}

describe.each([1, 4, 12])('umpire settings at rate %i:1', (rate) => {
  it('a persona swap leaves the engine outcome identical and only changes prompt flavour', async () => {
    const runs = [];
    for (const persona of PERSONAS) runs.push(await play(rate, persona, 'standard'));
    for (const r of runs) expect(r.world).toBe(runs[0]!.world);
    const flavours = runs.map((r) => new Set(r.umpire.systems));
    for (const f of flavours) expect(f.size).toBeGreaterThan(0);
    expect(new Set(flavours.map((f) => [...f][0])).size).toBe(PERSONAS.length);
  });

  it('is deterministic: the same settings give the same world twice', async () => {
    const a = await play(rate, 'pedantic', 'free');
    const b = await play(rate, 'pedantic', 'free');
    expect(a.world).toBe(b.world);
  });

  it('records the settings with the game and replays to the same world', async () => {
    const { world, store } = await play(rate, 'dramatic', 'free');
    const header = await store.logHeader('g1');
    expect(header?.settings).toEqual({ dial: 'free', persona: 'dramatic' });
    expect((JSON.parse(world) as GameState).dial).toBe('free');
    const replayed = replayLog(
      header!,
      loadScenario(holdTheBridge),
      await store.inputLog('g1'),
      createRegistry(),
      undefined,
      startingState,
    );
    expect(replayed.state.world.dial).toBe('free');
  });
});
