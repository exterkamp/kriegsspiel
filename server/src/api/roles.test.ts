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

async function start() {
  store = new MemoryGameStore();
  app = await buildApp({ parser: new StubOrderParser(), store, auth: { mailer } });
  const base = await app.server.listen({ port: 0, host: '127.0.0.1' });
  return { base, ws: base.replace('http', 'ws') };
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
  lastView() {
    const views = this.messages.flatMap((m) => (m.kind === 'viewUpdate' ? [m.view] : []));
    return views.at(-1);
  }
}

interface Table {
  base: string;
  ws: string;
  id: string;
  lead: string;
  red: string;
  cos: string;
  intel: string;
  sub: string;
}

/** A lobby game with blue's commander, red's player, and three more blue players, not yet started. */
async function lobbyTable(hierarchy?: 'shared' | 'chain'): Promise<Table> {
  const { base, ws } = await start();
  const [lead, red, cos, intel, sub] = await Promise.all(
    ['lead', 'red', 'cos', 'intel', 'sub'].map((n) => signIn(base, `${n}@example.test`)),
  );
  const created = await fetch(
    `${base}/games`,
    post(lead!, {
      lobby: true,
      rate: RATE,
      sessionType: 'team_vs_team',
      side: 'blue',
      ...(hierarchy ? { hierarchy } : {}),
    }),
  );
  const { id } = (await created.json()) as { id: string };
  expect((await fetch(`${base}/games/${id}/join`, post(red!, { side: 'red' }))).status).toBe(200);
  return { base, ws, id, lead: lead!, red: red!, cos: cos!, intel: intel!, sub: sub! };
}

async function startTable(t: Table) {
  const j = (cookie: string, body: unknown) =>
    fetch(`${t.base}/games/${t.id}/join`, post(cookie, body));
  expect((await j(t.cos, { side: 'blue', role: 'chiefOfStaff' })).status).toBe(200);
  expect((await j(t.intel, { side: 'blue', role: 'intelligence' })).status).toBe(200);
  expect((await j(t.sub, { side: 'blue', role: 'subordinate', units: ['blue-2'] })).status).toBe(
    200,
  );
  for (const c of [t.red, t.cos, t.intel, t.sub]) {
    await fetch(`${t.base}/games/${t.id}/ready`, post(c, { ready: true }));
  }
  const started = await fetch(`${t.base}/games/${t.id}/start`, post(t.lead));
  expect(started.status).toBe(200);
}

describe('roles in the lobby', () => {
  it('seats staff and subordinates beside the commander and tells each their role', async () => {
    const t = await lobbyTable();
    const j = (cookie: string, body: unknown) =>
      fetch(`${t.base}/games/${t.id}/join`, post(cookie, body));

    expect((await j(t.cos, { side: 'blue', role: 'chiefOfStaff' })).status).toBe(200);
    // One chief of staff to a side.
    expect((await j(t.intel, { side: 'blue', role: 'chiefOfStaff' })).status).toBe(409);
    // A subordinate names units of their side that nobody else commands.
    expect((await j(t.intel, { side: 'blue', role: 'subordinate' })).status).toBe(400);
    expect((await j(t.intel, { side: 'blue', role: 'subordinate', units: ['red-1'] })).status).toBe(
      400,
    );
    expect(
      (await j(t.intel, { side: 'blue', role: 'intelligence', units: ['blue-1'] })).status,
    ).toBe(400);
    expect(
      (await j(t.intel, { side: 'blue', role: 'subordinate', units: ['blue-2'] })).status,
    ).toBe(200);
    expect((await j(t.sub, { side: 'blue', role: 'subordinate', units: ['blue-2'] })).status).toBe(
      409,
    );

    const info = (await (await fetch(`${t.base}/games/${t.id}`, get(t.intel))).json()) as {
      role: string;
      sides: Array<{
        side: string;
        roles: Array<{ role: string; units?: string[]; you: boolean }>;
      }>;
    };
    expect(info.role).toBe('subordinate');
    expect(info.sides[0]!.roles).toEqual([
      { role: 'chiefOfStaff', you: false },
      { role: 'subordinate', units: ['blue-2'], you: true },
    ]);
    const lead = (await (await fetch(`${t.base}/games/${t.id}`, get(t.lead))).json()) as {
      role: string | null;
    };
    expect(lead.role).toBe('commander');
    expect(JSON.stringify(info)).not.toContain('example.test');

    // Giving the role up frees it.
    expect((await fetch(`${t.base}/games/${t.id}/leave-role`, post(t.intel))).status).toBe(200);
    expect((await j(t.sub, { side: 'blue', role: 'subordinate', units: ['blue-2'] })).status).toBe(
      200,
    );
  });

  it('needs the commander first, and waits for every role holder to be ready', async () => {
    const t = await lobbyTable();
    const j = (cookie: string, body: unknown) =>
      fetch(`${t.base}/games/${t.id}/join`, post(cookie, body));
    const lone = (await (
      await fetch(`${t.base}/games`, post(t.lead, { lobby: true, side: 'blue' }))
    ).json()) as { id: string };
    expect(
      (
        await fetch(
          `${t.base}/games/${lone.id}/join`,
          post(t.cos, { side: 'red', role: 'chiefOfStaff' }),
        )
      ).status,
    ).toBe(409);

    await j(t.cos, { side: 'blue', role: 'chiefOfStaff' });
    await fetch(`${t.base}/games/${t.id}/ready`, post(t.red, { ready: true }));
    const early = await fetch(`${t.base}/games/${t.id}/start`, post(t.lead));
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({ error: 'not_ready', sides: ['blue'] });
    await fetch(`${t.base}/games/${t.id}/ready`, post(t.cos, { ready: true }));
    expect((await fetch(`${t.base}/games/${t.id}/start`, post(t.lead))).status).toBe(200);
    // A free role can still be taken after the start (D6e), but only by one player.
    const mid = await j(t.intel, { side: 'blue', role: 'intelligence' });
    expect(mid.status).toBe(200);
    expect(await mid.json()).toMatchObject({ midGame: true });
    expect((await j(t.sub, { side: 'blue', role: 'intelligence' })).status).toBe(409);
    app!.hub.closeAll();
  });
});

describe('role views over the WebSocket', () => {
  it('sends each player the view cut for their role, and shared HQ the whole view', async () => {
    const t = await lobbyTable();
    await startTable(t);
    const url = `${t.ws}/games/${t.id}/ws`;
    const [lead, intel, sub, red] = await Promise.all([
      Tap.open(url, t.lead),
      Tap.open(url, t.intel),
      Tap.open(url, t.sub),
      Tap.open(url, t.red),
    ]);
    const [leadV, intelV, subV, redV] = await Promise.all(
      [lead, intel, sub, red].map(async (c) => {
        await c.until((m) => m.find((x) => x.kind === 'viewUpdate'));
        return c.lastView()!;
      }),
    );

    expect(leadV!.role).toBe('commander');
    expect(leadV!.ownUnits.map((u) => u.id)).toEqual(['blue-1', 'blue-2', 'blue-3']);
    expect(leadV!.ownUnits.every((u) => u.strength !== undefined)).toBe(true);
    expect(leadV!.ownUnits.every((u) => u.reportedAt === leadV!.atGame)).toBe(true);

    expect(intelV!.role).toBe('intelligence');
    expect(intelV!.ownUnits).toHaveLength(3);
    for (const u of intelV!.ownUnits) {
      expect(u.strength).toBeUndefined();
      expect(u.morale).toBeUndefined();
      expect(u.supply).toBeUndefined();
      expect(u.reportedAt).toBeUndefined();
      // The commander's absence from the outline is pinned in engine roles.test.ts (this scenario names none).
    }

    expect(subV!.role).toBe('subordinate');
    expect(subV!.ownUnits.map((u) => u.id)).toEqual(['blue-2']);
    // Red's side has no role holders: it plays shared HQ and is sent the plain view.
    expect(redV!.role).toBeUndefined();
    expect(redV!.ownUnits).toHaveLength(3);
    app!.hub.closeAll();
  });

  it('keeps a side with no roles on the plain side view', async () => {
    const { base, ws } = await start();
    const a = await signIn(base, 'a@example.test');
    const made = (await (
      await fetch(`${base}/games`, post(a, { rate: RATE, sessionType: 'team_vs_team' }))
    ).json()) as { id: string };
    const tap = await Tap.open(`${ws}/games/${made.id}/ws`, a);
    const view = await tap.until((m) => m.find((x) => x.kind === 'viewUpdate'));
    expect('role' in (view as { view: object }).view).toBe(false);
  });
});

describe('who may sign', () => {
  it('refuses staff, and a subordinate for units they do not command', async () => {
    const t = await lobbyTable();
    await startTable(t);
    const url = `${t.ws}/games/${t.id}/ws`;
    const cos = await Tap.open(url, t.cos);
    const sub = await Tap.open(url, t.sub);
    const lead = await Tap.open(url, t.lead);
    await Promise.all(
      [cos, sub, lead].map((c) => c.until((m) => m.find((x) => x.kind === 'viewUpdate'))),
    );

    cos.send({ kind: 'issueOrder', orderId: 'c1', text: 'blue-1 march to the bridge' });
    const refused = await cos.until((m) => m.find((x) => x.kind === 'error'));
    expect(refused).toMatchObject({ code: 'not_permitted' });

    sub.send({ kind: 'issueOrder', orderId: 's1', text: 'blue-1 march to the bridge' });
    const rejected = await sub.until((m) => m.find((x) => x.kind === 'error'));
    expect(rejected).toMatchObject({ code: 'order_rejected' });
    expect((rejected as { message: string }).message).toContain('may not sign');

    // The refusal is what the log holds, so a replay does not send the order either.
    const log = await store.inputLog(t.id);
    const entry = log.find((e) => e.command.kind === 'order')!;
    expect(entry.parse).toMatchObject({ kind: 'rejection' });

    // Their own formation, and the commander for any, go through.
    sub.send({ kind: 'issueOrder', orderId: 's2', text: 'blue-2 march to the bridge' });
    lead.send({ kind: 'issueOrder', orderId: 'l1', text: 'blue-1 march to the bridge' });
    await lead.until((m) =>
      m.find((x) => x.kind === 'dispatch' && x.dispatch.text.includes('received its orders')),
    );
    await sub.until((m) =>
      m.find(
        (x) =>
          x.kind === 'dispatch' &&
          x.dispatch.text.includes('received its orders') &&
          x.dispatch.from.includes('2'),
      ),
    );
    expect(sub.messages.filter((m) => m.kind === 'error')).toHaveLength(1);
    app!.hub.closeAll();
  });
});

describe('forwarding from HQ', () => {
  it('shows a subordinate only the papers HQ passed to their formation', async () => {
    const t = await lobbyTable();
    await startTable(t);
    const url = `${t.ws}/games/${t.id}/ws`;
    const lead = await Tap.open(url, t.lead);
    const cos = await Tap.open(url, t.cos);
    const sub = await Tap.open(url, t.sub);
    const intel = await Tap.open(url, t.intel);
    await Promise.all(
      [lead, cos, sub, intel].map((c) => c.until((m) => m.find((x) => x.kind === 'viewUpdate'))),
    );

    // blue-1 receives an order and reports back to HQ: a paper the subordinate of blue-2 never saw.
    lead.send({ kind: 'issueOrder', orderId: 'l1', text: 'blue-1 march to the bridge' });
    const paper = await lead.until((m) =>
      m.find((x) => x.kind === 'dispatch' && x.dispatch.text.includes('received its orders')),
    );
    const id = (paper as { dispatch: { id: string } }).dispatch.id;
    await sub.until((m) => (sub.lastView() && m.length > 0 ? true : undefined));
    expect(sub.lastView()!.dispatches.map((d) => d.id)).not.toContain(id);

    // Only HQ forwards, only to a formation of their own side, only what they hold themselves.
    intel.send({ kind: 'forwardDispatch', dispatchId: id, unit: 'blue-2' });
    expect(await intel.until((m) => m.find((x) => x.kind === 'error'))).toMatchObject({
      code: 'not_permitted',
    });
    lead.send({ kind: 'forwardDispatch', dispatchId: 'nope', unit: 'blue-2' });
    expect(await lead.until((m) => m.find((x) => x.kind === 'error'))).toMatchObject({
      code: 'no_such_dispatch',
    });

    // A unit of the other side, or none at all, cannot be the addressee.
    for (const unit of ['red-1', 'nowhere']) {
      const before = lead.messages.filter((x) => x.kind === 'error').length;
      lead.send({ kind: 'forwardDispatch', dispatchId: id, unit });
      await lead.until((m) =>
        m.filter((x) => x.kind === 'error').length > before ? true : undefined,
      );
      expect(lead.messages.filter((x) => x.kind === 'error').at(-1)).toMatchObject({
        code: 'bad_unit',
      });
    }

    // A paper forwarded to a formation this subordinate does not command (blue-3) stays away from them.
    cos.send({ kind: 'forwardDispatch', dispatchId: id, unit: 'blue-3' });
    const seen = sub.messages.length;
    await lead.until((m) => (lead.lastView() && m.length > 0 ? true : undefined));
    await new Promise((r) => setTimeout(r, 300));
    expect(sub.lastView()!.dispatches.map((d) => d.id)).not.toContain(id);
    expect(
      sub.messages.slice(seen).some((x) => x.kind === 'dispatch' && x.dispatch.id === id),
    ).toBe(false);

    cos.send({ kind: 'forwardDispatch', dispatchId: id, unit: 'blue-2' });
    const forwarded = await sub.until((m) =>
      m.find((x) => x.kind === 'dispatch' && x.dispatch.id === id),
    );
    expect(forwarded).toBeDefined();
    expect(sub.lastView()!.dispatches.map((d) => d.id)).toContain(id);
    // It reached the subordinate and nobody else new: the staff view of blue-1's unit is unchanged.
    expect(sub.lastView()!.ownUnits.map((u) => u.id)).toEqual(['blue-2']);
    app!.hub.closeAll();
  });
});

describe('forwarding up the chain of command', () => {
  async function seated(hierarchy: 'shared' | 'chain') {
    const t = await lobbyTable(hierarchy);
    await startTable(t);
    const url = `${t.ws}/games/${t.id}/ws`;
    const lead = await Tap.open(url, t.lead);
    const cos = await Tap.open(url, t.cos);
    const sub = await Tap.open(url, t.sub);
    await Promise.all(
      [lead, cos, sub].map((c) => c.until((m) => m.find((x) => x.kind === 'viewUpdate'))),
    );
    // The subordinate's formation receives an order and files a report.
    lead.send({ kind: 'issueOrder', orderId: 'u1', text: 'blue-2 march to the bridge' });
    const filed = await sub.until((m) =>
      m.find((x) => x.kind === 'dispatch' && x.dispatch.text.includes('received its orders')),
    );
    return { lead, cos, sub, id: (filed as { dispatch: { id: string } }).dispatch.id };
  }
  const settle = () => new Promise((r) => setTimeout(r, 300));

  it('keeps a subordinate report off HQ desks until the subordinate forwards it', async () => {
    const { lead, cos, sub, id } = await seated('chain');
    await settle();
    for (const hq of [lead, cos]) {
      expect(hq.lastView()!.dispatches.map((d) => d.id)).not.toContain(id);
      expect(hq.messages.some((x) => x.kind === 'dispatch' && x.dispatch.id === id)).toBe(false);
    }

    // Only a subordinate sends reports up, and only their own formation's.
    lead.send({ kind: 'forwardReport', reportId: id });
    expect(await lead.until((m) => m.find((x) => x.kind === 'error'))).toMatchObject({
      code: 'not_permitted',
    });
    sub.send({ kind: 'forwardReport', reportId: 'nope' });
    expect(await sub.until((m) => m.find((x) => x.kind === 'error'))).toMatchObject({
      code: 'no_such_dispatch',
    });

    sub.send({ kind: 'forwardReport', reportId: id });
    // It takes game time to ride to HQ, then arrives.
    const arrived = await lead.until((m) =>
      m.find((x) => x.kind === 'dispatch' && x.dispatch.id === id),
    );
    expect(arrived).toBeDefined();
    expect(lead.lastView()!.dispatches.map((d) => d.id)).toContain(id);
    app!.hub.closeAll();
  });

  it('shows HQ the same report at once in shared HQ', async () => {
    const { lead, id } = await seated('shared');
    expect(
      await lead.until((m) => m.find((x) => x.kind === 'dispatch' && x.dispatch.id === id)),
    ).toBeDefined();
    app!.hub.closeAll();
  });
});

describe('signing a shared draft', () => {
  const draftOf = (tap: Tap, id: string) =>
    tap.messages
      .flatMap((m) => (m.kind === 'draftState' ? [m.draft] : []))
      .filter((d) => d.id === id)
      .at(-1);

  async function seated(t: Table) {
    await startTable(t);
    const url = `${t.ws}/games/${t.id}/ws`;
    const taps = {
      cos: await Tap.open(url, t.cos),
      sub: await Tap.open(url, t.sub),
      lead: await Tap.open(url, t.lead),
    };
    await Promise.all(
      Object.values(taps).map((c) => c.until((m) => m.find((x) => x.kind === 'viewUpdate'))),
    );
    return taps;
  }

  it('lets staff propose but only the commander stamp, and closes a draft once sent', async () => {
    const t = await lobbyTable();
    const { cos, sub, lead } = await seated(t);
    cos.send({ kind: 'createDraft', draft: 'd1', text: 'blue-1 march to the bridge' });
    await lead.until((m) => m.find((x) => x.kind === 'draftState' && x.draft.id === 'd1'));

    cos.send({ kind: 'issueOrder', orderId: 'c1', draft: 'd1' });
    expect(await cos.until((m) => m.find((x) => x.kind === 'error'))).toMatchObject({
      code: 'not_permitted',
    });
    // A subordinate may not stamp an order to a formation they do not command either.
    sub.send({ kind: 'issueOrder', orderId: 's1', draft: 'd1' });
    const rejected = await sub.until((m) => m.find((x) => x.kind === 'error'));
    expect(rejected).toMatchObject({ code: 'order_rejected' });
    expect((await store.inputLog(t.id)).filter((e) => e.command.kind === 'order')).toHaveLength(1);
    expect(draftOf(lead, 'd1')?.sent).toBeUndefined();

    lead.send({ kind: 'issueOrder', orderId: 'l1', draft: 'd1' });
    const sent = await lead.until((m) => {
      const d = m.flatMap((x) => (x.kind === 'draftState' ? [x.draft] : [])).at(-1);
      return d?.sent ? d : undefined;
    });
    expect(sent.sent).toMatchObject({ orderId: 'l1', role: 'commander' });
    // The order logged is the draft's wording, so a replay needs no draft.
    const logged = (await store.inputLog(t.id)).filter((e) => e.command.kind === 'order');
    expect(logged.at(-1)!.command).toMatchObject({
      text: 'blue-1 march to the bridge',
      signer: { role: 'commander' },
    });

    // Sent: no more edits from anyone, and it cannot be stamped twice.
    cos.send({ kind: 'draftEdit', draft: 'd1', baseRev: 0, op: [26, ' now'], opId: 'e1' });
    await cos.until((m) => m.find((x) => x.kind === 'error' && x.code === 'draft_sent'));
    lead.send({ kind: 'issueOrder', orderId: 'l2', draft: 'd1' });
    await lead.until((m) => m.find((x) => x.kind === 'error' && x.code === 'draft_sent'));
    app!.hub.closeAll();
  });

  it('lets a subordinate stamp a draft for their own formation', async () => {
    const t = await lobbyTable();
    const { cos, sub } = await seated(t);
    cos.send({ kind: 'createDraft', draft: 'd2', text: 'blue-2 march to the bridge' });
    await sub.until((m) => m.find((x) => x.kind === 'draftState' && x.draft.id === 'd2'));
    sub.send({ kind: 'issueOrder', orderId: 's2', draft: 'd2' });
    const d = await sub.until((m) =>
      m.find((x) => x.kind === 'draftState' && x.draft.id === 'd2' && x.draft.sent),
    );
    expect(d).toMatchObject({ draft: { sent: { role: 'subordinate', orderId: 's2' } } });
    app!.hub.closeAll();
  });

  it('moves authority with the role: a new seat applies at once and a lost one is cut off', async () => {
    const t = await lobbyTable();
    const { cos, sub } = await seated(t);
    const rec = app!.lobby.get(t.id)!;
    const subRole = rec.roles!.find((r) => r.role === 'subordinate')!;
    const cosRole = rec.roles!.find((r) => r.role === 'chiefOfStaff')!;

    // The subordinate now commands blue-1 instead: the same socket may sign for it, not for blue-2.
    app!.lobby.put({
      ...rec,
      roles: rec.roles!.map((r) => (r === subRole ? { ...r, units: ['blue-1'] } : r)),
    });
    sub.send({ kind: 'issueOrder', orderId: 'n1', text: 'blue-2 march to the bridge' });
    expect(await sub.until((m) => m.find((x) => x.kind === 'error'))).toMatchObject({
      code: 'order_rejected',
    });
    sub.send({ kind: 'issueOrder', orderId: 'n2', text: 'blue-1 march to the bridge' });
    await sub.until((m) => m.find((x) => x.kind === 'dispatch' && x.dispatch.from.includes('1')));

    // The chief of staff's role goes to someone else: the old holder's socket is closed, not
    // left as shared HQ.
    const closed = new Promise<number>((resolve) =>
      cos.socket.addEventListener('close', (e) => resolve(e.code)),
    );
    app!.lobby.put({
      ...app!.lobby.get(t.id)!,
      roles: app!.lobby
        .get(t.id)!
        .roles!.filter((r) => r !== cosRole && r.userId !== cosRole.userId),
    });
    cos.send({ kind: 'issueOrder', orderId: 'x1', text: 'blue-1 march to the bridge' });
    expect(await closed).toBe(1008);
    expect((await store.inputLog(t.id)).filter((e) => e.command.kind === 'order')).toHaveLength(2);
    app!.hub.closeAll();
  });
});
