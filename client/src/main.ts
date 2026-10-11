import { mount, unmount } from 'svelte';
import App from './hq/App.svelte';
import { demoArtwork, demoScope, FixtureSource } from './hq/data/fixture.js';
import { BrowserRepository } from './hq/data/repository.js';
import { ContinuousSurface } from './hq/data/continuousSurface.js';
import { parseSession } from './session.js';

const app = document.getElementById('app');
if (app && parseSession(window.location.search).mode !== 'fixture') {
  // Preserve the accepted live client while the HQ live adapter remains contract-gated.
  void import('./liveClient.js');
} else if (app) {
  const component = mount(App, {
    target: app,
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
