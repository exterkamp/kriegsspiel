import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NativeBattlefieldRegistry,
  DEFAULT_BRIDGE_PAIRING,
  OPEN_BRIDGE_PAIRING,
} from './native-battlefield-registry.js';
import { MemoryGameStore, FileGameStore, parseInputLog, type InputLogHeader } from './store.js';
import { SqliteGameStore } from './sqlite.js';
import { headerPin, initialWorldFromHeader, assertPinnedWorld } from './pinned-header.js';
import { loadReplayInput, replayAt } from '../admin/replayView.js';
import { replayLog } from './replay.js';
import { createRegistry, startingState } from './registry.js';

const registry = new NativeBattlefieldRegistry([DEFAULT_BRIDGE_PAIRING, OPEN_BRIDGE_PAIRING]);
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});
async function folder() {
  const path = await mkdtemp(join(tmpdir(), 'ks-native-header-'));
  folders.push(path);
  return path;
}
function header(): InputLogHeader {
  const entry = registry.publicCatalog('hold-the-bridge').entries[1]!;
  const pin = registry.resolve('hold-the-bridge', {
    pairingId: entry.pairing.id,
    revision: entry.pairing.revision,
  });
  return {
    gameId: 'pinned-game',
    scenarioId: pin.initialWorld.scenarioId,
    seed: pin.initialWorld.seed,
    settings: { dial: 'standard', persona: 'dry' },
    battlefieldFormat: 1,
    battlefieldPin: pin,
    creationReceiptId: randomUUID(),
  };
}

describe('private pinned input headers', () => {
  it.each(['memory', 'jsonl', 'sqlite'] as const)(
    'retains detached pins and receipts through %s storage',
    async (kind) => {
      const path = await folder();
      const store =
        kind === 'memory'
          ? new MemoryGameStore()
          : kind === 'jsonl'
            ? new FileGameStore(path)
            : new SqliteGameStore(join(path, 'game.sqlite'));
      try {
        const input = header();
        const expected = structuredClone(input);
        const saving = store.saveLogHeader(input);
        // File creation awaits mkdir; caller mutation must not alter the accepted write.
        input.battlefieldPin!.initialWorld.units[0]!.morale = 0;
        await saving;
        const read = (await store.logHeader(expected.gameId))!;
        expect(read).toEqual(expected);
        read.battlefieldPin!.initialWorld.units[0]!.morale = 0;
        expect(await store.logHeader(expected.gameId)).toEqual(expected);
        expect(initialWorldFromHeader(expected).scenarioId).toBe('hold-the-bridge-open-v1');
      } finally {
        if (store instanceof SqliteGameStore) store.close();
      }
    },
  );

  it('reopens durable pins and loads admin/window/critique replay without an alternative registry lookup', async () => {
    const path = join(await folder(), 'game.sqlite');
    const first = new SqliteGameStore(path);
    const input = header();
    await first.saveLogHeader(input);
    first.close();
    const reopened = new SqliteGameStore(path);
    try {
      expect(await reopened.logHeader(input.gameId)).toEqual(input);
      const replay = (await loadReplayInput(reopened, input.gameId))!;
      expect(replay.world).toEqual(input.battlefieldPin!.initialWorld);
      expect(replayAt(replay, 0).engine.world.map.features).toHaveLength(3);
    } finally {
      reopened.close();
    }
  });

  it('preserves explicit legacy headers and refuses unknown legacy scenarios', async () => {
    const store = new SqliteGameStore(':memory:');
    try {
      const legacy = { gameId: 'old', scenarioId: 'hold-the-bridge', seed: 1815 };
      await store.saveLogHeader(legacy);
      expect(await store.logHeader('old')).toEqual(legacy);
      expect(headerPin(legacy)).toBeUndefined();
      expect(initialWorldFromHeader(legacy).map.features).toHaveLength(5);
      expect(() => initialWorldFromHeader({ ...legacy, scenarioId: 'unknown' })).toThrow(
        /unknown scenario/,
      );
    } finally {
      store.close();
    }
  });

  it('never treats missing, unknown or contradictory modern fields as a legacy default', () => {
    const good = header();
    for (const input of [
      { ...good, battlefieldFormat: 2 },
      { ...good, battlefieldPin: null },
      {
        battlefieldPin: good.battlefieldPin,
        gameId: good.gameId,
        scenarioId: good.scenarioId,
        seed: good.seed,
      },
      {
        creationReceiptId: good.creationReceiptId,
        gameId: good.gameId,
        scenarioId: 'hold-the-bridge',
        seed: good.seed,
      },
      { ...good, scenarioId: 'hold-the-bridge' },
    ])
      expect(() => initialWorldFromHeader(input as InputLogHeader)).toThrow();
    expect(() => initialWorldFromHeader(good, 'other-game')).toThrow(/identity mismatch/);
  });

  it.each(['memory', 'jsonl', 'sqlite'] as const)(
    'keeps a pinned game its own seed and rules version through %s storage and replay (#534, #432)',
    async (kind) => {
      const path = await folder();
      const store =
        kind === 'memory'
          ? new MemoryGameStore()
          : kind === 'jsonl'
            ? new FileGameStore(path)
            : new SqliteGameStore(join(path, 'game.sqlite'));
      try {
        // The pin keeps the scenario's authored world (seed 1815); the game rolls its own dice.
        const input = { ...header(), seed: 424242, rules: 4 };
        expect(input.battlefieldPin!.initialWorld.seed).not.toBe(input.seed);
        await store.saveLogHeader(input);
        const read = (await store.logHeader(input.gameId))!;
        expect(read).toEqual(input);
        expect(headerPin(read)).toEqual(input.battlefieldPin);
        const world = initialWorldFromHeader(read, input.gameId);
        expect(world.seed).toBe(input.battlefieldPin!.initialWorld.seed);
        const replay = replayLog(read, world, [], createRegistry(), 0, startingState);
        expect(replay.state.world.seed).toBe(424242);
        expect(replay.state.world.rules).toBe(4);
        const live = { ...structuredClone(world), seed: 424242, dial: 'standard' as const };
        expect(() => assertPinnedWorld(read, live, input.gameId)).not.toThrow();
      } finally {
        if (store instanceof SqliteGameStore) store.close();
      }
    },
  );

  it('rejects contradictory recovered static terrain but permits evolved unit positions', () => {
    const input = header();
    const world = structuredClone(input.battlefieldPin!.initialWorld);
    world.units[0]!.center.x += 1000;
    world.dial = 'standard';
    expect(() => assertPinnedWorld(input, world, input.gameId)).not.toThrow();
    world.map.width += 1000;
    expect(() => assertPinnedWorld(input, world, input.gameId)).toThrow(/contradicts/);
  });

  it('requires direct native replay callers to provide the exact pre-runtime world', () => {
    const input = header();
    const world = initialWorldFromHeader(input);
    expect(() => replayLog(input, world, [], createRegistry(), 0, startingState)).not.toThrow();
    world.units[0]!.strength -= 1;
    expect(() => replayLog(input, world, [], createRegistry(), 0, startingState)).toThrow(
      /contradicts pinned/,
    );
  });

  it('round-trips JSONL headers and rejects oversized headers before parsing', () => {
    const input = header();
    expect(parseInputLog(JSON.stringify(input) + '\n').header).toEqual(input);
    expect(() =>
      parseInputLog(JSON.stringify({ ...input, huge: 'x'.repeat(2 * 1024 * 1024) }) + '\n'),
    ).toThrow(/header exceeds/);
  });

  it('distinguishes absent native settings from empty, malformed and invalid stored settings', async () => {
    const path = join(await folder(), 'settings.sqlite');
    const store = new SqliteGameStore(path);
    const input = { ...header(), settings: { dial: 'free' as const, persona: 'dry' as const } };
    await store.saveLogHeader(input);
    const database = new DatabaseSync(path);
    const update = (value: string | null) =>
      database.prepare('UPDATE games SET settings = ? WHERE game_id = ?').run(value, input.gameId);
    try {
      expect((await store.logHeader(input.gameId))!.settings).toEqual(input.settings);
      expect((await loadReplayInput(store, input.gameId))!.header.settings).toEqual(input.settings);
      update(null);
      expect(await store.logHeader(input.gameId)).not.toHaveProperty('settings');
      expect((await loadReplayInput(store, input.gameId))!.header).not.toHaveProperty('settings');
      for (const invalid of [
        '',
        '{',
        'null',
        '{}',
        '{"dial":"unknown","persona":"dry"}',
        'x'.repeat(16385),
      ]) {
        update(invalid);
        await expect(store.logHeader(input.gameId)).rejects.toThrow();
        await expect(loadReplayInput(store, input.gameId)).rejects.toThrow();
      }
      update(JSON.stringify(input.settings));
      expect((await store.logHeader(input.gameId))!.settings).toEqual(input.settings);
    } finally {
      database.close();
      store.close();
    }
  });

  it('rejects missing/corrupt/oversized SQLite pin columns instead of dropping the format', async () => {
    const path = join(await folder(), 'game.sqlite');
    const store = new SqliteGameStore(path);
    const input = header();
    await store.saveLogHeader(input);
    const database = new DatabaseSync(path);
    try {
      for (const change of [
        () =>
          database
            .prepare('UPDATE games SET battlefield_pin = NULL WHERE game_id = ?')
            .run(input.gameId),
        () =>
          database
            .prepare(
              'UPDATE games SET battlefield_format = NULL, battlefield_pin = ?, creation_receipt_id = NULL WHERE game_id = ?',
            )
            .run(JSON.stringify(input.battlefieldPin), input.gameId),
        () =>
          database
            .prepare(
              'UPDATE games SET battlefield_format = 1, battlefield_pin = ? WHERE game_id = ?',
            )
            .run('x'.repeat(1024 * 1024 + 1), input.gameId),
      ]) {
        change();
        await expect(store.logHeader(input.gameId)).rejects.toThrow();
      }
    } finally {
      database.close();
      store.close();
    }
  });
});
