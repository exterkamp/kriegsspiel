import { mount, unmount } from 'svelte';
import App from './hq/App.svelte';
import { demoArtwork, demoScope, FixtureSource } from './hq/data/fixture.js';
import { BrowserRepository } from './hq/data/repository.js';
import { ContinuousSurface } from './hq/data/continuousSurface.js';
import { fetchMe, guestEnabled, requestLink, signOut, startGuest } from './auth.js';
import { fetchGames, fetchScenarios } from './lobby/api.js';
import { startShell } from './shell/boot.js';

function startFixture(target: HTMLElement): void {
  const component = mount(App, {
    target,
    props: {
      source: new FixtureSource(demoScope),
      surface: new ContinuousSurface(demoScope),
      repository: new BrowserRepository(demoScope, () => window.localStorage),
      artwork: demoArtwork,
    },
  });
  import.meta.hot?.dispose(() => {
    void unmount(component);
  });
}

const app = document.getElementById('app');
if (app) {
  void startShell({
    app,
    win: window,
    fetchMe,
    fetchGames,
    fetchScenarios,
    requestLink,
    signOut,
    guestEnabled,
    startGuest,
    // The accepted live client (3D table and desk) is the game screen; it reads its game from the URL.
    startLive: () => import('./liveClient.js').then(() => undefined),
    startFixture,
    now: Date.now,
  });
}
