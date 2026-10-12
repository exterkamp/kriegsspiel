/** #161: a cap on unfinished games per account, and eviction of idle games from memory. */
import { describe, expect, it } from 'vitest';
import { MemoryGameStore } from '../game/index.js';
import { StubOrderParser } from '../orders/stubParser.js';
import { buildApp, type AppOptions } from './app.js';

const mailbox: Array<{ to: string; link: string }> = [];
const mailer = {
  async sendLoginLink(to: string, link: string) {
    mailbox.push({ to, link });
  },
};

async function boot(options: Partial<AppOptions> = {}) {
  const app = await buildApp({
    parser: new StubOrderParser(),
    store: new MemoryGameStore(),
    auth: { mailer, guestPlay: true },
    ...options,
  });
  const base = await app.server.listen({ port: 0, host: '127.0.0.1' });
  const post = (path: string, cookie: string, body: unknown = {}) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
  const signIn = async (email: string) => {
    await post('/auth/login', '', { email });
    const link = new URL(mailbox.at(-1)!.link);
    const login = await fetch(`${base}${link.pathname}${link.search}`, { redirect: 'manual' });
    return login.headers.get('set-cookie')!.split(';')[0]!;
  };
  return { app, base, post, signIn };
}

describe('game limits', () => {
  it('refuses a game past the per-account cap, and a lobby game counts', async () => {
    const { app, post, signIn } = await boot({ limits: { perUser: 2, sweepEveryMs: 0 } });
    const cookie = await signIn('cap@example.test');
    expect((await post('/games', cookie)).status).toBe(201);
    expect((await post('/games', cookie, { lobby: true })).status).toBe(201);
    const third = await post('/games', cookie);
    expect(third.status).toBe(429);
    expect(((await third.json()) as { error: string }).error).toBe('too_many_games');
    // Another account is not affected.
    expect((await post('/games', await signIn('other@example.test'))).status).toBe(201);
    await app.server.close();
  });

  it('caps a guest lower than a signed-in account', async () => {
    const { app, post } = await boot({ limits: { perGuest: 1, sweepEveryMs: 0 } });
    const res = await post('/auth/guest', '');
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
    expect((await post('/games', cookie)).status).toBe(201);
    expect((await post('/games', cookie)).status).toBe(429);
    await app.server.close();
  });

  it('closes an idle game in memory, keeps it listed, and reopens it on use', async () => {
    let now = 1_000_000;
    const { app, base, post, signIn } = await boot({
      wallNow: () => now,
      limits: { idleMs: 60_000, sweepEveryMs: 0 },
    });
    const cookie = await signIn('idle@example.test');
    const game = (await (await post('/games', cookie)).json()) as { id: string };
    expect(app.host.get(game.id)).toBeDefined();

    expect(await app.sweepGames()).toEqual([]);
    now += 61_000;
    expect(await app.sweepGames()).toEqual([game.id]);
    expect(app.host.get(game.id)).toBeUndefined();

    const list = await fetch(`${base}/games`, { headers: { cookie } });
    const { games } = (await list.json()) as { games: Array<{ id: string }> };
    expect(games.map((g) => g.id)).toContain(game.id);
    // A closed game does not count against the cap.
    expect(app.host.size).toBe(0);
    await app.server.close();
  });
});
