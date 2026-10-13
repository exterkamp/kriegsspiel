import { mkdtempSync, rmSync } from 'node:fs';
import { DraftBook } from '../drafts/book.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import type { Mark } from '@kriegsspiel/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrderParser, ParseResult } from '../orders/index.js';
import { GameHost, MemoryGameStore, SqliteGameStore, replayLog } from './index.js';
import { MIGRATIONS } from './sqlite.js';
import { FakeTime } from './testing.js';

const BRIDGE = { x: 2_050_000, y: 1_500_000 };

function registry() {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerCombat(r);
  registerOrders(r);
  registerVisibility(r);
  return r;
}

class FixedParser implements OrderParser {
  async parse(text: string): Promise<ParseResult> {
    return { kind: 'intents', text, unitId: 'blue-1', intents: [{ kind: 'move', to: BRIDGE }] };
  }
}

const dirs: string[] = [];
const stores: SqliteGameStore[] = [];
const hosts: GameHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.shutdown()));
  for (const s of stores.splice(0)) {
    try {
      s.close();
    } catch {
      // already closed by the test
    }
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmpDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ks-sqlite-'));
  dirs.push(dir);
  return join(dir, 'nested', 'games.db');
}

function open(path: string) {
  const s = new SqliteGameStore(path);
  stores.push(s);
  return s;
}

function hostFor(store: SqliteGameStore | MemoryGameStore, time: FakeTime, snapshotEvery?: number) {
  const h = new GameHost({
    store,
    parser: new FixedParser(),
    registry: registry(),
    wallNow: time.now,
    timers: time,
    snapshotEvery,
  });
  hosts.push(h);
  return h;
}

const order = { kind: 'order', side: 'blue', text: 'blue-1 march' } as const;

describe('SqliteGameStore', () => {
  it('migrates a new database and is idempotent on reopen', () => {
    const path = tmpDb();
    expect(open(path).schemaVersion).toBe(MIGRATIONS.length);
    expect(open(path).schemaVersion).toBe(MIGRATIONS.length);
  });

  it('keeps the umpire settings in the log header', async () => {
    const store = open(':memory:');
    const settings = { dial: 'free', persona: 'pedantic' } as const;
    await store.saveLogHeader({ gameId: 'a', scenarioId: 's', seed: 1, settings });
    await store.saveLogHeader({ gameId: 'b', scenarioId: 's', seed: 2 });
    expect((await store.logHeader('a'))?.settings).toEqual(settings);
    expect(await store.logHeader('b')).not.toHaveProperty('settings');
  });

  it('stores header, log, progress, clock history and views', async () => {
    const store = open(':memory:');
    await store.saveLogHeader({ gameId: 'g', scenarioId: 's', seed: 7 });
    await expect(store.saveLogHeader({ gameId: 'g', scenarioId: 's', seed: 8 })).rejects.toThrow();
    expect(await store.logHeader('g')).toEqual({ gameId: 'g', scenarioId: 's', seed: 7 });
    for (const seq of [1, 2, 3]) {
      await store.appendInput('g', { seq, wallMs: 1, gameMs: seq, command: { kind: 'pause' } });
    }
    expect((await store.inputLog('g')).map((e) => e.seq)).toEqual([1, 2, 3]);
    expect((await store.inputLog('g', 2)).map((e) => e.seq)).toEqual([3]);
    await store.saveProgress('g', 50);
    await store.saveProgress('g', 40);
    expect(await store.loadProgress('g')).toBe(50);
    expect(await store.loadHeartbeat('g')).toBeUndefined();
    await store.saveHeartbeat('g', 900);
    await store.saveHeartbeat('g', 800);
    expect(await store.loadHeartbeat('g')).toBe(900);
    const change = {
      wallMs: 1,
      gameMs: 2,
      kind: 'pause',
      rate: 1,
      status: 'paused',
      mode: 'realtime',
    } as const;
    await store.appendClockHistory('g', [change]);
    await store.appendClockHistory('g', [change, change]);
    expect(await store.clockHistory('g')).toHaveLength(3);
    await store.saveViews('g', { seq: 3, gameMs: 9, views: { blue: { a: 1 } } });
    expect(await store.loadViews('g')).toEqual({ seq: 3, gameMs: 9, views: { blue: { a: 1 } } });
  });

  it('stores marks per game and side, replaces a list, and keeps them across a reopen', async () => {
    const path = tmpDb();
    const pin = (id: string, x: number): Mark => ({
      id,
      kind: 'pin',
      at: { x, y: 2 },
      label: 'cav',
      madeAtGame: 5,
    });
    const line: Mark = {
      id: 'l',
      kind: 'line',
      points: [
        { x: 1.5, y: 2.5 },
        { x: 3.5, y: 4.5 },
      ],
      madeAtGame: 9,
    };
    const first = open(path);
    expect(await first.loadMarks('g1', 'blue')).toEqual([]);
    await first.saveMarks('g1', 'blue', [pin('a', 1), pin('b', 2), line]);
    await first.saveMarks('g1', 'red', [pin('r', 3)]);
    await first.saveMarks('g2', 'blue', [pin('other', 4)]);
    await first.saveMarks('g1', 'blue', [pin('b', 7)]);
    expect(await first.loadSeen('g1', 'blue')).toBeUndefined();
    await first.saveSeen('g1', 'blue', 5000);
    await first.saveSeen('g1', 'blue', 3000);
    first.close();

    const again = open(path);
    expect(await again.loadSeen('g1', 'blue')).toBe(5000);
    expect(await again.loadSeen('g1', 'red')).toBeUndefined();
    expect(await again.loadMarks('g1', 'blue')).toEqual([pin('b', 7)]);
    expect(await again.loadMarks('g1', 'red')).toEqual([pin('r', 3)]);
    expect(await again.loadMarks('g2', 'blue')).toEqual([pin('other', 4)]);
    expect(await again.loadMarks('g2', 'red')).toEqual([]);
    await again.saveMarks('g1', 'blue', []);
    expect(await again.loadMarks('g1', 'blue')).toEqual([]);
  });

  it('stores drafts per game and side and keeps them across a reopen', async () => {
    const path = tmpDb();
    const book = new DraftBook();
    book.create('d1', 'ann', { text: 'abc' });
    book.edit('d1', 'bob', 5, { baseRev: 0, op: ['x', 3] });
    const first = open(path);
    expect(await first.loadDrafts('g1', 'blue')).toEqual([]);
    await first.saveDrafts('g1', 'blue', book.toJSON());
    first.close();
    const again = open(path);
    expect(await again.loadDrafts('g1', 'blue')).toEqual(book.toJSON());
    expect(await again.loadDrafts('g1', 'red')).toEqual([]);
    expect(await again.loadDrafts('g2', 'blue')).toEqual([]);
  });

  it('keeps the newest snapshots and loads the latest', async () => {
    const store = open(':memory:');
    const clock = {
      gameMsAtAnchor: 0,
      wallMsAtAnchor: 0,
      rate: 1,
      status: 'paused',
      mode: 'realtime',
    } as const;
    for (let seq = 0; seq < 8; seq++)
      await store.saveSnapshot('g', { seq, engine: `e${seq}`, clock });
    expect(await store.loadSnapshot('g')).toEqual({ seq: 7, engine: 'e7', clock });
    expect(await store.listGames()).toEqual(['g']);
  });
});

describe('crash recovery', () => {
  // A crash is modelled by abandoning the first store handle without closing it or the host:
  // every write is already committed to the file, exactly as after `kill -9`.
  for (const snapshotEvery of [1, 3, 100]) {
    it(`comes back paused with identical state (snapshot every ${snapshotEvery})`, async () => {
      const path = tmpDb();
      const time = new FakeTime();
      const store = open(path);
      const host = hostFor(store, time, snapshotEvery);
      const world = loadScenario(holdTheBridge);
      const game = await host.create('g1', world, { rate: 12 });
      await game.submit(order);
      await time.advance(2_000);
      await game.submit({ kind: 'setRate', rate: 4 });
      await game.submit({ kind: 'pause' });
      await game.submit({ kind: 'resume' });
      // Long enough for queued events to fire from scheduler ticks after the last input, so the
      // progress catch-up on reopen is what makes the states equal.
      await time.advance(300_000);
      const before = serialize(game.state);
      const timeBefore = game.state.time;
      const lastInput = (await open(path).inputLog('g1')).at(-1)!;
      expect(timeBefore).toBeGreaterThan(lastInput.endGameMs ?? lastInput.gameMs);

      // kill -9: no close, no shutdown. A second process opens the same file.
      const time2 = new FakeTime(time.now() + 3_600_000);
      const reopened = await hostFor(open(path), time2, snapshotEvery).open('g1');

      expect(reopened.gameClock.status).toBe('paused');
      // The downtime is told to the players and journaled; the heartbeat is the last wall time
      // before the crash, so it is at least the hour the second process waited less the run.
      expect(reopened.restart?.downMs).toBeGreaterThanOrEqual(3_600_000);
      expect(reopened.gameClock.rate).toBe(4);
      expect(reopened.state.time).toBe(timeBefore);
      expect(serialize(reopened.state)).toBe(before);
      await time2.advance(60_000);
      expect(reopened.state.time).toBe(timeBefore);
      await reopened.submit({ kind: 'resume' });
      await time2.advance(5_000);
      expect(reopened.gameClock.now()).toBeGreaterThan(timeBefore);
      // Input numbering carries on from the log.
      const log = await open(path).inputLog('g1');
      expect(log.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
      const restart = log[4]!;
      expect(restart.command.kind).toBe('restart');
      expect(restart.gameMs).toBe(timeBefore);
      expect(restart.endGameMs).toBe(timeBefore);
    });
  }

  it('recovers an order that was mid-parse when other commands snapshotted', async () => {
    const path = tmpDb();
    const time = new FakeTime();
    let release!: () => void;
    const slow: OrderParser = {
      parse: async (text) => {
        await new Promise<void>((r) => (release = r));
        return { kind: 'intents', text, unitId: 'blue-1', intents: [{ kind: 'move', to: BRIDGE }] };
      },
    };
    const host = new GameHost({
      store: open(path),
      parser: slow,
      registry: registry(),
      wallNow: time.now,
      timers: time,
    });
    hosts.push(host);
    const game = await host.create('g1', loadScenario(holdTheBridge), { rate: 12 });
    const done = game.submit(order);
    await time.advance(1_000);
    // Served while the order is parsing: its seq is lower, but it is logged first.
    await game.submit({ kind: 'setRate', rate: 4 });
    release();
    await done;
    await game.submit({ kind: 'pause' });
    const before = serialize(game.state);

    const time2 = new FakeTime(time.now() + 1_000);
    const reopened = await hostFor(open(path), time2).open('g1');
    expect(serialize(reopened.state)).toBe(before);
  });

  it('keeps seqs unique after reopening a log whose last entry is not the highest seq', async () => {
    const path = tmpDb();
    const time = new FakeTime();
    let release!: () => void;
    const slow: OrderParser = {
      parse: async (text) => {
        await new Promise<void>((r) => (release = r));
        return { kind: 'intents', text, unitId: 'blue-1', intents: [{ kind: 'move', to: BRIDGE }] };
      },
    };
    const host = new GameHost({
      store: open(path),
      parser: slow,
      registry: registry(),
      wallNow: time.now,
      timers: time,
      snapshotEvery: 100,
    });
    hosts.push(host);
    const game = await host.create('g1', loadScenario(holdTheBridge), { rate: 12 });
    const done = game.submit(order);
    await time.advance(1_000);
    await game.submit({ kind: 'setRate', rate: 4 });
    release();
    await done;
    // No snapshot since the start, so the reopened tail is [2, 1]: the order is logged last.
    const time2 = new FakeTime(time.now() + 1_000);
    const reopened = await hostFor(open(path), time2, 100).open('g1');
    await reopened.submit({ kind: 'pause' });
    expect((await open(path).inputLog('g1')).map((e) => e.seq)).toEqual([2, 1, 3, 4]);
  });

  it('replay from the database equals the in-memory run', async () => {
    const path = tmpDb();
    const time = new FakeTime();
    const sqlite = open(path);
    const game = await hostFor(sqlite, time, 2).create('g1', loadScenario(holdTheBridge), {
      rate: 12,
    });
    // The same game against a memory store, driven identically on its own fake time.
    const mtime = new FakeTime();
    const mem = new MemoryGameStore();
    const mgame = await hostFor(mem, mtime).create('g1', loadScenario(holdTheBridge), { rate: 12 });
    for (const [t, g, cmd] of [
      [0, game, order],
      [4_000, game, { kind: 'setRate', rate: 4 } as const],
      [4_000, game, { kind: 'pause' } as const],
    ] as const) {
      await time.advance(t);
      await g.submit(cmd);
    }
    for (const [t, cmd] of [
      [0, order],
      [4_000, { kind: 'setRate', rate: 4 } as const],
      [4_000, { kind: 'pause' } as const],
    ] as const) {
      await mtime.advance(t);
      await mgame.submit(cmd);
    }
    const log = await sqlite.inputLog('g1');
    const header = (await sqlite.logHeader('g1'))!;
    const replayed = replayLog(header, loadScenario(holdTheBridge), log, registry());
    expect(serialize(replayed.state)).toBe(serialize(game.state));
    expect(log).toEqual(await mem.inputLog('g1'));
  });

  it('stores the latest per-side views and the clock history', async () => {
    const path = tmpDb();
    const time = new FakeTime();
    const store = open(path);
    const game = await hostFor(store, time).create('g1', loadScenario(holdTheBridge));
    await game.submit({ kind: 'pause' });
    const views = await store.loadViews('g1');
    expect(Object.keys(views!.views).sort()).toEqual(['blue', 'red']);
    expect(views!.seq).toBe(1);
    expect((await store.clockHistory('g1')).map((c) => c.kind)).toEqual(['pause']);
  });

  it("keeps a finished game's winner in its stored summary across a reopen", async () => {
    const path = tmpDb();
    const store = open(path);
    await hostFor(store, new FakeTime()).create('g1', loadScenario(holdTheBridge));
    expect((await store.loadSummary('g1'))?.finished).toBe(false);
    await store.saveOutcome('g1', 'blue');
    store.close();
    const summary = await open(path).loadSummary('g1');
    expect(summary?.finished).toBe(true);
    expect(summary?.winner).toBe('blue');
  });
});
