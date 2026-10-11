import { afterEach, describe, expect, it } from 'vitest';
import { MemoryGameStore } from '../game/index.js';
import { StubOrderParser } from '../orders/stubParser.js';
import { buildApp, type App } from './app.js';

const mailbox: Array<{ to: string; link: string }> = [];
const mailer = {
  async sendLoginLink(to: string, link: string) {
    mailbox.push({ to, link });
  },
};

let app: App | undefined;
afterEach(async () => {
  await app?.server.close();
  app = undefined;
  mailbox.length = 0;
});

async function start() {
  app = await buildApp({
    parser: new StubOrderParser(),
    store: new MemoryGameStore(),
    auth: { mailer },
  });
  return app.server.listen({ port: 0, host: '127.0.0.1' });
}

async function signIn(base: string, email: string): Promise<string> {
  await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const link = new URL(mailbox.filter((m) => m.to === email).at(-1)!.link);
  const res = await fetch(`${base}${link.pathname}${link.search}`, { redirect: 'manual' });
  return res.headers.get('set-cookie')!.split(';')[0]!;
}

const get = (cookie: string): RequestInit => ({ headers: { cookie } });

async function newGame(base: string, cookie: string): Promise<string> {
  const res = await fetch(`${base}/games`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ sessionType: 'hot_seat' }),
  });
  return ((await res.json()) as { id: string }).id;
}

async function finish(id: string): Promise<void> {
  const game = app!.host.get(id)!;
  await game.submit({ kind: 'setMode', mode: 'fast-forward' });
  await game.submit({ kind: 'advanceTo', gameMs: 24 * 60 * 60_000 });
  expect(game.state.world.outcome).not.toBeNull();
}

interface Frame {
  gameMs: number;
  units: Array<{ side: string }>;
  beliefs: Record<string, unknown>;
  events: Array<{ type: string }>;
}
interface Timeline {
  endMs: number;
  outcome: { reason: string };
}

describe("post-game umpire's window", () => {
  it('refuses every request until the game has ended, then serves truth and beliefs', async () => {
    const base = await start();
    const cookie = await signIn(base, 'a@example.test');
    const id = await newGame(base, cookie);

    for (const path of ['window', 'window/at?at=0']) {
      const early = await fetch(`${base}/games/${id}/${path}`, get(cookie));
      expect(early.status).toBe(403);
      expect(await early.json()).toEqual({ error: 'game_not_over' });
    }

    await finish(id);
    const tl = (await (await fetch(`${base}/games/${id}/window`, get(cookie))).json()) as Timeline;
    expect(tl.outcome.reason).toBeTruthy();
    expect(tl.endMs).toBe(app!.host.get(id)!.state.time);

    const at = await fetch(`${base}/games/${id}/window/at?at=${tl.endMs}`, get(cookie));
    expect(at.status).toBe(200);
    const body = (await at.json()) as Frame;
    expect(body.gameMs).toBe(tl.endMs);
    // Both sides' units are present, whatever either side could see.
    expect(new Set(body.units.map((u) => u.side))).toEqual(new Set(['blue', 'red']));
    expect(Object.keys(body.beliefs).sort()).toEqual(['blue', 'red']);
    expect(body.events.some((e) => e.type === 'game.end')).toBe(true);

    // The scrubber can go back to the start, and beyond the end is clamped.
    const start0 = (await (
      await fetch(`${base}/games/${id}/window/at?at=0`, get(cookie))
    ).json()) as Frame;
    expect(start0.gameMs).toBe(0);
    expect(start0.events).toEqual([]);
    const past = (await (
      await fetch(`${base}/games/${id}/window/at?at=${tl.endMs * 10}`, get(cookie))
    ).json()) as Frame;
    expect(past.gameMs).toBe(tl.endMs);
  }, 60_000);

  it('needs a session and a seat in the game', async () => {
    const base = await start();
    const a = await signIn(base, 'a@example.test');
    const b = await signIn(base, 'b@example.test');
    const id = await newGame(base, a);
    await finish(id);
    expect((await fetch(`${base}/games/${id}/window`)).status).toBe(401);
    expect((await fetch(`${base}/games/${id}/window`, get(b))).status).toBe(403);
    expect((await fetch(`${base}/games/nope/window`, get(a))).status).toBe(404);
    expect((await fetch(`${base}/games/${id}/window/at?at=abc`, get(a))).status).toBe(400);
  }, 60_000);
});
