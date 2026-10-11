import { viewFor } from '@kriegsspiel/engine';
import { parseServerMessage, PROTOCOL_VERSION, type ServerMessage } from '@kriegsspiel/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type App } from '../api/app.js';
import { MemoryGameStore } from '../game/index.js';
import { StubOrderParser } from '../orders/stubParser.js';
import type { PushSender } from './push.js';
import { isPushEndpoint } from './routes.js';
import type { PushSubscriptionRecord } from './store.js';

const RATE = 3600;

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

const pushed: Array<{ sub: PushSubscriptionRecord; payload: string }> = [];
let pushResult: 'ok' | 'gone' = 'ok';
const push: PushSender = {
  publicKey: 'test-public-key',
  async send(sub, payload) {
    pushed.push({ sub, payload });
    return pushResult;
  },
};

let app: App | undefined;
afterEach(async () => {
  await app?.server.close();
  app = undefined;
  mailbox.length = 0;
  notices.length = 0;
  pushed.length = 0;
  pushResult = 'ok';
  vi.restoreAllMocks();
});

async function start(wallNow?: () => number) {
  app = await buildApp({
    parser: new StubOrderParser(),
    store: new MemoryGameStore(),
    auth: { mailer },
    notify: { push, emailEveryMs: 0 },
    wallNow,
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

const send = (cookie: string, method: string, path: string, body?: unknown, base = '') =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** A game with a blue player (returned) and a red player. */
async function game(base: string) {
  const blue = await signIn(base, 'blue@example.test');
  const created = (await (await send(blue, 'POST', '/games', { rate: RATE }, base)).json()) as {
    id: string;
  };
  const red = await signIn(base, 'red@example.test');
  await send(red, 'POST', `/games/${created.id}/join`, { side: 'red' }, base);
  return { id: created.id, blue, red };
}

const prefs = (over: object = {}) => ({ threshold: 'all', push: true, email: true, ...over });

async function settle() {
  await app!.notifier.flush();
}

const waitUntil = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  await settle();
};

describe('preferences API', () => {
  it('needs a session', async () => {
    const base = await start();
    expect((await fetch(`${base}/notifications/prefs`)).status).toBe(401);
    expect((await fetch(`${base}/notifications/push`)).status).toBe(401);
  });

  it('defaults to urgent, then stores and validates changes', async () => {
    const base = await start();
    const c = await signIn(base, 'a@example.test');
    expect(await (await send(c, 'GET', '/notifications/prefs', undefined, base)).json()).toEqual({
      threshold: 'urgent',
      push: true,
      email: true,
    });
    const quiet = { startMin: 1320, endMin: 420, utcOffsetMin: 60 };
    const put = await send(c, 'PUT', '/notifications/prefs', prefs({ quietHours: quiet }), base);
    expect(put.status).toBe(200);
    const got = await (await send(c, 'GET', '/notifications/prefs', undefined, base)).json();
    expect(got).toEqual(prefs({ quietHours: quiet }));
    for (const bad of [
      { ...prefs(), threshold: 'loud' },
      { ...prefs(), extra: 1 },
      { push: true },
    ]) {
      expect((await send(c, 'PUT', '/notifications/prefs', bad, base)).status).toBe(400);
    }
    expect(
      (
        await send(
          c,
          'PUT',
          '/notifications/prefs',
          prefs({ quietHours: { ...quiet, startMin: 2000 } }),
          base,
        )
      ).status,
    ).toBe(400);
  });

  it('serves the VAPID key and manages subscriptions', async () => {
    const base = await start();
    const c = await signIn(base, 'a@example.test');
    expect(await (await send(c, 'GET', '/notifications/push', undefined, base)).json()).toEqual({
      key: 'test-public-key',
    });
    const sub = { endpoint: 'https://push.example.test/abc', keys: { p256dh: 'k', auth: 'a' } };
    expect((await send(c, 'POST', '/notifications/push/subscription', sub, base)).status).toBe(201);
    const insecure = { ...sub, endpoint: 'http://push.example.test/abc' };
    expect((await send(c, 'POST', '/notifications/push/subscription', insecure, base)).status).toBe(
      400,
    );
    expect(
      (
        await send(
          c,
          'DELETE',
          '/notifications/push/subscription',
          { endpoint: sub.endpoint },
          base,
        )
      ).status,
    ).toBe(204);
  });
});

describe('delivery', () => {
  async function setup(blueOver: object = {}) {
    const base = await start();
    const g = await game(base);
    await send(g.blue, 'PUT', '/notifications/prefs', prefs(blueOver), base);
    const sub = { endpoint: 'https://push.example.test/blue', keys: { p256dh: 'k', auth: 'a' } };
    await send(g.blue, 'POST', '/notifications/push/subscription', sub, base);
    const actor = app!.host.get(g.id)!;
    // First look sets the baseline.
    app!.notifier.observe(g.id);
    return { base, g, actor };
  }

  it('sends an away player web push and email when a dispatch arrives', async () => {
    const { g, actor } = await setup();
    await actor.submit({ kind: 'order', side: 'blue', text: 'blue-1 march to the bridge' });
    await waitUntil(() => notices.length > 0);
    expect(notices.map((n) => n.to)).toEqual(['blue@example.test']);
    expect(pushed).toHaveLength(1);
    expect(JSON.parse(pushed[0]!.payload)).toMatchObject({
      title: 'Dispatch received',
      url: expect.stringContaining(`game=${g.id}`),
    });
  });

  it('never emails a guest, whose address is a placeholder, but still pushes', async () => {
    const { actor } = await setup();
    const real = app!.authStore.getUser.bind(app!.authStore);
    vi.spyOn(app!.authStore, 'getUser').mockImplementation((id) => {
      const u = real(id);
      return u && { ...u, guest: true };
    });
    await actor.submit({ kind: 'order', side: 'blue', text: 'blue-1 march to the bridge' });
    await waitUntil(() => pushed.length > 0);
    expect(notices).toHaveLength(0);
  });

  it('tells a player with the game open over the WebSocket instead', async () => {
    const { base, g, actor } = await setup();
    const messages: ServerMessage[] = [];
    const socket = new (WebSocket as unknown as new (u: string, i: object) => WebSocket)(
      `${base.replace('http', 'ws')}/games/${g.id}/ws`,
      { headers: { cookie: g.blue } },
    );
    socket.addEventListener('message', (e) => {
      const p = parseServerMessage(String(e.data));
      if (p.ok) messages.push(p.value);
    });
    await waitUntil(() => messages.some((m) => m.kind === 'viewUpdate'));
    await actor.submit({ kind: 'order', side: 'blue', text: 'blue-1 march to the bridge' });
    await waitUntil(() => messages.some((m) => m.kind === 'notification'));
    socket.close();
    const note = messages.find((m) => m.kind === 'notification');
    expect(note).toMatchObject({
      v: PROTOCOL_VERSION,
      event: 'dispatch',
      title: 'Dispatch received',
    });
    expect(pushed).toHaveLength(0);
    expect(notices).toHaveLength(0);
  });

  it('respects the threshold', async () => {
    const { actor } = await setup({ threshold: 'urgent' });
    await actor.submit({ kind: 'order', side: 'blue', text: 'blue-1 march to the bridge' });
    // Wait until the dispatch has really reached Blue's desk, so silence means it was held back.
    await waitUntil(() => viewFor(actor.state.world, 'blue', actor.state.time).reports.length > 0);
    expect(notices).toHaveLength(0);
    expect(pushed).toHaveLength(0);
  });

  it('respects the channel switches', async () => {
    const { actor } = await setup({ email: false });
    await actor.submit({ kind: 'order', side: 'blue', text: 'blue-1 march to the bridge' });
    await waitUntil(() => pushed.length > 0);
    expect(notices).toHaveLength(0);
    expect(pushed).toHaveLength(1);
  });

  it('holds push and email back in quiet hours', async () => {
    const wall = Date.UTC(2026, 0, 1, 23, 0);
    const base = await start(() => wall);
    const g = await game(base);
    await send(
      g.blue,
      'PUT',
      '/notifications/prefs',
      prefs({ quietHours: { startMin: 1320, endMin: 420, utcOffsetMin: 0 } }),
      base,
    );
    await send(
      g.blue,
      'POST',
      '/notifications/push/subscription',
      { endpoint: 'https://push.example.test/b', keys: { p256dh: 'k', auth: 'a' } },
      base,
    );
    app!.notifier.observe(g.id);
    await app!.host
      .get(g.id)!
      .submit({ kind: 'order', side: 'blue', text: 'blue-1 march to the bridge' });
    await settle();
    expect(notices).toHaveLength(0);
    expect(pushed).toHaveLength(0);
  });

  it('tells both sides when the game is paused and resumed', async () => {
    const { actor } = await setup({ threshold: 'all' });
    await actor.submit({ kind: 'pause' });
    app!.notifier.observe(actor.id);
    await settle();
    expect(pushed.map((p) => JSON.parse(p.payload).title)).toEqual(['Game paused']);
    await actor.submit({ kind: 'resume' });
    app!.notifier.observe(actor.id);
    await settle();
    expect(pushed.map((p) => JSON.parse(p.payload).title)).toEqual(['Game paused', 'Game resumed']);
  });

  it('drops a push subscription the browser has gone from', async () => {
    const { g, actor } = await setup();
    pushResult = 'gone';
    await actor.submit({ kind: 'order', side: 'blue', text: 'blue-1 march to the bridge' });
    await waitUntil(() => pushed.length > 0);
    await settle();
    const seat = app!.authStore.seatsOf(g.id).find((s) => s.side === 'blue')!;
    expect(app!.notifyStore.subscriptionsOf(seat.userId)).toEqual([]);
  });

  it('puts nothing but fixed words in a notification', async () => {
    const { actor } = await setup();
    await actor.submit({ kind: 'order', side: 'blue', text: 'blue-1 march to the bridge' });
    await waitUntil(() => notices.length > 0);
    const text = JSON.stringify([notices, pushed]);
    for (const unit of actor.state.world.units) {
      expect(text).not.toContain(unit.name);
      expect(text).not.toContain(unit.id);
    }
  });

  it('does not announce papers that were already there at the first look', async () => {
    const base = await start();
    const g = await game(base);
    await send(g.blue, 'PUT', '/notifications/prefs', prefs(), base);
    const actor = app!.host.get(g.id)!;
    // The order is sent before the notifier has looked at the game, so its dispatch is old news.
    app!.notifier.forget(g.id);
    await actor.submit({ kind: 'order', side: 'blue', text: 'blue-1 march to the bridge' });
    app!.notifier.observe(g.id);
    await settle();
    expect(notices).toHaveLength(0);
    // A later one is news.
    await actor.submit({ kind: 'order', side: 'blue', text: 'blue-1 halt' });
    await waitUntil(() => notices.length > 0);
    expect(notices.length).toBeGreaterThan(0);
  });

  it('refuses push endpoints that point at hosts a browser would not use', () => {
    for (const bad of [
      'http://push.example.test/a',
      'https://169.254.169.254/latest',
      'https://127.0.0.1:8443/',
      'https://[::1]/',
      'https://localhost/a',
      'https://internal-service:8443/',
      'https://user:pw@push.example.test/a',
      'not a url',
    ]) {
      expect(isPushEndpoint(bad), bad).toBe(false);
    }
    expect(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
  });
});
