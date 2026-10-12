/**
 * #198: HTTP routes and WebSocket messages are wrapped in `traceRequest`, so with the admin
 * view on, the Requests panel has rows and the entries a request causes share its correlation id.
 */
import { PROTOCOL_VERSION } from '@kriegsspiel/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { TraceStore, type TraceEntry } from '../debug/trace.js';
import { MemoryGameStore } from '../game/index.js';
import { StubOrderParser } from '../orders/stubParser.js';
import { buildApp, type App } from './app.js';

/** One game hour per wall second, so the order's parse and delivery settle quickly. */
const RATE = 3600;

const mailbox: Array<{ to: string; link: string }> = [];
const mailer = {
  async sendLoginLink(to: string, link: string) {
    mailbox.push({ to, link });
  },
};

let app: App | undefined;
const sockets: WebSocket[] = [];

afterEach(async () => {
  sockets.splice(0).forEach((s) => s.close());
  await app?.server.close();
  app = undefined;
  mailbox.length = 0;
});

async function start() {
  const trace = new TraceStore();
  app = await buildApp({
    parser: new StubOrderParser(),
    store: new MemoryGameStore(),
    auth: { mailer },
    admin: { enabled: true, trace },
  });
  const base = await app.server.listen({ port: 0, host: '127.0.0.1' });
  return { base, wsBase: base.replace('http', 'ws'), trace };
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

async function waitForEntries(
  trace: TraceStore,
  gameId: string,
  pick: (entries: TraceEntry[]) => boolean,
  ms = 5000,
): Promise<TraceEntry[]> {
  const deadline = Date.now() + ms;
  for (;;) {
    const entries = trace.entries(gameId);
    if (pick(entries)) return entries;
    if (Date.now() > deadline) {
      throw new Error(
        `timed out waiting for trace entries; got ${entries.map((e) => e.kind).join(', ')}`,
      );
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

const requestsOf = (entries: TraceEntry[]) => entries.filter((e) => e.kind === 'request');
const dataOf = (e: TraceEntry) => e.data as Record<string, unknown>;

describe('traceRequest wiring (#198)', () => {
  it('records the create-game request, the order message and their caused entries under shared correlation ids', async () => {
    const { base, wsBase, trace } = await start();
    const blue = await signIn(base, 'blue@example.test');
    const res = await fetch(`${base}/games`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: blue },
      body: JSON.stringify({ rate: RATE }),
    });
    expect(res.status).toBe(201);
    const game = (await res.json()) as { id: string; ws: string };

    // Creating the game left an HTTP request entry under the new game's id.
    const created = requestsOf(trace.entries(game.id));
    expect(created).toHaveLength(1);
    expect(dataOf(created[0]!)).toMatchObject({
      transport: 'http',
      method: 'POST',
      path: '/games',
      ok: true,
    });
    expect(typeof dataOf(created[0]!).responseBytes).toBe('number');

    // A per-game GET is traced under that game too.
    const got = await fetch(`${base}/games/${game.id}`, { headers: { cookie: blue } });
    expect(got.status).toBe(200);
    const afterGet = requestsOf(trace.entries(game.id));
    expect(afterGet).toHaveLength(2);
    expect(dataOf(afterGet[1]!)).toMatchObject({
      transport: 'http',
      method: 'GET',
      path: `/games/${game.id}`,
      ok: true,
    });

    // Issue an order over the WebSocket.
    const socket = new (
      WebSocket as unknown as new (
        url: string,
        init?: { headers: Record<string, string> },
      ) => WebSocket
    )(`${wsBase}${game.ws}`, { headers: { cookie: blue } });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', () => reject(new Error('connection refused')));
    });
    socket.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        kind: 'issueOrder',
        orderId: 'o1',
        text: 'blue-1 advance',
      }),
    );

    // The message left a WS request entry, and the command it caused shares its correlation id.
    const entries = await waitForEntries(
      trace,
      game.id,
      (all) =>
        requestsOf(all).some((e) => dataOf(e).transport === 'ws') &&
        all.some((e) => e.kind === 'command'),
    );
    const wsRequest = requestsOf(entries).find((e) => dataOf(e).transport === 'ws')!;
    expect(dataOf(wsRequest)).toMatchObject({ method: 'issueOrder', ok: true });
    expect(typeof dataOf(wsRequest).responseBytes).toBe('number');
    const linked = trace.entries(game.id, { correlationId: wsRequest.correlationId });
    expect(linked.some((e) => e.kind === 'command')).toBe(true);
    expect(
      linked.some((e) => e.kind === 'request' && e.correlationId === wsRequest.correlationId),
    ).toBe(true);

    // And the admin API (the Requests panel's data path) serves the request rows for the game.
    const panel = await fetch(`${base}/admin/api/games/${game.id}/entries?kind=request`);
    expect(panel.status).toBe(200);
    const page = (await panel.json()) as { entries: TraceEntry[] };
    expect(page.entries.length).toBeGreaterThanOrEqual(3);
    expect(page.entries.every((e) => e.kind === 'request')).toBe(true);
  });

  it('keeps global routes out of the per-game trace', async () => {
    const { base, trace } = await start();
    const health = await fetch(`${base}/healthz`);
    expect(health.status).toBe(200);
    const scenarios = await fetch(`${base}/scenarios`);
    expect(scenarios.status).toBe(200);
    // No phantom game appears in the store for requests that belong to no game.
    expect(trace.gameIds()).toEqual([]);
  });
});
