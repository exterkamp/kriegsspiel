import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type App } from '../api/app.js';
import { guestIdleMsFromEnv, guestPlayFromEnv } from '../config.js';
import { StubOrderParser } from '../orders/stubParser.js';

const mailbox: Array<{ to: string; link: string }> = [];
const mailer = {
  async sendLoginLink(to: string, link: string) {
    mailbox.push({ to, link });
  },
};
const HOUR = 3_600_000;
let app: App | undefined;
let wall = 1_700_000_000_000;

afterEach(async () => {
  vi.useRealTimers();
  await app?.server.close();
  app = undefined;
  mailbox.length = 0;
  wall = 1_700_000_000_000;
});

async function start(auth: Record<string, unknown> = {}) {
  app = await buildApp({
    parser: new StubOrderParser(),
    wallNow: () => wall,
    auth: { mailer, guestPlay: true, ...auth },
  });
  return app.server;
}
type Server = Awaited<ReturnType<typeof start>>;

const guest = async (server: Server, ip = '10.0.0.1', cookie?: string) => {
  const res = await server.inject({
    method: 'POST',
    url: '/auth/guest',
    remoteAddress: ip,
    headers: cookie ? { cookie } : {},
  });
  const set = res.headers['set-cookie'];
  return { res, cookie: set ? String(set).split(';')[0]! : cookie };
};
const createGame = async (server: Server, cookie: string) =>
  (await server.inject({ method: 'POST', url: '/games', headers: { cookie }, payload: {} })).json();
const me = (server: Server, cookie: string) =>
  server.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });

async function emailSignIn(server: Server, email: string, cookie?: string) {
  const r = await server.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email },
    remoteAddress: '10.9.9.9',
  });
  expect(r.statusCode).toBe(202);
  const token = new URL(mailbox.at(-1)!.link).searchParams.get('token')!;
  const res = await server.inject({
    method: 'GET',
    url: `/auth/verify?token=${token}`,
    headers: cookie ? { cookie } : {},
  });
  return String(res.headers['set-cookie']).split(';')[0]!;
}

describe('guest play', () => {
  it('is off unless enabled', async () => {
    const server = await start({ guestPlay: false });
    expect((await guest(server)).res.statusCode).toBe(404);
    expect((await server.inject({ method: 'GET', url: '/auth/guest' })).json()).toEqual({
      enabled: false,
    });
    app = undefined;
    await server.close();
    app = await buildApp({ parser: new StubOrderParser(), auth: { mailer } });
    const res = await app.server.inject({ method: 'POST', url: '/auth/guest' });
    expect(res.statusCode).toBe(404);
  });

  it('starts a session with no email, which can create a game', async () => {
    const server = await start();
    const g = await guest(server);
    expect(g.res.statusCode).toBe(200);
    expect(String(g.res.headers['set-cookie'])).toMatch(/HttpOnly/);
    expect((await me(server, g.cookie!)).json()).toMatchObject({ guest: true });
    const game = await createGame(server, g.cookie!);
    expect(game.id).toBeTruthy();
    const list = await server.inject({
      method: 'GET',
      url: `/games/${game.id}`,
      headers: { cookie: g.cookie! },
    });
    expect(list.statusCode).toBe(200);
  });

  it('gives the guest cookie a lifetime longer than the idle window, so an active guest is never logged out', async () => {
    const server = await start({ guestIdleMs: 24 * HOUR });
    const g = await guest(server);
    const maxAge = Number(/Max-Age=(\d+)/.exec(String(g.res.headers['set-cookie']))![1]);
    expect(maxAge).toBeGreaterThan((24 * HOUR) / 1000);
    expect(maxAge).toBeGreaterThanOrEqual(365 * 24 * 3600);
  });

  it('reuses the current session instead of making another guest', async () => {
    const server = await start();
    const a = await guest(server);
    const b = await guest(server, '10.0.0.1', a.cookie);
    expect(b.res.headers['set-cookie']).toBeUndefined();
    expect(b.res.json().id).toBe(a.res.json().id);
  });

  it("keeps a guest out of another account's game (REST and WebSocket)", async () => {
    const server = await start();
    const a = await guest(server, '10.0.0.1');
    const b = await guest(server, '10.0.0.2');
    const game = await createGame(server, a.cookie!);
    const get = await server.inject({
      method: 'GET',
      url: `/games/${game.id}`,
      headers: { cookie: b.cookie! },
    });
    expect(get.statusCode).toBe(404);
    const join = await server.inject({
      method: 'POST',
      url: `/games/${game.id}/join`,
      headers: { cookie: b.cookie! },
      payload: { side: 'red' },
    });
    expect(join.statusCode).toBe(404);
    expect(game.side).toBe('blue');
    expect(app!.authStore.seatOf(game.id, a.res.json().id)).toBe('blue');
    expect(app!.authStore.seatOf(game.id, b.res.json().id)).toBeUndefined();
    // The socket upgrade checks the seat before the upgrade (403 without one).
    const address = await server.listen({ port: 0, host: '127.0.0.1' });
    const url = address.replace('http', 'ws') + `/games/${game.id}/ws`;
    const open = (cookie: string) =>
      new Promise<string>((resolve) => {
        const ws = new WebSocket(url, { headers: { cookie } } as never);
        ws.onopen = () => (ws.close(), resolve('open'));
        ws.onerror = () => resolve('refused');
      });
    expect(await open(b.cookie!)).toBe('refused');
    expect(await open(a.cookie!)).toBe('open');
  });

  it('rate limits guest creation per address with injected time', async () => {
    const server = await start({ guestPerIp: 2 });
    expect((await guest(server)).res.statusCode).toBe(200);
    expect((await guest(server)).res.statusCode).toBe(200);
    const limited = (await guest(server)).res;
    expect(limited.statusCode).toBe(429);
    // The body says when the window ends, so the client can show a time.
    expect(limited.json()).toEqual({ error: 'rate_limited', retryAt: expect.any(Number) });
    expect(limited.json().retryAt).toBeGreaterThan(wall);
    expect(limited.json().retryAt).toBeLessThanOrEqual(wall + HOUR);
    expect((await guest(server, '10.0.0.2')).res.statusCode).toBe(200);
    wall += HOUR + 1;
    expect((await guest(server)).res.statusCode).toBe(200);
  });

  it('does not use a rate-limit slot when the caller already has a session', async () => {
    const server = await start({ guestPerIp: 1 });
    const a = await guest(server);
    expect(a.res.statusCode).toBe(200);
    for (let i = 0; i < 3; i++) {
      expect((await guest(server, '10.0.0.1', a.cookie)).res.statusCode).toBe(200);
    }
    expect((await guest(server)).res.statusCode).toBe(429);
  });

  it('removes idle guests and their seats, and keeps ones in use', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const server = await start({ guestIdleMs: 24 * HOUR });
    const idle = await guest(server, '10.0.0.1');
    const busy = await guest(server, '10.0.0.2');
    const idleGame = await createGame(server, idle.cookie!);
    await createGame(server, busy.cookie!);
    wall += 20 * HOUR;
    expect((await me(server, busy.cookie!)).statusCode).toBe(200); // slides the session
    wall += 10 * HOUR;
    vi.advanceTimersByTime(10 * 60_000);
    expect((await me(server, idle.cookie!)).statusCode).toBe(401);
    expect((await me(server, busy.cookie!)).statusCode).toBe(200);
    expect(app!.authStore.getUser(idle.res.json().id)).toBeUndefined();
    expect(app!.authStore.seatsOf(idleGame.id)).toEqual([]);
  });
});

describe('signing in from a guest session', () => {
  it('adopts the guest games into the new account', async () => {
    const server = await start();
    const g = await guest(server);
    const game = await createGame(server, g.cookie!);
    const cookie = await emailSignIn(server, 'p@example.test', g.cookie);
    const user = (await me(server, cookie)).json();
    expect(user).toMatchObject({ email: 'p@example.test', guest: false });
    expect(app!.authStore.seatOf(game.id, user.id)).toBe('blue');
    expect(app!.lobby.get(game.id)?.creator).toBe(user.id);
    // The guest session is gone.
    expect((await me(server, g.cookie!)).statusCode).toBe(401);
  });

  it('merges into an existing account and drops a seat that collides', async () => {
    const server = await start();
    const first = await emailSignIn(server, 'p@example.test');
    const existing = (await me(server, first)).json();
    const kept = await createGame(server, first);
    const g = await guest(server);
    const mine = await createGame(server, g.cookie!);
    const cookie = await emailSignIn(server, 'p@example.test', g.cookie);
    const user = (await me(server, cookie)).json();
    expect(user.id).toBe(existing.id);
    expect(app!.authStore.seatOf(mine.id, user.id)).toBe('blue');
    expect(app!.authStore.seatOf(kept.id, user.id)).toBe('blue');
  });

  it('plain sign-in without a guest session is unchanged', async () => {
    const server = await start();
    const cookie = await emailSignIn(server, 'q@example.test');
    expect((await me(server, cookie)).json()).toMatchObject({ guest: false });
  });
});

describe('guest settings from the environment', () => {
  it('defaults on outside production and off in production', () => {
    expect(guestPlayFromEnv({})).toBe(true);
    expect(guestPlayFromEnv({ NODE_ENV: 'production' })).toBe(false);
    expect(guestPlayFromEnv({ NODE_ENV: 'production', GUEST_PLAY: '1' })).toBe(true);
    expect(guestPlayFromEnv({ GUEST_PLAY: 'off' })).toBe(false);
    expect(guestIdleMsFromEnv({})).toBe(168 * HOUR);
    expect(guestIdleMsFromEnv({ GUEST_IDLE_HOURS: '2' })).toBe(2 * HOUR);
  });
});
