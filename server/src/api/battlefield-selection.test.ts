import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeApprovedBattlefield, decodeBattlefieldCatalog } from '@kriegsspiel/protocol';
import { buildApp, type App } from './app.js';
import { MemoryGameStore } from '../game/store.js';
import { SqliteGameStore } from '../game/sqlite.js';
import { SqliteCreationStore } from '../lobby/creation-store.js';
import {
  NativeBattlefieldRegistry,
  DEFAULT_BRIDGE_PAIRING,
  OPEN_BRIDGE_PAIRING,
} from '../game/native-battlefield-registry.js';
import { StubOrderParser } from '../orders/stubParser.js';
import { FakeTime } from '../game/testing.js';
import { hashToken } from '../auth/store.js';
import { headerPin } from '../game/pinned-header.js';
import { loadReplayInput, replayAt } from '../admin/replayView.js';
const apps: App[] = [];
const owners: SqliteCreationStore[] = [];
const gameStores: SqliteGameStore[] = [];
const folders: string[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.server.close();
  for (const store of gameStores.splice(0)) store.close();
  for (const owner of owners.splice(0)) owner.close();
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
async function open(path?: string) {
  const time = new FakeTime();
  const creations = new SqliteCreationStore(path ?? ':memory:', time.now);
  owners.push(creations);
  const store = path ? new SqliteGameStore(path) : new MemoryGameStore();
  if (store instanceof SqliteGameStore) gameStores.push(store);
  const battlefields = new NativeBattlefieldRegistry([DEFAULT_BRIDGE_PAIRING, OPEN_BRIDGE_PAIRING]);
  const app = await buildApp({
    parser: new StubOrderParser(),
    store,
    creations,
    battlefields,
    scriptedOpponents: true,
    wallNow: time.now,
    timers: time,
    limits: { sweepEveryMs: 0 },
  });
  apps.push(app);
  const user = creations.auth.upsertUser('player@example.test', time.now());
  const login = (id: string) => {
    const token = randomUUID();
    creations.auth.putSession(hashToken(token), id, time.now() + 86400000);
    return { cookie: `ks_session=${token}` };
  };
  const headers = login(user.id);
  const entry = battlefields.publicCatalog('hold-the-bridge').entries[1]!;
  const request = (over: Record<string, unknown> = {}) => ({
    scenario: 'hold-the-bridge',
    requestId: randomUUID(),
    battlefieldVersion: 1,
    pairing: { pairingId: entry.pairing.id, revision: entry.pairing.revision },
    mode: 'turns',
    ...over,
  });
  return { app, creations, store, battlefields, headers, request, user, login, time };
}
describe('native battlefield allocation API', () => {
  it('lists curated public pairings and creates, reads and replays exactly the selected assembly', async () => {
    const { app, creations, headers, request, store } = await open();
    const catalog = (await app.server.inject('/scenarios')).json().scenarios[0].battlefields;
    expect(decodeBattlefieldCatalog(catalog, 'hold-the-bridge').entries).toHaveLength(2);
    const payload = request();
    const made = await app.server.inject({ method: 'POST', url: '/games', headers, payload });
    expect(made.statusCode).toBe(201);
    const id = made.json().id;
    expect(made.json()).toMatchObject({
      scenario: 'hold-the-bridge',
      status: 'started',
      side: 'blue',
    });
    const receipt = creations.lookup(
      creations.auth.getUser(creations.forGame(id)!.ownerId)!.id,
      payload.requestId as string,
    )!;
    const actor = app.host.get(id)!;
    expect(actor.state.world.scenarioId).toBe('hold-the-bridge-open-v1');
    expect(actor.state.world.map.features).toHaveLength(3);
    const header = (await store.logHeader(id))!;
    expect(headerPin(header)!.pinIdentity).toBe(receipt.pin.pinIdentity);
    const info = await app.server.inject({ url: `/games/${id}?battlefieldVersion=1`, headers });
    expect(info.statusCode).toBe(200);
    expect(decodeApprovedBattlefield(info.json().battlefield, info.json().scenario)).toEqual(
      receipt.pin.battlefield,
    );
    for (const privateKey of [
      'rawScenario',
      'initialWorld',
      'battlefieldPin',
      'pinIdentity',
      'creationReceiptId',
      'units',
      'hq',
    ])
      expect(Object.hasOwn(info.json(), privateKey)).toBe(false);
    expect(JSON.stringify(info.json())).not.toMatch(
      /rawScenario|initialWorld|battlefieldPin|pinIdentity/,
    );
    const replay = await loadReplayInput(store, id);
    expect(replayAt(replay!, 0).engine.world.map).toEqual(actor.state.world.map);
  });
  it('retries one game before latest availability and limits, and rejects changed intent', async () => {
    const { app, creations, headers, request, battlefields } = await open();
    const payload = request();
    const first = await app.server.inject({ method: 'POST', url: '/games', headers, payload });
    expect(first.statusCode).toBe(201);
    vi.spyOn(battlefields, 'resolve').mockImplementation(() => {
      throw new Error('catalog offline');
    });
    const retry = await app.server.inject({ method: 'POST', url: '/games', headers, payload });
    expect(retry.statusCode).toBe(201);
    expect(retry.json().id).toBe(first.json().id);
    const changed = await app.server.inject({
      method: 'POST',
      url: '/games',
      headers,
      payload: { ...payload, dial: 'free' },
    });
    expect(changed.statusCode).toBe(409);
    expect(app.host.ids()).toEqual([first.json().id]);
    expect(creations.lobby.byCreator(creations.forGame(first.json().id)!.ownerId)).toHaveLength(1);
  });
  it('retains the same allocation after failed activation and resumes the accepted header', async () => {
    const { app, creations, headers, request, store } = await open();
    const payload = request();
    vi.spyOn(store, 'saveSnapshot').mockRejectedValueOnce(new Error('disk unavailable'));
    const failed = await app.server.inject({ method: 'POST', url: '/games', headers, payload });
    expect(failed.statusCode).toBe(503);
    const id = failed.json().id;
    expect(app.host.get(id)).toBeUndefined();
    expect(await store.logHeader(id)).toBeDefined();
    const reconcile = await app.server.inject({
      url: `/game-creations/${payload.requestId}`,
      headers,
    });
    expect(reconcile.json()).toMatchObject({ gameId: id, status: 'recovery_required' });
    const retry = await app.server.inject({ method: 'POST', url: '/games', headers, payload });
    expect(retry.statusCode).toBe(201);
    expect(retry.json().id).toBe(id);
    expect(creations.forGame(id)!.state).toBe('started');
  });
  it('coalesces concurrent same-key starts instead of allocating another game', async () => {
    const { app, headers, request, store } = await open();
    const payload = request();
    const save = store.saveSnapshot.bind(store);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const entered = vi.fn();
    vi.spyOn(store, 'saveSnapshot').mockImplementationOnce(async (id, snapshot) => {
      entered();
      await blocked;
      return save(id, snapshot);
    });
    const first = app.server.inject({ method: 'POST', url: '/games', headers, payload });
    void first.then(() => {});
    await vi.waitFor(() => expect(entered).toHaveBeenCalled());
    const second = app.server.inject({ method: 'POST', url: '/games', headers, payload });
    void second.then(() => {});
    release();
    const results = await Promise.all([first, second]);
    expect(results.map((r) => r.statusCode)).toEqual([201, 201]);
    expect(results[0]!.json().id).toBe(results[1]!.json().id);
    expect(app.host.ids()).toHaveLength(1);
  });
  it('keeps lobby creation separate from Start and requires capability before joining an alternative', async () => {
    const { app, creations, headers, request, login, time } = await open();
    const payload = request({ lobby: true, sessionType: 'team_vs_team' });
    const made = await app.server.inject({ method: 'POST', url: '/games', headers, payload });
    expect(made.statusCode).toBe(201);
    const id = made.json().id;
    expect(app.host.get(id)).toBeUndefined();
    const other = creations.auth.upsertUser('other@example.test', time.now());
    const peer = login(other.id);
    expect((await app.server.inject({ url: `/games/${id}`, headers: peer })).statusCode).toBe(426);
    expect(
      (
        await app.server.inject({
          method: 'POST',
          url: `/games/${id}/join`,
          headers: peer,
          payload: { side: 'red' },
        })
      ).statusCode,
    ).toBe(426);
    expect(creations.auth.seatOf(id, other.id)).toBeUndefined();
    expect(
      (
        await app.server.inject({
          method: 'POST',
          url: `/games/${id}/join?battlefieldVersion=1`,
          headers: peer,
          payload: { side: 'red' },
        })
      ).statusCode,
    ).toBe(200);
    await app.server.inject({
      method: 'POST',
      url: `/games/${id}/ready`,
      headers: peer,
      payload: { ready: true },
    });
    expect(
      (await app.server.inject({ method: 'POST', url: `/games/${id}/start`, headers, payload: {} }))
        .statusCode,
    ).toBe(200);
    expect(app.host.get(id)!.state.world.map.features).toHaveLength(3);
  });
  it('preserves no-key default semantics and default clients while rejecting stale selections before effects', async () => {
    const { app, creations, headers, request, user } = await open();
    const made = await app.server.inject({
      method: 'POST',
      url: '/games',
      headers,
      payload: { mode: 'turns' },
    });
    expect(made.statusCode).toBe(201);
    expect(app.host.get(made.json().id)!.state.world.map.features).toHaveLength(5);
    expect((await app.server.inject({ url: `/games/${made.json().id}`, headers })).statusCode).toBe(
      200,
    );
    const stale = request();
    (stale.pairing as { revision: string }).revision = 'engine-pairing-v1:sha256:' + '0'.repeat(64);
    const bad = await app.server.inject({ method: 'POST', url: '/games', headers, payload: stale });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('stale_pairing');
    expect(creations.lobby.byCreator(user.id)).toHaveLength(1);
    expect(creations.lookup(user.id, stale.requestId as string)).toBeUndefined();
  });
  it('does not disclose guest maps or another owner receipt through an invite', async () => {
    const { app, creations, request, login, time } = await open();
    const guest = creations.auth.createGuest(time.now());
    const headers = login(guest.id);
    const payload = request({ lobby: true });
    const made = await app.server.inject({ method: 'POST', url: '/games', headers, payload });
    expect(made.statusCode).toBe(201);
    const other = creations.auth.upsertUser('stranger@example.test', time.now());
    const peer = login(other.id);
    expect(
      (
        await app.server.inject({
          url: `/games/${made.json().id}?battlefieldVersion=1`,
          headers: peer,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.server.inject({ url: `/game-creations/${payload.requestId}`, headers: peer }))
        .statusCode,
    ).toBe(404);
  });
  it('fails visibly if a native lobby is lost instead of synthesizing legacy bridge terrain', async () => {
    const { app, headers, request, creations } = await open();
    const payload = request();
    const made = await app.server.inject({ method: 'POST', url: '/games', headers, payload });
    const id = made.json().id;
    creations.database.prepare('DELETE FROM lobby_games WHERE id = ?').run(id);
    const read = await app.server.inject({ url: `/games/${id}?battlefieldVersion=1`, headers });
    expect(read.statusCode).toBeGreaterThanOrEqual(500);
    expect(read.json()).not.toHaveProperty('battlefield');
    expect(creations.lobby.get(id)).toBeUndefined();
  });
  it('reopens a durable native game without alternative catalog availability', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'ks-native-api-'));
    folders.push(folder);
    const path = join(folder, 'game.sqlite');
    const first = await open(path);
    const payload = first.request();
    const made = await first.app.server.inject({
      method: 'POST',
      url: '/games',
      headers: first.headers,
      payload,
    });
    expect(made.statusCode).toBe(201);
    const id = made.json().id;
    await first.app.server.close();
    apps.splice(apps.indexOf(first.app), 1);
    (first.store as SqliteGameStore).close();
    gameStores.splice(gameStores.indexOf(first.store as SqliteGameStore), 1);
    first.creations.close();
    owners.splice(owners.indexOf(first.creations), 1);
    const next = await open(path);
    vi.spyOn(next.battlefields, 'resolve').mockImplementation(() => {
      throw new Error('catalog offline');
    });
    const read = await next.app.server.inject({
      url: `/games/${id}?battlefieldVersion=1`,
      headers: next.headers,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().battlefield.pairing.id).toBe(OPEN_BRIDGE_PAIRING);
    const actor = await next.app.host.open(id);
    expect(actor.state.world.map.features).toHaveLength(3);
  });
  it('returns recovery status after a lost reservation commit acknowledgement, then resumes the same ID', async () => {
    const { app, creations, headers, request, user } = await open();
    const payload = request();
    const exec = creations.database.exec.bind(creations.database);
    let lose = true;
    const fault = vi.spyOn(creations.database, 'exec').mockImplementation((sql) => {
      exec(sql);
      if (sql === 'COMMIT' && lose) {
        lose = false;
        throw new Error('ack lost after commit');
      }
    });
    const failed = await app.server.inject({ method: 'POST', url: '/games', headers, payload });
    expect(failed.statusCode).toBe(503);
    fault.mockRestore();
    const accepted = creations.lookup(user.id, payload.requestId as string)!;
    expect(accepted).toBeDefined();
    const check = await app.server.inject({ url: `/game-creations/${payload.requestId}`, headers });
    expect(check.json()).toMatchObject({ gameId: accepted.gameId, status: 'pending' });
    const retry = await app.server.inject({ method: 'POST', url: '/games', headers, payload });
    expect(retry.statusCode).toBe(201);
    expect(retry.json().id).toBe(accepted.gameId);
    expect(app.host.ids()).toEqual([accepted.gameId]);
  });
  it('checks WebSocket capability for an existing alternative seat before upgrade', async () => {
    const { app, headers, request } = await open();
    const made = await app.server.inject({
      method: 'POST',
      url: '/games',
      headers,
      payload: request(),
    });
    const id = made.json().id;
    await expect(
      app.server.injectWS(`/games/${id}/ws`, {
        headers: { ...headers, host: 'localhost', origin: 'http://localhost' },
      }),
    ).rejects.toThrow('426');
    const stream = await app.server.injectWS(`/games/${id}/ws?battlefieldVersion=1`, {
      headers: { ...headers, host: 'localhost', origin: 'http://localhost' },
    });
    expect(stream.readyState).toBe(1);
    stream.terminate();
  });
  it('does not invent public default terrain when every allocation marker was removed', async () => {
    const { app, creations, headers, request, store } = await open();
    const made = await app.server.inject({
      method: 'POST',
      url: '/games',
      headers,
      payload: request(),
    });
    const id = made.json().id;
    await app.host.close(id);
    creations.database.prepare('DELETE FROM creation_receipts WHERE game_id = ?').run(id);
    creations.database.prepare('DELETE FROM lobby_games WHERE id = ?').run(id);
    const snapshot = (await store.loadSnapshot(id))!;
    delete snapshot.battlefield;
    await store.saveSnapshot(id, snapshot);
    vi.spyOn(store, 'logHeader').mockResolvedValue(undefined);
    const read = await app.server.inject({ url: `/games/${id}?battlefieldVersion=1`, headers });
    expect(read.statusCode).toBeGreaterThanOrEqual(500);
    expect(read.json()).not.toHaveProperty('battlefield');
    expect(creations.lobby.get(id)).toBeUndefined();
  });
  it.each(['read', 'join'])(
    'rechecks current guest allocation after a delayed %s lookup and account deletion',
    async (action) => {
      const { app, creations, request, login, time, store } = await open();
      const guest = creations.auth.createGuest(time.now());
      const owner = login(guest.id);
      const made = await app.server.inject({
        method: 'POST',
        url: '/games',
        headers: owner,
        payload: request({ lobby: true, sessionType: 'team_vs_team' }),
      });
      const id = made.json().id;
      const peer = creations.auth.upsertUser('race-peer@example.test', time.now());
      const headers = login(peer.id);
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => (release = resolve));
      const entered = vi.fn();
      const original = store.logHeader.bind(store);
      vi.spyOn(store, 'logHeader').mockImplementationOnce(async (game) => {
        entered();
        await blocked;
        return original(game);
      });
      const pending = app.server.inject({
        method: action === 'read' ? 'GET' : 'POST',
        url: `/games/${id}${action === 'join' ? '/join' : ''}?battlefieldVersion=1`,
        headers,
        ...(action === 'join' ? { payload: { side: 'red' } } : {}),
      });
      void pending.then(() => {});
      await vi.waitFor(() => expect(entered).toHaveBeenCalled());
      expect(
        (await app.server.inject({ method: 'DELETE', url: '/auth/account', headers: owner }))
          .statusCode,
      ).toBe(204);
      release();
      const result = await pending;
      expect(result.statusCode).toBe(404);
      expect(result.json()).not.toHaveProperty('battlefield');
      expect(creations.auth.seatOf(id, peer.id)).toBeUndefined();
      expect(creations.lobby.get(id)).toBeUndefined();
    },
  );
  it.each(['co_op_vs_ai', 'hot_seat'])(
    'retires pending %s activation after account deletion',
    async (sessionType) => {
      const { app, creations, request, login, time, store } = await open();
      const guest = creations.auth.createGuest(time.now());
      const headers = login(guest.id);
      const payload = request({ sessionType });
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => (release = resolve));
      const entered = vi.fn();
      const save = store.saveSnapshot.bind(store);
      vi.spyOn(store, 'saveSnapshot').mockImplementationOnce(async (id, snapshot) => {
        entered();
        await blocked;
        return save(id, snapshot);
      });
      const pending = app.server.inject({ method: 'POST', url: '/games', headers, payload });
      void pending.then(() => {});
      await vi.waitFor(() => expect(entered).toHaveBeenCalled());
      const id = creations.lookup(guest.id, payload.requestId as string)!.gameId;
      expect(
        (await app.server.inject({ method: 'DELETE', url: '/auth/account', headers })).statusCode,
      ).toBe(204);
      release();
      const result = await pending;
      expect(result.statusCode).toBeGreaterThanOrEqual(400);
      expect(creations.forGame(id)!.state).toBe('tombstone');
      expect(app.host.get(id)).toBeUndefined();
      expect(time.pendingTimers).toBe(0);
    },
  );
  it('enforces actual16KiB creation wire bytes before any reservation', async () => {
    const { app, headers, creations, user } = await open();
    const body = JSON.stringify({ lobby: true, sessionType: 'hot_seat' });
    const response = await app.server.inject({
      method: 'POST',
      url: '/games',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: ' '.repeat(16385) + body,
    });
    expect(response.statusCode).toBe(413);
    expect(creations.lobby.byCreator(user.id)).toHaveLength(0);
  });
  it('retains an already-started regular host game for its remaining players after owner deletion', async () => {
    const { app, headers, request, creations, login, time } = await open();
    const made = await app.server.inject({
      method: 'POST',
      url: '/games',
      headers,
      payload: request({ lobby: true, sessionType: 'team_vs_team' }),
    });
    const id = made.json().id;
    const peer = creations.auth.upsertUser('remaining@example.test', time.now());
    const other = login(peer.id);
    await app.server.inject({
      method: 'POST',
      url: `/games/${id}/join?battlefieldVersion=1`,
      headers: other,
      payload: { side: 'red' },
    });
    await app.server.inject({
      method: 'POST',
      url: `/games/${id}/ready`,
      headers: other,
      payload: { ready: true },
    });
    expect(
      (await app.server.inject({ method: 'POST', url: `/games/${id}/start`, headers, payload: {} }))
        .statusCode,
    ).toBe(200);
    const actor = app.host.get(id);
    expect(
      (await app.server.inject({ method: 'DELETE', url: '/auth/account', headers })).statusCode,
    ).toBe(204);
    expect(creations.forGame(id)).toMatchObject({ state: 'tombstone', retiredOwnerGuest: false });
    const read = await app.server.inject({
      url: `/games/${id}?battlefieldVersion=1`,
      headers: other,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().you).toBe('red');
    expect(app.host.get(id)).toBe(actor);
    const stream = await app.server.injectWS(`/games/${id}/ws?battlefieldVersion=1`, {
      headers: { ...other, host: 'localhost', origin: 'http://localhost' },
    });
    expect(stream.readyState).toBe(1);
    stream.terminate();
  });
  it('does not reveal a deleted guest started game through a surviving invite', async () => {
    const { app, request, creations, login, time, headers: other } = await open();
    const guest = creations.auth.createGuest(time.now());
    const headers = login(guest.id);
    const made = await app.server.inject({
      method: 'POST',
      url: '/games',
      headers,
      payload: request(),
    });
    const id = made.json().id;
    expect(
      (await app.server.inject({ method: 'DELETE', url: '/auth/account', headers })).statusCode,
    ).toBe(204);
    await vi.waitFor(() => expect(app.host.get(id)).toBeUndefined());
    expect(
      (await app.server.inject({ url: `/games/${id}?battlefieldVersion=1`, headers: other }))
        .statusCode,
    ).toBe(404);
    expect(creations.forGame(id)).toMatchObject({ state: 'tombstone', retiredOwnerGuest: true });
    expect(time.pendingTimers).toBe(0);
  });
  it('keeps a still-owned actor recoverable after only the activation-status transaction fails', async () => {
    const { app, headers, request, creations } = await open();
    const payload = request();
    creations.database.exec(
      "CREATE TRIGGER fail_started BEFORE UPDATE OF state ON creation_receipts WHEN NEW.state='started' BEGIN SELECT RAISE(ABORT,'status unavailable'); END;",
    );
    const failed = await app.server.inject({ method: 'POST', url: '/games', headers, payload });
    expect(failed.statusCode).toBe(503);
    const id = failed.json().id;
    const actor = app.host.get(id);
    expect(actor).toBeDefined();
    expect(creations.forGame(id)!.state).toBe('reserved');
    creations.database.exec('DROP TRIGGER fail_started');
    const retry = await app.server.inject({ method: 'POST', url: '/games', headers, payload });
    expect(retry.statusCode).toBe(201);
    expect(retry.json().id).toBe(id);
    expect(app.host.get(id)).toBe(actor);
  });
  it.each(['co_op_vs_ai', 'hot_seat'])(
    'retires pending %s activation through the actual idle-guest sweep',
    async (sessionType) => {
      let sweep: (() => void) | undefined;
      const interval = globalThis.setInterval;
      const spy = vi
        .spyOn(globalThis, 'setInterval')
        .mockImplementation((callback, delay, ...args) => {
          if (delay === 600000) sweep = () => callback(...args);
          return interval(callback, delay, ...args);
        });
      try {
        const { app, creations, request, login, time, store } = await open();
        const guest = creations.auth.createGuest(time.now());
        const headers = login(guest.id);
        const payload = request({ sessionType });
        let release!: () => void;
        const blocked = new Promise<void>((resolve) => (release = resolve));
        const entered = vi.fn();
        const save = store.saveSnapshot.bind(store);
        vi.spyOn(store, 'saveSnapshot').mockImplementationOnce(async (id, snapshot) => {
          entered();
          await blocked;
          return save(id, snapshot);
        });
        const pending = app.server.inject({ method: 'POST', url: '/games', headers, payload });
        void pending.then(() => {});
        await vi.waitFor(() => expect(entered).toHaveBeenCalled());
        const id = creations.lookup(guest.id, payload.requestId as string)!.gameId;
        creations.auth.putSession(
          hashToken(headers.cookie.slice('ks_session='.length)),
          guest.id,
          time.now() - 1,
        );
        expect(sweep).toBeTypeOf('function');
        sweep!();
        expect(creations.auth.getUser(guest.id)).toBeUndefined();
        release();
        expect((await pending).statusCode).toBeGreaterThanOrEqual(400);
        expect(app.host.get(id)).toBeUndefined();
        expect(creations.forGame(id)!.state).toBe('tombstone');
        expect(time.pendingTimers).toBe(0);
      } finally {
        spy.mockRestore();
      }
    },
  );
});
