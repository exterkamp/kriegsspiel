/** #161: a cap on unfinished games per account, and eviction of idle games from memory. */
import { describe, expect, it, vi } from 'vitest';
import * as replayView from '../admin/replayView.js';
import { MemoryGameStore } from '../game/index.js';
import { StubOrderParser } from '../orders/stubParser.js';
import { buildApp, type AppOptions } from './app.js';

vi.mock('../admin/replayView.js', async (orig) => {
  const actual = await orig<typeof import('../admin/replayView.js')>();
  return { ...actual, replayTimeline: vi.fn(actual.replayTimeline) };
});

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

    // Using it again reopens it.
    const ws = new WebSocket(`${base.replace('http', 'ws')}/games/${game.id}/ws`, {
      headers: { cookie },
    } as never);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', () => reject(new Error('connection refused')));
    });
    expect(app.host.get(game.id)).toBeDefined();
    ws.close();
    await app.server.close();
  });

  it('closes a finished game nobody watches after the grace, but not one with a socket', async () => {
    let now = 1_000_000;
    const { app, base, post, signIn } = await boot({
      wallNow: () => now,
      limits: { idleMs: 24 * 3_600_000, finishedGraceMs: 30_000, sweepEveryMs: 0 },
    });
    const cookie = await signIn('done@example.test');
    const finish = async () => {
      const game = (await (
        await post('/games', cookie, { sessionType: 'team_vs_team' })
      ).json()) as {
        id: string;
        ws: string;
      };
      const actor = app.host.get(game.id)!;
      await actor.submit({ kind: 'setMode', mode: 'fast-forward' });
      await actor.submit({ kind: 'advanceTo', gameMs: 4 * 60 * 60_000 });
      expect(actor.state.world.outcome).toBeTruthy();
      return game;
    };
    // Lower the cap's pressure: finished games do not count against it.
    const watched = await finish();
    const unwatched = await finish();
    const ws = new WebSocket(`${base.replace('http', 'ws')}${watched.ws}`, {
      headers: { cookie },
    } as never);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', () => reject(new Error('connection refused')));
    });

    // Within the grace, a finished game stays; an unfinished one never goes before idleMs.
    expect(await app.sweepGames()).toEqual([]);
    now += 31_000;
    expect(await app.sweepGames()).toEqual([unwatched.id]);
    expect(app.host.get(unwatched.id)).toBeUndefined();
    expect(app.host.get(watched.id)).toBeDefined();
    ws.close();
    await app.server.close();
  }, 60_000);

  it('replays a closed game once per log length for GET /games', async () => {
    const { app, base, post, signIn } = await boot({ limits: { sweepEveryMs: 0 } });
    const cookie = await signIn('replay@example.test');
    const game = (await (await post('/games', cookie)).json()) as { id: string };
    await app.host.close(game.id);
    const list = () => fetch(`${base}/games`, { headers: { cookie } });
    const spy = vi.mocked(replayView.replayTimeline);
    spy.mockClear();

    await list();
    await list();
    expect(spy).toHaveBeenCalledTimes(1);

    // The log grows when the game is reopened and played, so the next listing replays again.
    const actor = await app.host.open(game.id);
    await actor.submit({ kind: 'setMode', mode: 'fast-forward' });
    await app.host.close(game.id);
    await list();
    expect(spy).toHaveBeenCalledTimes(2);
    await app.server.close();
  });
});
