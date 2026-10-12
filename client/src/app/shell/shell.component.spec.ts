import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayedGame } from '@legacy/shell/continueList';
import type { ScenarioOptions } from '@legacy/shell/newGame';
import type { GameInfo } from '@legacy/lobby/api';
import { fakeGame } from '../desk/fake-game';
import { TABLE_SCENE_FACTORY } from '../game/table.service';
import { SHELL_API, SHELL_NOW, SHELL_WINDOW, type ShellApi } from './shell-api';
import { ShellComponent } from './shell.component';

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

const options: ScenarioOptions = {
  opponent: 'scripted',
  scenarios: [
    {
      id: 'hold-the-bridge',
      name: 'Hold the Bridge',
      briefing: 'Hold the crossing.',
      lengthMinutes: 240,
      sides: [
        { id: 'blue', name: 'Blue', controller: 'human' },
        { id: 'red', name: 'Red', controller: 'scripted' },
      ],
      defaults: { side: 'blue', rate: 12 },
    },
  ],
};

const info = (over: Partial<GameInfo> = {}): GameInfo => ({
  ...game({}),
  you: 'blue',
  ready: false,
  pause: null,
  sides: [
    { side: 'blue', taken: true, ready: false },
    { side: 'red', taken: false, ready: false },
  ],
  ...over,
});

const fakeScene = () => ({
  start: vi.fn(),
  dispose: vi.fn(),
  apply: vi.fn(),
  resize: vi.fn(),
  setDesk: vi.fn(),
  setOverlays: vi.fn(),
  setMarks: vi.fn(),
  panTo: vi.fn(),
  snapTopDown: vi.fn(),
  snapOblique: vi.fn(),
  pickAt: vi.fn(() => ({ type: 'none' })),
  controls: { mouseButtons: { LEFT: 0 }, touches: { ONE: 0 } },
});

const assign = vi.fn();
const reload = vi.fn();

function api(over: Partial<ShellApi> = {}): ShellApi {
  return {
    fetchMe: async () => ({ id: 'u', email: 'me@example.test' }),
    fetchGames: async () => [
      game({}),
      game({ id: 'done', finished: true }),
      game({ id: 'lobby', status: 'lobby' }),
    ],
    fetchScenarios: async () => [{ id: 'hold-the-bridge', name: 'Hold the Bridge' }],
    fetchScenarioOptions: async () => options,
    createGame: async () => 'new1',
    requestLink: async () => undefined,
    signOut: async () => undefined,
    deleteAccount: async () => true,
    guestEnabled: async () => false,
    devToolsEnabled: async () => false,
    startGuest: async () => undefined,
    fetchGame: async () => info(),
    joinSide: async () => undefined,
    setReady: async () => undefined,
    startGame: async () => undefined,
    createQuickGame: async () => 'q1',
    ...over,
  };
}

let f: ComponentFixture<ShellComponent>;
let el: HTMLElement;
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
    await f.whenStable();
  }
};
async function open(url: string, over: Partial<ShellApi> = {}) {
  window.history.replaceState(null, '', url);
  const g = fakeGame({}, undefined);
  Object.assign(g.fake, { connect: vi.fn() });
  const win = {
    get location() {
      return {
        search: window.location.search,
        origin: 'http://x.test',
        assign,
        reload,
      } as unknown as Location;
    },
    history: window.history,
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
  };
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      g,
      { provide: SHELL_API, useValue: api(over) },
      { provide: SHELL_WINDOW, useValue: win },
      { provide: SHELL_NOW, useValue: () => 2 * 3_600_000 },
      { provide: TABLE_SCENE_FACTORY, useValue: () => fakeScene() },
    ],
  });
  f = TestBed.createComponent(ShellComponent);
  el = f.nativeElement as HTMLElement;
  await settle();
  return g.fake;
}
const click = (label: string): void => {
  [...el.querySelectorAll('button')]
    .find(
      (b) => b.textContent?.trim() === label || b.getAttribute('aria-label')?.startsWith(label),
    )!
    .click();
};
const radio = (sel: string) => el.querySelector<HTMLInputElement>(sel)!;

beforeEach(() => {
  assign.mockClear();
  reload.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('main menu', () => {
  it('lists only unfinished games with their details', async () => {
    await open('/');
    expect(el.querySelector('h1')?.textContent).toBe('Kriegsspiel');
    const rows = [...el.querySelectorAll('section ul button')];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute('aria-label')).toBe(
      'Continue: Hold the Bridge, playing blue, game time Day 1 01:30, last played 2 hours ago',
    );
    expect(el.textContent).toContain('me@example.test');
    expect(el.textContent).toContain('About');
  });

  it('shows the Developer tools links when the server turns them on', async () => {
    await open('/', { devToolsEnabled: async () => true });
    expect(el.querySelector('#dev-h')?.textContent).toBe('Developer tools');
    const links = [...el.querySelectorAll('section.dev a')].map((a) => [
      a.textContent,
      a.getAttribute('href'),
    ]);
    expect(links).toEqual([
      ['Map editor', '/map-authoring'],
      ['Map benchmark', '/map-benchmark'],
      ['Table benchmark', '/table-benchmark'],
      ['Style guide', '/style-guide'],
      ['Admin view', '/admin/'],
    ]);
    expect(el.querySelector('section.dev')?.textContent).toContain('admin token');
  });

  it('leaves the Developer tools out when the server turns them off or cannot say', async () => {
    await open('/');
    expect(el.querySelector('#dev-h')).toBeNull();
    TestBed.resetTestingModule();
    await open('/', {
      devToolsEnabled: async () => {
        throw new Error('down');
      },
    });
    expect(el.querySelector('#dev-h')).toBeNull();
  });

  it('hides Continue when there is nothing to continue', async () => {
    await open('/', { fetchGames: async () => [game({ finished: true })] });
    expect(el.querySelector('#continue-h')).toBeNull();
  });

  it('says so when the games cannot be loaded, and still offers New game', async () => {
    await open('/', {
      fetchGames: async () => {
        throw new Error('could not load your games (500)');
      },
    });
    expect(el.querySelector('[role=alert]')?.textContent).toContain('could not load');
    expect([...el.querySelectorAll('button')].some((b) => b.textContent === 'New game')).toBe(true);
  });

  it('Sign out returns to sign-in and signs out on the server', async () => {
    const signOut = vi.fn(async () => undefined);
    await open('/', { signOut });
    click('Sign out');
    await settle();
    expect(signOut).toHaveBeenCalledOnce();
    expect(el.querySelector('form')).not.toBeNull();
    expect(el.textContent).toContain('Send me a login link');
  });

  it('a guest has no sign-out but can sign in to keep their games', async () => {
    await open('/', { fetchMe: async () => ({ id: 'g', email: '', guest: true }) });
    expect(el.textContent).toContain('Playing as a guest');
    expect([...el.querySelectorAll('button')].some((b) => b.textContent === 'Sign out')).toBe(
      false,
    );
    click('Sign in to keep your games on other devices');
    await settle();
    expect(el.querySelector('form')).not.toBeNull();
  });
});

describe('sign-in and guest', () => {
  it('shows sign-in, not a game, when signed out', async () => {
    const createQuickGame = vi.fn(async () => 'x');
    await open('/?game=g1', { fetchMe: async () => undefined, createQuickGame });
    expect(el.querySelector('form')).not.toBeNull();
    expect(el.querySelector('canvas')).toBeNull();
  });

  it('sends the login link request and says where to look', async () => {
    const requestLink = vi.fn(async () => undefined);
    await open('/', { fetchMe: async () => undefined, requestLink });
    const input = el.querySelector('input')!;
    input.value = 'a@b.test';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    el.querySelector('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await settle();
    expect(requestLink).toHaveBeenCalledWith('a@b.test');
    expect(el.querySelector('[role=status]')?.textContent).toContain('a@b.test');
  });

  it('shows an error from the link request', async () => {
    await open('/', {
      fetchMe: async () => undefined,
      requestLink: async () => 'Too many requests.',
    });
    el.querySelector('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await settle();
    expect(el.querySelector('[role=status].err')?.textContent).toContain('Too many');
  });

  it('has no guest button unless the server allows guests', async () => {
    await open('/', { fetchMe: async () => undefined });
    expect(el.textContent).not.toContain('Play as guest');
  });

  it('Play as guest starts a session, then reloads into the main menu rather than a game', async () => {
    const startGuest = vi.fn(async () => undefined);
    await open('/', { fetchMe: async () => undefined, guestEnabled: async () => true, startGuest });
    click('Play as guest');
    await settle();
    expect(startGuest).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
    expect(assign).not.toHaveBeenCalled();
  });

  it('Play as guest on an invite link reloads it, and shows a failure', async () => {
    const startGuest = vi.fn(async () => undefined);
    await open('/?game=g1', {
      fetchMe: async () => undefined,
      guestEnabled: async () => true,
      startGuest,
    });
    click('Play as guest');
    await settle();
    expect(reload).toHaveBeenCalledOnce();

    TestBed.resetTestingModule();
    await open('/', {
      fetchMe: async () => undefined,
      guestEnabled: async () => true,
      startGuest: async () => 'Guest play is turned off on this server.',
    });
    click('Play as guest');
    await settle();
    expect(el.querySelector('[role=status].err')?.textContent).toContain('turned off');
  });
});

describe('moving between screens', () => {
  it('New game opens the form on its URL, with your games below, and Back returns', async () => {
    await open('/');
    click('New game');
    await settle();
    expect(window.location.search).toBe('?lobby=1');
    expect(el.querySelector('form[aria-label="New game"]')).not.toBeNull();
    expect(el.querySelector('#game-list')?.textContent).toContain(
      'Hold the Bridge, Team vs team, 12:1',
    );
    expect(el.querySelector('canvas')).toBeNull();
    click('Back');
    await settle();
    expect(el.querySelector('#continue-h')).not.toBeNull();
  });

  it('puts the form and your games in one scroller, so the list cannot cover Start (#318)', async () => {
    await open('/?lobby=1');
    const screen = el.querySelector('.screen')!;
    expect(screen.contains(el.querySelector('form[aria-label="New game"]'))).toBe(true);
    expect(screen.contains(el.querySelector('#game-list'))).toBe(true);
  });

  it('offers the side as a choice when there are two to pick from', async () => {
    await open('/?lobby=1', {
      fetchScenarioOptions: async () => ({ ...options, opponent: undefined }),
    });
    expect(radio('input[name=side][value=blue]').checked).toBe(true);
    expect(radio('input[name=side][value=red]').checked).toBe(false);
    expect(el.querySelector('.side-only')).toBeNull();
  });

  it('defaults to the first scenario, Blue and 12:1, and explains the rate', async () => {
    await open('/?lobby=1');
    // One side to play: shown as text, not a one-item list of radios.
    expect(el.querySelector('input[name=side]')).toBeNull();
    expect(el.querySelector('.side-only')?.textContent?.trim()).toBe('Blue');
    expect(radio('input[name=rate][value="12"]').checked).toBe(true);
    expect(el.textContent).toContain('one hour of battle passes in five minutes');
    expect(el.querySelector('input[name=side][value=red]')).toBeNull();
  });

  it('Start creates the game with the chosen options and opens it', async () => {
    const createGame = vi.fn(async () => 'new1');
    await open('/?lobby=1', { createGame });
    radio('input[name=rate][value="4"]').click();
    await settle();
    click('Start');
    await settle();
    expect(createGame).toHaveBeenCalledWith({
      scenario: 'hold-the-bridge',
      side: 'blue',
      rate: 4,
      sessionType: 'co_op_vs_ai',
    });
    expect(window.location.search).toBe('?game=new1');
    expect(el.querySelector('canvas')).not.toBeNull();
  });

  it('Start shows a server error and keeps the form; a double click makes one game', async () => {
    let calls = 0;
    const createGame = vi.fn(async () => {
      calls++;
      await Promise.resolve();
      throw new Error('You have reached the limit on games.');
    });
    await open('/?lobby=1', { createGame });
    radio('input[name=rate][value="1"]').click();
    await settle();
    const start = [...el.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Start',
    )!;
    start.click();
    start.click();
    await settle();
    expect(calls).toBe(1);
    expect(el.querySelector('[role=alert]')?.textContent).toContain('limit');
    expect(radio('input[name=rate][value="1"]').checked).toBe(true);
    click('Start');
    await settle();
    expect(calls).toBe(2);
  });

  it('a bad custom rate is explained and nothing is sent', async () => {
    const createGame = vi.fn(async () => 'x');
    await open('/?lobby=1', { createGame });
    radio('input[name=rate][value=custom]').click();
    await settle();
    const box = el.querySelector<HTMLInputElement>('input[aria-label="Custom clock rate"]')!;
    box.value = 'fast';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    click('Start');
    await settle();
    expect(createGame).not.toHaveBeenCalled();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Clock rate');
  });

  it('Continue opens that game at its own URL, with the table and the game menu', async () => {
    await open('/');
    click('Continue');
    await settle();
    expect(window.location.search).toBe('?game=g1');
    expect(el.querySelector('canvas')).not.toBeNull();
    expect(el.textContent).toContain('Menu (Esc)');
    click('Menu (Esc)');
    await settle();
    expect(el.querySelector('#account')?.textContent).toContain('me@example.test');
  });

  it('browser back from a loaded game needs a clean page load, and closes the connection', async () => {
    const g = await open('/');
    click('Continue');
    await settle();
    window.history.back();
    await new Promise((r) => window.addEventListener('popstate', r, { once: true }));
    expect(g['disconnect']).toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
  });
});

describe('query-parameter routing', () => {
  it('?new=1 makes a game with the side and rate asked for and moves to its URL', async () => {
    const createQuickGame = vi.fn(async () => 'q1');
    await open('/?new=1&side=red&rate=4', { createQuickGame });
    expect(createQuickGame).toHaveBeenCalledWith('red', 4);
    expect(window.location.search).toBe('?game=q1');
    expect(el.querySelector('canvas')).not.toBeNull();
  });

  it('?game= takes a free side when you have none, and says when none is free', async () => {
    const joinSide = vi.fn(async () => undefined);
    const fetchGame = vi
      .fn<ShellApi['fetchGame']>()
      .mockResolvedValueOnce(info({ you: null }))
      .mockResolvedValue(info());
    await open('/?game=g1', { fetchGame, joinSide });
    expect(joinSide).toHaveBeenCalledWith('g1', 'red');
    expect(el.querySelector('canvas')).not.toBeNull();

    TestBed.resetTestingModule();
    await open('/?game=g1', {
      fetchGame: async () =>
        info({ you: null, sides: [{ side: 'blue', taken: true, ready: true }] }),
    });
    expect(el.querySelector('[role=alert]')?.textContent).toContain('every side');
  });

  it('?game= for a missing game shows the error', async () => {
    await open('/?game=zz', {
      fetchGame: async () => {
        throw new Error('no such game');
      },
    });
    expect(el.querySelector('[role=alert]')?.textContent).toContain('no such game');
  });

  it('?mode=fixture is gone (D28): signed in, it is the menu', async () => {
    await open('/?mode=fixture');
    expect(el.querySelector('canvas')).toBeNull();
    expect(el.querySelector('h1')?.textContent).toBe('Kriegsspiel');
  });
});

describe('lobby room', () => {
  it('waits in the room for a game that has not started, then opens it', async () => {
    const startGame = vi.fn(async () => undefined);
    let status: 'lobby' | 'started' = 'lobby';
    const fetchGame = async () => info({ status, creator: true });
    await open('/?game=g1', { fetchGame, startGame });
    expect(el.querySelector('#room-sides')?.textContent).toContain('red: open');
    expect(el.querySelector<HTMLInputElement>('#invite')!.value).toBe('http://x.test/?game=g1');
    expect(el.querySelector<HTMLButtonElement>('#room-start')!.disabled).toBe(true);
    expect(el.querySelector('#lobby-msg')?.textContent).toContain('Waiting for a player on red');
    expect(el.querySelector('canvas')).toBeNull();
    status = 'started';
    const room = f.debugElement.query((d) => d.name === 'ks-room').componentInstance;
    await room.poll();
    await settle();
    expect(el.querySelector('canvas')).not.toBeNull();
  });

  it('says so after repeated poll failures and recovers on the next success', async () => {
    let down = false;
    await open('/?game=g1', {
      fetchGame: async () => {
        if (down) throw new Error('offline');
        return info({ status: 'lobby', creator: false });
      },
    });
    const room = f.debugElement.query((d) => d.name === 'ks-room').componentInstance;
    down = true;
    for (let i = 0; i < 3; i++) await room.poll();
    await settle();
    expect(el.querySelector('#lobby-msg')?.textContent).toContain('Connection lost');
    down = false;
    await room.poll();
    await settle();
    expect(el.querySelector('#lobby-msg')?.textContent).not.toContain('Connection lost');
  });

  it('a guest without a seat can take a side', async () => {
    const joinSide = vi.fn(async () => undefined);
    await open('/?game=g1', {
      fetchGame: async () => info({ status: 'lobby', creator: false, you: null }),
      joinSide,
    });
    const take = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Take red'),
    );
    take!.click();
    await settle();
    expect(joinSide).toHaveBeenCalledWith('g1', 'red');
  });

  it('a seated guest can ready up', async () => {
    const setReady = vi.fn(async () => undefined);
    await open('/?game=g1', {
      fetchGame: async () => info({ status: 'lobby', creator: false, ready: false }),
      setReady,
    });
    expect(el.querySelector('#lobby-msg')?.textContent).toContain('Waiting for the host');
    el.querySelector<HTMLButtonElement>('#room-ready')!.click();
    await settle();
    expect(setReady).toHaveBeenCalledWith('g1', true);
  });
});

describe('in-game menu', () => {
  const esc = async (): Promise<void> => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
  };

  it('offers Resume, Leave to main menu and Sign out on Esc, with focus on Resume', async () => {
    await open('/?game=g1');
    expect(el.querySelector('[role=dialog]')).toBeNull();
    await esc();
    const dialog = el.querySelector('[role=dialog]')!;
    expect([...dialog.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Resume',
      'Leave to main menu',
      'Sign out',
      'Delete account',
    ]);
    expect(document.activeElement?.textContent).toBe('Resume');
    await esc();
    expect(el.querySelector('[role=dialog]')).toBeNull();
  });

  it('leaves Esc to the desk in a desk view, and to a text field', async () => {
    await open('/?game=g1');
    el.querySelector<HTMLButtonElement>('nav[aria-label=Desk] button:nth-child(3)')?.click();
    await settle();
    await esc();
    expect(el.querySelector('[role=dialog]')).toBeNull();
  });

  it('keeps Tab inside the open menu', async () => {
    await open('/?game=g1');
    await esc();
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('[role=dialog] button')];
    buttons.at(-1)!.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    window.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('Leave closes the connection, then loads the main menu on a fresh page', async () => {
    const g = await open('/?game=g1');
    await esc();
    click('Leave to main menu');
    expect(g['disconnect']).toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith('/');
  });

  it('Sign out signs out on the server and loads the home page', async () => {
    const signOut = vi.fn(async () => undefined);
    const g = await open('/?game=g1', { signOut });
    await esc();
    click('Sign out');
    await settle();
    expect(signOut).toHaveBeenCalledOnce();
    expect(g['disconnect']).toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith('/');
  });

  it('is not offered on the new-game screen', async () => {
    await open('/?lobby=1');
    expect(el.textContent).not.toContain('Menu (Esc)');
  });
});

describe('account bar', () => {
  it('Delete account asks first, then leaves for the home page', async () => {
    const deleteAccount = vi.fn(async () => true);
    await open('/?game=g1', { deleteAccount });
    click('Menu (Esc)');
    await settle();
    const confirmSpy = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    click('Delete account');
    await settle();
    expect(deleteAccount).not.toHaveBeenCalled();
    click('Delete account');
    await settle();
    expect(deleteAccount).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith('/');
    expect(confirmSpy).toHaveBeenCalledTimes(2);
  });
});
