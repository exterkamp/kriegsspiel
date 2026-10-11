/** The app shell's screens and the moves between them. Plain data and pure functions; the DOM lives in boot.ts. */
import { parseSession } from '../session.js';

export type Screen =
  | { name: 'sign-in' }
  | { name: 'menu' }
  | { name: 'new-game' }
  | { name: 'game'; game?: string; side?: string; create?: { side?: string; rate?: number } }
  | { name: 'game-over'; game: string }
  | { name: 'fixture' };

export type ScreenName = Screen['name'];

export interface ShellState {
  screen: Screen;
  signedIn: boolean;
}

export type ShellEvent =
  | { type: 'auth'; signedIn: boolean }
  /** The player chose to go somewhere (a button or link inside the app). */
  | { type: 'go'; screen: Screen }
  /** The browser moved through history, or the page just opened: the URL decides. */
  | { type: 'location'; search: string };

/** Screens that need no account. */
const open = (s: Screen): boolean => s.name === 'fixture';

/** Where a signed-out visitor is held, and where a signed-in one is sent from there. */
const guard = (screen: Screen, signedIn: boolean): Screen =>
  signedIn || open(screen) ? screen : { name: 'sign-in' };

/** The screen a URL asks for. Existing URLs keep their meaning: `?new`, `?game=`, `?lobby=1`, `mode=fixture`. */
export function screenFromSearch(search: string): Screen {
  const p = parseSession(search);
  switch (p.mode) {
    case 'fixture':
      return { name: 'fixture' };
    case 'lobby':
      return { name: 'new-game' };
    case 'create':
      return {
        name: 'game',
        create: { ...(p.side ? { side: p.side } : {}), ...(p.rate ? { rate: p.rate } : {}) },
      };
    case 'join':
      return new URLSearchParams(search).has('over')
        ? { name: 'game-over', game: p.game }
        : { name: 'game', game: p.game, ...(p.side ? { side: p.side } : {}) };
    case 'menu':
      return { name: 'menu' };
  }
}

/** The URL (path and query) that reopens a screen. A reload on it returns to the same screen. */
export function urlFor(screen: Screen): string {
  switch (screen.name) {
    case 'sign-in':
    case 'menu':
      return '/';
    case 'new-game':
      return '/?lobby=1';
    case 'fixture':
      return '/?mode=fixture';
    case 'game-over':
      return `/?game=${encodeURIComponent(screen.game)}&over=1`;
    case 'game': {
      if (screen.game) {
        const side = screen.side ? `&side=${encodeURIComponent(screen.side)}` : '';
        return `/?game=${encodeURIComponent(screen.game)}${side}`;
      }
      const q = new URLSearchParams({ new: '1' });
      if (screen.create?.side) q.set('side', screen.create.side);
      if (screen.create?.rate) q.set('rate', String(screen.create.rate));
      return `/?${q.toString()}`;
    }
  }
}

export function initialShell(search: string, signedIn: boolean): ShellState {
  return { screen: guard(screenFromSearch(search), signedIn), signedIn };
}

export function reduce(state: ShellState, e: ShellEvent): ShellState {
  switch (e.type) {
    case 'auth':
      // Signing in leaves the sign-in screen for the menu; signing out leaves everything but the fixture.
      return {
        signedIn: e.signedIn,
        screen: e.signedIn
          ? state.screen.name === 'sign-in'
            ? { name: 'menu' }
            : state.screen
          : guard(state.screen, false),
      };
    case 'go':
      return { ...state, screen: guard(e.screen, state.signedIn) };
    case 'location':
      return { ...state, screen: guard(screenFromSearch(e.search), state.signedIn) };
  }
}

/** Screens served by the live client (the 3D table and its desk), as opposed to the shell's own pages. */
export const isLiveScreen = (s: Screen): boolean => s.name === 'game' || s.name === 'game-over';

/** Whether moving between two screens needs a fresh page: the live client cannot be unloaded or re-aimed. */
export const needsReload = (from: Screen, to: Screen, liveLoaded: boolean): boolean =>
  liveLoaded && (isLiveScreen(from) || isLiveScreen(to)) && urlFor(from) !== urlFor(to);
