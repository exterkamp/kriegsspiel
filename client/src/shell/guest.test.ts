// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, tick } from 'svelte';
import { startShell, type Shell, type ShellDeps } from './boot.js';
import type { ScenarioOptions } from './newGame.js';

let app: HTMLElement;
let shell: Shell | undefined;
const assign = vi.fn();
const reload = vi.fn();

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
    await tick();
  }
  flushSync();
};

async function open(url: string, over: Partial<ShellDeps> = {}): Promise<void> {
  window.history.replaceState(null, '', url);
  shell = await startShell({
    app,
    win: {
      get location() {
        return { ...window.location, search: window.location.search, assign, reload } as Location;
      },
      history: window.history,
      addEventListener: window.addEventListener.bind(window),
      removeEventListener: window.removeEventListener.bind(window),
    },
    fetchMe: async () => undefined,
    fetchGames: async () => [],
    fetchScenarios: async () => [],
    fetchScenarioOptions: async () => ({}) as ScenarioOptions,
    createGame: async () => 'new1',
    requestLink: async () => undefined,
    signOut: async () => undefined,
    startLive: async () => undefined,
    now: () => 0,
    ...over,
  });
  await settle();
}

const button = (label: string) =>
  [...app.querySelectorAll('button')].find((b) => b.textContent?.includes(label));

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  app = document.getElementById('app')!;
  assign.mockClear();
  reload.mockClear();
});
afterEach(() => shell?.stop());

describe('guest play on the sign-in screen', () => {
  it('has no guest button unless the server allows it', async () => {
    await open('/', { guestEnabled: async () => false, startGuest: vi.fn() });
    expect(button('Play as guest')).toBeUndefined();
    await open('/');
    expect(button('Play as guest')).toBeUndefined();
  });

  it('one click starts a guest session and a new game', async () => {
    const startGuest = vi.fn(async () => undefined);
    await open('/', { guestEnabled: async () => true, startGuest });
    button('Play as guest')!.click();
    await settle();
    expect(startGuest).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith('/?new=1');
  });

  it('reloads the URL asked for, such as an invite', async () => {
    await open('/?game=g1', { guestEnabled: async () => true, startGuest: async () => undefined });
    button('Play as guest')!.click();
    await settle();
    expect(reload).toHaveBeenCalledOnce();
    expect(assign).not.toHaveBeenCalled();
  });

  it('shows the error when guest play is refused', async () => {
    await open('/', {
      guestEnabled: async () => true,
      startGuest: async () => 'Guest play is off.',
    });
    button('Play as guest')!.click();
    await settle();
    expect(app.querySelector('[role=status]')?.textContent).toBe('Guest play is off.');
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('the menu for a guest', () => {
  const guestMe = { id: 'g', email: 'guest-1@guest.invalid', guest: true };
  it('offers sign-in instead of sign-out and never shows the placeholder address', async () => {
    await open('/', { fetchMe: async () => guestMe });
    expect(app.textContent).not.toContain('guest.invalid');
    expect(button('Sign out')).toBeUndefined();
    button('Sign in to keep your games')!.click();
    await settle();
    expect(app.querySelector('form')).not.toBeNull();
  });
});
