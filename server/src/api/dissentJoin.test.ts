import { afterEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, parseServerMessage, type ServerMessage } from '@kriegsspiel/protocol';
import { MemoryGameStore } from '../game/index.js';
import { StubOrderParser } from '../orders/stubParser.js';
import { buildApp, type App } from './app.js';

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
  sub: string;
}

/** A started game: blue's commander, chief of staff, intelligence and a subordinate (blue-2), and red's player. */
async function startedTable(): Promise<Table> {
  store = new MemoryGameStore();
  app = await buildApp({ parser: new StubOrderParser(), store, auth: { mailer } });
  const base = await app.server.listen({ port: 0, host: '127.0.0.1' });
  const [lead, red, cos, intel, sub] = await Promise.all(
    ['lead', 'red', 'cos', 'intel', 'sub'].map((n) => signIn(base, `${n}@example.test`)),
  );
  const created = await fetch(
    `${base}/games`,
    post(lead!, { lobby: true, rate: RATE, sessionType: 'team_vs_team', side: 'blue' }),
  );
  const { id } = (await created.json()) as { id: string };
  const j = (cookie: string, body: unknown) =>
    fetch(`${base}/games/${id}/join`, post(cookie, body));
  expect((await j(red!, { side: 'red' })).status).toBe(200);
  expect((await j(cos!, { side: 'blue', role: 'chiefOfStaff' })).status).toBe(200);
  expect((await j(intel!, { side: 'blue', role: 'intelligence' })).status).toBe(200);
  expect((await j(sub!, { side: 'blue', role: 'subordinate', units: ['blue-2'] })).status).toBe(
    200,
  );
  for (const c of [red!, cos!, intel!, sub!]) {
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
    sub: sub!,
  };
}

/** The commander signs an order and waits until the side has it on record. */
async function sign(lead: Tap, orderId: string): Promise<void> {
  lead.send({ kind: 'issueOrder', orderId, text: 'blue-1 march to the bridge' });
  await lead.until((m) =>
    m.find((x) => x.kind === 'dispatch' && x.dispatch.text.includes('your orders')),
  );
}

describe('dissent on a signed order', () => {
  it("records a teammate's dissent for the side, refuses the signer and unknown orders", async () => {
    const t = await startedTable();
    const lead = await Tap.open(t.url, t.lead);
    const cos = await Tap.open(t.url, t.cos);
    const red = await Tap.open(t.url, t.red);
    const intel = await Tap.open(t.url, t.intel);
    await Promise.all(
      [lead, cos].map((c) => c.until((m) => m.find((x) => x.kind === 'viewUpdate'))),
    );
    await sign(lead, 'l1');

    cos.send({ kind: 'dissent', dissentId: 'd1', orderId: 'l1', body: 'The bridge is mined.' });
    for (const tap of [lead, cos]) {
      const got = await tap.until((m) => m.find((x) => x.kind === 'dissents'));
      expect(got).toMatchObject({
        dissents: [{ id: 'd1', orderId: 'l1', seat: 'chiefOfStaff', body: 'The bridge is mined.' }],
      });
    }

    lead.send({ kind: 'dissent', dissentId: 'd2', orderId: 'l1', body: 'I disagree with myself.' });
    expect(await lead.until((m) => m.find((x) => x.kind === 'error'))).toMatchObject({
      code: 'own_order',
    });
    cos.send({ kind: 'dissent', dissentId: 'd3', orderId: 'nope', body: 'x' });
    await cos.until((m) => m.find((x) => x.kind === 'error' && x.code === 'no_such_order'));
    cos.send({ kind: 'dissent', dissentId: 'd1', orderId: 'l1', body: 'again' });
    await cos.until((m) => m.find((x) => x.kind === 'error' && x.code === 'bad_dissent'));

    // The other side never hears of it, and intelligence, who sees no orders, may neither file nor read.
    expect(red.messages.some((m) => m.kind === 'dissents')).toBe(false);
    intel.send({ kind: 'dissent', dissentId: 'd4', orderId: 'l1', body: 'x' });
    await intel.until((m) => m.find((x) => x.kind === 'error' && x.code === 'not_permitted'));
    expect(intel.messages.some((m) => m.kind === 'dissents')).toBe(false);

    // It is in the input log as a journal-only entry.
    const log = await store.inputLog(t.id);
    expect(log.filter((e) => e.command.kind === 'dissent')).toHaveLength(1);
    app!.hub.closeAll();
  });
});

describe('joining a role mid-game', () => {
  it("seats a new player in a vacated role with a briefing from the seat's journal", async () => {
    const t = await startedTable();
    const lead = await Tap.open(t.url, t.lead);
    const cos = await Tap.open(t.url, t.cos);
    await Promise.all(
      [lead, cos].map((c) => c.until((m) => m.find((x) => x.kind === 'viewUpdate'))),
    );
    await sign(lead, 'l1');
    cos.send({ kind: 'dissent', dissentId: 'd1', orderId: 'l1', body: 'The bridge is mined.' });
    await cos.until((m) => m.find((x) => x.kind === 'dissents'));
    cos.send({
      kind: 'createDraft',
      draft: 'dr1',
      title: 'Ford plan',
      text: 'blue-1 cross the ford',
    });
    await cos.until((m) => m.find((x) => x.kind === 'draftState'));

    const cos2 = await signIn(t.base, 'cos2@example.test');
    const join = (cookie: string, body: unknown) =>
      fetch(`${t.base}/games/${t.id}/join`, post(cookie, body));
    // The chair is taken until its holder leaves.
    expect((await join(cos2, { side: 'blue', role: 'chiefOfStaff' })).status).toBe(409);
    expect((await fetch(`${t.base}/games/${t.id}/leave-role`, post(t.cos))).status).toBe(200);
    const joined = await join(cos2, { side: 'blue', role: 'chiefOfStaff' });
    expect(joined.status).toBe(200);
    expect(await joined.json()).toMatchObject({ role: 'chiefOfStaff', midGame: true });

    const fresh = await Tap.open(t.url, cos2);
    const found = await fresh.until((m) => m.find((x) => x.kind === 'briefing'));
    const items = (found as { briefing: { items: Array<{ text: string }> } }).briefing.items;
    const text = items.map((i) => i.text).join('\n');
    expect(text).toContain('Dissented from');
    expect(text).toContain('The bridge is mined.');
    expect(text).toContain('Ford plan');
    const view = await fresh.until((m) => m.find((x) => x.kind === 'viewUpdate'));
    expect((view as { view: { role?: string } }).view.role).toBe('chiefOfStaff');
    // The commander, who joined no seat mid-game, is given no briefing.
    expect(lead.messages.some((m) => m.kind === 'briefing')).toBe(false);
    app!.hub.closeAll();
  });

  it('seats a free role at once and keeps one holder per staff role', async () => {
    const t = await startedTable();
    const q = await signIn(t.base, 'qm@example.test');
    const take = (cookie: string) =>
      fetch(`${t.base}/games/${t.id}/join`, post(cookie, { side: 'blue', role: 'quartermaster' }));
    expect((await take(q)).status).toBe(200);
    expect((await take(await signIn(t.base, 'qm2@example.test'))).status).toBe(409);
    app!.hub.closeAll();
  });
});
