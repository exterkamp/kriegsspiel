import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import {
  ACK_DELAY_MS,
  COURIER_MS_PER_METRE,
  findPath,
  holdTheBridge,
  loadScenario,
} from '@kriegsspiel/engine';
import {
  MAX_LINE_POINTS,
  MAX_MARKS,
  PROTOCOL_VERSION,
  parseServerMessage,
  type ServerMessage,
} from '@kriegsspiel/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MemoryGameStore,
  createRegistry,
  loadScenarioById,
  replayLog,
  startingState,
} from '../game/index.js';
import { FakeTime } from '../game/testing.js';
import { StubOrderParser } from '../orders/stubParser.js';
import { umpireConfigFromEnv } from '../umpire/config.js';
import { createUmpireClient } from '../umpire/createUmpireClient.js';
import { scriptedOpponentsFromEnv } from '../config.js';
import { buildApp, type App } from './app.js';
import { MAX_ORDERS_IN_FLIGHT, MAX_ORDERS_PER_MINUTE } from './hub.js';
import { sideViewOf } from './sideView.js';

/** One game hour per wall second, so a courier ride and its report take well under a second. */
const RATE = 3600;
const v = PROTOCOL_VERSION;

// When the courier from blue HQ reaches blue-1 (game ms), as the engine computes it.
const START = loadScenario(holdTheBridge);
const ROUTE = findPath(
  START.map,
  START.sides.find((s) => s.id === 'blue')!.hq,
  START.units.find((u) => u.id === 'blue-1')!.center,
)!;
const DELIVERY_MS = Math.round((ROUTE.cost / 1000) * COURIER_MS_PER_METRE);

/** A WebSocket client that records every message and lets a test wait for one. */
class Client {
  readonly messages: ServerMessage[] = [];
  readonly raw: string[] = [];
  private waiters: Array<() => void> = [];
  private closedFlag = false;

  private constructor(readonly socket: WebSocket) {
    socket.addEventListener('message', (e) => {
      const text = String(e.data);
      this.raw.push(text);
      const parsed = parseServerMessage(text);
      if (!parsed.ok) throw new Error(`server sent an invalid message: ${parsed.error}`);
      this.messages.push(parsed.value);
      this.wake();
    });
    socket.addEventListener('close', () => {
      this.closedFlag = true;
      this.wake();
    });
  }

  static async connect(url: string, cookie?: string): Promise<Client> {
    // Node's WebSocket (undici) takes request headers as a second argument.
    const socket = new (
      WebSocket as unknown as new (
        url: string,
        init?: { headers: Record<string, string> },
      ) => WebSocket
    )(url, cookie ? { headers: { cookie } } : undefined);
    const client = new Client(socket);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', () => reject(new Error('connection refused')));
    });
    return client;
  }

  get closed(): boolean {
    return this.closedFlag;
  }

  private wake(): void {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((f) => f());
  }

  send(data: string | Uint8Array): void {
    this.socket.send(data);
  }

  async waitFor<K extends ServerMessage['kind']>(
    kind: K,
    where: (m: Extract<ServerMessage, { kind: K }>) => boolean = () => true,
    ms = 5000,
  ): Promise<Extract<ServerMessage, { kind: K }>> {
    const deadline = Date.now() + ms;
    for (;;) {
      const hit = this.messages.find(
        (m): m is Extract<ServerMessage, { kind: K }> => m.kind === kind && where(m as never),
      );
      if (hit) return hit;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timed out waiting for ${kind}; got ${this.raw.join('\n')}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }
}

interface Created {
  id: string;
  rate: number;
  side: 'blue' | 'red';
  ws: string;
  /** Session cookie of the user sitting on each side. */
  cookies: Partial<Record<'blue' | 'red', string>>;
}

/** Login links the app "mailed", newest last. */
const mailbox: Array<{ to: string; link: string }> = [];
const mailer = {
  async sendLoginLink(to: string, link: string) {
    mailbox.push({ to, link });
  },
};

let app: App | undefined;
let store: MemoryGameStore;
const clients: Client[] = [];

afterEach(async () => {
  clients.splice(0).forEach((c) => c.socket.close());
  await app?.server.close();
  app = undefined;
  mailbox.length = 0;
});

async function start(parser: StubOrderParser = new StubOrderParser()) {
  store = new MemoryGameStore();
  app = await buildApp({ parser, store, auth: { mailer } });
  const base = await app.server.listen({ port: 0, host: '127.0.0.1' });
  return { base, ws: base.replace('http', 'ws') };
}

/** Log in through the magic link and return the session cookie to send back. */
async function signIn(base: string, email: string): Promise<string> {
  const asked = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  expect(asked.status).toBe(202);
  const mail = mailbox.filter((m) => m.to === email).at(-1)!;
  const link = new URL(mail.link);
  const res = await fetch(`${base}${link.pathname}${link.search}`, { redirect: 'manual' });
  expect(res.status).toBe(302);
  return res.headers.get('set-cookie')!.split(';')[0]!;
}

const json = (cookie: string | undefined, body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  body: JSON.stringify(body),
});

/** A blue player creates a game; a red player joins it unless `joinRed` is off (a scripted Red, or a test that times the game from creation). */
async function createGame(base: string, body: unknown = { rate: RATE }, joinRed = true) {
  const blue = await signIn(base, `blue-${mailbox.length}@example.test`);
  const res = await fetch(`${base}/games`, json(blue, body));
  const created = (await res.json()) as Created;
  if (res.status !== 201) return { status: res.status, json: created };
  created.cookies = { [created.side]: blue };
  if (!joinRed) return { status: res.status, json: created };
  const red = await signIn(base, `red-${mailbox.length}@example.test`);
  const joined = await fetch(`${base}/games/${created.id}/join`, json(red, { side: 'red' }));
  if (joined.status === 200) created.cookies.red = red;
  return { status: res.status, json: created };
}

async function join(ws: string, game: Created, side: 'blue' | 'red') {
  const c = await Client.connect(`${ws}${game.ws}`, game.cookies[side]);
  clients.push(c);
  return c;
}

const order = (text: string, orderId = 'o1') =>
  JSON.stringify({ v, kind: 'issueOrder', orderId, text });

describe('POST /games', () => {
  it('creates a game with a token per side', async () => {
    const { base } = await start();
    const { status, json } = await createGame(base, { rate: 12 });
    expect(status).toBe(201);
    expect(json.rate).toBe(12);
    expect(json.side).toBe('blue');
    expect(Object.keys(json.cookies).sort()).toEqual(['blue', 'red']);
    expect(app!.host.get(json.id)).toBeDefined();
  });

  it.each([
    { rate: 0 },
    { rate: -1 },
    { rate: 1e-9 },
    { rate: 'fast' },
    { rate: 1e9 },
    { scenario: 'x' },
  ])('rejects %j', async (body) => {
    const { base } = await start();
    expect((await createGame(base, body)).status).toBe(400);
  });

  it('defaults to real time', async () => {
    const { base } = await start();
    expect((await createGame(base, {})).json.rate).toBe(1);
  });
});

describe('restart notice', () => {
  it('tells a player who joins a reopened game that it came back paused', async () => {
    const { base, ws } = await start();
    const { json: game } = await createGame(base);
    const fresh = await join(ws, game, 'blue');
    await fresh.waitFor('viewUpdate');
    expect(fresh.messages.some((m) => m.kind === 'serverRestarted')).toBe(false);

    await app!.host.close(game.id);
    await app!.host.open(game.id);
    const c = await join(ws, game, 'blue');
    const note = await c.waitFor('serverRestarted');
    expect(note.downMs).toBeGreaterThanOrEqual(0);
    const view = await c.waitFor('viewUpdate');
    expect(view.view.clock.status).toBe('paused');
  });

  it('does not tell a later joiner once the game has been resumed', async () => {
    const { base, ws } = await start();
    const { json: game } = await createGame(base);
    await app!.host.close(game.id);
    const reopened = await app!.host.open(game.id);
    await reopened.submit({ kind: 'resume' });
    expect(reopened.gameClock.status).toBe('running');
    const c = await join(ws, game, 'blue');
    const view = await c.waitFor('viewUpdate');
    expect(view.view.clock.status).toBe('running');
    expect(c.messages.some((m) => m.kind === 'serverRestarted')).toBe(false);
  });
});

describe('WebSocket auth', () => {
  it('refuses no session, a bad session and an unknown game', async () => {
    const { base, ws } = await start();
    const { json } = await createGame(base);
    await expect(Client.connect(`${ws}/games/${json.id}/ws`)).rejects.toThrow();
    await expect(Client.connect(`${ws}/games/${json.id}/ws`, 'ks_session=nope')).rejects.toThrow();
    await expect(Client.connect(`${ws}/games/missing/ws`, json.cookies.blue)).rejects.toThrow();
  });

  it('lets a signed-in user without a seat in that game stay out', async () => {
    const { base, ws } = await start();
    const a = (await createGame(base)).json;
    const b = (await createGame(base)).json;
    await expect(Client.connect(`${ws}/games/${b.id}/ws`, a.cookies.blue)).rejects.toThrow();
    const stranger = await signIn(base, 'stranger@example.test');
    await expect(Client.connect(`${ws}/games/${b.id}/ws`, stranger)).rejects.toThrow();
  });

  it('puts each user on their own side', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const blue = await join(ws, game, 'blue');
    const red = await join(ws, game, 'red');
    expect((await blue.waitFor('viewUpdate')).view.side).toBe('blue');
    expect((await red.waitFor('viewUpdate')).view.side).toBe('red');
  });

  it('does not accept the old ?token= parameter', async () => {
    const { base, ws } = await start();
    const { json } = await createGame(base);
    await expect(Client.connect(`${ws}/games/${json.id}/ws?token=abc`)).rejects.toThrow();
  });
});

describe('sign-out and deletion', () => {
  async function waitClosed(c: Client) {
    const deadline = Date.now() + 3000;
    while (!c.closed && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    return c.closed;
  }

  it('closes the player’s sockets on logout, then refuses a new connection', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const blue = await join(ws, game, 'blue');
    const red = await join(ws, game, 'red');
    await blue.waitFor('viewUpdate');
    await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie: game.cookies.blue! } });
    expect(await waitClosed(blue)).toBe(true);
    expect(red.closed).toBe(false);
    await expect(Client.connect(`${ws}${game.ws}`, game.cookies.blue)).rejects.toThrow();
  });

  it('closes the sockets and frees the seat when the account is deleted', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const red = await join(ws, game, 'red');
    await red.waitFor('viewUpdate');
    const res = await fetch(`${base}/auth/account`, {
      method: 'DELETE',
      headers: { cookie: game.cookies.red! },
    });
    expect(res.status).toBe(204);
    expect(await waitClosed(red)).toBe(true);
    expect(app!.authStore.seatsOf(game.id).map((s) => s.side)).toEqual(['blue']);
  });
});

describe('seats', () => {
  it('needs a session to create or join', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/games`, json(undefined, {}))).status).toBe(401);
    const { json: game } = await createGame(base);
    expect(
      (await fetch(`${base}/games/${game.id}/join`, json(undefined, { side: 'red' }))).status,
    ).toBe(401);
    expect((await fetch(`${base}/games/${game.id}`)).status).toBe(401);
  });

  it('gives a side to one user only, and one side to a user', async () => {
    const { base } = await start();
    const { json: game } = await createGame(base);
    const third = await signIn(base, 'third@example.test');
    expect(
      (await fetch(`${base}/games/${game.id}/join`, json(third, { side: 'red' }))).status,
    ).toBe(409);
    expect(
      (await fetch(`${base}/games/${game.id}/join`, json(game.cookies.blue, { side: 'red' })))
        .status,
    ).toBe(409);
    // Joining the seat you already hold is a no-op.
    expect(
      (await fetch(`${base}/games/${game.id}/join`, json(game.cookies.blue, { side: 'blue' })))
        .status,
    ).toBe(200);
    expect((await fetch(`${base}/games/missing/join`, json(third, { side: 'red' }))).status).toBe(
      404,
    );
  });

  it('lists the sides and which is yours', async () => {
    const { base } = await start();
    const created = await fetch(
      `${base}/games`,
      json(await signIn(base, 'a@example.test'), { side: 'red' }),
    );
    const game = (await created.json()) as Created;
    const guest = await signIn(base, 'b@example.test');
    const info = await fetch(`${base}/games/${game.id}`, { headers: { cookie: guest } });
    expect(await info.json()).toMatchObject({
      id: game.id,
      you: null,
      sides: [
        { side: 'blue', taken: false },
        { side: 'red', taken: true },
      ],
    });
  });

  it('refuses a scripted side when the built-in opponent plays it', async () => {
    store = new MemoryGameStore();
    app = await buildApp({
      parser: new StubOrderParser(),
      store,
      scriptedOpponents: true,
      auth: { mailer },
    });
    const base = await app.server.listen({ port: 0, host: '127.0.0.1' });
    const cookie = await signIn(base, 'a@example.test');
    expect((await fetch(`${base}/games`, json(cookie, { side: 'red' }))).status).toBe(400);
    const made = (await (await fetch(`${base}/games`, json(cookie, {}))).json()) as Created;
    const other = await signIn(base, 'b@example.test');
    expect(
      (await fetch(`${base}/games/${made.id}/join`, json(other, { side: 'red' }))).status,
    ).toBe(400);
  });
});

describe('views', () => {
  it('sends each side only its own units first, and never the other side’s', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const blue = await join(ws, game, 'blue');
    const red = await join(ws, game, 'red');

    const bv = (await blue.waitFor('viewUpdate')).view;
    const rv = (await red.waitFor('viewUpdate')).view;
    expect(bv.side).toBe('blue');
    expect(rv.side).toBe('red');
    expect(bv.clock.rate).toBe(RATE);
    expect(bv.ownUnits.length).toBeGreaterThan(0);
    expect(bv.ownUnits.every((u) => u.id.startsWith('blue-'))).toBe(true);
    expect(rv.ownUnits.every((u) => u.id.startsWith('red-'))).toBe(true);
    // Each side is told where its own HQ is, and only that.
    expect(bv.hq).toEqual({ x: 2050, y: 2950 });
    expect(rv.hq).toEqual({ x: 2050, y: 50 });

    // Armies start out of sight of each other: nothing hidden rides along.
    expect(bv.visibleEnemies).toEqual([]);
    expect(blue.raw.join('')).not.toContain('red-');
    expect(red.raw.join('')).not.toContain('blue-');
  });

  it('pushes view updates as the game runs', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const blue = await join(ws, game, 'blue');
    const first = (await blue.waitFor('viewUpdate')).view;
    const later = (await blue.waitFor('viewUpdate', (m) => m.view.atGame > first.atGame)).view;
    expect(later.atGame).toBeGreaterThan(first.atGame);
  });

  it('pushes clock changes', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const blue = await join(ws, game, 'blue');
    await blue.waitFor('viewUpdate');
    await app!.host.get(game.id)!.submit({ kind: 'pause' });
    const m = await blue.waitFor('clockState', (c) => c.clock.status === 'paused');
    expect(m.clock.rate).toBe(RATE);
  });
});

describe('game over', () => {
  it('sends one notice to each side, stops the clock, and tells a late joiner at once', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const blue = await join(ws, game, 'blue');
    const red = await join(ws, game, 'red');
    const b = await blue.waitFor('gameOver');
    const r = await red.waitFor('gameOver');
    expect(r).toEqual(b);
    expect(Object.keys(b).sort()).toEqual(['atGame', 'kind', 'reason', 'v', 'winner']);
    expect(app!.host.get(game.id)!.gameClock.status).toBe('stopped');

    const late = await join(ws, game, 'red');
    const l = await late.waitFor('gameOver');
    expect(l).toEqual(b);
    // Force further pushes after the notice: only the per-connection guard keeps it to one.
    for (let i = 0; i < 3; i++) app!.hub.notify(game.id);
    blue.send(JSON.stringify({ v, kind: 'issueOrder', orderId: 'after', text: 'hold' }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (const c of [blue, red, late]) {
      expect(c.messages.filter((m) => m.kind === 'gameOver')).toHaveLength(1);
    }
  });

  it('rejects an order sent after the game is over and queues nothing', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const blue = await join(ws, game, 'blue');
    await blue.waitFor('gameOver');

    blue.send(JSON.stringify({ v, kind: 'issueOrder', orderId: 'too-late', text: 'hold' }));
    const err = await blue.waitFor('error', (m) => m.code === 'game_over');
    expect(err.message.startsWith('too-late: ')).toBe(true);
    // Nothing was submitted: no order entry reached the game's input log.
    const orders = (await store.inputLog(game.id)).filter((e) => e.command.kind === 'order');
    expect(orders).toHaveLength(0);
  });
});

/** Counts parses, and holds each one on `gate` while it is set. */
class CountingParser extends StubOrderParser {
  calls = 0;
  done = 0;
  gate: Promise<void> | undefined;
  override async parse(...args: Parameters<StubOrderParser['parse']>) {
    this.calls++;
    await this.gate;
    const result = await super.parse(...args);
    this.done++;
    return result;
  }
}

describe('order limits (#160)', () => {
  it('refuses the same words sent again within seconds, and sends them once (#343)', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const blue = await join(ws, game, 'blue');
    await blue.waitFor('viewUpdate');
    blue.send(order('Hold the bridge', 'first'));
    blue.send(order('  hold   the BRIDGE ', 'second'));
    const err = await blue.waitFor('error', (m) => m.code === 'duplicate_text');
    expect(err.message.startsWith('second: ')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const orders = (await store.inputLog(game.id)).filter((e) => e.command.kind === 'order');
    expect(orders).toHaveLength(1);
  });

  it('sends a returning side the orders it sent, from the input log (#343)', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const blue = await join(ws, game, 'blue');
    await blue.waitFor('viewUpdate');
    blue.send(order('blue-1 hold', 'kept'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const back = await join(ws, game, 'blue');
    const m = await back.waitFor('sentOrders');
    expect(m.orders).toHaveLength(1);
    expect(m.orders[0]).toMatchObject({ id: 'kept', text: 'blue-1 hold' });
    const red = await join(ws, game, 'red');
    expect((await red.waitFor('sentOrders')).orders).toEqual([]);
  });

  it('ignores a repeated orderId and queues the order once', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const blue = await join(ws, game, 'blue');
    await blue.waitFor('viewUpdate');
    blue.send(order('hold', 'dup'));
    blue.send(order('hold', 'dup'));
    const err = await blue.waitFor('error', (m) => m.code === 'duplicate_order');
    expect(err.message.startsWith('dup: ')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const orders = (await store.inputLog(game.id)).filter((e) => e.command.kind === 'order');
    expect(orders).toHaveLength(1);
  });

  it('caps orders per minute on one connection, then accepts again after the window', async () => {
    const parser = new CountingParser();
    const { base, ws } = await start(parser);
    const game = (await createGame(base, { rate: 1 })).json;
    const blue = await join(ws, game, 'blue');
    await blue.waitFor('viewUpdate');
    const t0 = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0);
    try {
      // One at a time, so the in-flight cap never comes into play.
      for (let i = 0; i < MAX_ORDERS_PER_MINUTE; i++) {
        blue.send(order(`blue-1 hold ${i}`, `m${i}`));
        await vi.waitFor(() => expect(parser.calls).toBe(i + 1));
        await new Promise((resolve) => setImmediate(resolve));
      }
      blue.send(order('blue-1 hold over', 'over'));
      const err = await blue.waitFor('error', (m) => m.code === 'rate_limited');
      expect(err.message.startsWith('over: ')).toBe(true);
      expect(parser.calls).toBe(MAX_ORDERS_PER_MINUTE);

      now.mockReturnValue(t0 + 61_000);
      blue.send(order('blue-1 hold later', 'later'));
      await vi.waitFor(() => expect(parser.calls).toBe(MAX_ORDERS_PER_MINUTE + 1));
    } finally {
      now.mockRestore();
    }
  });

  it('caps orders parsing at once, and frees a slot when one finishes', async () => {
    const parser = new CountingParser();
    let release!: () => void;
    parser.gate = new Promise<void>((resolve) => (release = resolve));
    const { base, ws } = await start(parser);
    const game = (await createGame(base)).json;
    const blue = await join(ws, game, 'blue');
    await blue.waitFor('viewUpdate');
    for (let i = 0; i < MAX_ORDERS_IN_FLIGHT; i++) blue.send(order(`blue-1 hold ${i}`, `f${i}`));
    await vi.waitFor(() => expect(parser.calls).toBe(MAX_ORDERS_IN_FLIGHT));
    blue.send(order('blue-1 hold extra', 'extra'));
    const err = await blue.waitFor('error', (m) => m.code === 'rate_limited');
    expect(err.message.startsWith('extra: ')).toBe(true);
    expect(parser.calls).toBe(MAX_ORDERS_IN_FLIGHT);

    release();
    parser.gate = undefined;
    await vi.waitFor(() => expect(parser.done).toBe(MAX_ORDERS_IN_FLIGHT));
    await new Promise((resolve) => setImmediate(resolve));
    blue.send(order('blue-1 hold after', 'after'));
    await vi.waitFor(() => expect(parser.calls).toBe(MAX_ORDERS_IN_FLIGHT + 1));
  });

  it('lets a refused order be sent again under the same id', async () => {
    const parser = new CountingParser();
    const { base, ws } = await start(parser);
    const game = (await createGame(base)).json;
    const blue = await join(ws, game, 'blue');
    await blue.waitFor('viewUpdate');
    // No unit named: the umpire asks which one, so nothing is issued.
    blue.send(order('hold', 'x'));
    await blue.waitFor('error', (m) => m.code === 'order_clarification');
    blue.send(order('hold', 'x'));
    await vi.waitFor(() =>
      expect(
        blue.messages.filter((m) => m.kind === 'error' && m.code === 'order_clarification'),
      ).toHaveLength(2),
    );
    expect(parser.calls).toBe(2);
    expect(blue.messages.some((m) => m.kind === 'error' && m.code === 'duplicate_order')).toBe(
      false,
    );
  });
});

describe('staff questions', () => {
  const ask = (questionId: string, role = 'chiefOfStaff') =>
    JSON.stringify({ v, kind: 'askStaff', questionId, role, question: 'Status?' });

  it('charges the cost on the server: queued once, then busy, per side', async () => {
    const { base, ws } = await start();
    // Rate 1 keeps game time near the start, so the officer is still busy on the second ask.
    const game = (await createGame(base, { rate: 1 })).json;
    const blue = await join(ws, game, 'blue');
    const red = await join(ws, game, 'red');
    await blue.waitFor('viewUpdate');

    blue.send(ask('qa'));
    const queued = await blue.waitFor('staffQueued', (m) => m.questionId === 'qa');
    expect(queued.answerAtGame).toBe(queued.askedAtGame + queued.costMs);
    expect(queued.costMs).toBeGreaterThan(0);

    blue.send(ask('qb'));
    const busy = await blue.waitFor('error', (m) => m.code === 'staff_busy');
    expect(busy.message.startsWith('qb: ')).toBe(true);
    expect(blue.messages.some((m) => m.kind === 'staffQueued' && m.questionId === 'qb')).toBe(
      false,
    );

    // Another officer, and the other side, are unaffected.
    blue.send(ask('qc', 'engineer'));
    await blue.waitFor('staffQueued', (m) => m.questionId === 'qc');
    red.send(ask('qd'));
    await red.waitFor('staffQueued', (m) => m.questionId === 'qd');
  });

  it('answers every accepted question; with no umpire the answer carries no text', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base, { rate: 1 })).json;
    const blue = await join(ws, game, 'blue');
    await blue.waitFor('viewUpdate');
    blue.send(ask('qa', 'intelligence'));
    const answer = await blue.waitFor('staffAnswer', (m) => m.questionId === 'qa');
    expect(answer.role).toBe('intelligence');
    expect(answer.text).toBeUndefined();
    expect(answer.officer.name).not.toBe('');
  });

  it('refuses a question once the game is over', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const blue = await join(ws, game, 'blue');
    await blue.waitFor('gameOver');
    blue.send(ask('qz'));
    const err = await blue.waitFor('error', (m) => m.code === 'game_over');
    expect(err.message.startsWith('qz: ')).toBe(true);
  });
});

describe('staff check on a draft', () => {
  const cmd = (c: Record<string, unknown>) => JSON.stringify({ v, ...c });
  const check = (checkId: string, draft = 'd1') => cmd({ kind: 'checkDraft', checkId, draft });

  async function startWithStaff() {
    store = new MemoryGameStore();
    const umpire = createUmpireClient({
      config: umpireConfigFromEnv({ UMPIRE_PROVIDER: 'test' }),
      env: {},
    });
    app = await buildApp({
      parser: new StubOrderParser(),
      store,
      auth: { mailer },
      narrator: () => umpire,
    });
    const base = await app.server.listen({ port: 0, host: '127.0.0.1' });
    return { base, ws: base.replace('http', 'ws') };
  }

  it('reads the server’s copy of the draft, charges the chief of staff, and tells the whole side', async () => {
    const { base, ws } = await startWithStaff();
    const game = (await createGame(base, { rate: 1 })).json;
    const a = await join(ws, game, 'blue');
    const b = await join(ws, game, 'blue');
    const red = await join(ws, game, 'red');
    await a.waitFor('drafts');
    a.send(cmd({ kind: 'createDraft', draft: 'd1', text: 'Move up' }));
    await b.waitFor('draftState', (m) => m.draft.id === 'd1');

    a.send(check('c1'));
    for (const c of [a, b]) {
      const queued = await c.waitFor('draftCheckQueued', (m) => m.checkId === 'c1');
      expect(queued.answerAtGame).toBe(queued.askedAtGame + queued.costMs);
      expect(queued.costMs).toBeGreaterThan(0);
      const report = await c.waitFor('draftCheck', (m) => m.checkId === 'c1');
      expect(report.rev).toBe(queued.rev);
      expect(report.unavailable).toBeUndefined();
      expect(report.findings.map((f) => f.kind)).toContain('missing_place');
      expect(report.caveat).toMatch(/not a guarantee/);
    }
    // The other side hears nothing of it.
    expect(red.messages.some((m) => m.kind === 'draftCheck' || m.kind === 'draftCheckQueued')).toBe(
      false,
    );
    // It is a journal-only entry with its model call, so replay needs no model.
    const entry = (await store.inputLog(game.id)).find((e) => e.command.kind === 'draftCheck')!;
    expect(entry.command).toMatchObject({ side: 'blue', draft: 'd1', text: 'Move up', rev: 0 });
    expect(entry.calls).toHaveLength(1);
    expect(entry.calls![0]!.stage).toBe('staff');
  });

  it('keeps the chief of staff busy for a second request, per side', async () => {
    const { base, ws } = await startWithStaff();
    const game = (await createGame(base, { rate: 1 })).json;
    const blue = await join(ws, game, 'blue');
    const red = await join(ws, game, 'red');
    await blue.waitFor('drafts');
    blue.send(cmd({ kind: 'createDraft', draft: 'd1', text: '1st Battalion hold' }));
    red.send(cmd({ kind: 'createDraft', draft: 'd1', text: '1st Battalion hold' }));
    await blue.waitFor('draftState');
    await red.waitFor('draftState');
    blue.send(check('c1'));
    await blue.waitFor('draftCheckQueued');
    blue.send(check('c2'));
    const busy = await blue.waitFor('error', (m) => m.code === 'staff_busy');
    expect(busy.message.startsWith('c2: ')).toBe(true);
    red.send(check('c3'));
    await red.waitFor('draftCheckQueued', (m) => m.checkId === 'c3');
  });

  it('refuses an unknown or empty draft without charging for it', async () => {
    const { base, ws } = await startWithStaff();
    const game = (await createGame(base, { rate: 1 })).json;
    const blue = await join(ws, game, 'blue');
    await blue.waitFor('drafts');
    blue.send(check('c1', 'nope'));
    expect((await blue.waitFor('error', (m) => m.code === 'draft_unknown')).message).toMatch(
      /^c1: /,
    );
    blue.send(cmd({ kind: 'createDraft', draft: 'd1' }));
    await blue.waitFor('draftState');
    blue.send(check('c2'));
    expect((await blue.waitFor('error', (m) => m.code === 'bad_draft')).message).toMatch(/^c2: /);
    // A refusal charges nothing: the next real request is not busy.
    blue.send(
      cmd({ kind: 'draftEdit', draft: 'd1', baseRev: 0, op: ['Hold the bridge'], opId: 'e1' }),
    );
    await blue.waitFor('draftEntry');
    blue.send(check('c3'));
    await blue.waitFor('draftCheckQueued', (m) => m.checkId === 'c3');
  });

  it('says the staff could not look when there is no umpire, and changes nothing', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base, { rate: 1 })).json;
    const blue = await join(ws, game, 'blue');
    await blue.waitFor('drafts');
    blue.send(cmd({ kind: 'createDraft', draft: 'd1', text: 'Hold the bridge' }));
    await blue.waitFor('draftState');
    blue.send(check('c1'));
    const report = await blue.waitFor('draftCheck');
    expect(report.unavailable).toBe(true);
    expect(report.reading).toBeUndefined();
    expect(report.findings).toEqual([]);
    expect(report.officer.name).not.toBe('');
  });
});

describe('orders', () => {
  it('delivers the order after the courier ride, then sends the dispatch', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const blue = await join(ws, game, 'blue');
    const red = await join(ws, game, 'red');
    await blue.waitFor('viewUpdate');

    blue.send(order('blue-1 march to the bridge'));

    const { dispatch } = await blue.waitFor('dispatch', (m) =>
      m.dispatch.text.includes('received its orders'),
    );
    // The order was signed at `issuedAt`; the courier took DELIVERY_MS to reach the unit and
    // the acknowledgement took ACK_DELAY_MS to come back.
    const signed = (await store.inputLog(game.id)).find((e) => e.command.kind === 'order')!;
    expect(signed.error).toBeUndefined();
    expect(dispatch.writtenAtGame).toBe(signed.gameMs + DELIVERY_MS);
    expect(dispatch.receivedAtGame).toBe(signed.gameMs + DELIVERY_MS + ACK_DELAY_MS);
    expect(dispatch.from).toBe(START.units.find((u) => u.id === 'blue-1')!.name);

    // The next view carries it too, and blue-1 is on the move.
    const withIt = await blue.waitFor('viewUpdate', (m) =>
      m.view.dispatches.some((d) => d.id === dispatch.id),
    );
    const start1 = START.units.find((u) => u.id === 'blue-1')!.center;
    const now1 = withIt.view.ownUnits.find((u) => u.id === 'blue-1')!;
    expect(now1.position).not.toEqual({ x: start1.x / 1000, y: start1.y / 1000 });

    // The dispatch goes to the side that sent the order and nobody else.
    expect(red.messages.some((m) => m.kind === 'dispatch')).toBe(false);
  });

  it('carries the courier chosen on the wire to the signed order, and none when none was chosen', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const blue = await join(ws, game, 'blue');
    await blue.waitFor('viewUpdate');
    blue.send(
      JSON.stringify({
        v,
        kind: 'issueOrder',
        orderId: 'f',
        text: 'blue-1 hold the bridge',
        courier: 'fast',
      }),
    );
    blue.send(order('blue-1 hold the bridge', 'p'));
    await vi.waitFor(async () => {
      const orders = (await store.inputLog(game.id)).filter((e) => e.command.kind === 'order');
      expect(orders).toHaveLength(2);
    });
    const [fast, plain] = (await store.inputLog(game.id)).filter((e) => e.command.kind === 'order');
    expect(fast!.command).toMatchObject({ courier: 'fast' });
    expect(plain!.command).not.toHaveProperty('courier');
  });

  it('reports a dispatch once, not again in later pushes', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const blue = await join(ws, game, 'blue');
    blue.send(order('blue-1 hold the bridge'));
    await blue.waitFor('dispatch');
    const last = (await blue.waitFor('viewUpdate', (m) => m.view.dispatches.length > 0)).view;
    await blue.waitFor('viewUpdate', (m) => m.view.atGame > last.atGame + 120_000);
    const ids = blue.messages.flatMap((m) => (m.kind === 'dispatch' ? [m.dispatch.id] : []));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not push the papers already in the initial view again to a later connection', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const first = await join(ws, game, 'blue');
    first.send(order('blue-1 hold the bridge'));
    const { dispatch } = await first.waitFor('dispatch');
    const second = await join(ws, game, 'blue');
    const view = await second.waitFor('viewUpdate');
    expect(view.view.dispatches.some((d) => d.id === dispatch.id)).toBe(true);
    // Let the game move on so a push reaches the second socket as well.
    await second.waitFor('viewUpdate', (m) => m.view.atGame > view.view.atGame + 60_000);
    expect(second.messages.some((m) => m.kind === 'dispatch')).toBe(false);
  });

  it('logs a game made through the API so that it replays to the same state', async () => {
    const { base } = await start();
    const game = (await createGame(base)).json;
    const actor = app!.host.get(game.id)!;
    await actor.submit({ kind: 'setMode', mode: 'manual' });
    await actor.submit({ kind: 'advanceTo', gameMs: 30 * 60_000 });
    await actor.submit({ kind: 'order', side: 'blue', text: 'blue-1 march to the bridge' });
    await actor.submit({ kind: 'advanceTo', gameMs: 60 * 60_000 });

    const header = (await store.logHeader(game.id))!;
    const entries = await store.inputLog(game.id);
    const replayed = replayLog(
      header,
      loadScenarioById(header.scenarioId),
      entries,
      createRegistry(),
      undefined,
      startingState,
    );
    expect(actor.state.queue.length).toBeGreaterThan(0);
    expect(replayed.state).toEqual(actor.state);
  });

  it('answers an order the umpire cannot read with an error, and keeps the connection', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const blue = await join(ws, game, 'blue');
    blue.send(order('what a lovely day', 'bad-1'));
    const e = await blue.waitFor('error', (m) => m.message.includes('bad-1'));
    expect(['order_rejected', 'order_clarification']).toContain(e.code);
    expect(blue.closed).toBe(false);
  });

  it('refuses an order to a unit of the other side', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const blue = await join(ws, game, 'blue');
    blue.send(order('red-1 march to the bridge', 'x-1'));
    await blue.waitFor('error', (m) => m.message.includes('x-1'));
    expect(app!.host.get(game.id)!.state.queue.some((e) => e.type === 'order.issue')).toBe(false);
  });

  it('says drafts and other commands are not supported yet', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const blue = await join(ws, game, 'blue');
    blue.send(JSON.stringify({ v, kind: 'issueOrder', orderId: 'o', draft: 'd1' }));
    blue.send(JSON.stringify({ v, kind: 'setReady', ready: true }));
    await blue.waitFor('error', (m) => m.code === 'not_implemented' && m.message.includes('draft'));
    await blue.waitFor(
      'error',
      (m) => m.code === 'not_implemented' && m.message.includes('setReady'),
    );
  });
});

/**
 * Starts the app on a fake wall clock, so game time moves only when the test advances it and
 * nothing waits on the real clock or the machine's load. Returns the clock and the base URL.
 */
async function startWithFakeTime(extra: Partial<Parameters<typeof buildApp>[0]> = {}) {
  const time = new FakeTime(Date.now());
  store = new MemoryGameStore();
  const built = await buildApp({
    parser: new StubOrderParser(),
    store,
    auth: { mailer },
    wallNow: time.now,
    timers: time,
    ...extra,
  });
  app = built;
  const base = await built.server.listen({ port: 0, host: '127.0.0.1' });
  return { time, base };
}

describe('catch-up on reconnect', () => {
  it('tells a returning side what arrived while away, once, without duplicating papers', async () => {
    // Game time moves only when the test advances the fake wall clock, so how far it has moved
    // when the player leaves and returns does not depend on how fast the machine is.
    const { time, base } = await startWithFakeTime();
    const ws = base.replace('http', 'ws');
    const game = (await createGame(base)).json;
    const first = await join(ws, game, 'blue');
    const initial = await first.waitFor('viewUpdate');
    const actor = app!.host.get(game.id)!;
    const deskCount = () =>
      sideViewOf(actor.state, 'blue', actor.gameClock.snapshot()).dispatches.length;
    /** Advance game hours, one at a time, until `done`; the report's arrival is a game-time event. */
    const advanceUntil = async (done: () => boolean) => {
      for (let i = 0; i < 100 && !done(); i++) await time.advance(1000);
      expect(done()).toBe(true);
    };
    // A first visit has nothing to catch up on.
    // One report reaches the desk while the player is here, so it is not new on return.
    first.send(order('blue-1 march to the bridge', 'o1'));
    await advanceUntil(() => deskCount() > 0);
    const seenHere = await first.waitFor('viewUpdate', (m) => m.view.dispatches.length > 0);
    const before = seenHere.view.dispatches.map((d) => d.id);
    // Wait for the second order to be taken before leaving, rather than racing the close.
    first.send(order('blue-1 hold at the bridge', 'o2'));
    await vi.waitFor(async () =>
      expect(
        (await store.inputLog(game.id)).filter((e) => e.command.kind === 'order'),
      ).toHaveLength(2),
    );
    first.socket.close();
    await vi.waitFor(async () =>
      expect(await store.loadSeen(game.id, 'blue')).toBeGreaterThanOrEqual(initial.view.atGame),
    );
    // Game hours pass with nobody connected until the second report reaches the desk.
    await advanceUntil(() => deskCount() > before.length);
    const arrived = sideViewOf(actor.state, 'blue', actor.gameClock.snapshot());
    const newIds = arrived.dispatches.map((d) => d.id).filter((id) => !before.includes(id));
    expect(newIds.length).toBeGreaterThan(0);

    const again = await join(ws, game, 'blue');
    const catchUp = await again.waitFor('catchUp');
    expect(catchUp.sinceGame).toBeGreaterThanOrEqual(initial.view.atGame);
    expect(catchUp.sinceGame).toBeLessThan(catchUp.atGame);
    // Only what arrived while away: the report seen before leaving is in the view, not the catch-up.
    expect(catchUp.dispatchIds).toEqual(newIds);
    // The papers are in the view, once; they are not also pushed one by one.
    const view = await again.waitFor('viewUpdate');
    const ids = view.view.dispatches.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([...before, ...(catchUp.dispatchIds as string[])]));
    expect(again.messages.some((m) => m.kind === 'dispatch')).toBe(false);

    // A second tab of the same side is not "away", and neither is the other side's first visit.
    // Make the saved seen time stale and attach the tab in the same tick (no tick can refresh it in
    // between), so that only the open-tab rule, not "nothing changed since", can suppress a catch-up.
    const sent: string[] = [];
    const fakeTab = {
      readyState: 1,
      send: (data: string) => void sent.push(data),
      close: () => undefined,
      on: () => undefined,
    };
    (app!.hub as unknown as { seen: Map<string, number> }).seen.set(`${game.id}\0blue`, 0);
    app!.hub.attach(game.id, 'blue', fakeTab);
    const red = await join(ws, game, 'red');
    await vi.waitFor(() => expect(sent.some((m) => m.includes('"viewUpdate"'))).toBe(true));
    await red.waitFor('viewUpdate');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sent.some((m) => m.includes('"catchUp"'))).toBe(false);
    expect(red.messages.some((m) => m.kind === 'catchUp')).toBe(false);
    expect(first.messages.some((m) => m.kind === 'catchUp')).toBe(false);
  });
});

describe('shared order drafts', () => {
  const cmd = (c: Record<string, unknown>) => JSON.stringify({ v, ...c });

  it('puts two clients’ concurrent edits and comments in one order, and keeps the other side out', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const a = await join(ws, game, 'blue');
    const b = await join(ws, game, 'blue');
    const red = await join(ws, game, 'red');
    expect((await a.waitFor('drafts')).drafts).toEqual([]);
    a.send(cmd({ kind: 'createDraft', draft: 'd1', text: 'Hold the bridge', title: 'Order 1' }));
    await b.waitFor('draftState', (m) => m.draft.id === 'd1');
    // Both edit the same rev before hearing from each other.
    a.send(cmd({ kind: 'draftEdit', draft: 'd1', baseRev: 0, op: ['Colonel: ', 15], opId: 'a1' }));
    b.send(
      cmd({ kind: 'draftEdit', draft: 'd1', baseRev: 0, op: [15, ' at all costs'], opId: 'b1' }),
    );
    for (const c of [a, b]) {
      await c.waitFor('draftEntry', (m) => m.entry.rev === 2);
    }
    const last = b.messages.filter((m) => m.kind === 'draftEntry');
    expect(last.map((m) => m.entry.rev)).toEqual([1, 2]);
    a.send(
      cmd({
        kind: 'draftComment',
        draft: 'd1',
        baseRev: 2,
        comment: { id: 'c1', from: 9, to: 13, body: 'Which hold?' },
      }),
    );
    await b.waitFor('draftEntry', (m) => m.entry.kind === 'comment');
    b.send(cmd({ kind: 'readDraft', draft: 'd1', rev: 3 }));
    const receipt = await a.waitFor('draftReceipt');
    expect(receipt.rev).toBe(3);
    // A fresh connection (a player coming back later) gets the whole draft.
    a.socket.close();
    const again = await join(ws, game, 'blue');
    const [d] = (await again.waitFor('drafts')).drafts;
    expect(d!.text).toBe('Colonel: Hold the bridge at all costs');
    expect(d!.history.map((e) => e.rev)).toEqual([1, 2, 3]);
    expect(d!.comments).toHaveLength(1);
    expect(Object.values(d!.receipts)).toEqual([3]);
    expect(red.messages.filter((m) => m.kind.startsWith('draft') && m.kind !== 'drafts')).toEqual(
      [],
    );
    expect((await red.waitFor('drafts')).drafts).toEqual([]);
  });

  it('applies a resent opId once after a reconnect, and syncDrafts resends the snapshot', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const a = await join(ws, game, 'blue');
    await a.waitFor('drafts');
    a.send(cmd({ kind: 'createDraft', draft: 'd1', text: 'abc' }));
    await a.waitFor('draftState');
    a.send(cmd({ kind: 'draftEdit', draft: 'd1', baseRev: 0, op: [3, 'd'], opId: 'o1' }));
    await a.waitFor('draftEntry');
    a.socket.close();
    const again = await join(ws, game, 'blue');
    await again.waitFor('drafts');
    again.send(cmd({ kind: 'draftEdit', draft: 'd1', baseRev: 0, op: [3, 'd'], opId: 'o1' }));
    await again.waitFor('draftEntry', (m) => m.entry.kind === 'edit' && m.entry.opId === 'o1');
    again.send(cmd({ kind: 'syncDrafts' }));
    await again.waitFor('drafts', (m) => m.drafts.length === 1 && m.drafts[0]!.text === 'abcd');
    expect(again.messages.filter((m) => m.kind === 'drafts').pop()).toMatchObject({
      drafts: [{ rev: 1, text: 'abcd' }],
    });
  });

  it('forks and merges, saves to the store, and answers a bad edit with an error', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const a = await join(ws, game, 'blue');
    await a.waitFor('drafts');
    a.send(cmd({ kind: 'createDraft', draft: 'd1', text: 'abc' }));
    a.send(cmd({ kind: 'forkDraft', draft: 'd1', newDraft: 'd2' }));
    await a.waitFor('draftState', (m) => m.draft.id === 'd2');
    a.send(cmd({ kind: 'draftEdit', draft: 'd2', baseRev: 0, op: [3, 'd'] }));
    a.send(cmd({ kind: 'draftEdit', draft: 'd1', baseRev: 0, op: ['<', 3] }));
    a.send(cmd({ kind: 'mergeDraft', draft: 'd2' }));
    const closed = await a.waitFor('draftState', (m) => m.draft.mergedInto === 'd1');
    expect(closed.draft.id).toBe('d2');
    a.send(cmd({ kind: 'draftEdit', draft: 'd1', baseRev: 0, op: [99] }));
    expect((await a.waitFor('error', (m) => m.code === 'bad_op')).code).toBe('bad_op');
    a.send(cmd({ kind: 'draftEdit', draft: 'd2', baseRev: 1, op: [4] }));
    await a.waitFor('error', (m) => m.code === 'draft_closed');
    await vi.waitFor(async () => {
      const saved = await store.loadDrafts(game.id, 'blue');
      expect(saved.find((d) => d.id === 'd1')?.text).toBe('<abcd');
    });
  });
});

describe('seen time on shutdown', () => {
  it('flushSeen saves the seen time of a side that is still connected', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const blue = await join(ws, game, 'blue');
    const initial = await blue.waitFor('viewUpdate');
    await app!.hub.flushSeen();
    expect(await store.loadSeen(game.id, 'blue')).toBeGreaterThanOrEqual(initial.view.atGame);
  });
});

describe('marks', () => {
  const pin = (id: string, x = 100) => ({
    id,
    kind: 'pin',
    at: { x, y: 200 },
    label: 'enemy cav',
    madeAtGame: 60_000,
    sourceReport: 'd1',
  });
  const put = (mark: unknown) => JSON.stringify({ v, kind: 'putMark', mark });

  it('starts empty, shares a side’s marks between its connections, and keeps them from the other side', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const a = await join(ws, game, 'blue');
    const b = await join(ws, game, 'blue');
    const red = await join(ws, game, 'red');
    expect((await a.waitFor('marks')).marks).toEqual([]);
    a.send(put(pin('m1')));
    const seen = await b.waitFor('marks', (m) => m.marks.length === 1);
    expect(seen.marks[0]).toEqual(pin('m1'));
    // Not corrected: the mark comes back exactly as sent, wherever the truth is.
    a.send(put({ ...pin('m1'), at: { x: 5, y: 6 } }));
    await b.waitFor(
      'marks',
      (m) => m.marks.length === 1 && 'at' in m.marks[0]! && m.marks[0].at.x === 5,
    );
    expect((await red.waitFor('marks')).marks).toEqual([]);
    expect(red.messages.filter((m) => m.kind === 'marks')).toHaveLength(1);
  });

  it('persists across a reload (a new connection) and survives delete', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const a = await join(ws, game, 'blue');
    a.send(put(pin('m1')));
    a.send(put(pin('m2', 300)));
    await a.waitFor('marks', (m) => m.marks.length === 2);
    a.socket.close();
    const again = await join(ws, game, 'blue');
    expect((await again.waitFor('marks')).marks.map((m) => m.id)).toEqual(['m1', 'm2']);
    again.send(JSON.stringify({ v, kind: 'deleteMark', markId: 'm1' }));
    await again.waitFor('marks', (m) => m.marks.length === 1);
    await vi.waitFor(async () =>
      expect((await store.loadMarks(game.id, 'blue')).map((m) => m.id)).toEqual(['m2']),
    );
  });

  it('carries a maximum-size pencil line of full-precision points without dropping the connection', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const a = await join(ws, game, 'blue');
    await a.waitFor('marks');
    const points = Array.from({ length: MAX_LINE_POINTS }, (_, i) => ({
      x: 1234.5678901234567 + i * 1.0000000000001,
      y: 2345.678901234567 + i * 1.0000000000001,
    }));
    const line = { id: 'big', kind: 'line', points, madeAtGame: 60_000, label: 'x'.repeat(80) };
    const frame = put(line);
    expect(Buffer.byteLength(frame)).toBeLessThan(16 * 1024);
    a.send(frame);
    const seen = await a.waitFor('marks', (m) => m.marks.length === 1);
    expect(seen.marks[0]).toEqual(line);
    await vi.waitFor(async () =>
      expect((await store.loadMarks(game.id, 'blue')).map((m) => m.id)).toEqual(['big']),
    );
  });

  it('refuses an invalid mark and a side’s 501st mark', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    // A side already at the cap (written straight to the store, so the test is not 500 round trips).
    await store.saveMarks(
      game.id,
      'blue',
      Array.from({ length: MAX_MARKS }, (_, i) => pin(`p${i}`, i)) as never,
    );
    const a = await join(ws, game, 'blue');
    await a.waitFor('marks', (m) => m.marks.length === MAX_MARKS);
    a.send(put({ id: 'bad', kind: 'ring', at: { x: 1, y: 1 }, radius: -5, madeAtGame: 0 }));
    await a.waitFor('error', (m) => m.code === 'bad_message');
    a.send(put(pin('one-too-many')));
    await a.waitFor('error', (m) => m.code === 'too_many_marks');
    // Replacing a mark that exists is still allowed at the cap.
    a.send(put(pin('p0', 9)));
    await a.waitFor('marks', (m) => {
      const first = m.marks[0];
      return m.marks.length === MAX_MARKS && first?.kind === 'pin' && first.at.x === 9;
    });
  });
});

describe('malformed messages', () => {
  it('rejects each without crashing, and the connection still works', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const blue = await join(ws, game, 'blue');
    await blue.waitFor('viewUpdate');

    const bad = [
      'not json',
      '{',
      'null',
      '[]',
      '42',
      JSON.stringify({ v: 99, kind: 'setReady', ready: true }),
      JSON.stringify({ v, kind: 'cheat' }),
      JSON.stringify({ v, kind: 'issueOrder', orderId: 'o' }),
      JSON.stringify({ v, kind: 'issueOrder', orderId: 'o', text: 'go', side: 'red' }),
      JSON.stringify({ v, kind: 'vote', proposal: 'p', yes: 'maybe' }),
      '{"v":1,"kind":"draftEdit","draft":"d","baseRev":0,"op":' + '['.repeat(10_000),
    ];
    for (const m of bad) blue.send(m);
    blue.send(new Uint8Array([1, 2, 3]));
    await blue.waitFor('error', (m) => m.message.includes('JSON text'));
    await until(() => blue.messages.filter((m) => m.kind === 'error').length >= bad.length + 1);
    expect(
      blue.messages.filter((m) => m.kind === 'error').every((m) => m.code === 'bad_message'),
    ).toBe(true);
    expect(blue.closed).toBe(false);

    // Still served: a valid order after all that gets its normal answer.
    blue.send(order('blue-1 march to the bridge'));
    await blue.waitFor('dispatch');
  });

  it('drops an oversized message’s sender, not the server', async () => {
    const { base, ws } = await start();
    const game = (await createGame(base)).json;
    const big = await join(ws, game, 'blue');
    big.send(order('x'.repeat(100_000)));
    await until(() => big.closed);
    const other = await join(ws, game, 'red');
    await other.waitFor('viewUpdate');
  });
});

async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('scripted opponent', () => {
  /** Wall time the game runs on here, so nothing waits on the real clock or the machine's load. */
  let time: FakeTime;

  /** Starts the app with the settings `main.ts` derives from the given environment. */
  async function startLikeMain(env: Record<string, string | undefined>) {
    const started = await startWithFakeTime({ scriptedOpponents: scriptedOpponentsFromEnv(env) });
    time = started.time;
    return started.base;
  }

  const redUnits = (id: string) =>
    app!.host.get(id)!.state.world.units.filter((u) => u.side === 'red');
  const agentOrders = async (id: string) => (await store.inputLog(id)).filter((e) => e.agent);

  it('moves Red by default with no client input', async () => {
    const base = await startLikeMain({});
    const game = (await createGame(base, { rate: 86_400 }, false)).json;
    const start = redUnits(game.id).map((u) => u.center);
    await time.advance(5000);
    expect(await agentOrders(game.id)).not.toHaveLength(0);
    expect(
      redUnits(game.id).some((u, i) => u.center.x !== start[i]!.x || u.center.y !== start[i]!.y),
    ).toBe(true);
  });

  it('leaves Red idle when SCRIPTED_OPPONENTS=0', async () => {
    // The same span of fake time that gives the default setting an agent order, so the idle
    // check below can't pass vacuously by looking for less time than that.
    const defaultBase = await startLikeMain({});
    const calibration = (await createGame(defaultBase, { rate: 86_400 }, false)).json;
    await time.advance(5000);
    expect(await agentOrders(calibration.id)).not.toHaveLength(0);
    await app!.server.close();

    const base = await startLikeMain({ SCRIPTED_OPPONENTS: '0' });
    const game = (await createGame(base, { rate: 86_400 }, false)).json;
    await time.advance(5000);
    expect(await agentOrders(game.id)).toHaveLength(0);
  });

  it.each([
    [{}, true],
    [{ SCRIPTED_OPPONENTS: '' }, true],
    [{ SCRIPTED_OPPONENTS: '1' }, true],
    [{ SCRIPTED_OPPONENTS: 'true' }, true],
    [{ SCRIPTED_OPPONENTS: '0' }, false],
    [{ SCRIPTED_OPPONENTS: ' 0 ' }, false],
    [{ SCRIPTED_OPPONENTS: 'false' }, false],
    [{ SCRIPTED_OPPONENTS: 'FALSE' }, false],
    [{ SCRIPTED_OPPONENTS: 'off' }, false],
    [{ SCRIPTED_OPPONENTS: 'OFF' }, false],
  ])('scriptedOpponentsFromEnv(%j) is %s', (env, expected) => {
    expect(scriptedOpponentsFromEnv(env)).toBe(expected);
  });
});

describe('deployment endpoints', () => {
  it('answers /healthz and serves the built client from staticDir', async () => {
    const dir = mkdtempSync(joinPath(tmpdir(), 'ks-static-'));
    writeFileSync(joinPath(dir, 'index.html'), '<title>ks</title>');
    const { server } = await buildApp({
      parser: new StubOrderParser(),
      staticDir: dir,
      auth: { mailer },
    });
    try {
      const health = await server.inject('/healthz');
      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual({ ok: true });
      const page = await server.inject('/');
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('<title>ks</title>');
      expect((await server.inject({ method: 'POST', url: '/games', payload: {} })).statusCode).toBe(
        401,
      );
    } finally {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('redirects a directory without trailing slash, keeping the query', async () => {
    const dir = mkdtempSync(joinPath(tmpdir(), 'ks-static-'));
    mkdirSync(joinPath(dir, 'admin'));
    writeFileSync(joinPath(dir, 'admin', 'index.html'), '<title>admin</title>');
    const { server } = await buildApp({ parser: new StubOrderParser(), staticDir: dir });
    try {
      const bare = await server.inject('/admin');
      expect(bare.statusCode).toBe(301);
      expect(bare.headers.location).toBe('/admin/');
      const withToken = await server.inject('/admin?token=x');
      expect(withToken.statusCode).toBe(301);
      expect(withToken.headers.location).toBe('/admin/?token=x');
      const page = await server.inject('/admin/');
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('<title>admin</title>');
    } finally {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('SPA fallback for the Angular client', () => {
  async function spaApp(spaFallback: boolean) {
    const dir = mkdtempSync(joinPath(tmpdir(), 'ks-spa-'));
    writeFileSync(joinPath(dir, 'index.html'), '<title>ng</title>');
    const { server } = await buildApp({
      parser: new StubOrderParser(),
      staticDir: dir,
      spaFallback,
      auth: { mailer },
    });
    return { server, done: () => rmSync(dir, { recursive: true, force: true }) };
  }

  it('serves index.html for the client routes and keeps the API paths as API', async () => {
    const { server, done } = await spaApp(true);
    try {
      for (const url of [
        '/',
        '/admin',
        '/admin/',
        '/admin/games/3',
        '/admin/apix',
        '/map-authoring',
        '/map-table',
        '/map-table?x=1',
        '/map-benchmark?x=1',
        '/table-benchmark',
        '/table-benchmark?seconds=10',
        '/style-guide',
      ]) {
        const res = await server.inject(url);
        expect(res.statusCode, url).toBe(200);
        expect(res.body, url).toContain('<title>ng</title>');
      }
      for (const url of [
        '/admin/api',
        '/admin/api/games',
        '/games/nope/x',
        '/scenarios/nope/x',
        '/auth/nope',
        '/other',
        '/administrator',
        '/map-table-other',
        '/__local/maps',
      ]) {
        const res = await server.inject(url);
        expect(res.statusCode, url).toBe(404);
        expect(res.json().error, url).toBe('Not Found');
      }
      expect((await server.inject({ method: 'POST', url: '/admin', payload: {} })).statusCode).toBe(
        404,
      );
    } finally {
      await server.close();
      done();
    }
  });

  it('serves the app shell for every top-level route in the Angular router', async () => {
    const routesFile = new URL('../../../client/src/app/app.routes.ts', import.meta.url);
    // Assumes top-level, non-parameterised paths; `path:` may sit anywhere on a line because
    // Prettier keeps short route objects on one line.
    const paths = [...readFileSync(routesFile, 'utf8').matchAll(/\bpath:\s*'([^']*)'/g)]
      .map((m) => m[1]!)
      .filter((p) => p && p !== '**' && !p.endsWith('.html') && !p.includes(':'));
    expect(paths).toContain('style-guide');
    const { server, done } = await spaApp(true);
    try {
      for (const path of paths) {
        const res = await server.inject(`/${path}`);
        expect(res.statusCode, path).toBe(200);
        expect(res.body, path).toContain('<title>ng</title>');
      }
    } finally {
      await server.close();
      done();
    }
  });

  it('redirects the old .html pages, keeping the query', async () => {
    const { server, done } = await spaApp(true);
    try {
      const map = await server.inject('/map-authoring.html?a=1');
      expect(map.statusCode).toBe(301);
      expect(map.headers.location).toBe('/map-authoring?a=1');
      const inspector = await server.inject('/map-table.html?inspection=1');
      expect(inspector.statusCode).toBe(301);
      expect(inspector.headers.location).toBe('/map-table?inspection=1');
      expect(
        (await server.inject({ method: 'HEAD', url: '/map-table.html?x=1' })).headers.location,
      ).toBe('/map-table?x=1');
      expect(
        (await server.inject({ method: 'POST', url: '/map-table.html', payload: {} })).statusCode,
      ).toBe(404);
      expect((await server.inject('/map-benchmark.html')).headers.location).toBe('/map-benchmark');
      expect((await server.inject('/admin/index.html?x=1')).headers.location).toBe('/admin?x=1');
      expect((await server.inject('/table-benchmark.html')).headers.location).toBe(
        '/table-benchmark',
      );
      expect((await server.inject({ method: 'HEAD', url: '/map-authoring.html' })).statusCode).toBe(
        301,
      );
      const post = await server.inject({ method: 'POST', url: '/map-authoring.html', payload: {} });
      expect(post.statusCode).toBe(404);
      expect(post.json().error).toBe('Not Found');
    } finally {
      await server.close();
      done();
    }
  });

  it('is off by default, so the Svelte client keeps its own pages', async () => {
    const { server, done } = await spaApp(false);
    try {
      expect((await server.inject('/map-authoring')).statusCode).toBe(404);
      expect((await server.inject('/map-authoring.html')).statusCode).toBe(404);
    } finally {
      await server.close();
      done();
    }
  });
});

describe('pause voting over the WebSocket', () => {
  const cmd = (body: object) => JSON.stringify({ v, ...body });
  /** Blue and red players in a started lobby game with pause voting (voters are the seats taken at the start). */
  async function votingGame(pause: object = { rule: 'unanimous' }, rate = RATE) {
    const { base, ws } = await start();
    const bluePlayer = await signIn(base, 'vote-blue@example.test');
    const redPlayer = await signIn(base, 'vote-red@example.test');
    const res = await fetch(
      `${base}/games`,
      json(bluePlayer, { lobby: true, rate, side: 'blue', pause }),
    );
    const game = (await res.json()) as Created;
    game.cookies = { blue: bluePlayer, red: redPlayer };
    await fetch(`${base}/games/${game.id}/join`, json(redPlayer, { side: 'red' }));
    await fetch(`${base}/games/${game.id}/ready`, json(redPlayer, { ready: true }));
    const started = await fetch(`${base}/games/${game.id}/start`, json(bluePlayer, {}));
    expect(started.status).toBe(200);
    const blue = await join(ws, game, 'blue');
    const red = await join(ws, game, 'red');
    return { game, blue, red, ws };
  }

  it('tells both players about a proposal, lets them vote, and pauses on all yes', async () => {
    const { game, blue, red } = await votingGame();
    await blue.waitFor('pauseState', (m) => m.phase === 'running' && !m.proposal);

    blue.send(cmd({ kind: 'proposePause', reason: 'door' }));
    const mine = await blue.waitFor('pauseState', (m) => m.phase === 'pause_proposed');
    expect(mine.proposal).toMatchObject({
      kind: 'pause',
      bySide: 'blue',
      byYou: true,
      reason: 'door',
      yes: 1,
      no: 0,
      voters: 2,
      myVote: true,
    });
    const theirs = await red.waitFor('pauseState', (m) => m.phase === 'pause_proposed');
    expect(theirs.proposal).toMatchObject({ byYou: false, bySide: 'blue', yes: 1 });
    expect(theirs.proposal!.myVote).toBeUndefined();
    expect(theirs.proposal!.msLeft).toBeGreaterThan(0);

    red.send(cmd({ kind: 'vote', proposal: theirs.proposal!.id, yes: true }));
    await blue.waitFor('pauseResult', (m) => m.outcome === 'paused');
    await red.waitFor('pauseState', (m) => m.phase === 'paused' && !m.proposal);
    await blue.waitFor('clockState', (c) => c.clock.status === 'paused');
    expect(app!.host.get(game.id)!.gameClock.status).toBe('paused');

    // And back again.
    red.send(cmd({ kind: 'proposeResume' }));
    const ask = await blue.waitFor('pauseState', (m) => m.phase === 'resume_proposed');
    blue.send(cmd({ kind: 'vote', proposal: ask.proposal!.id, yes: true }));
    await red.waitFor('pauseResult', (m) => m.outcome === 'resumed');
    await blue.waitFor('clockState', (c) => c.clock.status === 'running');
  });

  it('cancels on a no and says so to both players', async () => {
    const { blue, red } = await votingGame();
    blue.send(cmd({ kind: 'proposePause' }));
    const open = await red.waitFor('pauseState', (m) => m.phase === 'pause_proposed');
    red.send(cmd({ kind: 'vote', proposal: open.proposal!.id, yes: false }));
    for (const c of [blue, red]) {
      const r = await c.waitFor('pauseResult');
      expect(r).toMatchObject({
        outcome: 'cancelled',
        cause: 'no-vote',
        proposalKind: 'pause',
        bySide: 'red',
      });
    }
    await blue.waitFor('pauseState', (m) => m.phase === 'running' && !m.proposal);
  });

  it('cancels when a voter never answers, and shows an open vote to one who reconnects', async () => {
    const {
      game,
      blue,
      red: first,
      ws,
    } = await votingGame(
      {
        rule: 'unanimous',
        voteTimeoutMs: 1000,
      },
      // Slow enough that the 50-minute hold does not end the game while the vote runs out.
      240,
    );
    first.socket.close();
    blue.send(cmd({ kind: 'proposePause' }));
    await blue.waitFor('pauseState', (m) => m.phase === 'pause_proposed');

    const red = await join(ws, game, 'red');
    const seen = await red.waitFor('pauseState');
    expect(seen.phase).toBe('pause_proposed');
    expect(seen.proposal!.myVote).toBeUndefined();

    const r = await red.waitFor('pauseResult', () => true, 8000);
    expect(r).toMatchObject({ outcome: 'cancelled', cause: 'timeout' });
    expect(app!.host.get(game.id)!.gameClock.status).toBe('running');
  });

  it('refuses a pause request in a game without voting', async () => {
    const { base, ws } = await start();
    const plain = (await createGame(base)).json;
    const c = await join(ws, plain, 'blue');
    c.send(cmd({ kind: 'proposePause' }));
    expect((await c.waitFor('error')).code).toBe('pause_unavailable');
    expect(c.messages.some((m) => m.kind === 'pauseState')).toBe(false);
  });

  it('refuses a vote on a proposal that is not open', async () => {
    const { blue } = await votingGame();
    blue.send(cmd({ kind: 'vote', proposal: 'nope', yes: true }));
    expect((await blue.waitFor('error')).code).toBe('pause_refused');
  });
});
