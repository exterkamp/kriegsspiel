// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ContinuousSurface } from './hq/data/continuousSurface.js';
import { demoScope, FixtureSource } from './hq/data/fixture.js';
import { BrowserRepository } from './hq/data/repository.js';

const { mount, liveLoaded } = vi.hoisted(() => ({ mount: vi.fn(), liveLoaded: vi.fn() }));
vi.mock('svelte', async (original) => ({ ...(await original<object>()), mount }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.doUnmock('./liveClient.js');
  vi.doMock('./liveClient.js', () => {
    liveLoaded();
    return {};
  });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
});

it('mounts the scoped HQ fixture without importing the live client for the root URL', async () => {
  window.history.replaceState(null, '', '/');
  await import('./main.js');
  expect(mount).toHaveBeenCalledOnce();
  const options = mount.mock.calls[0]![1];
  expect(options.target).toBe(document.getElementById('app'));
  // Module resets give these constructors fresh identities; check their public contract as well.
  expect(options.props.source.constructor.name).toBe(FixtureSource.name);
  expect(options.props.surface.constructor.name).toBe(ContinuousSurface.name);
  expect(options.props.repository.constructor.name).toBe(BrowserRepository.name);
  expect(options.props.source.scope).toEqual(demoScope);
  expect(liveLoaded).not.toHaveBeenCalled();
});

it.each(['/?new=1&side=blue&rate=12', '/?game=accepted-game'])(
  'selects the accepted live composition for %s without mounting HQ',
  async (url) => {
    window.history.replaceState(null, '', url);
    await import('./main.js');
    await vi.waitFor(() => expect(liveLoaded).toHaveBeenCalledOnce());
    expect(mount).not.toHaveBeenCalled();
  },
);
