/** #263: the app tells the host process when a game is closed so per-game resources can go. */
import { describe, expect, it } from 'vitest';
import { MemoryGameStore } from '../game/index.js';
import { StubOrderParser } from '../orders/stubParser.js';
import { buildApp } from './app.js';

const mailbox: Array<{ to: string; link: string }> = [];
const mailer = {
  async sendLoginLink(to: string, link: string) {
    mailbox.push({ to, link });
  },
};

describe('onGameDone', () => {
  it('fires for a live game when the app shuts down', async () => {
    const done: string[] = [];
    const app = await buildApp({
      parser: new StubOrderParser(),
      store: new MemoryGameStore(),
      auth: { mailer },
      onGameDone: (id) => done.push(id),
    });
    const base = await app.server.listen({ port: 0, host: '127.0.0.1' });
    await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.test' }),
    });
    const link = new URL(mailbox.at(-1)!.link);
    const login = await fetch(`${base}${link.pathname}${link.search}`, { redirect: 'manual' });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const res = await fetch(`${base}/games`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ rate: 3600 }),
    });
    expect(res.status).toBe(201);
    const game = (await res.json()) as { id: string };
    expect(done).toEqual([]);
    await app.server.close();
    expect(done).toContain(game.id);
  });
});
