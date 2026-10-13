import { afterEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, parseServerMessage, type ServerMessage } from '@kriegsspiel/protocol';
import { MemoryGameStore } from '../game/index.js';
import { StubOrderParser } from '../orders/stubParser.js';
import { buildApp, type App } from './app.js';
import { MAX_TURN_COMMANDS_PER_MINUTE } from './hub.js';

const v = PROTOCOL_VERSION;
const RATE = 3600;

const mailbox: Array<{ to: string; link: string }> = [];
const mailer = {
  async sendLoginLink(to: string, link: string) {
    mailbox.push({ to, link });
  },
};

let app: App | undefined;
let store: MemoryGameStore;
const sockets: WebSocket[] = [];

afterEach(async () => {
  sockets.splice(0).forEach((s) => s.close());
  await app?.server.close();
  app = undefined;
  mailbox.length = 0;
});

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

/** A socket that keeps every message it was sent. */
class Tap {
  readonly messages: ServerMessage[] = [];
  private constructor(readonly socket: WebSocket) {
    socket.addEventListener('message', (e) => {
      const parsed = parseServerMessage(String(e.data));
      if (parsed.ok) this.messages.push(parsed.value);
    });
  }
  static async open(url: string, cookie: string): Promise<Tap> {
    const socket = new (
      WebSocket as unknown as new (u: string, i: { headers: Record<string, string> }) => WebSocket
    )(url, { headers: { cookie } });
    sockets.push(socket);
    const tap = new Tap(socket);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', () => reject(new Error('refused')));
    });
    return tap;
  }
  send(message: Record<string, unknown>): void {
    this.socket.send(JSON.stringify({ v, ...message }));
  }
  async until<T>(pick: (messages: ServerMessage[]) => T | undefined, ms = 5000): Promise<T> {
    const deadline = Date.now() + ms;
    for (;;) {
      const hit = pick(this.messages);
      if (hit !== undefined) return hit;
      if (Date.now() > deadline) throw new Error(`timed out; got ${JSON.stringify(this.messages)}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }
}

interface Table {
  base: string;
  url: string;
  id: string;
  lead: string;
  red: string;
  cos: string;
  intel: string;
}

/** A started turn-mode game: blue's commander, chief of staff and intelligence officer, and red's player. */
async function startedTable(): Promise<Table> {
  store = new MemoryGameStore();
  app = await buildApp({ parser: new StubOrderParser(), store, auth: { mailer } });
  const base = await app.server.listen({ port: 0, host: '127.0.0.1' });
  const [lead, red, cos, intel] = await Promise.all(
    ['lead', 'red', 'cos', 'intel'].map((n) => signIn(base, `${n}@example.test`)),
  );
  const created = await fetch(
    `${base}/games`,
    post(lead!, {
      lobby: true,
      rate: RATE,
      sessionType: 'team_vs_team',
      side: 'blue',
      mode: 'turns',
    }),
  );
  const { id, umpire } = (await created.json()) as { id: string; umpire: unknown };
  expect(umpire).toEqual({ dial: 'standard', persona: 'dry', mode: 'turns', turnMinutes: 20 });
  const j = (cookie: string, body: unknown) =>
    fetch(`${base}/games/${id}/join`, post(cookie, body));
  expect((await j(red!, { side: 'red' })).status).toBe(200);
  expect((await j(cos!, { side: 'blue', role: 'chiefOfStaff' })).status).toBe(200);
  expect((await j(intel!, { side: 'blue', role: 'intelligence' })).status).toBe(200);
  for (const c of [red!, cos!, intel!]) {
    await fetch(`${base}/games/${id}/ready`, post(c, { ready: true }));
  }
  expect((await fetch(`${base}/games/${id}/start`, post(lead!))).status).toBe(200);
  return {
    base,
    url: `${base.replace('http', 'ws')}/games/${id}/ws`,
    id,
    lead: lead!,
    red: red!,
    cos: cos!,
    intel: intel!,
  };
}

type TurnStateMsg = Extract<ServerMessage, { kind: 'turnState' }>;
const lastTurn = (m: ServerMessage[]) =>
  m.filter((x): x is TurnStateMsg => x.kind === 'turnState').at(-1);

describe('POST /games in turn mode', () => {
  it('validates the turn settings and leaves a real-time game as before', async () => {
    store = new MemoryGameStore();
    app = await buildApp({ parser: new StubOrderParser(), store, auth: { mailer } });
    const base = await app.server.listen({ port: 0, host: '127.0.0.1' });
    const lead = await signIn(base, 'lead@example.test');
    const make = (body: unknown) =>
      fetch(`${base}/games`, post(lead, { lobby: true, ...(body as object) }));
    expect((await make({ mode: 'turns', turnMinutes: 90 })).status).toBe(400);
    expect((await make({ mode: 'turns', turnMinutes: 4 })).status).toBe(400);
    expect((await make({ mode: 'turns', turnDeadlineHours: 0 })).status).toBe(400);
    expect((await make({ mode: 'hourly' })).status).toBe(400);
    const turns = await make({ mode: 'turns', turnMinutes: 30, turnDeadlineHours: 48 });
    expect(((await turns.json()) as { umpire: unknown }).umpire).toEqual({
      dial: 'standard',
      persona: 'dry',
      mode: 'turns',
      turnMinutes: 30,
      turnDeadlineHours: 48,
    });
    const realtime = await make({ turnMinutes: 30 });
    expect(((await realtime.json()) as { umpire: unknown }).umpire).toEqual({
      dial: 'standard',
      persona: 'dry',
    });
  });
});

describe('turn mode over the socket', () => {
  it('holds orders for the side only, refuses clock votes and real-time orders, and resolves when both send', async () => {
    const t = await startedTable();
    const lead = await Tap.open(t.url, t.lead);
    const cos = await Tap.open(t.url, t.cos);
    const intel = await Tap.open(t.url, t.intel);
    const red = await Tap.open(t.url, t.red);
    for (const tap of [lead, cos, intel, red]) {
      expect(await tap.until(lastTurn)).toMatchObject({
        turn: 1,
        startsAt: 0,
        endsAt: 20 * 60_000,
        sent: [],
        resolving: false,
        held: [],
      });
    }

    // The chief of staff may hold an order for the side; the commander sees it too.
    const held = { orderId: 'o1', to: 'blue-1', text: 'Take the bridge by the high road' };
    cos.send({ kind: 'holdTurnOrder', order: held });
    for (const tap of [lead, cos]) {
      await tap.until((m) => (lastTurn(m)?.held.length === 1 ? true : undefined));
    }
    lead.send({ kind: 'holdTurnOrder', order: { ...held, text: 'Hold the north wood' } });
    await cos.until((m) =>
      lastTurn(m)?.held[0]?.text === 'Hold the north wood' ? true : undefined,
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(lastTurn(intel.messages)!.held).toEqual([]);
    expect(lastTurn(red.messages)!.held).toEqual([]);

    lead.send({ kind: 'issueOrder', orderId: 'x1', text: 'blue-1 march to the bridge' });
    await lead.until((m) => m.find((x) => x.kind === 'error' && x.code === 'turn_mode'));
    red.send({ kind: 'proposePause' });
    await red.until((m) => m.find((x) => x.kind === 'error' && x.code === 'turn_mode'));
    cos.send({ kind: 'sendTurn' });
    await cos.until((m) => m.find((x) => x.kind === 'error' && x.code === 'not_permitted'));
    intel.send({ kind: 'holdTurnOrder', order: { orderId: 'i1', to: 'blue-2', text: 'x' } });
    await intel.until((m) => m.find((x) => x.kind === 'error' && x.code === 'not_permitted'));
    lead.send({ kind: 'holdTurnOrder', order: { orderId: 'o2', to: 'red-1', text: 'surrender' } });
    await lead.until((m) =>
      m.find(
        (x) => x.kind === 'error' && x.code === 'turn_refused' && x.message.startsWith('o2: '),
      ),
    );

    red.send({ kind: 'sendTurn' });
    await lead.until((m) => (lastTurn(m)?.sent.join() === 'red' ? true : undefined));
    lead.send({ kind: 'sendTurn' });
    for (const tap of [lead, red]) {
      expect(
        await tap.until((m) => (lastTurn(m)?.turn === 2 ? lastTurn(m) : undefined)),
      ).toMatchObject({
        startsAt: 20 * 60_000,
        endsAt: 40 * 60_000,
        sent: [],
        held: [],
      });
    }
    // Blue's order text never reached red.
    expect(JSON.stringify(red.messages)).not.toContain('north wood');
    // A reload shows the orders the side sent.
    const again = await Tap.open(t.url, t.lead);
    const sent = await again.until((m) => m.find((x) => x.kind === 'sentOrders'));
    expect(sent).toMatchObject({
      orders: [{ id: 'o1', text: 'Hold the north wood', sentAtGame: 0 }],
    });
    app!.hub.closeAll();
  });

  it('limits how many turn commands a connection may send in a minute', async () => {
    const t = await startedTable();
    const lead = await Tap.open(t.url, t.lead);
    await lead.until(lastTurn);
    const before = (await store.inputLog(t.id)).length;
    for (let i = 0; i <= MAX_TURN_COMMANDS_PER_MINUTE; i++) {
      lead.send({
        kind: 'holdTurnOrder',
        order: { orderId: 'o1', to: 'blue-1', text: `rev ${i}` },
      });
    }
    const refused = await lead.until((m) =>
      m.find((x) => x.kind === 'error' && x.code === 'rate_limited'),
    );
    expect(refused).toMatchObject({ message: 'o1: too many turn commands; wait a moment' });
    await lead.until((m) =>
      lastTurn(m)?.held[0]?.text === `rev ${MAX_TURN_COMMANDS_PER_MINUTE - 1}` ? true : undefined,
    );
    const turnRows = (await store.inputLog(t.id))
      .slice(before)
      .filter((e) => e.command.kind === 'turnOrder');
    expect(turnRows).toHaveLength(MAX_TURN_COMMANDS_PER_MINUTE);
    app!.hub.closeAll();
  });
});
