// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, tick } from 'svelte';
import axe from 'axe-core';
import { startShell, type ShellDeps } from './boot.js';
import { registerGame } from './gameHandle.js';
import type { PlayedGame } from './continueList.js';

const game = (over: Partial<PlayedGame>): PlayedGame => ({
  id: 'g1',
  scenario: 'hold-the-bridge',
  status: 'started',
  sessionType: 'team_vs_team',
  rate: 12,
  side: 'blue',
  creator: true,
  createdAtMs: 0,
  finished: false,
  gameTimeMs: 90 * 60_000,
  lastPlayedMs: 0,
  ...over,
});

let app: HTMLElement;
let running: Array<{ stop(): void }> = [];
let win: ShellDeps['win'] & { location: Location };
const assign = vi.fn();
const reload = vi.fn();

function deps(over: Partial<ShellDeps> = {}): ShellDeps {
  return {
    app,
    win,
    fetchMe: async () => ({ id: 'u', email: 'me@example.test' }),
    fetchGames: async () => [
      game({}),
      game({ id: 'done', finished: true }),
      game({ id: 'lobby', status: 'lobby' }),
    ],
    fetchScenarios: async () => [{ id: 'hold-the-bridge', name: 'Hold the Bridge' }],
    requestLink: async () => undefined,
    signOut: async () => undefined,
    startLive: async () => undefined,
    startFixture: vi.fn(),
    now: () => 2 * 3_600_000,
    ...over,
  };
}
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
    await tick();
  }
  flushSync();
};
const open = async (url: string, over: Partial<ShellDeps> = {}) => {
  window.history.replaceState(null, '', url);
  const shell = await startShell(deps(over));
  running.push(shell);
  await settle();
  return shell;
};

beforeEach(() => {
  document.documentElement.lang = 'en';
  document.title = 'Kriegsspiel';
  document.body.innerHTML = '<div id="app"></div>';
  app = document.getElementById('app')!;
  assign.mockClear();
  reload.mockClear();
  win = {
    get location() {
      return { ...window.location, search: window.location.search, assign, reload } as Location;
    },
    history: window.history,
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
  };
});
afterEach(() => {
  running.forEach((s) => s.stop());
  running = [];
  registerGame(undefined);
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
});

describe('main menu', () => {
  it('opens on the menu with no URL parameters, listing only unfinished games with their details', async () => {
    await open('/');
    expect(app.querySelector('h1')?.textContent).toBe('Kriegsspiel');
    const rows = [...app.querySelectorAll('section ul button')];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute('aria-label')).toBe(
      'Continue: Hold the Bridge, playing blue, game time Day 1 01:30, last played 2 hours ago',
    );
    expect(app.textContent).toContain('me@example.test');
    expect(app.textContent).toContain('About');
  });
  it('hides Continue when there is nothing to continue', async () => {
    await open('/', { fetchGames: async () => [game({ finished: true })] });
    expect(app.querySelector('#continue-h')).toBeNull();
  });
  it('says so when the games cannot be loaded, and still offers New game', async () => {
    await open('/', {
      fetchGames: async () => {
        throw new Error('could not load your games (500)');
      },
    });
    expect(app.querySelector('[role=alert]')?.textContent).toContain('could not load');
    expect([...app.querySelectorAll('button')].some((b) => b.textContent === 'New game')).toBe(
      true,
    );
  });
  it('shows sign-in, not the menu or a game, when signed out', async () => {
    const startLive = vi.fn(async () => undefined);
    await open('/?game=g1', { fetchMe: async () => undefined, startLive });
    expect(app.querySelector('form')).not.toBeNull();
    expect(app.querySelector('h1')).not.toBeNull();
    expect(startLive).not.toHaveBeenCalled();
  });
  it('sends the login link request', async () => {
    const requestLink = vi.fn(async () => undefined);
    await open('/', { fetchMe: async () => undefined, requestLink });
    app.querySelector<HTMLInputElement>('input')!.value = 'a@b.test';
    app.querySelector('input')!.dispatchEvent(new Event('input', { bubbles: true }));
    app
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(requestLink).toHaveBeenCalledWith('a@b.test');
    expect(app.querySelector('[role=status]')?.textContent).toContain('a@b.test');
  });
  it('has no axe violations on the menu and sign-in (contrast needs a browser)', async () => {
    await open('/');
    const a = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(a.violations).toEqual([]);
    await open('/', { fetchMe: async () => undefined });
    const b = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(b.violations).toEqual([]);
  });
});

describe('moving between screens', () => {
  const click = (label: string): void => {
    [...app.querySelectorAll('button')]
      .find((b) => b.textContent === label || b.getAttribute('aria-label')?.startsWith(label))!
      .click();
  };
  it('New game loads the live client on the new-game URL', async () => {
    const startLive = vi.fn(async () => undefined);
    const shell = await open('/', { startLive });
    click('New game');
    await settle();
    expect(shell.state.screen.name).toBe('new-game');
    expect(window.location.search).toBe('?lobby=1');
    expect(startLive).toHaveBeenCalledOnce();
  });
  it('Continue opens that game at its own URL', async () => {
    const startLive = vi.fn(async () => undefined);
    await open('/', { startLive });
    click('Continue');
    await settle();
    expect(window.location.search).toBe('?game=g1');
    expect(startLive).toHaveBeenCalledOnce();
  });
  it('existing URLs open their screens: ?game, ?new, ?lobby and mode=fixture', async () => {
    for (const url of ['/?game=abc', '/?new=1&rate=12', '/?lobby=1']) {
      const startLive = vi.fn(async () => undefined);
      await open(url, { startLive });
      expect(startLive).toHaveBeenCalledOnce();
    }
    const startFixture = vi.fn();
    await open('/?mode=fixture', { fetchMe: async () => undefined, startFixture });
    expect(startFixture).toHaveBeenCalledOnce();
  });
  it('Sign out from the menu returns to sign-in and signs out on the server', async () => {
    const signOut = vi.fn(async () => undefined);
    const shell = await open('/', { signOut });
    click('Sign out');
    await settle();
    expect(signOut).toHaveBeenCalledOnce();
    expect(shell.state.screen.name).toBe('sign-in');
    expect(app.querySelector('form')).not.toBeNull();
  });
  it('browser back from a loaded game needs a clean page load, and closes the connection', async () => {
    const disconnect = vi.fn();
    registerGame({ disconnect });
    await open('/');
    click('Continue');
    await settle();
    window.history.back();
    await new Promise((r) => window.addEventListener('popstate', r, { once: true }));
    expect(disconnect).toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
  });
});

describe('in-game menu', () => {
  const esc = (): void => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
  };
  it('offers Resume, Leave to main menu and Sign out on Esc, with focus on Resume', async () => {
    await open('/?game=g1');
    expect(document.querySelector('[role=dialog]')).toBeNull();
    esc();
    await settle();
    const dialog = document.querySelector('[role=dialog]')!;
    expect([...dialog.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Resume',
      'Leave to main menu',
      'Sign out',
    ]);
    expect(document.activeElement?.textContent).toBe('Resume');
    esc();
    await settle();
    expect(document.querySelector('[role=dialog]')).toBeNull();
  });
  it('Leave closes the connection, then loads the main menu on a fresh page', async () => {
    const disconnect = vi.fn();
    registerGame({ disconnect });
    await open('/?game=g1');
    esc();
    await settle();
    [...document.querySelectorAll<HTMLButtonElement>('[role=dialog] button')]
      .find((b) => b.textContent === 'Leave to main menu')!
      .click();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith('/');
  });
  it('is not offered on the new-game screen', async () => {
    await open('/?lobby=1');
    expect(document.body.textContent).not.toContain('Menu (Esc)');
  });
});
