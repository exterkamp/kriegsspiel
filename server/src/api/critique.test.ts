import { Critique } from '@kriegsspiel/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryGameStore } from '../game/index.js';
import { StubOrderParser } from '../orders/stubParser.js';
import { testReply } from '../umpire/providers/test.js';
import type { UmpireClient, UmpireRequest } from '../umpire/umpireClient.js';
import { buildApp, type App } from './app.js';

const mailbox: Array<{ to: string; link: string }> = [];
const mailer = {
  async sendLoginLink(to: string, link: string) {
    mailbox.push({ to, link });
  },
};

let app: App | undefined;
afterEach(async () => {
  await app?.server.close();
  app = undefined;
  mailbox.length = 0;
});

/** A critic that answers like the test provider, counting its calls. */
function critic(): UmpireClient & { requests: UmpireRequest[] } {
  const requests: UmpireRequest[] = [];
  return {
    requests,
    async call<T>(request: UmpireRequest) {
      requests.push(request);
      const output = testReply(request.schema, request.input as Record<string, unknown>);
      return {
        output: output as T,
        record: {
          stage: 'critique',
          model: 'scripted',
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
}

async function start(client?: UmpireClient, store = new MemoryGameStore()) {
  app = await buildApp({
    parser: new StubOrderParser(),
    store,
    auth: { mailer },
    ...(client ? { critic: () => client } : {}),
  });
  return { base: await app.server.listen({ port: 0, host: '127.0.0.1' }), store };
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

async function newGame(base: string, cookie: string): Promise<string> {
  const res = await fetch(`${base}/games`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ sessionType: 'hot_seat' }),
  });
  return ((await res.json()) as { id: string }).id;
}

async function finish(id: string): Promise<void> {
  const game = app!.host.get(id)!;
  await game.submit({ kind: 'setMode', mode: 'fast-forward' });
  await game.submit({ kind: 'order', side: 'blue', text: 'blue-1 move to the bridge' });
  await game.submit({ kind: 'advanceTo', gameMs: 24 * 60 * 60_000 });
  expect(game.state.world.outcome).not.toBeNull();
}

const get = (cookie: string): RequestInit => ({ headers: { cookie } });

describe('post-game critique', () => {
  it('is refused until the game has ended, and to anyone without a seat', async () => {
    const { base } = await start();
    const cookie = await signIn(base, 'a@example.test');
    const other = await signIn(base, 'b@example.test');
    const id = await newGame(base, cookie);

    const early = await fetch(`${base}/games/${id}/critique`, get(cookie));
    expect(early.status).toBe(403);
    expect(await early.json()).toEqual({ error: 'game_not_over' });

    await finish(id);
    expect((await fetch(`${base}/games/${id}/critique`)).status).toBe(401);
    expect((await fetch(`${base}/games/${id}/critique`, get(other))).status).toBe(403);
    expect((await fetch(`${base}/games/nope/critique`, get(cookie))).status).toBe(404);
  }, 60_000);

  it("serves the log's own wording when no umpire is configured, citing real events", async () => {
    const { base, store } = await start();
    const cookie = await signIn(base, 'a@example.test');
    const id = await newGame(base, cookie);
    await finish(id);

    const res = await fetch(`${base}/games/${id}/critique`, get(cookie));
    expect(res.status).toBe(200);
    const body = Critique.parse(await res.json());
    expect(body.source).toBe('template');
    expect(body.points.length).toBeGreaterThan(0);
    const end = Math.floor(app!.host.get(id)!.state.time / 60_000);
    for (const p of body.points) {
      expect(p.cites.some((c) => c.minute === p.minute)).toBe(true);
      for (const c of p.cites) expect(c.minute).toBeLessThanOrEqual(end);
    }
    // With no umpire nothing is saved, so a later umpire can still write one.
    const log = await store.inputLog(id);
    expect(log.some((e) => e.command.kind === 'critique')).toBe(false);
  }, 60_000);

  it('has the umpire write it once, keeps it in the input log, and serves it with no new call', async () => {
    const client = critic();
    const { base, store } = await start(client);
    const cookie = await signIn(base, 'a@example.test');
    const id = await newGame(base, cookie);
    await finish(id);

    // Two requests at once share one run.
    const [a, b] = await Promise.all([
      fetch(`${base}/games/${id}/critique`, get(cookie)).then((r) => r.json()),
      fetch(`${base}/games/${id}/critique`, get(cookie)).then((r) => r.json()),
    ]);
    expect(Critique.parse(a).source).toBe('model');
    expect(b).toEqual(a);
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]!.stage).toBe('critique');

    const again = await (await fetch(`${base}/games/${id}/critique`, get(cookie))).json();
    expect(again).toEqual(a);
    expect(client.requests).toHaveLength(1);

    // The journal entry carries the text and the model call, and the game still replays from the log.
    const entries = (await store.inputLog(id)).filter((e) => e.command.kind === 'critique');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.calls).toHaveLength(1);
    expect(entries[0]!.command).toMatchObject({ critique: a });
    const window = await fetch(`${base}/games/${id}/window`, get(cookie));
    expect(window.status).toBe(200);
  }, 60_000);
});
