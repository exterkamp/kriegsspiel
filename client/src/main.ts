import { mount, unmount } from 'svelte';
import Shell from './hq/shell/Shell.svelte';
import { demoArtwork, demoScope, FixtureSource } from './hq/data/fixture.js';
import { BrowserRepository } from './hq/data/repository.js';
import { LegacySurface } from './hq/data/legacySurface.js';

const app = document.getElementById('app');
if (app) {
  const component = mount(Shell, {
    target: app,
    props: {
      source: new FixtureSource(demoScope),
      surface: new LegacySurface(demoScope),
      repository: new BrowserRepository(demoScope, () => window.localStorage),
      artwork: demoArtwork,
    },
  });
  import.meta.hot?.dispose(() => {
    void unmount(component);
  });
}
