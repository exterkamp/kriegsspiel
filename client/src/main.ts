import { fetchMe, guestEnabled, requestLink, signOut, startGuest } from './auth.js';
import { fetchGames, fetchScenarios } from './lobby/api.js';
import { createGame, fetchScenarioOptions } from './shell/newGameApi.js';
import { startShell } from './shell/boot.js';

const app = document.getElementById('app');
if (app) {
  void startShell({
    app,
    win: window,
    fetchMe,
    fetchGames,
    fetchScenarios,
    fetchScenarioOptions,
    createGame,
    requestLink,
    signOut,
    guestEnabled,
    startGuest,
    // The accepted live client (3D table and desk) is the game screen; it reads its game from the URL.
    startLive: () => import('./liveClient.js').then(() => undefined),
    now: Date.now,
  });
}
