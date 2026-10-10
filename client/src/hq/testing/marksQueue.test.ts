// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import Harness from './MarksShellHarness.svelte';
import { artwork, makePorts, ok, scope } from '../shell/fakes';
import type { MapPresentation, PersonalMark, Result } from '../contracts';
let app: { setMarks(next: readonly PersonalMark[]): void } | null = null;
let target: HTMLDivElement;
const flush = async () => {
  for (let i = 0; i < 15; i++) {
    await Promise.resolve();
    await tick();
  }
};
const mark = (label: string): PersonalMark => ({
  id: 'personal-1',
  scope,
  map: { id: artwork.id, revision: artwork.revision },
  label,
  geometry: { kind: 'pin', at: { x: 325.75, y: 815.125 } },
  source: { kind: 'manual' },
  placedAtGame: null,
  editedAtGame: null,
});
beforeEach(() => {
  target = document.createElement('div');
  document.body.append(target);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(async () => {
  if (app) await unmount(app);
  app = null;
  target.remove();
  vi.unstubAllGlobals();
});
async function render() {
  const ports = makePorts();
  app = mount(Harness, { target, props: { ...ports, artwork } }) as {
    setMarks(next: readonly PersonalMark[]): void;
  };
  await flush();
  return ports;
}
it('combines a pending newer source with current marks and ignores superseded completion', async () => {
  const ports = await render();
  let finish!: (result: Result<void>) => void;
  vi.mocked(ports.surface.apply).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const newer = {
    ...ports.snapshot,
    ordinal: 2,
    atGame: 20,
    pieces: [{ ...ports.snapshot.pieces[0]!, label: 'New source formation' }],
  };
  ports.emit({ connection: 'ready', stale: false, snapshot: newer, error: null });
  await flush();
  app!.setMarks([mark('Latest personal annotation')]);
  await flush();
  expect(target.textContent).toContain('snapshot at 10 game ms');
  finish(ok(undefined));
  await flush();
  const last = vi.mocked(ports.surface.apply).mock.calls.at(-1)![0];
  expect(last.snapshot.ordinal).toBe(2);
  expect(last.marks[0]?.label).toBe('Latest personal annotation');
  expect(target.textContent).toContain('snapshot at 20 game ms');
  expect(target.textContent).toContain('New source formation');
});
it.each(['offline', 'error'] as const)(
  'keeps %s health frozen after a late mark apply and later reapply',
  async (connection) => {
    const ports = await render();
    let finish!: (result: Result<void>) => void;
    vi.mocked(ports.surface.apply).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    app!.setMarks([mark('Before disconnect')]);
    await flush();
    ports.emit({
      connection,
      stale: true,
      snapshot: null,
      error: { code: 'offline', message: 'Connection lost.', retry: 'read-only' },
    });
    await flush();
    finish(ok(undefined));
    await flush();
    expect(target.textContent).toContain('stale snapshot');
    app!.setMarks([mark('After disconnect')]);
    await flush();
    const last: MapPresentation = vi.mocked(ports.surface.apply).mock.calls.at(-1)![0];
    expect(last.marks[0]?.label).toBe('After disconnect');
    expect(target.textContent).toContain('stale snapshot');
    expect(target.textContent).toContain('Connection lost.');
    ports.emit({
      connection: 'ready',
      stale: false,
      snapshot: { ...ports.snapshot, ordinal: 2, atGame: 20 },
      error: null,
    });
    await flush();
    expect(vi.mocked(ports.surface.apply).mock.calls.at(-1)![0].marks[0]?.label).toBe(
      'After disconnect',
    );
    expect(target.textContent).not.toContain('stale snapshot');
  },
);
