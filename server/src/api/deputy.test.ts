import { afterEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, parseServerMessage, type ServerMessage } from '@kriegsspiel/protocol';
import { MemoryGameStore } from '../game/index.js';
import { StubOrderParser } from '../orders/stubParser.js';
import type { UmpireClient, UmpireRequest, UmpireResponse } from '../umpire/umpireClient.js';
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
const sockets: WebSocket[] = [];

afterEach(async () => {
  sockets.splice(0).forEach((s) => s.close());
  app?.hub.closeAll();
  await app?.server.close();
  app = undefined;
  mailbox.length = 0;
});

/** A model that has nothing to say; the tests here are about who may appoint a deputy, not what it writes. */
const quiet: UmpireClient = {
  async call<T>(request: UmpireRequest): Promise<UmpireResponse<T>> {
    const output = { orders: [], report: '' };
    return {
      output: output as T,
      record: {
        stage: request.stage,
        model: 'fake',
        promptVersion: request.promptVersion,
        system: request.system,
        input: request.input,
        rawOutput: JSON.stringify(output),
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        costUsd: 0,
        attempts: 1,
      },
    };
  },
};

async function start(narrator?: () => UmpireClient) {
  app = await buildApp({
    parser: new StubOrderParser(),
    store: new MemoryGameStore(),
    auth: { mailer },
    narrator,
  });
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
    return this.messages.flatMap((m) => (m.kind === 'viewUpdate' ? [m.view] : [])).at(-1);
  }
  errors() {
    return this.messages.flatMap((m) => (m.kind === 'error' ? [m.code] : []));
  }
}

/** A started game: blue's commander, chief of staff and a subordinate; red's player. */
async function table() {
  const { base, ws } = await start(() => quiet);
  const [lead, red, cos, sub] = await Promise.all(
    ['lead', 'red', 'cos', 'sub'].map((n) => signIn(base, `${n}@example.test`)),
  );
  const made = await fetch(
    `${base}/games`,
    post(lead!, { lobby: true, rate: RATE, sessionType: 'team_vs_team', side: 'blue' }),
  );
  const { id } = (await made.json()) as { id: string };
  const join = (c: string, body: unknown) => fetch(`${base}/games/${id}/join`, post(c, body));
  await join(red!, { side: 'red' });
  await join(cos!, { side: 'blue', role: 'chiefOfStaff' });
  await join(sub!, { side: 'blue', role: 'subordinate', units: ['blue-2'] });
  for (const c of [red!, cos!, sub!])
    await fetch(`${base}/games/${id}/ready`, post(c, { ready: true }));
  expect((await fetch(`${base}/games/${id}/start`, post(lead!))).status).toBe(200);
  return { url: `${ws}/games/${id}/ws`, id, lead: lead!, cos: cos!, sub: sub! };
}

const settings = { enabled: true, discretion: 'adjust', intent: 'Hold the bridge.' };

describe('appointing a deputy over the WebSocket', () => {
  it('lets only the commander set it, and shows the setting to HQ and not to a subordinate', async () => {
    const t = await table();
    const [lead, cos, sub] = await Promise.all([
      Tap.open(t.url, t.lead),
      Tap.open(t.url, t.cos),
      Tap.open(t.url, t.sub),
    ]);
    for (const c of [lead, cos, sub]) await c.until((m) => m.find((x) => x.kind === 'viewUpdate'));

    cos.send({ kind: 'setDeputy', settings });
    sub.send({ kind: 'setDeputy', settings });
    await cos.until((m) => m.find((x) => x.kind === 'error'));
    await sub.until((m) => m.find((x) => x.kind === 'error'));
    expect(cos.errors()).toEqual(['not_permitted']);
    expect(sub.errors()).toEqual(['not_permitted']);

    lead.send({ kind: 'setDeputy', settings });
    await lead.until((m) => {
      const view = [...m].reverse().find((x) => x.kind === 'viewUpdate');
      return view?.kind === 'viewUpdate' && view.view.deputy ? view : undefined;
    });
    expect(lead.lastView()!.deputy).toEqual({ settings, account: [] });
    expect(lead.errors()).toEqual([]);
    await cos.until((m) =>
      m.some((x) => x.kind === 'viewUpdate' && x.view.deputy !== undefined) ? true : undefined,
    );
    expect(sub.lastView()!.deputy).toBeUndefined();
  });

  it('treats a player with a connection open as present, and one who has left as away', async () => {
    const t = await table();
    const lead = await Tap.open(t.url, t.lead);
    await lead.until((m) => m.find((x) => x.kind === 'viewUpdate'));
    const hub = app!.hub;
    expect(hub.isAway(t.id, 'blue', { role: 'commander' })).toBe(false);
    expect(hub.isAway(t.id, 'blue', { role: 'chiefOfStaff' })).toBe(true);
    lead.socket.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(hub.isAway(t.id, 'blue', { role: 'commander' })).toBe(true);
  });

  it('refuses to appoint one in a game that has no staff to appoint from', async () => {
    const { base, ws } = await start();
    const a = await signIn(base, 'a@example.test');
    const made = (await (
      await fetch(`${base}/games`, post(a, { rate: RATE, sessionType: 'team_vs_team' }))
    ).json()) as { id: string };
    const tap = await Tap.open(`${ws}/games/${made.id}/ws`, a);
    await tap.until((m) => m.find((x) => x.kind === 'viewUpdate'));
    tap.send({ kind: 'setDeputy', settings });
    await tap.until((m) => m.find((x) => x.kind === 'error'));
    expect(tap.errors()).toEqual(['deputy_unavailable']);
  });
});
