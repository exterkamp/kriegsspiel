import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadScenario, holdTheBridge, type EmittedEvent } from '@kriegsspiel/engine';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrderParser, ParseResult } from '../orders/index.js';
import { GameHost, FileGameStore, MemoryGameStore, parseInputLog, replayLog } from './index.js';
import type { GameStore } from './index.js';
import { createRegistry, loadScenarioById } from './registry.js';
import { FakeTime } from './testing.js';

class FixedParser implements OrderParser {
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

const dirs: string[] = [];
let host: GameHost | undefined;
afterEach(async () => {
  await host?.shutdown();
  host = undefined;
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/**
 * The same scripted game at a given pace: an order at game minute 1, a rate-independent
 * pause, more play to game minute 30 and a final pause. `scale` shrinks wall time to match.
 */
async function play(store: GameStore, rate: number, mode: 'realtime' | 'manual' = 'realtime') {
  const time = new FakeTime();
  const events: EmittedEvent[] = [];
  const parser = new FixedParser();
  host = new GameHost({
    store,
    parser,
    registry: createRegistry(),
    wallNow: time.now,
    timers: time,
    onEmitted: (_id, e) => events.push(...e),
  });
  const game = await host.create('g1', loadScenario(holdTheBridge), { rate });
  const wall = (gameMs: number) => gameMs / rate;
  if (mode === 'manual') {
    await game.submit({ kind: 'setMode', mode: 'manual' });
    await game.submit({ kind: 'advanceTo', gameMs: 60_000 });
  } else {
    await time.advance(wall(60_000));
  }
  await game.submit({ kind: 'order', side: 'blue', text: 'blue-1 march to the bridge' });
  if (mode === 'manual') await game.submit({ kind: 'advanceTo', gameMs: 30 * 60_000 });
  else await time.advance(wall(29 * 60_000));
  await game.submit({ kind: 'pause' });
  return { final: game.state, events, parser };
}

function replayOf(store: GameStore) {
  return async () => {
    const header = (await store.logHeader('g1'))!;
    const entries = await store.inputLog('g1');
    return replayLog(header, loadScenarioById(header.scenarioId), entries, createRegistry());
  };
}

describe('input log replay', () => {
  it('reproduces the final state and event sequence of a played game', async () => {
    const store = new MemoryGameStore();
    const { final, events } = await play(store, 1);
    expect(final.time).toBe(30 * 60_000);
    const replayed = await replayOf(store)();
    expect(replayed.state).toEqual(final);
    expect(replayed.emitted).toEqual(events);
    expect(events.length).toBeGreaterThan(0);
  });

  it('gives the same result at every clock rate and on a manual clock', async () => {
    const results = [];
    for (const [rate, mode] of [
      [1, 'realtime'],
      [4, 'realtime'],
      [12, 'realtime'],
      [1, 'manual'],
    ] as const) {
      const store = new MemoryGameStore();
      const { final, events } = await play(store, rate, mode);
      await host?.shutdown();
      const replayed = await replayOf(store)();
      expect(replayed.state).toEqual(final);
      expect(replayed.emitted).toEqual(events);
      results.push(replayed.state.world);
    }
    for (const w of results.slice(1)) expect(w).toEqual(results[0]);
  });

  it('never calls the parser: orders use the recorded parse result', async () => {
    const store = new MemoryGameStore();
    const { parser } = await play(store, 1);
    expect(parser.calls).toBe(1);
    const log = await store.inputLog('g1');
    expect(log.find((e) => e.command.kind === 'order')?.parse?.kind).toBe('intents');
    // replayLog has no parser parameter at all; it finishes with the call count unchanged.
    await replayOf(store)();
    expect(parser.calls).toBe(1);
  });

  it('skips refused commands', async () => {
    const store = new MemoryGameStore();
    const time = new FakeTime();
    host = new GameHost({
      store,
      parser: {
        parse: async () => ({ kind: 'rejection', text: 'x', reason: 'no' }) as ParseResult,
      },
      registry: createRegistry(),
      wallNow: time.now,
      timers: time,
    });
    const game = await host.create('g1', loadScenario(holdTheBridge));
    await game.submit({ kind: 'order', side: 'blue', text: 'x' });
    await game.submit({ kind: 'setRate', rate: -1 });
    await time.advance(5_000);
    await game.submit({ kind: 'pause' });
    expect((await store.inputLog('g1')).map((e) => !!e.error)).toEqual([false, true, false]);
    expect((await replayOf(store)()).state).toEqual(game.state);
  });
});

describe('replay edge cases', () => {
  it('stops at an earlier --until without applying later inputs', async () => {
    const store = new MemoryGameStore();
    await play(store, 1);
    const header = (await store.logHeader('g1'))!;
    const entries = await store.inputLog('g1');
    const run = (until?: number) =>
      replayLog(header, loadScenarioById(header.scenarioId), entries, createRegistry(), until);
    const early = run(30_000);
    expect(early.state.time).toBe(30_000);
    expect(early.state.queue.some((e) => e.type === 'order.issue')).toBe(false);
    expect(early.emitted.some((e) => e.type.startsWith('order'))).toBe(false);
    expect(run(90_000).state.time).toBe(90_000);
    expect(run().state.time).toBe(30 * 60_000);
  });

  it('carries the world through a slow parse that ends the log', async () => {
    const store = new MemoryGameStore();
    const time = new FakeTime();
    let release!: () => void;
    const parser: OrderParser = {
      parse: async (text) => {
        await new Promise<void>((r) => (release = r));
        return {
          kind: 'intents',
          text,
          unitId: 'blue-1',
          intents: [{ kind: 'move', to: { x: 20, y: 20 } }],
        };
      },
    };
    host = new GameHost({
      store,
      parser,
      registry: createRegistry(),
      wallNow: time.now,
      timers: time,
    });
    const game = await host.create('g1', loadScenario(holdTheBridge));
    const done = game.submit({ kind: 'order', side: 'blue', text: 'march' });
    await time.advance(10_000);
    release();
    await done;
    const [entry] = await store.inputLog('g1');
    expect(entry!.endGameMs!).toBeGreaterThan(entry!.gameMs);
    expect((await replayOf(store)()).state).toEqual(game.state);
  });

  it('leaves the state alone for a failed command that carries a parse result', async () => {
    const store = new MemoryGameStore();
    await play(store, 1);
    const header = (await store.logHeader('g1'))!;
    const entries = await store.inputLog('g1');
    const order = entries.find((e) => e.command.kind === 'order')!;
    const run = (list: typeof entries) =>
      replayLog(header, loadScenarioById(header.scenarioId), list, createRegistry());
    const failed = { ...order, error: 'store write failed' };
    const noOrder = { ...order, command: { kind: 'pause' as const }, parse: undefined };
    expect(run(entries.map((e) => (e === order ? failed : e)))).toEqual(
      run(entries.map((e) => (e === order ? noOrder : e))),
    );
  });
});

describe('FileGameStore', () => {
  it('persists a JSON-lines log per game that replays to the same state', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kriegsspiel-log-'));
    dirs.push(dir);
    const store = new FileGameStore(dir);
    const { final } = await play(store, 12);

    const text = await readFile(join(dir, 'g1.jsonl'), 'utf8');
    const lines = text
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines[0]).toEqual({ gameId: 'g1', scenarioId: 'hold-the-bridge', seed: 1815 });
    expect(lines.slice(1).map((l) => l.command.kind)).toEqual(['order', 'pause']);

    // A fresh store over the same directory (a new process) replays from the file alone.
    const { header, entries } = parseInputLog(text);
    const replayed = replayLog(
      header,
      loadScenarioById(header.scenarioId),
      entries,
      createRegistry(),
    );
    expect(replayed.state).toEqual(final);
    expect(await new FileGameStore(dir).inputLog('g1')).toEqual(entries);
  });

  it('ignores a line cut short by a crash and rejects unsafe ids', async () => {
    const header = '{"gameId":"g","scenarioId":"hold-the-bridge","seed":1815}\n';
    const entry = '{"seq":1,"wallMs":0,"gameMs":0,"command":{"kind":"pause"},"endGameMs":0}\n';
    expect(parseInputLog(header + entry + '{"seq":2,"wal').entries).toHaveLength(1);
    expect(() => parseInputLog(header + '{bad\n' + entry)).toThrow(/line 2/);
    const store = new FileGameStore('/nonexistent');
    expect(() => store.logPath('../evil')).toThrow();
  });
});
