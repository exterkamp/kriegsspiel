import { afterEach, describe, expect, it } from 'vitest';
import { MemoryGameStore } from '../game/index.js';
import { StubOrderParser } from '../orders/stubParser.js';
import { buildApp, type App } from './app.js';

const mailbox: Array<{ to: string; link: string }> = [];
const notices: Array<{ to: string; subject: string; text: string }> = [];
const mailer = {
  async sendLoginLink(to: string, link: string) {
    mailbox.push({ to, link });
  },
  async sendNotification(to: string, subject: string, text: string) {
    notices.push({ to, subject, text });
  },
};

let app: App | undefined;

afterEach(async () => {
  await app?.server.close();
  app = undefined;
  mailbox.length = 0;
  notices.length = 0;
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

async function table() {
  app = await buildApp({
    parser: new StubOrderParser(),
    store: new MemoryGameStore(),
    auth: { mailer },
  });
  const base = await app.server.listen({ port: 0, host: '127.0.0.1' });
  const [lead, red, cos] = await Promise.all(
    ['lead', 'red', 'cos'].map((n) => signIn(base, `${n}@example.test`)),
  );
  const { id } = (await (
    await fetch(
      `${base}/games`,
      post(lead!, { lobby: true, rate: 3600, sessionType: 'team_vs_team', side: 'blue' }),
    )
  ).json()) as { id: string };
  const call = (cookie: string, path: string, body?: unknown) =>
    fetch(`${base}/games/${id}/${path}`, post(cookie, body));
  const info = async (cookie: string) =>
    (await (await fetch(`${base}/games/${id}`, { headers: { cookie } })).json()) as {
      you: string | null;
      removed: boolean;
      sides: Array<{ side: string; taken: boolean; ready: boolean }>;
    };
  return { base, id, lead: lead!, red: red!, cos: cos!, call, info };
}

describe('leaving a seat in the lobby', () => {
  it('frees the seat and the ready mark, and lets someone else take it', async () => {
    const t = await table();
    expect((await t.call(t.red, 'join', { side: 'red' })).status).toBe(200);
    await t.call(t.red, 'ready', { ready: true });
    expect((await t.call(t.red, 'leave')).status).toBe(200);
    const after = await t.info(t.lead);
    expect(after.sides.find((s) => s.side === 'red')).toMatchObject({ taken: false, ready: false });
    expect((await t.info(t.red)).you).toBeNull();
    expect((await t.call(t.cos, 'join', { side: 'red' })).status).toBe(200);
    // Nothing left to leave.
    expect((await t.call(t.red, 'leave')).status).toBe(404);
  });

  it('lets a role holder leave, but not the creator, and not once the game has started', async () => {
    const t = await table();
    await t.call(t.red, 'join', { side: 'red' });
    expect((await t.call(t.cos, 'join', { side: 'blue', role: 'chiefOfStaff' })).status).toBe(200);
    expect((await t.call(t.cos, 'leave')).status).toBe(200);
    expect((await t.call(t.lead, 'leave')).status).toBe(409);
    await t.call(t.red, 'ready', { ready: true });
    expect((await t.call(t.lead, 'start')).status).toBe(200);
    const late = await t.call(t.red, 'leave');
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ error: 'already_started' });
  });
});

describe('the creator removing a player', () => {
  it('removes the seat holder, tells them, and keeps them out', async () => {
    const t = await table();
    await t.call(t.red, 'join', { side: 'red' });
    await t.call(t.red, 'ready', { ready: true });
    expect((await t.call(t.lead, 'kick', { side: 'red' })).status).toBe(200);

    const gone = await t.info(t.red);
    expect(gone).toMatchObject({ you: null, removed: true });
    expect((await t.info(t.lead)).sides.find((s) => s.side === 'red')).toMatchObject({
      taken: false,
      ready: false,
    });
    // They cannot come back, in a seat or a role.
    expect((await t.call(t.red, 'join', { side: 'red' })).status).toBe(403);
    expect((await t.call(t.red, 'join', { side: 'blue', role: 'intelligence' })).status).toBe(403);
    // Their views stop: no WebSocket, no ready.
    expect((await t.call(t.red, 'ready', { ready: true })).status).toBe(403);
    const refused = await new Promise<boolean>((resolve) => {
      const socket = new (
        WebSocket as unknown as new (u: string, i: { headers: Record<string, string> }) => WebSocket
      )(`${t.base.replace('http', 'ws')}/games/${t.id}/ws`, { headers: { cookie: t.red } });
      socket.addEventListener('open', () => {
        socket.close();
        resolve(false);
      });
      socket.addEventListener('error', () => resolve(true));
    });
    expect(refused).toBe(true);
    // They were told by email.
    await app!.notifier.flush();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ to: 'red@example.test', subject: 'Removed from the game' });
  });

  it('removes a role holder by role', async () => {
    const t = await table();
    await t.call(t.cos, 'join', { side: 'blue', role: 'chiefOfStaff' });
    expect((await t.call(t.lead, 'kick', { side: 'blue', role: 'chiefOfStaff' })).status).toBe(200);
    expect((await t.info(t.cos)).removed).toBe(true);
    expect((await t.call(t.lead, 'kick', { side: 'blue', role: 'chiefOfStaff' })).status).toBe(404);
  });

  it('is the creator only, never themselves, and not after the start', async () => {
    const t = await table();
    await t.call(t.red, 'join', { side: 'red' });
    const other = await t.call(t.red, 'kick', { side: 'blue' });
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ error: 'not_creator' });
    const self = await t.call(t.lead, 'kick', { side: 'blue' });
    expect(self.status).toBe(400);
    expect(await self.json()).toMatchObject({ error: 'cannot_kick_self' });
    expect((await t.call(t.lead, 'kick', { side: 'nowhere' })).status).toBe(404);
    expect((await t.call(t.lead, 'kick', {})).status).toBe(400);

    await t.call(t.red, 'ready', { ready: true });
    await t.call(t.lead, 'start');
    expect((await t.call(t.lead, 'kick', { side: 'red' })).status).toBe(409);
    expect((await t.info(t.red)).you).toBe('red');
  });
});
