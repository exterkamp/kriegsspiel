// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import Plotting from './Plotting.svelte';
import { capture, pointer, setup, value } from './fakes';
import type { PlotState, ReportPlacementController } from './types';

let hub: HTMLDivElement;
let canvas: HTMLCanvasElement;
let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
let s: ReturnType<typeof setup>;
const flush = async () => {
  await tick();
  await tick();
};
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  s = setup();
  hub = document.body.appendChild(document.createElement('div'));
  canvas = hub.appendChild(document.createElement('canvas'));
  target = hub.appendChild(document.createElement('div'));
});
afterEach(async () => {
  if (component) await unmount(component);
  component = null;
  s.controller.dispose();
  hub.remove();
  vi.unstubAllGlobals();
});
async function render(controller: ReportPlacementController = s.controller) {
  component = mount(Plotting, { target, props: { controller, hub, canvas } });
  await flush();
}
const text = () => target.textContent?.replace(/\s+/g, ' ');

it('formats captured written/received/observed/placement timestamps while keeping exact capture values', async () => {
  const raw = capture();
  const supplied = {
    ...raw,
    gameMs: 90062009,
    snapshot: {
      ...raw.snapshot,
      atGame: 90062009,
      papers: [
        {
          ...raw.snapshot.papers[0]!,
          writtenAtGame: 999,
          receivedAtGame: 90061007,
          observedAtGame: 0,
        },
      ],
    },
  };
  const request = value(s.controller.begin(supplied, null));
  await request.ready;
  await render();
  expect(text()).toContain(
    'Written: 00:00:00 · Received: 25:01:01 · Observed: 00:00:00 · Placement time: 25:01:02',
  );
  expect(text()).not.toContain('game ms');
  expect(s.controller.getState().paper?.receivedAtGame).toBe(90061007);
  expect(s.controller.getState().gameMs).toBe(90062009);
  expect(s.ports.createPin).not.toHaveBeenCalled();
});

it('keeps absent observed and placement times explicitly unavailable', async () => {
  const request = value(s.controller.begin({ ...capture(), gameMs: null }, null));
  await request.ready;
  await render();
  expect(text()).toContain('Observed: Time unavailable · Placement time: Time unavailable');
});

it('yields Escape to an open dialog outside the plotting hub, then cancels after it closes', async () => {
  const request = value(s.controller.begin(capture(), null));
  await request.ready;
  await render();
  const dialog = document.createElement('dialog');
  document.body.append(dialog);
  try {
    dialog.open = true;
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    dialog.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
    expect(s.controller.getState().phase).toBe('placing');
    expect(s.releaseControls).not.toHaveBeenCalled();
    dialog.open = false;
    const nextEscape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(nextEscape);
    await flush();
    expect(nextEscape.defaultPrevented).toBe(true);
    expect(s.controller.getState().phase).toBe('finished');
    expect(s.releaseControls).toHaveBeenCalledOnce();
    expect(s.ports.createPin).not.toHaveBeenCalled();
  } finally {
    dialog.remove();
  }
});

it('does not turn Escape from an explicitly inert placement control into cancellation', async () => {
  const request = value(s.controller.begin(capture(), null));
  await request.ready;
  await render();
  const panel = target.querySelector('section')!;
  panel.setAttribute('inert', '');
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  panel.querySelector('input')!.dispatchEvent(escape);
  expect(escape.defaultPrevented).toBe(false);
  expect(s.controller.getState().phase).toBe('placing');
  expect(s.releaseControls).not.toHaveBeenCalled();
  panel.removeAttribute('inert');
  panel.querySelector('input')!.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }),
  );
  await flush();
  expect(s.controller.getState().phase).toBe('finished');
});

it('still cancels an owned pointer on pointercancel while a dialog is open', async () => {
  const request = value(s.controller.begin(capture(), pointer()));
  await request.ready;
  await render();
  const dialog = hub.appendChild(document.createElement('dialog'));
  dialog.open = true;
  const event = new Event('pointercancel', { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId: 7,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    clientX: 350.125,
    clientY: 250.875,
  });
  canvas.dispatchEvent(event);
  await flush();
  expect(s.controller.getState().phase).toBe('finished');
  expect(s.releasePointer).toHaveBeenCalledOnce();
  expect(s.releaseControls).toHaveBeenCalledOnce();
  expect(s.ports.createPin).not.toHaveBeenCalled();
});

it.each([-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])(
  'renders invalid supplied presentation time %s explicitly unavailable',
  async (time) => {
    // Production capture rejects malformed data; verify the display boundary independently.
    const state: PlotState = {
      ...s.controller.getState(),
      phase: 'finished',
      gameMs: time,
      paper: {
        ...capture().snapshot.papers[0]!,
        writtenAtGame: time,
        receivedAtGame: time,
        observedAtGame: time,
      },
    };
    await render({
      ...s.controller,
      getState: () => state,
      subscribe: (listener) => {
        listener(state);
        return () => {};
      },
    });
    expect(text()).toContain(
      'Written: Time unavailable · Received: Time unavailable · Observed: Time unavailable · Placement time: Time unavailable',
    );
  },
);
