import { holdTheBridge, loadScenario } from '@kriegsspiel/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../api/app.js';
import { MemoryGameStore } from '../game/store.js';
import { FakeTime } from '../game/testing.js';
import type { OrderParser, ParseResult } from '../orders/index.js';

class CountingParser implements OrderParser {
  calls = 0;
  async parse(text: string): Promise<ParseResult> {
    this.calls++;
    return {
      kind: 'intents',
      text,
      unitId: 'blue-1',
      intents: [{ kind: 'move', to: { x: 20, y: 20 } }],
    };
  }
}

let app: App | undefined;
afterEach(async () => {
  await app?.server.close();
  app = undefined;
});

const MIN = 60_000;

/** A manual-clock game with an order at minute 1, live state captured at several times. */
async function recordedGame() {
  const time = new FakeTime();
  const parser = new CountingParser();
  app = await buildApp({
    parser,
    store: new MemoryGameStore(),
    wallNow: time.now,
    timers: time,
    admin: { enabled: true },
  });
  const game = await app.host.create('g1', loadScenario(holdTheBridge));
  await game.submit({ kind: 'setMode', mode: 'manual' });
  const live = new Map<number, unknown>();
  for (const t of [MIN, 5 * MIN, 12 * MIN, 30 * MIN]) {
    await game.submit({ kind: 'advanceTo', gameMs: t });
    if (t === MIN)
      await game.submit({ kind: 'order', side: 'blue', text: 'blue-1 go to the bridge' });
    live.set(t, structuredClone(game.state));
  }
  return { game, parser, live };
}

const get = (url: string) => app!.server.inject({ method: 'GET', url, remoteAddress: '127.0.0.1' });

describe('admin replay', () => {
  it('matches the live state at each recorded time and never calls the parser', async () => {
    const { game, parser, live } = await recordedGame();
    expect(parser.calls).toBe(1);
    for (const [t, state] of live) {
      if (t === MIN) continue; // the order was issued after this capture's advance
      const res = await get(`/admin/api/games/g1/replay/at?at=${t}`);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.gameMs).toBe(t);
      expect(body.llmCalls).toBe(0);
      expect(body.engine).toEqual(JSON.parse(JSON.stringify(state)));
    }
    expect(parser.calls).toBe(1);
    expect(game.state.time).toBe(30 * MIN);
  });

  it('returns both side views and only the events up to the chosen time', async () => {
    await recordedGame();
    const early = (await get('/admin/api/games/g1/replay/at?at=300000')).json();
    const late = (await get('/admin/api/games/g1/replay/at?at=1800000')).json();
    expect(Object.keys(early.views).sort()).toEqual(['blue', 'red']);
    expect(early.views.blue.side).toBe('blue');
    expect(early.views.blue.atGame).toBe(300000);
    expect(early.events.every((e: { time: number }) => e.time <= 300000)).toBe(true);
    expect(late.events.length).toBeGreaterThanOrEqual(early.events.length);
  });

  it('lists a timeline with jump marks and rejects bad input', async () => {
    await recordedGame();
    const tl = (await get('/admin/api/games/g1/replay')).json();
    expect(tl.endMs).toBe(30 * MIN);
    const kinds = new Set(tl.marks.map((m: { kind: string }) => m.kind));
    expect(kinds.has('llm')).toBe(true);
    expect(kinds.has('input')).toBe(true);
    const times = tl.marks.map((m: { ms: number }) => m.ms);
    expect(times).toEqual([...times].sort((a: number, b: number) => a - b));
    expect((await get('/admin/api/games/nope/replay')).statusCode).toBe(404);
    expect((await get('/admin/api/games/g1/replay/at?at=-5')).statusCode).toBe(400);
    expect((await get('/admin/api/games/g1/replay/at')).statusCode).toBe(400);
  });

  it('is absent when the admin view is off', async () => {
    app = await buildApp({ parser: new CountingParser() });
    expect((await get('/admin/api/games/g1/replay')).statusCode).toBe(404);
  });
});
