import { describe, expect, it } from 'vitest';
import {
  initialShell,
  isLiveScreen,
  needsReload,
  reduce,
  screenFromSearch,
  urlFor,
  type Screen,
  type ShellState,
} from './screens.js';

const menu: Screen = { name: 'menu' };
const signedIn = (screen: Screen): ShellState => ({ screen, signedIn: true });
const signedOut = (screen: Screen): ShellState => ({ screen, signedIn: false });

describe('opening the site', () => {
  it('shows sign-in when signed out and the menu when signed in, never a game', () => {
    expect(initialShell('', false).screen).toEqual({ name: 'sign-in' });
    expect(initialShell('', true).screen).toEqual(menu);
  });
  it('holds a signed-out visitor at sign-in for every account-only URL', () => {
    for (const q of ['?new=1', '?game=g', '?lobby=1', '?game=g&over=1'])
      expect(initialShell(q, false).screen).toEqual({ name: 'sign-in' });
  });
  it('no longer has a fixture screen: mode=fixture is the menu, or sign-in when signed out', () => {
    expect(initialShell('?mode=fixture', false).screen).toEqual({ name: 'sign-in' });
    expect(initialShell('?mode=fixture', true).screen).toEqual(menu);
  });
});

describe('existing URLs', () => {
  it.each<[string, Screen]>([
    ['?new=1&side=blue&rate=12', { name: 'game', create: { side: 'blue', rate: 12 } }],
    ['?game=abc', { name: 'game', game: 'abc' }],
    ['?game=abc&side=red', { name: 'game', game: 'abc', side: 'red' }],
    ['?game=abc&over=1', { name: 'game-over', game: 'abc' }],
    ['?lobby=1', { name: 'new-game' }],
    ['?mode=fixture', menu],
    ['', menu],
  ])('%s', (q, screen) => expect(screenFromSearch(q)).toEqual(screen));
  it('round-trips every screen through its URL, so a reload returns to the same one', () => {
    const screens: Screen[] = [
      menu,
      { name: 'new-game' },
      { name: 'game', game: 'a b', side: 'red' },
      { name: 'game', create: { side: 'blue', rate: 4 } },
      { name: 'game-over', game: 'g1' },
    ];
    for (const s of screens) expect(screenFromSearch(urlFor(s).slice(1))).toEqual(s);
  });
});

describe('transitions', () => {
  it('menu to new-game, to a game, to game-over and back to the menu', () => {
    let s = signedIn(menu);
    s = reduce(s, { type: 'go', screen: { name: 'new-game' } });
    expect(s.screen.name).toBe('new-game');
    s = reduce(s, { type: 'go', screen: { name: 'game', game: 'g' } });
    expect(s.screen).toEqual({ name: 'game', game: 'g' });
    s = reduce(s, { type: 'go', screen: { name: 'game-over', game: 'g' } });
    expect(s.screen.name).toBe('game-over');
    s = reduce(s, { type: 'go', screen: menu });
    expect(s.screen).toEqual(menu);
  });
  it('signing in moves from sign-in to the menu, and leaves other screens alone', () => {
    expect(reduce(signedOut({ name: 'sign-in' }), { type: 'auth', signedIn: true })).toEqual(
      signedIn(menu),
    );
    expect(
      reduce(signedIn({ name: 'game', game: 'g' }), { type: 'auth', signedIn: true }).screen,
    ).toEqual({ name: 'game', game: 'g' });
  });
  it('signing out from any screen lands on sign-in', () => {
    for (const screen of [menu, { name: 'new-game' }, { name: 'game', game: 'g' }] as Screen[])
      expect(reduce(signedIn(screen), { type: 'auth', signedIn: false })).toEqual(
        signedOut({ name: 'sign-in' }),
      );
  });
  it('refuses to go to an account-only screen while signed out', () => {
    expect(
      reduce(signedOut(menu), { type: 'go', screen: { name: 'game', game: 'g' } }).screen,
    ).toEqual({ name: 'sign-in' });
  });
  it('browser back and forward follow the URL, including to the same game after a reload', () => {
    let s = signedIn({ name: 'game', game: 'g' });
    s = reduce(s, { type: 'location', search: '' });
    expect(s.screen).toEqual(menu);
    s = reduce(s, { type: 'location', search: '?game=g' });
    expect(s.screen).toEqual({ name: 'game', game: 'g' });
    expect(initialShell('?game=g', true).screen).toEqual(s.screen);
  });
  it('back to a game after the session ended lands on sign-in', () => {
    expect(reduce(signedOut(menu), { type: 'location', search: '?game=g' }).screen.name).toBe(
      'sign-in',
    );
  });
});

describe('when a page reload is needed', () => {
  const game: Screen = { name: 'game', game: 'g' };
  it('is needed only once the live client is loaded and the move touches a live screen', () => {
    expect(needsReload(game, menu, true)).toBe(true);
    expect(needsReload(menu, game, true)).toBe(true);
    expect(needsReload(game, { name: 'game', game: 'h' }, true)).toBe(true);
    expect(needsReload(menu, game, false)).toBe(false);
    expect(needsReload(menu, { name: 'sign-in' }, true)).toBe(false);
    expect(needsReload(game, game, true)).toBe(false);
  });
  it('knows which screens the live client serves', () => {
    expect(['game', 'game-over'].every((n) => isLiveScreen({ name: n } as Screen))).toBe(true);
    expect(isLiveScreen({ name: 'new-game' })).toBe(false);
    expect(isLiveScreen(menu)).toBe(false);
  });
});
