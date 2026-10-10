import {
  COURIER_DELAY_MS,
  COURIER_MS_PER_METRE,
  findPath,
  holdTheBridge,
  loadScenario,
} from '@kriegsspiel/engine';
import { PROTOCOL_VERSION, parseServerMessage, type ServerMessage } from '@kriegsspiel/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MemoryGameStore,
  createRegistry,
  loadScenarioById,
  replayLog,
  startingState,
} from '../game/index.js';
import { StubOrderParser } from '../orders/stubParser.js';
import { buildApp, type App } from './app.js';

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

  static async connect(url: string): Promise<Client> {
    const socket = new WebSocket(url);
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
  tokens: Record<string, string>;
  ws: Record<string, string>;
}

let app: App | undefined;
let store: MemoryGameStore;
const clients: Client[] = [];

afterEach(async () => {
  clients.splice(0).forEach((c) => c.socket.close());
  await app?.server.close();
  app = undefined;
});

async function start() {
  store = new MemoryGameStore();
  app = await buildApp({ parser: new StubOrderParser(), store });
  const base = await app.server.listen({ port: 0, host: '127.0.0.1' });
  return { base, ws: base.replace('http', 'ws') };
}

async function createGame(base: string, body: unknown = { rate: RATE }) {
  const res = await fetch(`${base}/games`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Created };
}

async function join(ws: string, game: Created, side: 'blue' | 'red') {
  const c = await Client.connect(`${ws}${game.ws[side]}`);
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
    expect(Object.keys(json.tokens).sort()).toEqual(['blue', 'red']);
    expect(json.tokens.blue).not.toBe(json.tokens.red);
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

describe('WebSocket auth', () => {
  it('refuses a missing or wrong token and an unknown game', async () => {
    const { base, ws } = await start();
    const { json } = await createGame(base);
    await expect(Client.connect(`${ws}/games/${json.id}/ws`)).rejects.toThrow();
    await expect(Client.connect(`${ws}/games/${json.id}/ws?token=nope`)).rejects.toThrow();
    await expect(
      Client.connect(`${ws}/games/missing/ws?token=${json.tokens.blue}`),
    ).rejects.toThrow();
  });

  it('does not let one game’s token into another', async () => {
    const { base, ws } = await start();
    const a = (await createGame(base)).json;
    const b = (await createGame(base)).json;
    await expect(Client.connect(`${ws}/games/${b.id}/ws?token=${a.tokens.blue}`)).rejects.toThrow();
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
    // the report took COURIER_DELAY_MS to come back.
    const signed = (await store.inputLog(game.id)).find((e) => e.command.kind === 'order')!;
    expect(signed.error).toBeUndefined();
    expect(dispatch.writtenAtGame).toBe(signed.gameMs + DELIVERY_MS);
    expect(dispatch.receivedAtGame).toBe(signed.gameMs + DELIVERY_MS + COURIER_DELAY_MS);
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
      '{"v":1,"kind":"draftEdit","draft":"d","ops":' + '['.repeat(10_000),
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
