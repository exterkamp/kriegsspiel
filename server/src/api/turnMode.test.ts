import { afterEach, describe, expect, it } from 'vitest';
import { holdTheBridge, loadScenario } from '@kriegsspiel/engine';
import {
  PROTOCOL_VERSION,
  parseServerMessage,
  type Dispatch,
  type ServerMessage,
} from '@kriegsspiel/protocol';
import { MemoryGameStore } from '../game/index.js';
import { StubOrderParser } from '../orders/stubParser.js';
import { buildApp, type App } from './app.js';
import { MAX_TURN_COMMANDS_PER_MINUTE } from './hub.js';
import { umpireConfigFromEnv } from '../umpire/config.js';
import { createUmpireClient } from '../umpire/createUmpireClient.js';
import type { UmpireClient, UmpireRequest } from '../umpire/umpireClient.js';

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
async function startedTable(
  opts: {
    adjudicator?: () => UmpireClient;
    dial?: string;
    admin?: { enabled: boolean; token?: string };
  } = {},
): Promise<Table> {
  store = new MemoryGameStore();
  app = await buildApp({
    parser: new StubOrderParser(),
    store,
    auth: { mailer },
    ...(opts.adjudicator ? { adjudicator: opts.adjudicator } : {}),
    ...(opts.admin ? { admin: opts.admin } : {}),
  });
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
      ...(opts.dial ? { dial: opts.dial } : {}),
    }),
  );
  const { id, umpire } = (await created.json()) as { id: string; umpire: unknown };
  expect(umpire).toEqual({
    dial: opts.dial ?? 'standard',
    persona: 'dry',
    mode: 'turns',
    turnMinutes: 20,
  });
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

  it('ends the game on the wire with the turn that decided it: no further turn, then gameOver (#429)', async () => {
    store = new MemoryGameStore();
    app = await buildApp({
      parser: new StubOrderParser(),
      store,
      auth: { mailer },
      scriptedOpponents: true,
    });
    const base = await app.server.listen({ port: 0, host: '127.0.0.1' });
    const lead = await signIn(base, 'solo@example.test');
    const created = await fetch(
      `${base}/games`,
      post(lead, { sessionType: 'co_op_vs_ai', side: 'blue', mode: 'turns', dial: 'rigid' }),
    );
    const { id } = (await created.json()) as { id: string };
    const tap = await Tap.open(`${base.replace('http', 'ws')}/games/${id}/ws`, lead);
    const over = () => tap.messages.find((x) => x.kind === 'gameOver');
    // Blue sends empty turns until the scripted Red decides the game.
    for (let n = 1; n < 20 && !over(); n++) {
      await tap.until((m) => (lastTurn(m)?.turn === n || over() ? true : undefined));
      if (over()) break;
      tap.send({ kind: 'sendTurn' });
      await tap.until((m) => (lastTurn(m)?.turn === n + 1 || over() ? true : undefined));
    }
    const end = over() as Extract<ServerMessage, { kind: 'gameOver' }>;
    expect(end).toBeDefined();
    // The game ended inside the last turn announced, or at its end; no turn opened at or after it.
    const turns = tap.messages.filter((x): x is TurnStateMsg => x.kind === 'turnState');
    const last = turns.at(-1)!;
    expect(end.atGame).toBeGreaterThan(last.startsAt);
    expect(end.atGame).toBeLessThanOrEqual(last.endsAt);
    expect(turns.every((x) => x.startsAt < end.atGame)).toBe(true);
    // Decided at a minute the clock shows, not a fraction of a second into a phantom next turn (#429).
    expect(end.atGame % 60_000).toBe(0);
    // Nothing about a turn follows the game over, and the clock stands stopped at its time.
    expect(tap.messages.slice(tap.messages.indexOf(end)).some((x) => x.kind === 'turnState')).toBe(
      false,
    );
    const clocks = tap.messages.filter((x) => x.kind === 'clockState');
    expect(clocks.at(-1)).toMatchObject({
      clock: { status: 'stopped', gameMsAtAnchor: end.atGame },
    });
    // The decisive turn's ruling is the last paper in the in-tray.
    const papers = tap.messages.flatMap((x) => (x.kind === 'dispatch' ? [x.dispatch] : []));
    expect(papers.at(-1)).toMatchObject({
      from: "The umpire's ruling",
      receivedAtGame: end.atGame,
    });
    app!.hub.closeAll();
  });
});

describe('the turn umpire in the app (D39, 11.6)', () => {
  /** The canned umpire, keeping every request it was sent. */
  const counting = () => {
    const requests: UmpireRequest[] = [];
    const inner = createUmpireClient({
      config: umpireConfigFromEnv({ UMPIRE_PROVIDER: 'test' }),
      env: {},
    });
    const client: UmpireClient = {
      call: (r) => {
        requests.push(r);
        return inner.call(r);
      },
    };
    return { requests, client };
  };

  const playOneTurn = async (t: Table) => {
    const lead = await Tap.open(t.url, t.lead);
    const red = await Tap.open(t.url, t.red);
    await lead.until(lastTurn);
    lead.send({
      kind: 'holdTurnOrder',
      order: { orderId: 'o1', to: 'blue-1', text: 'March to the bridge and hold it' },
    });
    await lead.until((m) => (lastTurn(m)?.held.length === 1 ? true : undefined));
    red.send({ kind: 'sendTurn' });
    lead.send({ kind: 'sendTurn' });
    await lead.until((m) => (lastTurn(m)?.turn === 2 ? true : undefined));
    const log = await store.inputLog(t.id);
    return { log, lead, red };
  };

  it('adjudicates a standard turn with the umpire, and sends each side its own papers (11.9)', async () => {
    const { requests, client } = counting();
    const t = await startedTable({ adjudicator: () => client });
    const { log, red, lead } = await playOneTurn(t);
    // One adjudicate call, then one report call per side.
    expect(requests.map((r) => r.stage)).toEqual(['adjudicate', 'narrate', 'narrate']);
    const turn = log.find((e) => e.command.kind === 'resolveTurn')!;
    expect(turn.turn!.adjudicator).toBe('umpire');
    expect(turn.calls).toHaveLength(1);
    const reported = log.filter((e) => e.command.kind === 'turnReports');
    expect(reported.map((e) => (e.command as { side: string }).side).sort()).toEqual([
      'blue',
      'red',
    ]);
    for (const e of reported) {
      expect(e.calls).toHaveLength(1);
      expect(e.narrated!.length).toBeGreaterThan(0);
    }
    // The turn's papers reach each in-tray at the turn's end, in the units' own narrated words:
    // the canned umpire's account of each of the side's own units ("... staff tables direct").
    const { units } = loadScenario(holdTheBridge);
    for (const [tap, side] of [
      [lead, 'blue'],
      [red, 'red'],
    ] as const) {
      const papers = await tap.until((m) => {
        const got = m.flatMap((x) =>
          x.kind === 'dispatch' && x.dispatch.kind === 'turn' ? [x.dispatch] : [],
        );
        return got.length > 0 ? got : undefined;
      });
      const own = units.filter((u) => u.side === side).map((u) => u.name);
      for (const d of papers as Dispatch[]) {
        expect(own).toContain(d.from);
        expect(d.writtenAtGame).toBe(turn.turn!.endMs);
        expect(d.receivedAtGame).toBe(turn.turn!.endMs);
        expect(d.text).toContain('staff tables');
      }
      // The proposal's summary is master state, and no paper names the other side's units.
      const sent = JSON.stringify(tap.messages);
      expect(sent).not.toContain('resolved by the tables');
      for (const u of units.filter((x) => x.side !== side)) expect(sent).not.toContain(u.name);
    }
    app!.hub.closeAll();
  });

  it('keeps a rigid turn on the engine: no adjudicate call', async () => {
    const { requests, client } = counting();
    const t = await startedTable({ adjudicator: () => client, dial: 'rigid' });
    const { log } = await playOneTurn(t);
    expect(requests).toEqual([]);
    expect(log.find((e) => e.command.kind === 'resolveTurn')!.turn!.adjudicator).toBe('engine');
    app!.hub.closeAll();
  });

  it('keeps every turn on the engine with no adjudicator configured (the keyless demo)', async () => {
    const t = await startedTable();
    const { log } = await playOneTurn(t);
    expect(log.find((e) => e.command.kind === 'resolveTurn')!.turn!.adjudicator).toBe('engine');
    app!.hub.closeAll();
  });
});

describe('turn internals reach no player before the game ends (D39, 11.11)', () => {
  const CANARY = 'CANARY-TURN-PANEL-4417';
  const TOKEN = 'admin-token-11-11';
  /** The canned umpire, with a canary in every summary and precedent. */
  const canary = (): UmpireClient => {
    const inner = createUmpireClient({
      config: umpireConfigFromEnv({ UMPIRE_PROVIDER: 'test' }),
      env: {},
    });
    return {
      call: async <T>(r: UmpireRequest) => {
        const res = await inner.call<T>(r);
        if (r.stage !== 'adjudicate') return res;
        const output = {
          ...(res.output as object),
          summary: `The umpire's own account. ${CANARY}.`,
          precedents: [`A standing ruling. ${CANARY}.`],
        } as T;
        return { output, record: { ...res.record, rawOutput: JSON.stringify(output) } };
      },
    };
  };

  it('keeps the Turn panel behind the admin gate and the window behind game over', async () => {
    const t = await startedTable({ adjudicator: canary, admin: { enabled: true, token: TOKEN } });
    const lead = await Tap.open(t.url, t.lead);
    const red = await Tap.open(t.url, t.red);
    await lead.until(lastTurn);
    red.send({ kind: 'sendTurn' });
    lead.send({ kind: 'sendTurn' });
    await lead.until((m) => (lastTurn(m)?.turn === 2 ? true : undefined));
    const resolved = (await store.inputLog(t.id)).find((e) => e.command.kind === 'resolveTurn')!;
    expect(resolved.turn!.adjudicator).toBe('umpire');

    // Mid-game, a seated player gets none of the window's routes.
    for (const cookie of [t.lead, t.red, t.cos, t.intel]) {
      for (const path of [
        'window',
        'window/at?at=0',
        'window/at?at=1200000',
        'window/dissents',
        'critique',
      ]) {
        const res = await fetch(`${t.base}/games/${t.id}/${path}`, { headers: { cookie } });
        expect(res.status, path).toBe(403);
        expect(await res.json()).toEqual({ error: 'game_not_over' });
      }
    }
    // The admin Turn panel is the admin API's: a player's session is no key to it from outside,
    // nor through a proxy on the same host.
    const turns = `/admin/api/games/${t.id}/turns`;
    const inject = (remoteAddress: string, headers: Record<string, string> = {}) =>
      app!.server.inject({ method: 'GET', url: turns, remoteAddress, headers });
    expect((await inject('203.0.113.9', { cookie: t.lead })).statusCode).toBe(401);
    expect(
      (await inject('127.0.0.1', { cookie: t.lead, 'x-forwarded-for': '203.0.113.9' })).statusCode,
    ).toBe(401);
    const admin = await inject('203.0.113.9', { authorization: `Bearer ${TOKEN}` });
    expect(admin.statusCode).toBe(200);
    expect(admin.body).toContain(CANARY);
    // Nothing of it reached a player's socket or game record.
    for (const tap of [lead, red]) expect(JSON.stringify(tap.messages)).not.toContain(CANARY);
    for (const cookie of [t.lead, t.red]) {
      const game = await fetch(`${t.base}/games/${t.id}`, { headers: { cookie } });
      expect(await game.text()).not.toContain(CANARY);
    }

    // Once the game is over the window shows each turn, the umpire's account and its log.
    const actor = app!.host.get(t.id)!;
    for (let n = 2; n < 10 && !actor.state.world.outcome; n++) {
      red.send({ kind: 'sendTurn' });
      lead.send({ kind: 'sendTurn' });
      await lead.until((m) =>
        lastTurn(m)?.turn === n + 1 || m.some((x) => x.kind === 'gameOver') ? true : undefined,
      );
    }
    expect(actor.state.world.outcome).toBeTruthy();
    const window = await fetch(`${t.base}/games/${t.id}/window`, { headers: { cookie: t.red } });
    expect(window.status).toBe(200);
    const tl = (await window.json()) as {
      turns: Array<{ n: number; summary?: string; journal?: { notes: unknown[] } }>;
      marks: Array<{ kind: string }>;
    };
    expect(tl.turns.map((x) => x.n)).toEqual(tl.turns.map((_, i) => i + 1));
    expect(tl.turns[0]!.summary).toContain(CANARY);
    expect(tl.turns[0]!.journal!.notes).toHaveLength(1);
    expect(tl.marks.filter((m) => m.kind === 'turn').length).toBe(tl.turns.length * 2);
    app!.hub.closeAll();
  });
});
