import { InjectionToken } from '@angular/core';
import { deleteAccount, fetchMe, guestEnabled, requestLink, signOut, startGuest } from '@legacy/auth';
import type { Me } from '@legacy/auth';
import {
  fetchGame,
  fetchGames,
  fetchScenarios,
  joinSide,
  setReady,
  startGame,
  type GameInfo,
  type GameSummary,
} from '@legacy/lobby/api';
import type { PlayedGame } from '@legacy/shell/continueList';
import type { CreateRequest, ScenarioOptions } from '@legacy/shell/newGame';
import { createGame, fetchScenarioOptions } from '@legacy/shell/newGameApi';

/** Everything the shell asks of the server, behind one token so specs can supply their own. */
export interface ShellApi {
  fetchMe: () => Promise<Me | undefined>;
  fetchGames: () => Promise<Array<GameSummary | PlayedGame>>;
  fetchScenarios: () => Promise<Array<{ id: string; name: string }>>;
  fetchScenarioOptions: () => Promise<ScenarioOptions>;
  createGame: (req: CreateRequest) => Promise<string>;
  requestLink: (email: string) => Promise<string | undefined>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<boolean>;
  guestEnabled: () => Promise<boolean>;
  startGuest: () => Promise<string | undefined>;
  fetchGame: (id: string) => Promise<GameInfo>;
  joinSide: (id: string, side: string) => Promise<void>;
  setReady: (id: string, ready: boolean) => Promise<void>;
  startGame: (id: string) => Promise<void>;
  /** Makes a game for `?new=1`, taking `side` (the server picks one when unset). */
  createQuickGame: (side?: string, rate?: number) => Promise<string>;
}

async function createQuickGame(side?: string, rate?: number): Promise<string> {
  const res = await fetch('/games', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...(rate === undefined ? {} : { rate }), ...(side ? { side } : {}) }),
  });
  if (!res.ok) throw new Error(`could not create a game (${res.status})`);
  return ((await res.json()) as { id: string }).id;
}

export const SHELL_API = new InjectionToken<ShellApi>('SHELL_API', {
  providedIn: 'root',
  factory: () => ({
    fetchMe: () => fetchMe(),
    fetchGames: () => fetchGames(),
    fetchScenarios: () => fetchScenarios(),
    fetchScenarioOptions: () => fetchScenarioOptions(),
    createGame: (req) => createGame(req),
    requestLink: (email) => requestLink(email),
    signOut: () => signOut(),
    deleteAccount: () => deleteAccount(),
    guestEnabled: () => guestEnabled(),
    startGuest: () => startGuest(),
    fetchGame: (id) => fetchGame(id),
    joinSide: (id, side) => joinSide(id, side),
    setReady: (id, ready) => setReady(id, ready),
    startGame: (id) => startGame(id),
    createQuickGame,
  }),
});

/** The browser window, as a token so specs can give the shell a fake location and history. */
export const SHELL_WINDOW = new InjectionToken<
  Pick<Window, 'location' | 'history' | 'addEventListener' | 'removeEventListener'>
>('SHELL_WINDOW', { providedIn: 'root', factory: () => window });

export const SHELL_NOW = new InjectionToken<() => number>('SHELL_NOW', {
  providedIn: 'root',
  factory: () => Date.now,
});
