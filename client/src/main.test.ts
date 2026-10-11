// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { mount, liveLoaded, startShell } = vi.hoisted(() => ({
  mount: vi.fn(),
  liveLoaded: vi.fn(),
  startShell: vi.fn(),
}));
vi.mock('svelte', async (original) => ({ ...(await original<object>()), mount }));
vi.mock('./shell/boot.js', () => ({ startShell }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
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

it(
  'hands the page to the shell, without loading the live client',
  { timeout: 30_000 },
  async () => {
    await import('./main.js');
    expect(startShell).toHaveBeenCalledOnce();
    expect(startShell.mock.calls[0]![0].app).toBe(document.getElementById('app'));
    expect(liveLoaded).not.toHaveBeenCalled();
    expect(mount).not.toHaveBeenCalled();
  },
);

it('loads the live client only when the shell asks for it', async () => {
  await import('./main.js');
  await startShell.mock.calls[0]![0].startLive();
  expect(liveLoaded).toHaveBeenCalledOnce();
});
