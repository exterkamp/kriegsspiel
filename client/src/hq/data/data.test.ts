import { describe, expect, it } from 'vitest';
import { fixtureView } from '../../table/fixture.js';
import { demoScope, FixtureSource, normalizeFixture, projectGameTime } from './fixture.js';
import { BrowserRepository, type StoragePort } from './repository.js';

const operation = () => ({ signal: new AbortController().signal });
const valid = () => {
  const raw = structuredClone(fixtureView);
  raw.lastKnownContacts = raw.lastKnownContacts.map((c) => ({
    ...c,
    ageMs: raw.atGame - c.observedAtGame,
  }));
  return raw;
};
describe('fixture boundary', () => {
  it('recovers from subscriber cancellation and rejects oversized enemy geometry/labels', async () => {
    const source = new FixtureSource(demoScope, () => 0);
    const controller = new AbortController();
    const off = source.subscribe((s) => {
      if (s.connection === 'opening') controller.abort();
    });
    expect((await source.open({ signal: controller.signal })).ok).toBe(false);
    expect(source.getState().connection).toBe('idle');
    off();
    expect((await source.open(operation())).ok).toBe(true);
    source.dispose();
    const raw = valid();
    const own = raw.ownUnits[0]!;
    raw.visibleEnemies = [
      {
        id: 'enemy',
        position: own.position,
        facing: 0,
        formation: 'loose',
        footprint: own.footprint,
        shape: Array.from({ length: 257 }, () => ({ x: 0, y: 0 })),
      },
    ];
    expect(() => normalizeFixture(raw, demoScope, 0)).toThrow();
    raw.visibleEnemies[0]!.shape = [{ x: -100000, y: 0 }];
    expect(() => normalizeFixture(raw, demoScope, 0)).toThrow();
    raw.visibleEnemies[0]!.shape = [{ x: 0, y: 0 }];
    raw.visibleEnemies[0]!.footprint = { frontage: 1e9, depth: 10 };
    expect(() => normalizeFixture(raw, demoScope, 0)).toThrow();
    raw.visibleEnemies[0]!.footprint = own.footprint;
    raw.visibleEnemies[0]!.sizeEstimate = 'x'.repeat(257);
    expect(() => normalizeFixture(raw, demoScope, 0)).toThrow();
  });
  it('rejects hidden fields, inconsistent dates and conflicting duplicate papers', () => {
    expect(() => normalizeFixture({ ...valid(), masterState: {} }, demoScope, 0)).toThrow();
    expect(() => normalizeFixture(fixtureView, demoScope, 0)).toThrow();
    const raw = valid();
    const paper = {
      id: 'p1',
      from: 'Scout',
      writtenAtGame: 0,
      receivedAtGame: 1000,
      category: 'scouts' as const,
      text: 'Column by the river.',
    };
    raw.dispatches = [paper, paper];
    expect(normalizeFixture(raw, demoScope, 0).papers).toHaveLength(1);
    raw.dispatches = [paper, { ...paper, text: 'Changed report' }];
    expect(() => normalizeFixture(raw, demoScope, 0)).toThrow();
  });
  it('preserves unknown commander and snapshot provenance, with no fabricated observation time', () => {
    const snapshot = normalizeFixture(valid(), demoScope, 0);
    expect(snapshot.roster[0]?.commander.kind).toBe('unknown');
    expect(snapshot.roster[0]?.strength.kind).toBe('snapshot');
    expect(snapshot.pieces[0]?.observedAtGame).toBeNull();
    expect(Object.isFrozen(snapshot.roster)).toBe(true);
  });
  it.each([1, 4, 12, 1000])('advances only eligible real-time clocks at rate %s', (rate) => {
    const snapshot = normalizeFixture(valid(), demoScope, 100);
    const running = { ...snapshot, clock: { ...snapshot.clock, rate, status: 'running' as const } };
    const state = { connection: 'ready' as const, stale: false, snapshot: running, error: null };
    expect(projectGameTime(state, 'fixture', 1100)).toBe(snapshot.atGame + 1000 * rate);
    expect(projectGameTime(state, 'live', 1100)).toBe(snapshot.atGame);
    expect(projectGameTime({ ...state, stale: true }, 'fixture', 1100)).toBe(snapshot.atGame);
    for (const mode of ['manual', 'fast-forward', 'unknown'] as const)
      expect(
        projectGameTime(
          { ...state, snapshot: { ...running, clock: { ...running.clock, mode } } },
          'fixture',
          1100,
        ),
      ).toBe(snapshot.atGame);
    for (const barrier of [
      { kind: 'unknown' },
      { kind: 'working', needAtGame: snapshot.atGame },
    ] as const)
      expect(
        projectGameTime(
          { ...state, snapshot: { ...running, clock: { ...running.clock, barrier } } },
          'fixture',
          1100,
        ),
      ).toBe(snapshot.atGame);
    expect(projectGameTime(state, 'fixture', 0)).toBe(snapshot.atGame);
  });
  it('does not revive after dispose, and isolates failing subscribers', async () => {
    const source = new FixtureSource(demoScope, () => 0);
    source.subscribe((s) => {
      if (s.connection === 'ready') throw new Error('Subscriber defect');
    });
    let seen = '';
    source.subscribe((s) => {
      seen = s.connection;
    });
    expect((await source.open(operation())).ok).toBe(true);
    expect(seen).toBe('ready');
    source.dispose();
    expect((await source.refresh(operation())).ok).toBe(false);
    expect(source.getState().connection).toBe('disposed');
  });
});
describe('scoped preference repository', () => {
  const make = () => {
    const entries = new Map<string, string>();
    const storage: StoragePort = {
      getItem: (k) => entries.get(k) ?? null,
      setItem: (k, v) => {
        entries.set(k, v);
      },
    };
    let revision = 0;
    return {
      entries,
      storage,
      repository: new BrowserRepository(
        demoScope,
        () => storage,
        () => `r${++revision}`,
      ),
    };
  };
  it('detects deleted storage and does not resurrect a stale saved document', async () => {
    const { repository, entries } = make();
    const initial = await repository.load(operation());
    if (!initial.ok) throw new Error('Expected document');
    const saved = await repository.save(
      { ...initial.value.document, highContrast: true },
      initial.value.document.revision,
      operation(),
    );
    if (!saved.ok) throw new Error('Expected save');
    entries.clear();
    expect(
      (await repository.save(saved.value.document, saved.value.document.revision, operation())).ok,
    ).toBe(false);
    expect(entries.size).toBe(0);
    const loaded = await repository.load(operation());
    expect(loaded.ok && loaded.value.document.highContrast).toBe(false);
  });
  it('preserves stored data on quota failure and returns success after the write commit point', async () => {
    const { repository, storage, entries } = make();
    const initial = await repository.load(operation());
    if (!initial.ok) throw new Error('Expected document');
    const saved = await repository.save(
      initial.value.document,
      initial.value.document.revision,
      operation(),
    );
    if (!saved.ok) throw new Error('Expected save');
    const before = [...entries.entries()];
    const write = storage.setItem;
    storage.setItem = () => {
      const e = new Error('Full');
      e.name = 'QuotaExceededError';
      throw e;
    };
    const failed = await repository.save(
      { ...saved.value.document, highContrast: true },
      saved.value.document.revision,
      operation(),
    );
    expect(!failed.ok && failed.error.code).toBe('quota-exceeded');
    expect([...entries.entries()]).toEqual(before);
    const controller = new AbortController();
    storage.setItem = (key, value) => {
      write(key, value);
      controller.abort();
    };
    const committed = await repository.save(
      { ...saved.value.document, highContrast: true },
      saved.value.document.revision,
      { signal: controller.signal },
    );
    expect(committed.ok).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(await repository.load(operation())).toEqual(committed);
  });
  it('reloads saved preferences, rejects stale writes and isolates player scope', async () => {
    const { repository, storage } = make();
    const loaded = await repository.load(operation());
    if (!loaded.ok) throw new Error('Expected initial document');
    const d = loaded.value.document;
    expect(await repository.load(operation())).toEqual(loaded);
    const saved = await repository.save({ ...d, highContrast: true }, d.revision, operation());
    expect(saved.ok).toBe(true);
    expect((await repository.save(d, d.revision, operation())).ok).toBe(false);
    const reopened = new BrowserRepository(demoScope, () => storage);
    expect(await reopened.load(operation())).toEqual(saved);
    const other = new BrowserRepository({ ...demoScope, playerId: 'another' }, () => storage);
    const isolated = await other.load(operation());
    expect(isolated.ok && isolated.value.document.highContrast).toBe(false);
    expect(
      (
        await repository.save(
          {
            ...d,
            selection: { kind: 'unit', id: 'u', scope: { ...demoScope, playerId: 'other' } },
          },
          d.revision,
          operation(),
        )
      ).ok,
    ).toBe(false);
  });
  it('preserves corrupt/future records, reports denial and does not write after cancellation', async () => {
    const { repository, entries } = make();
    const loaded = await repository.load(operation());
    if (!loaded.ok) throw new Error('Expected document');
    const aborted = new AbortController();
    aborted.abort();
    expect(
      (
        await repository.save(loaded.value.document, loaded.value.document.revision, {
          signal: aborted.signal,
        })
      ).ok,
    ).toBe(false);
    expect(entries.size).toBe(0);
    const key = JSON.stringify([
      'kriegsspiel.hq.preferences.v1',
      demoScope.gameId,
      demoScope.sideId,
      demoScope.playerId,
    ]);
    entries.set(key, '{broken');
    expect((await repository.load(operation())).ok).toBe(false);
    expect(entries.get(key)).toBe('{broken');
    entries.set(key, JSON.stringify({ schemaVersion: 99 }));
    const future = await repository.load(operation());
    expect(!future.ok && future.error.code).toBe('migration-required');
    const denied = new BrowserRepository(demoScope, () => {
      throw new Error('Denied');
    });
    const result = await denied.load(operation());
    expect(!result.ok && result.error.code).toBe('storage-unavailable');
  });
});
