import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../api/app.js';
import { StubOrderParser } from '../orders/stubParser.js';
import { allowedOriginsFromEnv, originAllowed, safeNext } from './origin.js';

describe('safeNext', () => {
  it('keeps same-site relative targets', () => {
    expect(safeNext('/?game=abc')).toBe('/?game=abc');
    expect(safeNext('/?new=1&side=blue&rate=12')).toBe('/?new=1&side=blue&rate=12');
    expect(safeNext('/admin#x')).toBe('/admin#x');
  });
  it('refuses anything that could leave the site or loop', () => {
    for (const bad of [
      'https://evil.test/',
      '//evil.test/',
      '/\\evil.test',
      '/\t/evil.test',
      'game=1',
      '',
      '/auth/verify?token=x',
      '/' + 'a'.repeat(600),
      42,
      undefined,
    ]) {
      expect(safeNext(bad)).toBeUndefined();
    }
  });
});

describe('originAllowed', () => {
  const pub = 'https://ks.example';
  it('allows no Origin, the public origin, the request host and listed origins', () => {
    expect(originAllowed(undefined, 'x', pub)).toBe(true);
    expect(originAllowed('https://ks.example', 'internal:3000', pub)).toBe(true);
    expect(originAllowed('http://192.168.1.174:8090', '192.168.1.174:8090', pub)).toBe(true);
    expect(originAllowed('http://localhost:4200', 'localhost:4200', pub)).toBe(true);
    expect(originAllowed('https://other.test', 'h', pub, ['https://other.test'])).toBe(true);
    expect(originAllowed('https://anything.test', 'h', pub, ['*'])).toBe(true);
  });
  it('rejects siblings and malformed origins', () => {
    expect(originAllowed('https://evil.ks.example', 'ks.example', pub)).toBe(false);
    expect(originAllowed('null', 'ks.example', pub)).toBe(false);
    expect(originAllowed('nonsense', 'ks.example', pub)).toBe(false);
  });
  it('reads ALLOWED_ORIGINS', () => {
    expect(allowedOriginsFromEnv({ ALLOWED_ORIGINS: ' https://a.test, ,*' })).toEqual([
      'https://a.test',
      '*',
    ]);
    expect(allowedOriginsFromEnv({})).toEqual([]);
  });
});

describe('login keeps the invite target', () => {
  let app: App | undefined;
  afterEach(async () => {
    await app?.server.close();
    app = undefined;
  });

  it('carries a validated next through the link and redirects to it', async () => {
    const mail: string[] = [];
    app = await buildApp({
      parser: new StubOrderParser(),
      auth: {
        mailer: {
          async sendLoginLink(_to, link) {
            mail.push(link);
          },
        },
      },
    });
    const post = (next: string) =>
      app!.server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'a@b.test', next },
        remoteAddress: `10.0.0.${mail.length + 1}`,
      });
    await post('/?game=g1');
    await post('https://evil.test/');
    expect(new URL(mail[0]!).searchParams.get('next')).toBe('/?game=g1');
    expect(new URL(mail[1]!).searchParams.has('next')).toBe(false);

    const token = new URL(mail[0]!).searchParams.get('token')!;
    const ok = await app.server.inject({
      method: 'GET',
      url: `/auth/verify?token=${token}&next=${encodeURIComponent('/?game=g1')}`,
    });
    expect(ok.headers.location).toBe('/?game=g1');

    // A hand-edited link cannot redirect off-site either.
    const t2 = new URL(mail[1]!).searchParams.get('token')!;
    const bad = await app.server.inject({
      method: 'GET',
      url: `/auth/verify?token=${t2}&next=${encodeURIComponent('//evil.test')}`,
    });
    expect(bad.headers.location).toBe('/');
  });

  it('rejects a WebSocket upgrade from a foreign Origin before anything else', async () => {
    app = await buildApp({
      parser: new StubOrderParser(),
      auth: { publicUrl: 'https://ks.example' },
    });
    const ws = (origin?: string) =>
      app!.server.inject({
        method: 'GET',
        url: '/games/nope/ws?side=blue',
        headers: { host: 'ks.example', ...(origin ? { origin } : {}) },
      });
    expect((await ws('https://evil.ks.example')).json()).toEqual({ error: 'bad_origin' });
    // Allowed origins go on to the session check.
    expect((await ws('https://ks.example')).statusCode).toBe(401);
    expect((await ws()).statusCode).toBe(401);
  });

  it('wires allowedOrigins from AppOptions into the upgrade check', async () => {
    const upgrade = async (allowedOrigins: string[]) => {
      const a = await buildApp({
        parser: new StubOrderParser(),
        auth: { publicUrl: 'https://ks.example', allowedOrigins },
      });
      try {
        return (
          await a.server.inject({
            method: 'GET',
            url: '/games/nope/ws?side=blue',
            headers: { host: 'ks.example', origin: 'https://other.test' },
          })
        ).statusCode;
      } finally {
        await a.server.close();
      }
    };
    expect(await upgrade([])).toBe(403);
    expect(await upgrade(['https://other.test'])).toBe(401);
    expect(await upgrade(['*'])).toBe(401);
  });
});
