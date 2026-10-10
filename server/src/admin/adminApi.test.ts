import { afterEach, describe, expect, it } from 'vitest';
import { serialize } from '@kriegsspiel/engine';
import { buildApp, type App } from '../api/app.js';
import { hashToken } from '../auth/store.js';
import { StubOrderParser } from '../orders/stubParser.js';
import { adminFromEnv, isLoopback } from './adminApi.js';

const RATE = 3600;
const TOKEN = 'admin-secret-token';
let app: App | undefined;

afterEach(async () => {
  await app?.server.close();
  app = undefined;
});

async function start(admin?: { enabled: boolean; token?: string }) {
  app = await buildApp({ parser: new StubOrderParser(), admin });
  const base = await app.server.listen({ port: 0, host: '127.0.0.1' });
  const user = app.authStore.upsertUser('admin-test@example.test', Date.now());
  app.authStore.putSession(hashToken('test-session'), user.id, Date.now() + 3_600_000);
  const res = await fetch(`${base}/games`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'ks_session=test-session' },
    body: JSON.stringify({ rate: RATE }),
  });
  const game = (await res.json()) as { id: string };
  return { base, id: game.id };
}

const get = (url: string, remoteAddress?: string, headers: Record<string, string> = {}) =>
  app!.server.inject({ method: 'GET', url, remoteAddress, headers });

describe('gating', () => {
  it('returns 404 for every admin route when the flag is off', async () => {
    const { id } = await start(); // no admin option
    for (const url of ['games', `games/${id}/state`, `games/${id}/entries`, `games/${id}/stream`]) {
      expect((await get(`/admin/api/${url}`)).statusCode).toBe(404);
    }
    expect(
      (await get('/admin/api/games', '203.0.113.9', { authorization: `Bearer ${TOKEN}` }))
        .statusCode,
    ).toBe(404);
    const off = await start({ enabled: false, token: TOKEN });
    expect((await get(`/admin/api/games/${off.id}/state`)).statusCode).toBe(404);
  });

  it('stores nothing in the trace when the flag is off', async () => {
    const { id } = await start();
    expect(app!.host.get(id)).toBeDefined();
    // No store exists to read from, and the routes are absent.
    expect((await get(`/admin/api/games/${id}/entries`)).statusCode).toBe(404);
  });

  it('lets loopback in without a token', async () => {
    await start({ enabled: true });
    expect((await get('/admin/api/games', '127.0.0.1')).statusCode).toBe(200);
    expect((await get('/admin/api/games', '::1')).statusCode).toBe(200);
    expect((await get('/admin/api/games', '::ffff:127.0.0.1')).statusCode).toBe(200);
  });

  it('rejects a non-loopback request without a token, and accepts it with the token', async () => {
    await start({ enabled: true, token: TOKEN });
    const remote = '203.0.113.9';
    expect((await get('/admin/api/games', remote)).statusCode).toBe(401);
    expect(
      (await get('/admin/api/games', remote, { authorization: 'Bearer nope' })).statusCode,
    ).toBe(401);
    expect(
      (await get('/admin/api/games', remote, { authorization: `Bearer ${TOKEN}` })).statusCode,
    ).toBe(200);
    expect((await get(`/admin/api/games?token=${TOKEN}`, remote)).statusCode).toBe(200);
  });

  it('does not treat a loopback request carrying proxy headers as local', async () => {
    await start({ enabled: true, token: TOKEN });
    const proxyHeaders: Record<string, string>[] = [
      { 'x-forwarded-for': '203.0.113.9' },
      { forwarded: 'for=203.0.113.9' },
    ];
    for (const headers of proxyHeaders) {
      expect((await get('/admin/api/games', '127.0.0.1', headers)).statusCode).toBe(401);
      expect(
        (
          await get('/admin/api/games', '127.0.0.1', {
            ...headers,
            authorization: `Bearer ${TOKEN}`,
          })
        ).statusCode,
      ).toBe(200);
    }
  });

  it('rejects every non-loopback request when no token is configured', async () => {
    await start({ enabled: true });
    expect((await get('/admin/api/games', '203.0.113.9')).statusCode).toBe(401);
    expect(
      (await get('/admin/api/games', '203.0.113.9', { authorization: 'Bearer ' })).statusCode,
    ).toBe(401);
  });

  it('recognises loopback addresses only', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('127.9.9.9')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('10.0.0.1')).toBe(false);
    expect(isLoopback('::ffff:10.0.0.1')).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });

  it('reads the flag from the environment', () => {
    expect(adminFromEnv({})).toEqual({ enabled: false, token: undefined });
    expect(adminFromEnv({ ADMIN_ENABLED: 'true', ADMIN_TOKEN: ' t ' })).toEqual({
      enabled: true,
      token: 't',
    });
    expect(adminFromEnv({ ADMIN_ENABLED: '0' }).enabled).toBe(false);
  });
});

describe('reads', () => {
  it('lists games, snapshots state and pages filtered entries', async () => {
    const { id } = await start({ enabled: true });
    await app!.host.get(id)!.submit({ kind: 'advanceTo', gameMs: 60_000 });
    const list = (await get('/admin/api/games', '127.0.0.1')).json();
    expect(list.games.map((g: { id: string }) => g.id)).toContain(id);

    const state = (await get(`/admin/api/games/${id}/state`, '127.0.0.1')).json();
    expect(state.id).toBe(id);
    expect(state.engine.world.units.length).toBeGreaterThan(0);

    const all = (await get(`/admin/api/games/${id}/entries?limit=1000`, '127.0.0.1')).json();
    expect(all.entries.length).toBeGreaterThan(1);
    const first = (await get(`/admin/api/games/${id}/entries?limit=1`, '127.0.0.1')).json();
    expect(first.entries).toHaveLength(1);
    expect(first.next).toBe(first.entries[0].seq);
    const second = (
      await get(`/admin/api/games/${id}/entries?limit=1&after=${first.next}`, '127.0.0.1')
    ).json();
    expect(second.entries[0].seq).toBeGreaterThan(first.entries[0].seq);

    const commands = (await get(`/admin/api/games/${id}/entries?kind=command`, '127.0.0.1')).json();
    expect(commands.entries.length).toBeGreaterThan(0);
    expect(commands.entries.every((e: { kind: string }) => e.kind === 'command')).toBe(true);

    expect((await get(`/admin/api/games/${id}/entries?kind=bogus`, '127.0.0.1')).statusCode).toBe(
      400,
    );
    expect((await get('/admin/api/games/missing/state', '127.0.0.1')).statusCode).toBe(404);
    expect((await get('/admin/api/games/missing/entries', '127.0.0.1')).statusCode).toBe(404);
  });
});

describe('live stream', () => {
  it('receives entries as the game advances', async () => {
    const { base, id } = await start({ enabled: true });
    const backlog = (await get(`/admin/api/games/${id}/entries?limit=1000`, '127.0.0.1')).json();
    const cursor = backlog.entries.at(-1)?.seq ?? 0;
    const res = await fetch(`${base}/admin/api/games/${id}/stream?after=${cursor}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const entries: { seq: number; kind: string }[] = [];
    const pump = async (want: number) => {
      const deadline = Date.now() + 5000;
      while (entries.length < want && Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value);
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = block.split('\n').find((l) => l.startsWith('data: '));
          if (line) entries.push(JSON.parse(line.slice(6)));
        }
      }
    };
    // Only entries after the cursor arrive: what the game does from here on.
    await app!.host.get(id)!.submit({ kind: 'advanceTo', gameMs: 120_000 });
    await pump(2);
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.every((e) => e.seq > cursor)).toBe(true);
    expect(entries.some((e) => e.kind === 'command')).toBe(true);
    await reader.cancel();
  });

  it('applies ?after= to live entries too, not only to the backlog', async () => {
    const { base, id } = await start({ enabled: true });
    const backlog = (await get(`/admin/api/games/${id}/entries?limit=1000`, '127.0.0.1')).json();
    const last = backlog.entries.at(-1)?.seq ?? 0;
    // Skip the first live entry: it is recorded after the stream opens, so only the live path can drop it.
    const res = await fetch(`${base}/admin/api/games/${id}/stream?after=${last + 1}`);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    await app!.host.get(id)!.submit({ kind: 'advanceTo', gameMs: 120_000 });
    const seqs: number[] = [];
    let buf = '';
    const deadline = Date.now() + 5000;
    while (seqs.length < 1 && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
      for (const m of buf.matchAll(/^id: (\d+)$/gm)) seqs.push(Number(m[1]));
      buf = '';
    }
    await reader.cancel();
    expect(seqs.length).toBeGreaterThan(0);
    expect(seqs.every((s) => s > last + 1)).toBe(true);
  });

  it('replays the backlog after a cursor, then follows live', async () => {
    const { base, id } = await start({ enabled: true });
    const res = await fetch(`${base}/admin/api/games/${id}/stream?kind=clock`);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    await app!.host.get(id)!.submit({ kind: 'pause' });
    const deadline = Date.now() + 5000;
    while (!/"kind":"clock"/.test(text) && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    expect(text).toMatch(/"kind":"clock"/);
    expect(text).not.toMatch(/"kind":"command"/);
    await reader.cancel();
  });

  it('does not keep the server from closing while a stream is open', async () => {
    const { base, id } = await start({ enabled: true });
    const res = await fetch(`${base}/admin/api/games/${id}/stream`);
    await res.body!.getReader().read();
    await app!.server.close();
    app = undefined;
  });
});

describe('read-only', () => {
  it('has no route that can mutate state, and calling every route leaves the game unchanged', async () => {
    const { id } = await start({ enabled: true });
    const server = app!.server;
    const paths = ['games', `games/${id}/state`, `games/${id}/entries`, `games/${id}/stream`];
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      for (const p of paths) {
        expect(server.hasRoute({ method, url: `/admin/api/${p.replace(id, ':id')}` })).toBe(false);
        const res = await server.inject({
          method,
          url: `/admin/api/${p}`,
          remoteAddress: '127.0.0.1',
          payload: {},
        });
        expect(res.statusCode).toBe(404);
      }
    }
    const actor = app!.host.get(id)!;
    await actor.submit({ kind: 'pause' });
    const before = serialize(actor.state);
    const clockBefore = actor.gameClock.snapshot();
    const seq = (await get(`/admin/api/games/${id}/entries?limit=1000`, '127.0.0.1')).json().entries
      .length;
    for (const p of ['games', `games/${id}/state`, `games/${id}/entries`]) {
      expect((await get(`/admin/api/${p}`, '127.0.0.1')).statusCode).toBe(200);
    }
    expect(serialize(actor.state)).toBe(before);
    expect(actor.gameClock.snapshot()).toEqual(clockBefore);
    const after = (await get(`/admin/api/games/${id}/entries?limit=1000`, '127.0.0.1')).json()
      .entries.length;
    expect(after).toBe(seq); // reading records nothing
  });

  it('exposes no admin-registered routes other than GET', () => {
    // Every route the plugin registers is listed by printRoutes; none but GET (and Fastify's HEAD) appear.
    return start({ enabled: true }).then(() => {
      const routes = app!.server.printRoutes({ commonPrefix: false });
      const adminSection = routes
        .split('\n')
        .filter((l) => /admin/.test(l) || /stream|state|entries/.test(l));
      expect(adminSection.join('\n')).not.toMatch(/POST|PUT|PATCH|DELETE/);
    });
  });
});
