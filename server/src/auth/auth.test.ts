import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../api/app.js';
import { authFromEnv, trustProxyFromEnv } from '../config.js';
import { StubOrderParser } from '../orders/stubParser.js';
import { LogMailer, WebhookMailer } from './mailer.js';
import { LOGIN_LINK_TTL_MS, SESSION_TTL_MS, readCookie } from './routes.js';
import { MemoryAuthStore, SqliteAuthStore, hashToken, type AuthStore } from './store.js';

const mailbox: Array<{ to: string; link: string }> = [];
const mailer = {
  async sendLoginLink(to: string, link: string) {
    mailbox.push({ to, link });
  },
};

let app: App | undefined;
let wall = 1_700_000_000_000;
const dirs: string[] = [];

afterEach(async () => {
  await app?.server.close();
  app = undefined;
  mailbox.length = 0;
  wall = 1_700_000_000_000;
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

async function start(auth: NonNullable<Parameters<typeof buildApp>[0]['auth']> = {}) {
  app = await buildApp({
    parser: new StubOrderParser(),
    wallNow: () => wall,
    auth: { mailer, ...auth },
  });
  return app.server;
}

const login = (server: App['server'], email: unknown, ip = '10.0.0.1') =>
  server.inject({ method: 'POST', url: '/auth/login', payload: { email }, remoteAddress: ip });

const tokenOf = (link: string) => new URL(link).searchParams.get('token')!;

async function signIn(server: App['server'], email = 'player@example.test') {
  expect((await login(server, email)).statusCode).toBe(202);
  const link = mailbox.filter((m) => m.to === email).at(-1)!.link;
  const res = await server.inject({ method: 'GET', url: `/auth/verify?token=${tokenOf(link)}` });
  const cookie = String(res.headers['set-cookie']);
  return { res, cookie: cookie.split(';')[0]!, setCookie: cookie };
}

describe('magic-link login', () => {
  it('mails a link, which signs the user in once', async () => {
    const server = await start({ publicUrl: 'https://ks.example' });
    const { res, cookie, setCookie } = await signIn(server);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(mailbox[0]!.link).toMatch(/^https:\/\/ks\.example\/auth\/verify\?token=[\w-]{40,}$/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/Path=\//);

    const me = await server.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });
    expect(me.json()).toMatchObject({ email: 'player@example.test' });

    // The link is spent.
    const again = await server.inject({
      method: 'GET',
      url: `/auth/verify?token=${tokenOf(mailbox[0]!.link)}`,
    });
    expect(again.statusCode).toBe(400);
    expect(again.headers['set-cookie']).toBeUndefined();
  });

  it('leaves the cookie without Secure on a plain http origin (local dev)', async () => {
    const server = await start({ publicUrl: 'http://localhost:3000' });
    expect((await signIn(server)).setCookie).not.toMatch(/Secure/);
  });

  it('gives the same user the same id on every login, and normalises the email', async () => {
    const server = await start();
    const a = await signIn(server, 'player@example.test');
    expect((await login(server, '  Player@Example.TEST ')).statusCode).toBe(202);
    expect(mailbox.at(-1)!.to).toBe('player@example.test');
    const b = await signIn(server, 'player@example.test');
    const id = async (cookie: string) =>
      (await server.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).json().id;
    expect(await id(a.cookie)).toBe(await id(b.cookie));
  });

  it('refuses an expired, unknown or missing link', async () => {
    const server = await start();
    await login(server, 'player@example.test');
    wall += LOGIN_LINK_TTL_MS + 1;
    const expired = await server.inject({
      method: 'GET',
      url: `/auth/verify?token=${tokenOf(mailbox[0]!.link)}`,
    });
    expect(expired.statusCode).toBe(400);
    for (const url of ['/auth/verify?token=nope', '/auth/verify']) {
      expect((await server.inject({ method: 'GET', url })).statusCode).toBe(400);
    }
  });

  it('answers a malformed email with 400 and an unknown one like a known one', async () => {
    const server = await start();
    for (const bad of ['', 'nope', 42, null, 'a@b', 'x'.repeat(300) + '@example.test']) {
      expect((await login(server, bad)).statusCode).toBe(400);
    }
    const first = await login(server, 'new@example.test');
    const second = await login(server, 'new@example.test');
    expect([first.statusCode, first.body]).toEqual([second.statusCode, second.body]);
  });

  it('still answers 202 when the mail gateway fails', async () => {
    const server = await start({
      mailer: {
        async sendLoginLink() {
          throw new Error('gateway down');
        },
      },
    });
    expect((await login(server, 'player@example.test')).statusCode).toBe(202);
  });

  it('stores only hashes of the link token and the session id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ks-auth-'));
    dirs.push(dir);
    const path = join(dir, 'games.db');
    const store = new SqliteAuthStore(path);
    const server = await start({ store });
    const { cookie } = await signIn(server);
    const sessionId = cookie.split('=')[1]!;
    const linkToken = tokenOf(mailbox[0]!.link);
    const db = new DatabaseSync(path);
    const dump = JSON.stringify([
      db.prepare('SELECT * FROM auth_sessions').all(),
      db.prepare('SELECT * FROM auth_login_tokens').all(),
    ]);
    db.close();
    expect(dump).toContain(hashToken(sessionId));
    expect(dump).not.toContain(sessionId);
    expect(dump).not.toContain(linkToken);
    await server.close();
    app = undefined;
    store.close();
  });
});

describe('rate limits', () => {
  it('limits login mails per email address', async () => {
    const server = await start({ loginPerEmail: 3 });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await login(server, 'a@example.test')).statusCode);
    expect(codes).toEqual([202, 202, 202, 429, 429]);
    expect(mailbox).toHaveLength(3);
    // Another address is unaffected; so is the same one an hour on.
    expect((await login(server, 'b@example.test')).statusCode).toBe(202);
    wall += 3_600_001;
    expect((await login(server, 'a@example.test')).statusCode).toBe(202);
  });

  it('limits login mails per client address', async () => {
    const server = await start({ loginPerIp: 2 });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await login(server, `u${i}@example.test`)).statusCode);
    expect(codes).toEqual([202, 202, 429, 429]);
    expect((await login(server, 'x@example.test', '10.0.0.2')).statusCode).toBe(202);
  });

  it('keys the limits on X-Forwarded-For only when trustProxy is on', async () => {
    const via = (server: App['server'], email: string, forwarded: string) =>
      server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email },
        remoteAddress: '10.9.9.9',
        headers: { 'x-forwarded-for': forwarded },
      });
    app = await buildApp({
      parser: new StubOrderParser(),
      wallNow: () => wall,
      trustProxy: true,
      auth: { mailer, loginPerIp: 1 },
    });
    expect((await via(app.server, 'a@example.test', '203.0.113.1')).statusCode).toBe(202);
    expect((await via(app.server, 'b@example.test', '203.0.113.2')).statusCode).toBe(202);
    expect((await via(app.server, 'c@example.test', '203.0.113.1')).statusCode).toBe(429);
    await app.server.close();
    // Off (the default): the header is ignored, so the proxy's own address is one shared bucket.
    app = await buildApp({
      parser: new StubOrderParser(),
      wallNow: () => wall,
      auth: { mailer, loginPerIp: 1 },
    });
    expect((await via(app.server, 'a@example.test', '203.0.113.1')).statusCode).toBe(202);
    expect((await via(app.server, 'b@example.test', '203.0.113.2')).statusCode).toBe(429);
  });

  it('reads TRUST_PROXY from the environment', () => {
    expect(trustProxyFromEnv({})).toBe(false);
    expect(trustProxyFromEnv({ TRUST_PROXY: '1' })).toBe(true);
    expect(trustProxyFromEnv({ TRUST_PROXY: 'off' })).toBe(false);
  });

  it('limits guesses at /auth/verify', async () => {
    const server = await start();
    const codes: number[] = [];
    for (let i = 0; i < 32; i++) {
      codes.push((await server.inject({ method: 'GET', url: '/auth/verify?token=x' })).statusCode);
    }
    expect(codes.slice(0, 30).every((c) => c === 400)).toBe(true);
    expect(codes.slice(30)).toEqual([429, 429]);
  });
});

describe('sessions', () => {
  it('rejects a missing, bogus or expired session', async () => {
    const server = await start();
    const get = (cookie?: string) =>
      server.inject({ method: 'GET', url: '/auth/me', headers: cookie ? { cookie } : {} });
    expect((await get()).statusCode).toBe(401);
    expect((await get('ks_session=nope')).statusCode).toBe(401);
    const { cookie } = await signIn(server);
    expect((await get(`other=1; ${cookie}`)).statusCode).toBe(200);
    wall += SESSION_TTL_MS + 1;
    expect((await get(cookie)).statusCode).toBe(401);
  });

  it('logs out: the session stops working and the cookie is cleared', async () => {
    const server = await start();
    const { cookie } = await signIn(server);
    const out = await server.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers['set-cookie'])).toMatch(/Max-Age=0/);
    const me = await server.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });
});

describe('account deletion', () => {
  it('removes the user, their sessions and their seat, and frees the side', async () => {
    const server = await start();
    const { cookie } = await signIn(server, 'a@example.test');
    const other = await signIn(server, 'b@example.test');
    const created = await server.inject({
      method: 'POST',
      url: '/games',
      headers: { cookie },
      payload: {},
    });
    const { id, side } = created.json();
    expect(side).toBe('blue');

    const gone = await server.inject({
      method: 'DELETE',
      url: '/auth/account',
      headers: { cookie },
    });
    expect(gone.statusCode).toBe(204);
    expect(
      (await server.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).statusCode,
    ).toBe(401);
    expect(app!.authStore.seatsOf(id)).toEqual([]);

    // The side is free again, and a new login with the same address is a fresh account.
    const join = await server.inject({
      method: 'POST',
      url: `/games/${id}/join`,
      headers: { cookie: other.cookie },
      payload: { side: 'blue' },
    });
    expect(join.statusCode).toBe(200);
    const again = await signIn(server, 'a@example.test');
    const me = await server.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: again.cookie },
    });
    expect(me.json().id).not.toBe(created.json().id);
  });

  it('needs a session', async () => {
    const server = await start();
    expect((await server.inject({ method: 'DELETE', url: '/auth/account' })).statusCode).toBe(401);
  });
});

describe.each([
  ['MemoryAuthStore', () => ({ store: new MemoryAuthStore(), done: () => {} })],
  [
    'SqliteAuthStore',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'ks-auth-'));
      dirs.push(dir);
      const store = new SqliteAuthStore(join(dir, 'a.db'));
      return { store, done: () => store.close() };
    },
  ],
])('%s', (_name, make) => {
  const withStore = (fn: (s: AuthStore) => void) => {
    const { store, done } = make();
    try {
      fn(store);
    } finally {
      done();
    }
  };

  it('creates a user once per email', () =>
    withStore((s) => {
      const a = s.upsertUser('a@x.test', 1);
      expect(s.upsertUser('a@x.test', 2)).toEqual(a);
      expect(s.getUser(a.id)).toEqual(a);
      expect(s.upsertUser('b@x.test', 1).id).not.toBe(a.id);
    }));

  it('spends a login token once and refuses it after expiry', () =>
    withStore((s) => {
      s.putLoginToken('h1', 'a@x.test', 100);
      expect(s.consumeLoginToken('h1', 50)).toBe('a@x.test');
      expect(s.consumeLoginToken('h1', 50)).toBeUndefined();
      s.putLoginToken('h2', 'a@x.test', 100);
      expect(s.consumeLoginToken('h2', 100)).toBeUndefined();
    }));

  it('expires sessions and prunes', () =>
    withStore((s) => {
      s.putSession('s1', 'u1', 100);
      expect(s.getSession('s1', 99)).toBe('u1');
      expect(s.getSession('s1', 100)).toBeUndefined();
      s.putSession('s2', 'u1', 100);
      s.putLoginToken('l', 'a@x.test', 100);
      s.prune(100);
      expect(s.getSession('s2', 0)).toBeUndefined();
      expect(s.consumeLoginToken('l', 0)).toBeUndefined();
    }));

  it('gives a side to one user and a user one side per game', () =>
    withStore((s) => {
      expect(s.claimSeat('g', 'blue', 'u1')).toBe(true);
      expect(s.claimSeat('g', 'blue', 'u1')).toBe(true);
      expect(s.claimSeat('g', 'blue', 'u2')).toBe(false);
      expect(s.claimSeat('g', 'red', 'u1')).toBe(false);
      expect(s.claimSeat('g', 'red', 'u2')).toBe(true);
      expect(s.claimSeat('h', 'blue', 'u2')).toBe(true);
      expect(s.seatOf('g', 'u1')).toBe('blue');
      expect(s.seatOf('g', 'u3')).toBeUndefined();
      expect(s.seatsOf('g')).toHaveLength(2);
    }));

  it('deletes everything a user owns and reports their games', () =>
    withStore((s) => {
      const u = s.upsertUser('a@x.test', 1);
      const keep = s.upsertUser('k@x.test', 1);
      s.putSession('s', u.id, 100);
      s.putSession('keep', keep.id, 100);
      s.putLoginToken('l', 'a@x.test', 100);
      s.claimSeat('g1', 'blue', u.id);
      s.claimSeat('g2', 'red', u.id);
      s.claimSeat('g1', 'red', keep.id);
      expect(s.deleteUser(u.id).sort()).toEqual(['g1', 'g2']);
      expect(s.getUser(u.id)).toBeUndefined();
      expect(s.getSession('s', 0)).toBeUndefined();
      expect(s.consumeLoginToken('l', 0)).toBeUndefined();
      expect(s.seatsOf('g1')).toEqual([{ side: 'red', userId: keep.id }]);
      expect(s.getSession('keep', 0)).toBe(keep.id);
    }));
});

describe('mailers and config', () => {
  it('posts the link to the webhook with the bearer token', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const m = new WebhookMailer('https://mail.test/send', 'sekret', (async (
      url: string,
      init: RequestInit,
    ) => {
      calls.push({ url, init });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch);
    await m.sendLoginLink('a@x.test', 'https://ks.test/auth/verify?token=t');
    expect(calls[0]!.url).toBe('https://mail.test/send');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer sekret');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.to).toBe('a@x.test');
    expect(body.text).toContain('https://ks.test/auth/verify?token=t');
  });

  it('throws when the gateway refuses', async () => {
    const m = new WebhookMailer(
      'https://mail.test/send',
      undefined,
      (async () => new Response(null, { status: 502 })) as unknown as typeof fetch,
    );
    await expect(m.sendLoginLink('a@x.test', 'l')).rejects.toThrow('502');
  });

  it('chooses the mailer and public URL from the environment', () => {
    const lines: string[] = [];
    const dev = authFromEnv({}, 4000, (l) => lines.push(l));
    expect(dev.publicUrl).toBe('http://localhost:4000');
    expect(dev.mailer).toBeInstanceOf(LogMailer);
    const prod = authFromEnv(
      { PUBLIC_URL: 'https://ks.example', MAIL_WEBHOOK_URL: 'https://mail.test/send' },
      4000,
      () => {},
    );
    expect(prod.publicUrl).toBe('https://ks.example');
    expect(prod.mailer).toBeInstanceOf(WebhookMailer);
  });

  it('parses cookies', () => {
    expect(readCookie('a=1; ks_session=abc; b=2', 'ks_session')).toBe('abc');
    expect(readCookie(undefined, 'ks_session')).toBeUndefined();
    expect(readCookie('xks_session=1', 'ks_session')).toBeUndefined();
  });
});
