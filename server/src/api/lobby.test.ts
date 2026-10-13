import { afterEach, describe, expect, it } from 'vitest';
import { MemoryAuthStore } from '../auth/store.js';
import { MemoryGameStore } from '../game/index.js';
import { StubOrderParser } from '../orders/stubParser.js';
import { buildApp, type App } from './app.js';

type BuildOptions = Parameters<typeof buildApp>[0];

const mailbox: Array<{ to: string; link: string }> = [];
const mailer = {
  async sendLoginLink(to: string, link: string) {
    mailbox.push({ to, link });
  },
};

let app: App | undefined;
let store: MemoryGameStore;

afterEach(async () => {
  await app?.server.close();
  app = undefined;
  mailbox.length = 0;
});

async function start(scriptedOpponents = false, aiAgents?: BuildOptions['aiAgents']) {
  app = await buildApp({
    parser: new StubOrderParser(),
    store: (store = new MemoryGameStore()),
    scriptedOpponents,
    aiAgents,
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

const post = (cookie: string, body: unknown = {}): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify(body),
});
const get = (cookie: string): RequestInit => ({ headers: { cookie } });

interface Info {
  id: string;
  status: string;
  you: string | null;
  ready: boolean;
  sessionType: string;
  rate: number;
  sides: Array<{ side: string; taken: boolean; ready: boolean; roles: unknown[] }>;
}

describe('lobby', () => {
  it('lets two accounts create, join, ready up and start a game', async () => {
    const base = await start();
    const a = await signIn(base, 'a@example.test');
    const b = await signIn(base, 'b@example.test');
    const created = await fetch(
      `${base}/games`,
      post(a, { lobby: true, rate: 12, sessionType: 'team_vs_team', side: 'blue' }),
    );
    expect(created.status).toBe(201);
    const game = (await created.json()) as { id: string; status: string };
    expect(game.status).toBe('lobby');
    expect(app!.host.get(game.id)).toBeUndefined();

    // Not startable while Red is open.
    let started = await fetch(`${base}/games/${game.id}/start`, post(a));
    expect(started.status).toBe(409);
    expect(await started.json()).toMatchObject({ error: 'sides_open', sides: ['red'] });

    expect((await fetch(`${base}/games/${game.id}/join`, post(b, { side: 'red' }))).status).toBe(
      200,
    );
    // Red has not said ready yet.
    started = await fetch(`${base}/games/${game.id}/start`, post(a));
    expect(started.status).toBe(409);
    expect(await started.json()).toMatchObject({ error: 'not_ready', sides: ['red'] });

    // Only the creator starts, and only a seated player is ready.
    const c = await signIn(base, 'c@example.test');
    expect((await fetch(`${base}/games/${game.id}/ready`, post(c, { ready: true }))).status).toBe(
      403,
    );
    expect((await fetch(`${base}/games/${game.id}/ready`, post(b, { ready: true }))).status).toBe(
      200,
    );
    expect((await fetch(`${base}/games/${game.id}/start`, post(b))).status).toBe(403);

    const info = (await (await fetch(`${base}/games/${game.id}`, get(a))).json()) as Info;
    expect(info.sides).toEqual([
      { side: 'blue', taken: true, ready: true, roles: [] },
      { side: 'red', taken: true, ready: true, roles: [] },
    ]);
    expect(info.rate).toBe(12);

    started = await fetch(`${base}/games/${game.id}/start`, post(a));
    expect(started.status).toBe(200);
    const actor = app!.host.get(game.id)!;
    expect(actor.gameClock.rate).toBe(12);
    expect((await fetch(`${base}/games/${game.id}/start`, post(a))).status).toBe(409);
    app!.hub.closeAll();
  });

  describe('umpire dial and persona', () => {
    const createHotSeat = (base: string, cookie: string, extra: object) =>
      fetch(`${base}/games`, post(cookie, { lobby: true, sessionType: 'hot_seat', ...extra }));

    it('carries the chosen dial and persona from the request into the started game', async () => {
      const base = await start();
      const a = await signIn(base, 'a@example.test');
      const created = await createHotSeat(base, a, { dial: 'free', persona: 'dramatic' });
      expect(created.status).toBe(201);
      const game = (await created.json()) as { id: string };
      expect((await fetch(`${base}/games/${game.id}/start`, post(a))).status).toBe(200);
      expect(app!.host.get(game.id)!.state.world.dial).toBe('free');
      expect((await store.logHeader(game.id))?.settings).toEqual({
        dial: 'free',
        persona: 'dramatic',
      });
      app!.hub.closeAll();
    });

    it('defaults to the standard dial and the dry persona', async () => {
      const base = await start();
      const a = await signIn(base, 'a@example.test');
      const game = (await (await createHotSeat(base, a, {})).json()) as { id: string };
      expect((await fetch(`${base}/games/${game.id}/start`, post(a))).status).toBe(200);
      expect(app!.host.get(game.id)!.state.world.dial).toBe('standard');
      expect((await store.logHeader(game.id))?.settings).toEqual({
        dial: 'standard',
        persona: 'dry',
      });
      app!.hub.closeAll();
    });

    it('rejects an unknown dial or persona', async () => {
      const base = await start();
      const a = await signIn(base, 'a@example.test');
      expect((await createHotSeat(base, a, { dial: 'bogus' })).status).toBe(400);
      expect((await createHotSeat(base, a, { persona: 'bogus' })).status).toBe(400);
    });
  });

  it('keeps a lobby game closed to its WebSocket until it starts', async () => {
    const base = await start();
    const a = await signIn(base, 'a@example.test');
    const game = (await (
      await fetch(`${base}/games`, post(a, { lobby: true, sessionType: 'hot_seat' }))
    ).json()) as { id: string };
    const res = await fetch(`${base}/games/${game.id}/ws`, get(a));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not_started' });
  });

  it('plays hot-seat on one account: every side is theirs and nobody else can join', async () => {
    const base = await start();
    const a = await signIn(base, 'a@example.test');
    const b = await signIn(base, 'b@example.test');
    const game = (await (
      await fetch(`${base}/games`, post(a, { lobby: true, sessionType: 'hot_seat' }))
    ).json()) as { id: string; side: string };
    expect(game.side).toBe('blue');
    const info = (await (await fetch(`${base}/games/${game.id}`, get(a))).json()) as Info;
    expect(info.sides.every((s) => s.taken && s.ready)).toBe(true);
    expect((await fetch(`${base}/games/${game.id}/join`, post(b, { side: 'red' }))).status).toBe(
      400,
    );
    expect((await fetch(`${base}/games/${game.id}/start`, post(a))).status).toBe(200);

    // The creator may open either side's socket; another account may not.
    const ws = base.replace('http', 'ws');
    const open = (path: string, cookie: string) =>
      new Promise<'open' | 'refused'>((resolve) => {
        const s = new WebSocket(`${ws}${path}`, { headers: { cookie } } as never);
        s.addEventListener('open', () => {
          s.close();
          resolve('open');
        });
        s.addEventListener('error', () => resolve('refused'));
      });
    expect(await open(`/games/${game.id}/ws?side=red`, a)).toBe('open');
    expect(await open(`/games/${game.id}/ws?side=blue`, a)).toBe('open');
    expect(await open(`/games/${game.id}/ws?side=red`, b)).toBe('refused');
    app!.hub.closeAll();
  });

  it('gives co-op games the built-in opponent and leaves team games to people', async () => {
    const base = await start(true);
    const a = await signIn(base, 'a@example.test');
    const coop = (await (
      await fetch(`${base}/games`, post(a, { lobby: true, sessionType: 'co_op_vs_ai' }))
    ).json()) as { id: string };
    const info = (await (await fetch(`${base}/games/${coop.id}`, get(a))).json()) as Info;
    expect(info.sides.map((s) => s.side)).toEqual(['blue']);
    expect((await fetch(`${base}/games/${coop.id}/start`, post(a))).status).toBe(200);

    const b = await signIn(base, 'b@example.test');
    const team = (await (
      await fetch(`${base}/games`, post(b, { sessionType: 'team_vs_team' }))
    ).json()) as { id: string };
    const teamInfo = (await (await fetch(`${base}/games/${team.id}`, get(b))).json()) as Info;
    expect(teamInfo.sides.map((s) => s.side)).toEqual(['blue', 'red']);
    expect(teamInfo.status).toBe('started');
  });

  it('refuses a co-op game when the server has no AI opponent', async () => {
    const base = await start(false);
    const a = await signIn(base, 'a@example.test');
    const res = await fetch(`${base}/games`, post(a, { sessionType: 'co_op_vs_ai' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'no_ai_opponent' });
  });

  it('rejects bad settings', async () => {
    const base = await start();
    const a = await signIn(base, 'a@example.test');
    for (const body of [
      { scenario: 'nope' },
      { rate: 0 },
      { sessionType: 'duel' },
      { pause: { rule: 'dictator' } },
    ]) {
      expect((await fetch(`${base}/games`, post(a, body))).status).toBe(400);
    }
    expect((await fetch(`${base}/games`, { method: 'POST' })).status).toBe(401);
  });

  it('lists the games an account made or holds a seat in, newest first', async () => {
    const base = await start();
    const a = await signIn(base, 'a@example.test');
    const b = await signIn(base, 'b@example.test');
    const first = (await (
      await fetch(`${base}/games`, post(a, { lobby: true, sessionType: 'team_vs_team' }))
    ).json()) as { id: string };
    await new Promise((r) => setTimeout(r, 5));
    const second = (await (
      await fetch(`${base}/games`, post(a, { lobby: true, sessionType: 'hot_seat' }))
    ).json()) as { id: string };
    await fetch(`${base}/games/${first.id}/join`, post(b, { side: 'red' }));

    const mine = (await (await fetch(`${base}/games`, get(a))).json()) as {
      games: Array<{ id: string; side: string; creator: boolean; status: string }>;
    };
    expect(mine.games.map((g) => g.id)).toEqual([second.id, first.id]);
    expect(mine.games[1]).toMatchObject({ side: 'blue', creator: true, status: 'lobby' });

    const theirs = (await (await fetch(`${base}/games`, get(b))).json()) as {
      games: Array<{ id: string; side: string; creator: boolean }>;
    };
    expect(theirs.games).toHaveLength(1);
    expect(theirs.games[0]).toMatchObject({ id: first.id, side: 'red', creator: false });
    expect((await fetch(`${base}/games`)).status).toBe(401);
  });

  it('lists the scenarios', async () => {
    const base = await start();
    const res = await fetch(`${base}/scenarios`);
    const body = (await res.json()) as { scenarios: Array<Record<string, unknown>> };
    expect(body.scenarios).toHaveLength(1);
    expect(body.scenarios[0]).toMatchObject({
      id: 'hold-the-bridge',
      name: 'Hold the Bridge',
      sides: [
        { id: 'blue', name: 'Blue', controller: 'human' },
        { id: 'red', name: 'Red', controller: 'scripted' },
      ],
      defaults: { side: 'blue', rate: 12 },
    });
    expect(typeof body.scenarios[0]!.briefing).toBe('string');
    expect(body.scenarios[0]!.lengthMinutes).toBeGreaterThan(0);
  });

  it('says who plays the empty side on /scenarios', async () => {
    const opponentOn = async (scripted: boolean, ai?: BuildOptions['aiAgents']) => {
      await app?.server.close();
      const base = await start(scripted, ai);
      return ((await (await fetch(`${base}/scenarios`)).json()) as { opponent?: string }).opponent;
    };
    expect(await opponentOn(false)).toBeUndefined();
    expect(await opponentOn(true)).toBe('scripted');
    expect(await opponentOn(true, () => [])).toBe('ai_commander');
  });

  it('says on /scenarios when the umpire is the test provider', async () => {
    const umpireOn = async (testUmpire?: boolean) => {
      await app?.server.close();
      app = await buildApp({
        parser: new StubOrderParser(),
        store: new MemoryGameStore(),
        testUmpire,
        auth: { mailer },
      });
      const base = await app.server.listen({ port: 0, host: '127.0.0.1' });
      return ((await (await fetch(`${base}/scenarios`)).json()) as { umpire?: string }).umpire;
    };
    expect(await umpireOn()).toBeUndefined();
    expect(await umpireOn(true)).toBe('test');
  });

  it('gives a started game the pause rules chosen at creation', async () => {
    const base = await start();
    const a = await signIn(base, 'a@example.test');
    const made = await fetch(
      `${base}/games`,
      post(a, { sessionType: 'hot_seat', pause: { rule: 'majority', maxPauseMs: 60_000 } }),
    );
    const game = (await made.json()) as { id: string };
    expect(app!.host.get(game.id)!.pauseState).toBeDefined();
    const info = (await (await fetch(`${base}/games/${game.id}`, get(a))).json()) as {
      pause: unknown;
    };
    expect(info.pause).toEqual({ rule: 'majority', maxPauseMs: 60_000 });
  });

  it('opens a game that has seats but no lobby record as a started team game', async () => {
    const store = new MemoryGameStore();
    const authStore = new MemoryAuthStore();
    app = await buildApp({
      parser: new StubOrderParser(),
      store,
      auth: { mailer, store: authStore },
    });
    let base = await app.server.listen({ port: 0, host: '127.0.0.1' });
    const a = await signIn(base, 'a@example.test');
    const game = (await (await fetch(`${base}/games`, post(a, { side: 'blue' }))).json()) as {
      id: string;
    };
    await app.server.close();
    // The same stores under a fresh lobby store: what a deployment from before lobby records sees.
    app = await buildApp({
      parser: new StubOrderParser(),
      store,
      auth: { mailer, store: authStore },
    });
    base = await app.server.listen({ port: 0, host: '127.0.0.1' });
    const info = (await (await fetch(`${base}/games/${game.id}`, get(a))).json()) as Info;
    expect(info).toMatchObject({ id: game.id, status: 'started', you: 'blue' });
    const list = (await (await fetch(`${base}/games`, get(a))).json()) as {
      games: Array<{ id: string }>;
    };
    expect(list.games.map((g) => g.id)).toEqual([game.id]);
    const opened = await new Promise<'open' | 'refused'>((resolve) => {
      const sock = new WebSocket(`${base.replace('http', 'ws')}/games/${game.id}/ws`, {
        headers: { cookie: a },
      } as never);
      sock.addEventListener('open', () => {
        sock.close();
        resolve('open');
      });
      sock.addEventListener('error', () => resolve('refused'));
    });
    expect(opened).toBe('open');
    app!.hub.closeAll();
  });

  it('answers a second /start that arrives together with the first with 409, not 500', async () => {
    const base = await start();
    const a = await signIn(base, 'a@example.test');
    const game = (await (
      await fetch(`${base}/games`, post(a, { lobby: true, sessionType: 'hot_seat' }))
    ).json()) as { id: string };
    const results = await Promise.all([
      fetch(`${base}/games/${game.id}/start`, post(a)),
      fetch(`${base}/games/${game.id}/start`, post(a)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('lists a started game as unfinished with its game time and last played time', async () => {
    const base = await start();
    const a = await signIn(base, 'a@example.test');
    const made = (await (
      await fetch(`${base}/games`, post(a, { sessionType: 'team_vs_team' }))
    ).json()) as { id: string };
    const list = (await (await fetch(`${base}/games`, get(a))).json()) as {
      games: Array<{ id: string; finished: boolean; gameTimeMs: number; lastPlayedMs: number }>;
    };
    const row = list.games.find((g) => g.id === made.id)!;
    expect(row.finished).toBe(false);
    expect(row.gameTimeMs).toBeGreaterThanOrEqual(0);
    expect(row.lastPlayedMs).toBeGreaterThan(0);
    app!.hub.closeAll();
  });

  type Row = { id: string; finished: boolean; gameTimeMs: number; lastPlayedMs: number };
  const rowOf = async (base: string, cookie: string, id: string): Promise<Row> => {
    const list = (await (await fetch(`${base}/games`, get(cookie))).json()) as { games: Row[] };
    return list.games.find((g) => g.id === id)!;
  };

  it('reports a game whose actor is closed from its replayed log', async () => {
    const base = await start();
    const a = await signIn(base, 'a@example.test');
    const made = (await (
      await fetch(`${base}/games`, post(a, { sessionType: 'team_vs_team' }))
    ).json()) as { id: string };
    await app!.host.get(made.id)!.submit({ kind: 'setMode', mode: 'fast-forward' });
    await app!.host.get(made.id)!.submit({ kind: 'advanceTo', gameMs: 10 * 60_000 });
    await app!.host.close(made.id);
    expect(app!.host.get(made.id)).toBeUndefined();
    const row = await rowOf(base, a, made.id);
    expect(row.finished).toBe(false);
    expect(row.gameTimeMs).toBe(10 * 60_000);
    expect(row.lastPlayedMs).toBeGreaterThan(0);
  });

  it('reports finished: true once the game has an outcome, live or replayed', async () => {
    const base = await start();
    const a = await signIn(base, 'a@example.test');
    const made = (await (
      await fetch(`${base}/games`, post(a, { sessionType: 'team_vs_team' }))
    ).json()) as { id: string };
    const actor = app!.host.get(made.id)!;
    await actor.submit({ kind: 'setMode', mode: 'fast-forward' });
    await actor.submit({ kind: 'advanceTo', gameMs: 4 * 60 * 60_000 });
    expect(actor.state.world.outcome).toBeTruthy();
    expect((await rowOf(base, a, made.id)).finished).toBe(true);
    await app!.host.close(made.id);
    const replayed = await rowOf(base, a, made.id);
    expect(replayed.finished).toBe(true);
    expect(replayed.gameTimeMs).toBe(actor.state.time);
  }, 60_000);

  it('lists a lobby game as unfinished, last played at its creation', async () => {
    const base = await start();
    const a = await signIn(base, 'a@example.test');
    const made = (await (
      await fetch(`${base}/games`, post(a, { lobby: true, sessionType: 'hot_seat' }))
    ).json()) as { id: string; createdAtMs?: number };
    const list = (await (await fetch(`${base}/games`, get(a))).json()) as {
      games: Array<Row & { createdAtMs: number; status: string }>;
    };
    const row = list.games.find((g) => g.id === made.id)!;
    expect(row).toMatchObject({ status: 'lobby', finished: false, gameTimeMs: 0 });
    expect(row.lastPlayedMs).toBe(row.createdAtMs);
  });
});
