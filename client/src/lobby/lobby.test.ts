// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { parseSession, wsUrl } from '../session.js';
import { createLobbyGame, startGame, type GameInfo } from './api.js';
import { inviteLink, parseRate, startBlocker } from './model.js';

const info = (over: Partial<GameInfo> = {}): GameInfo => ({
  id: 'g1',
  scenario: 'hold-the-bridge',
  status: 'lobby',
  sessionType: 'team_vs_team',
  rate: 4,
  side: 'blue',
  creator: true,
  createdAtMs: 0,
  you: 'blue',
  ready: true,
  pause: null,
  sides: [
    { side: 'blue', taken: true, ready: true },
    { side: 'red', taken: true, ready: true },
  ],
  ...over,
});

describe('startBlocker', () => {
  it('lets the creator start when every side is seated and ready', () => {
    expect(startBlocker(info())).toBeUndefined();
  });

  it('says what the creator is waiting for', () => {
    const open = info({
      sides: [
        { side: 'blue', taken: true, ready: true },
        { side: 'red', taken: false, ready: false },
      ],
    });
    expect(startBlocker(open)).toMatch(/player on red/);
    const unready = info({
      sides: [
        { side: 'blue', taken: true, ready: true },
        { side: 'red', taken: true, ready: false },
      ],
    });
    expect(startBlocker(unready)).toMatch(/red to be ready/);
  });

  it('is closed to a guest and to a started game', () => {
    expect(startBlocker(info({ creator: false }))).toMatch(/Only the person/);
    expect(startBlocker(info({ status: 'started' }))).toMatch(/started/);
  });
});

describe('parseRate', () => {
  it('takes a number or n:1 within the server limits', () => {
    expect(parseRate('12')).toBe(12);
    expect(parseRate(' 30:1 ')).toBe(30);
    expect(parseRate('0')).toBeUndefined();
    expect(parseRate('fast')).toBeUndefined();
    expect(parseRate('999999')).toBeUndefined();
  });
});

describe('links', () => {
  it('builds an invite link that the session parser opens as a join', () => {
    const link = new URL(inviteLink('https://example.test', 'a b'));
    expect(parseSession(link.search)).toEqual({ mode: 'join', game: 'a b' });
  });

  it('parses ?lobby and puts a hot-seat side on the socket url', () => {
    expect(parseSession('?lobby=1')).toEqual({ mode: 'lobby' });
    expect(wsUrl({ protocol: 'http:', host: 'h' }, 'g', 'red')).toBe('ws://h/games/g/ws?side=red');
    expect(wsUrl({ protocol: 'https:', host: 'h' }, 'g')).toBe('wss://h/games/g/ws');
  });
});

describe('api', () => {
  it('creates a lobby game', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: 'g9' }), { status: 201 }));
    const id = await createLobbyGame(
      { scenario: 's', rate: 12, sessionType: 'hot_seat' },
      f as unknown as typeof fetch,
    );
    expect(id).toBe('g9');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/games');
    expect(JSON.parse(String(init.body))).toMatchObject({
      lobby: true,
      rate: 12,
      sessionType: 'hot_seat',
    });
  });

  it('turns a start refusal into a message', async () => {
    const f = async () => new Response(JSON.stringify({ error: 'sides_open' }), { status: 409 });
    await expect(startGame('g', f as unknown as typeof fetch)).rejects.toThrow(/Every side/);
  });
});
