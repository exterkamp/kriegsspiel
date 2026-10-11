// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type { Result } from '../../contracts';
import Plotting from './Plotting.svelte';
import ReportPlotHandle from './ReportPlotHandle.svelte';
import { capture, deferred, fail, ok, pointer, setup, value } from './fakes';
import type { PlotPointer } from './types';

let hub: HTMLDivElement;
let canvas: HTMLCanvasElement;
let target: HTMLDivElement;
let handles: ReturnType<typeof mount>[] = [];
let panel: ReturnType<typeof mount> | null = null;
let s: ReturnType<typeof setup>;
const disconnect = vi.fn();
const flush = async () => {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
    await tick();
  }
};
beforeEach(async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect = disconnect;
    },
  );
  s = setup();
  hub = document.body.appendChild(document.createElement('div'));
  canvas = hub.appendChild(document.createElement('canvas'));
  target = hub.appendChild(document.createElement('div'));
  panel = mount(Plotting, { target, props: { controller: s.controller, hub, canvas } });
  await flush();
});
afterEach(async () => {
  for (const handle of handles) await unmount(handle);
  handles = [];
  if (panel) await unmount(panel);
  panel = null;
  s.controller.dispose();
  hub.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function button(text: string, root: ParentNode = hub) {
  const found = Array.from(root.querySelectorAll('button')).find(
    (el) => el.textContent?.trim() === text,
  );
  if (!found) throw Error(`Missing ${text}`);
  return found;
}
function field(name: string) {
  return target.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
}
async function set(name: string, text: string) {
  field(name).value = text;
  field(name).dispatchEvent(new Event('input', { bubbles: true }));
  await flush();
}
function pointerEvent(type: string, p = pointer()) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: p.clientXCssPx,
    clientY: p.clientYCssPx,
    button: p.button,
  });
  Object.defineProperties(event, {
    pointerId: { value: p.pointerId },
    pointerType: { value: p.pointerType },
    isPrimary: { value: p.isPrimary },
  });
  return event;
}
async function begin(p: PlotPointer | null = null) {
  const r = value(s.controller.begin(capture(), p));
  await r.ready;
  await flush();
  return r;
}
function submit() {
  target
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}
async function handle(disabled = false) {
  const slot = hub.appendChild(document.createElement('div'));
  const onStart = vi.fn((id: string, p: PlotPointer | null) =>
    s.controller.begin({ ...capture(), paperId: id }, p),
  );
  const mounted = mount(ReportPlotHandle, {
    target: slot,
    props: { paperId: 'paper', disabled, onStart },
  });
  handles.push(mounted);
  await flush();
  return { slot, onStart, mounted };
}

it('dedicated primary handle captures at persistent hub before desk handle unmount; drop survives it', async () => {
  const h = await handle();
  const holding = new Set<number>();
  const captureHub = vi.fn((id: number) => holding.add(id));
  s.ports.capturePointer.mockImplementation((id) => {
    captureHub(id);
    return ok(() => {
      holding.delete(id);
      hub.dispatchEvent(pointerEvent('lostpointercapture'));
    });
  });
  button('Drag report to map', h.slot).dispatchEvent(pointerEvent('pointerdown'));
  expect(h.onStart).toHaveBeenCalledTimes(1);
  expect(captureHub).toHaveBeenCalledWith(7);
  await unmount(h.mounted);
  handles = [];
  h.slot.remove();
  await flush();
  expect(holding.has(7)).toBe(true);
  const event = pointerEvent('pointerup');
  hub.dispatchEvent(event);
  await flush();
  expect(event.defaultPrevented).toBe(true);
  expect(s.ports.createPin).toHaveBeenCalledTimes(1);
  expect(holding.size).toBe(0);
  expect(target.textContent).toContain('Created locally; unsaved.');
});
it('native keyboard and coordinate buttons pass null; physical compatibility click never starts twice', async () => {
  const h = await handle();
  button('Drag report to map', h.slot).dispatchEvent(
    new MouseEvent('click', { bubbles: true, detail: 0 }),
  );
  expect(h.onStart.mock.calls[0]).toEqual(['paper', null]);
  await flush();
  value(s.controller.cancel(s.controller.getState().requestId!));
  await flush();
  button('Choose report coordinates', h.slot).click();
  expect(h.onStart.mock.calls[1]).toEqual(['paper', null]);
  value(s.controller.cancel(s.controller.getState().requestId!));
  await flush();
  const drag = button('Drag report to map', h.slot);
  drag.dispatchEvent(pointerEvent('pointerdown', pointer({ pointerType: 'touch' })));
  drag.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  expect(h.onStart).toHaveBeenCalledTimes(3);
});
it.each([
  pointer({ button: 2 }),
  pointer({ isPrimary: false }),
  pointer({ pointerType: 'pen', isPrimary: false }),
])('ignores ineligible initiating pointer %j', async (p) => {
  const h = await handle();
  button('Drag report to map', h.slot).dispatchEvent(pointerEvent('pointerdown', p));
  expect(h.onStart).not.toHaveBeenCalled();
});
it('disabled handle cannot invoke pointer or keyboard starts; dragstart is refused', async () => {
  const h = await handle(true);
  const drag = button('Drag report to map', h.slot);
  drag.dispatchEvent(pointerEvent('pointerdown'));
  drag.click();
  button('Choose report coordinates', h.slot).click();
  expect(h.onStart).not.toHaveBeenCalled();
  const event = new Event('dragstart', { cancelable: true });
  drag.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
});
it('numeric chosen coordinates retain invalid fields, enforce finite inclusive bounds and label limit, then create once', async () => {
  await begin();
  expect(document.activeElement).toBe(field('east'));
  expect(field('east').value).toBe('');
  expect(field('south').value).toBe('');
  submit();
  await flush();
  expect(s.ports.createPin).not.toHaveBeenCalled();
  expect(field('east').value).toBe('');
  await set('east', '4000.000001');
  await set('south', '0');
  submit();
  await flush();
  expect(field('east').value).toBe('4000.000001');
  expect(s.ports.createPin).not.toHaveBeenCalled();
  await set('east', '4000');
  await set('south', '3000');
  await set('label', 'a'.repeat(257));
  submit();
  expect(s.ports.createPin).not.toHaveBeenCalled();
  await set('label', '<b>Chosen point</b>');
  submit();
  submit();
  await flush();
  expect(s.ports.createPin).toHaveBeenCalledTimes(1);
  expect(s.ports.createPin.mock.calls[0]!.slice(1)).toEqual([
    { x: 4000, y: 3000 },
    '<b>Chosen point</b>',
  ]);
  expect(target.textContent).toContain('Created locally; unsaved.');
  expect(target.querySelector('b')).toBeNull();
});
it('reported location is labelled and offered without automatic creation; source text is plain', async () => {
  const raw = capture();
  Object.assign(raw.snapshot.papers[0]!, {
    location: { x: 10, y: 20 },
    text: '<script>unsafe</script>',
  });
  const r = value(s.controller.begin(raw, null));
  await r.ready;
  await flush();
  expect(field('east').value).toBe('10');
  expect(field('south').value).toBe('20');
  expect(target.textContent).toContain('Reported location: 10, 20 metres');
  expect(target.textContent).toContain('<script>unsafe</script>');
  expect(target.querySelector('script')).toBeNull();
  expect(s.ports.createPin).not.toHaveBeenCalled();
  expect(target.querySelector('h3')?.textContent).toBe('Place captured report pin');
  expect(target.querySelectorAll('label')).toHaveLength(3);
  expect(target.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
});
it('drag consumes capture-phase canvas events before controls/selection, but form input contacts remain ordinary', async () => {
  await begin(pointer());
  const downstream = vi.fn();
  canvas.addEventListener('pointerup', downstream);
  canvas.dispatchEvent(pointerEvent('pointerup'));
  await flush();
  expect(downstream).not.toHaveBeenCalled();
  expect(s.ports.createPin).toHaveBeenCalledTimes(1);
  await begin();
  const inputDown = pointerEvent('pointerdown');
  field('east').dispatchEvent(inputDown);
  expect(inputDown.defaultPrevented).toBe(false);
  expect(s.controller.getState().pointerId).toBeNull();
});
it('suppresses only matching physical compatibility click; keyboard/unrelated click and new physical contact remain usable', async () => {
  await begin(pointer());
  canvas.dispatchEvent(pointerEvent('pointerup'));
  await flush();
  const keyboard = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 });
  canvas.dispatchEvent(keyboard);
  expect(keyboard.defaultPrevented).toBe(false);
  const unrelated = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    detail: 1,
    clientX: 10,
    clientY: 20,
  });
  canvas.dispatchEvent(unrelated);
  expect(unrelated.defaultPrevented).toBe(false);
  const click = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    detail: 1,
    clientX: 350.125,
    clientY: 250.875,
  });
  canvas.dispatchEvent(click);
  expect(click.defaultPrevented).toBe(true);
  await begin(pointer());
  canvas.dispatchEvent(pointerEvent('pointerup'));
  await flush();
  canvas.dispatchEvent(pointerEvent('pointerdown'));
  const nextClick = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    detail: 1,
    clientX: 350.125,
    clientY: 250.875,
  });
  canvas.dispatchEvent(nextClick);
  expect(nextClick.defaultPrevented).toBe(false);
});
it('resize/scroll replays owner CSS move and up uses current rectangle with no DPR scaling', async () => {
  await begin(pointer());
  let left = 0;
  let width = 1000;
  s.ports.pickAt.mockImplementation((x, y) =>
    ok({ kind: 'map', at: { x: ((x - left) / width) * 4000, y: (y / 1000) * 3000 } }),
  );
  const move = pointer({ clientXCssPx: 250, clientYCssPx: 200 });
  canvas.dispatchEvent(pointerEvent('pointermove', move));
  await flush();
  expect(s.controller.getState().preview?.at).toEqual({ x: 1000, y: 600 });
  left = 50;
  width = 500;
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 3 });
  window.dispatchEvent(new Event('resize'));
  await flush();
  expect(s.controller.getState().preview?.at).toEqual({ x: 1600, y: 600 });
  window.dispatchEvent(new Event('scroll'));
  await flush();
  canvas.dispatchEvent(
    pointerEvent('pointerup', pointer({ clientXCssPx: 300, clientYCssPx: 250 })),
  );
  expect(s.ports.createPin.mock.calls[0]![1]).toEqual({ x: 2000, y: 750 });
  expect(s.ports.pickAt.mock.calls.at(-1)).toEqual([300, 250]);
});
it('numeric offscreen preview survives scroll/resize and never mutates marks', async () => {
  await begin();
  s.ports.project.mockReturnValue(ok(null));
  await set('east', '1.25');
  await set('south', '2.5');
  expect(target.textContent).toContain('Preview: 1.25, 2.5 metres (offscreen)');
  expect(target.querySelector('.preview')).toBeNull();
  window.dispatchEvent(new Event('scroll'));
  await flush();
  expect(s.ports.project.mock.calls.at(-1)).toEqual([{ x: 1.25, y: 2.5 }]);
  expect(s.ports.createPin).not.toHaveBeenCalled();
});
it('panel/offmap up ends pointer only; next numeric submission can create the same frozen request', async () => {
  const r = await begin(pointer());
  s.ports.pickAt.mockReturnValueOnce(ok({ kind: 'none' }));
  hub.dispatchEvent(pointerEvent('pointerup'));
  await flush();
  expect(s.controller.getState()).toMatchObject({
    requestId: r.id,
    phase: 'placing',
    pointerId: null,
  });
  await set('east', '32.125');
  await set('south', '40');
  submit();
  await flush();
  expect(s.ports.createPin).toHaveBeenCalledTimes(1);
});
it.each(['pointercancel', 'lostpointercapture', 'secondary', 'Escape', 'blur', 'hidden', 'button'])(
  '%s cancels an owned gesture and releases resources without creation',
  async (mode) => {
    await begin(pointer({ pointerType: 'touch' }));
    if (mode === 'pointercancel' || mode === 'lostpointercapture')
      hub.dispatchEvent(pointerEvent(mode, pointer({ pointerType: 'touch' })));
    if (mode === 'secondary')
      canvas.dispatchEvent(
        pointerEvent(
          'pointerdown',
          pointer({ pointerId: 9, pointerType: 'touch', isPrimary: false }),
        ),
      );
    if (mode === 'Escape')
      field('east').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    if (mode === 'blur') window.dispatchEvent(new Event('blur'));
    if (mode === 'hidden') {
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      document.dispatchEvent(new Event('visibilitychange'));
    }
    if (mode === 'button') button('Cancel placement').click();
    await flush();
    expect(s.controller.getState().phase).toBe('finished');
    expect(s.ports.createPin).not.toHaveBeenCalled();
    expect(s.releaseControls).toHaveBeenCalledTimes(1);
    expect(s.releasePointer).toHaveBeenCalledTimes(1);
  },
);
it('release before ready cancels promptly and late navigation cannot autofocus/create', async () => {
  const d = deferred<Result<void>>();
  s.ports.enterTable.mockReturnValue(d.promise);
  const r = value(s.controller.begin(capture(), pointer()));
  hub.dispatchEvent(pointerEvent('pointerup'));
  expect(await r.ready).toMatchObject({ ok: false });
  d.resolve(ok(undefined));
  await flush();
  expect(target.querySelector('form')).toBeNull();
  expect(s.ports.createPin).not.toHaveBeenCalled();
});
it('recoverable creation failure retains numeric fields; thrown creation consumes form with truthful unknown status', async () => {
  await begin();
  await set('east', '12');
  await set('south', '34');
  await set('label', 'Retained');
  s.ports.createPin.mockReturnValueOnce(fail('Busy'));
  submit();
  await flush();
  expect(field('east').value).toBe('12');
  expect(field('south').value).toBe('34');
  expect(field('label').value).toBe('Retained');
  s.ports.createPin.mockImplementation(() => {
    throw Error('after RAM mutation');
  });
  submit();
  await flush();
  expect(target.textContent).toContain('Creation outcome unknown');
  expect(target.querySelector('form')).toBeNull();
  expect(s.ports.createPin).toHaveBeenCalledTimes(2);
});
it('unmount cancels active request and removes listeners/observer; queued numeric focus cannot run', async () => {
  const d = deferred<Result<void>>();
  s.ports.enterTable.mockReturnValue(d.promise);
  const r = value(s.controller.begin(capture(), null));
  const focus = vi.spyOn(HTMLElement.prototype, 'focus');
  await unmount(panel!);
  panel = null;
  expect(s.controller.getState().phase).toBe('finished');
  expect(await r.ready).toMatchObject({ ok: false });
  d.resolve(ok(undefined));
  await flush();
  const calls = s.ports.pickAt.mock.calls.length;
  canvas.dispatchEvent(pointerEvent('pointermove'));
  canvas.dispatchEvent(pointerEvent('pointerup'));
  window.dispatchEvent(new Event('resize'));
  window.dispatchEvent(new Event('scroll'));
  expect(s.ports.pickAt).toHaveBeenCalledTimes(calls);
  expect(focus).not.toHaveBeenCalled();
  expect(disconnect).toHaveBeenCalled();
  // The root owns final disposal, not this listener component.
  expect(s.controller.getState().phase).toBe('finished');
});
