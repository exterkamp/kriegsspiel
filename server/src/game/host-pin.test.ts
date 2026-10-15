import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NativeBattlefieldRegistry,
  DEFAULT_BRIDGE_PAIRING,
  OPEN_BRIDGE_PAIRING,
} from './native-battlefield-registry.js';
import { GameHost } from './host.js';
import { MemoryGameStore } from './store.js';
import { createRegistry, startingState } from './registry.js';
import { FakeTime } from './testing.js';
import { headerPin, initialWorldFromHeader } from './pinned-header.js';
import { StubOrderParser } from '../orders/stubParser.js';
const registry = new NativeBattlefieldRegistry([DEFAULT_BRIDGE_PAIRING, OPEN_BRIDGE_PAIRING]);
const descriptor = registry.publicCatalog('hold-the-bridge').entries[1]!;
const pin = () =>
  registry.resolve('hold-the-bridge', {
    pairingId: descriptor.pairing.id,
    revision: descriptor.pairing.revision,
  });
const hosts: GameHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.shutdown()));
});
function createHost(store: MemoryGameStore, time = new FakeTime(), onClose = vi.fn()) {
  const host = new GameHost({
    store,
    parser: new StubOrderParser(),
    registry: createRegistry(),
    init: startingState,
    wallNow: time.now,
    timers: time,
    onClose,
  });
  hosts.push(host);
  return host;
}

describe('native pinned actor activation and recovery', () => {
  it('writes the pre-runtime pin while applying settings only to the running world', async () => {
    const store = new MemoryGameStore();
    const host = createHost(store);
    const native = pin();
    const actor = await host.create('pinned', native.initialWorld, {
      pin: native,
      settings: { dial: 'free', persona: 'dry' },
      rate: 4,
    });
    const header = (await store.logHeader('pinned'))!;
    expect(headerPin(header)!.initialWorld).toEqual(native.initialWorld);
    expect(header.battlefieldPin!.initialWorld).not.toHaveProperty('dial');
    expect(actor.state.world.dial).toBe('free');
    expect(actor.state.world.map.features).toHaveLength(3);
    expect(initialWorldFromHeader(header)).toEqual(native.initialWorld);
  });

  it('does not expose an actor or duplicate open before persistence/startup settles', async () => {
    const store = new MemoryGameStore();
    const time = new FakeTime();
    const host = createHost(store, time);
    const native = pin();
    const save = store.saveSnapshot.bind(store);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = vi.fn();
    vi.spyOn(store, 'saveSnapshot').mockImplementation(async (id, snapshot) => {
      entered();
      await blocked;
      return save(id, snapshot);
    });
    const first = host.create('pending', native.initialWorld, { pin: native });
    await vi.waitFor(() => expect(entered).toHaveBeenCalled());
    expect(host.get('pending')).toBeUndefined();
    const duplicate = host.open('pending');
    release();
    expect(await duplicate).toBe(await first);
    expect(host.get('pending')).toBe(await first);
  });

  it('resumes exactly the same native header after a failed first snapshot', async () => {
    const store = new MemoryGameStore();
    const time = new FakeTime();
    const host = createHost(store, time);
    const native = pin();
    const headerWrites = vi.spyOn(store, 'saveLogHeader');
    const failure = vi
      .spyOn(store, 'saveSnapshot')
      .mockRejectedValueOnce(new Error('snapshot unavailable'));
    await expect(host.create('interrupted', native.initialWorld, { pin: native })).rejects.toThrow(
      'snapshot unavailable',
    );
    expect(host.get('interrupted')).toBeUndefined();
    expect(time.pendingTimers).toBe(0);
    const original = await store.logHeader('interrupted');
    expect(original).toBeDefined();
    failure.mockRestore();
    const actor = await host.create('interrupted', native.initialWorld, { pin: native });
    expect(actor.state.world.map.features).toHaveLength(3);
    expect(await store.logHeader('interrupted')).toEqual(original);
    expect(headerWrites).toHaveBeenCalledTimes(1);
  });

  it('rejects a different assembly or conflicting inputs in a header-only allocation', async () => {
    const store = new MemoryGameStore();
    const host = createHost(store);
    const native = pin();
    await store.saveLogHeader({
      gameId: 'incomplete',
      scenarioId: native.initialWorld.scenarioId,
      seed: native.initialWorld.seed,
      battlefieldFormat: 1,
      battlefieldPin: native,
    });
    const other = registry.resolve('hold-the-bridge');
    await expect(host.create('incomplete', other.initialWorld, { pin: other })).rejects.toThrow(
      /conflicts/,
    );
    await store.appendInput('incomplete', {
      seq: 1,
      wallMs: 0,
      gameMs: 0,
      command: { kind: 'pause' },
    });
    await expect(host.create('incomplete', native.initialWorld, { pin: native })).rejects.toThrow(
      /conflicts/,
    );
    expect(host.get('incomplete')).toBeUndefined();
    expect(await store.loadSnapshot('incomplete')).toBeUndefined();
  });

  it('closes partial actors after later startup failure and reopens their existing snapshot', async () => {
    const store = new MemoryGameStore();
    const time = new FakeTime();
    const close = vi.fn();
    const host = createHost(store, time, close);
    const native = pin();
    const failure = vi
      .spyOn(store, 'saveViews')
      .mockRejectedValueOnce(new Error('views unavailable'));
    await expect(host.create('partial', native.initialWorld, { pin: native })).rejects.toThrow(
      'views unavailable',
    );
    expect(host.get('partial')).toBeUndefined();
    expect(time.pendingTimers).toBe(0);
    expect(close).toHaveBeenCalledWith('partial');
    expect(await store.loadSnapshot('partial')).toBeDefined();
    failure.mockRestore();
    const reopened = await host.open('partial');
    expect(reopened.state.world.map.features).toHaveLength(3);
  });

  it('validates immutable recovered terrain before replay or actor registration', async () => {
    const store = new MemoryGameStore();
    const first = createHost(store);
    const native = pin();
    await first.create('corrupt', native.initialWorld, { pin: native });
    await first.shutdown();
    const snapshot = (await store.loadSnapshot('corrupt'))!;
    const encoded = JSON.parse(snapshot.engine);
    encoded.world.map.width += 1000;
    await store.saveSnapshot('corrupt', { ...snapshot, engine: JSON.stringify(encoded) });
    const second = createHost(store);
    await expect(second.open('corrupt')).rejects.toThrow(/contradicts/);
    expect(second.get('corrupt')).toBeUndefined();
  });

  it.each(['missing header', 'missing marker', 'changed settings', 'foreign identity'])(
    'refuses recovery after %s instead of downgrading to a legacy scenario',
    async (change) => {
      const store = new MemoryGameStore();
      const first = createHost(store);
      const native = pin();
      await first.create('bound', native.initialWorld, {
        pin: native,
        settings: { dial: 'free', persona: 'dry' },
      });
      await first.shutdown();
      const saved = (await store.loadSnapshot('bound'))!;
      expect(saved.battlefield).toBeDefined();
      if (change === 'missing header') vi.spyOn(store, 'logHeader').mockResolvedValue(undefined);
      if (change === 'missing marker') {
        const altered = { ...saved };
        delete altered.battlefield;
        await store.saveSnapshot('bound', altered);
      }
      if (change === 'changed settings') {
        const h = (await store.logHeader('bound'))!;
        await store.saveLogHeader({ ...h, settings: { dial: 'free', persona: 'pedantic' } });
      }
      if (change === 'foreign identity')
        await store.saveSnapshot('bound', {
          ...saved,
          battlefield: {
            ...saved.battlefield!,
            headerIdentity: 'native-input-header-v1:sha256:' + '0'.repeat(64),
          },
        });
      const second = createHost(store);
      await expect(second.open('bound')).rejects.toThrow(/Snapshot contradicts/);
      expect(second.get('bound')).toBeUndefined();
    },
  );

  it('preserves an existing native header when a retry omits its pin', async () => {
    const store = new MemoryGameStore();
    const native = pin();
    const host = createHost(store);
    const existing = {
      gameId: 'native-only',
      scenarioId: native.initialWorld.scenarioId,
      seed: native.initialWorld.seed,
      battlefieldFormat: 1 as const,
      battlefieldPin: native,
    };
    await store.saveLogHeader(existing);
    await expect(
      host.create('native-only', registry.resolve('hold-the-bridge').initialWorld),
    ).rejects.toThrow(/conflicts/);
    expect(await store.logHeader('native-only')).toEqual(existing);
    expect(await store.loadSnapshot('native-only')).toBeUndefined();
    expect(host.get('native-only')).toBeUndefined();
  });
  it.each(['missing', 'contradictory legacy'])(
    'does not infer a historical world after combined marker loss and %s header',
    async (change) => {
      const store = new MemoryGameStore();
      const first = createHost(store);
      const native = pin();
      await first.create('lost-markers', native.initialWorld, { pin: native });
      await first.shutdown();
      const saved = (await store.loadSnapshot('lost-markers'))!;
      delete saved.battlefield;
      await store.saveSnapshot('lost-markers', saved);
      if (change === 'missing') vi.spyOn(store, 'logHeader').mockResolvedValue(undefined);
      else
        await store.saveLogHeader({
          gameId: 'lost-markers',
          scenarioId: 'hold-the-bridge',
          seed: 17,
        });
      const second = createHost(store);
      await expect(second.open('lost-markers')).rejects.toThrow(/historical|contradicts/);
      expect(second.get('lost-markers')).toBeUndefined();
    },
  );

  it('waits for in-flight activation before shutdown and retires its scheduler', async () => {
    const store = new MemoryGameStore();
    const time = new FakeTime();
    const host = createHost(store, time);
    const native = pin();
    const save = store.saveSnapshot.bind(store);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = vi.fn();
    vi.spyOn(store, 'saveSnapshot').mockImplementation(async (id, snapshot) => {
      entered();
      await blocked;
      return save(id, snapshot);
    });
    const creating = host.create('closing', native.initialWorld, { pin: native });
    await vi.waitFor(() => expect(entered).toHaveBeenCalled());
    const closing = host.shutdown();
    release();
    await creating;
    await closing;
    expect(host.get('closing')).toBeUndefined();
    expect(time.pendingTimers).toBe(0);
  });
});
