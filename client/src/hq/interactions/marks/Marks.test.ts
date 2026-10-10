// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import { fromStore, writable } from 'svelte/store';
import Marks from './Marks.svelte';
import { fail, mark, ok, paper, props } from './fakes';
import type { MarkGeometry, Result } from '../../contracts';

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
const flush = async () => {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
    await tick();
  }
};
const button = (text: string) =>
  Array.from(target.querySelectorAll('button')).find((el) => el.textContent === text)!;
const control = (name: string) =>
  target.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    `[name="${name}"]`,
  )!;
async function set(name: string, value: string) {
  const el = control(name);
  el.value = value;
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  await flush();
}
async function submit() {
  target
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
}
async function render(options = props()) {
  component = mount(Marks, { target, props: options });
  await flush();
  return options;
}
beforeEach(() => {
  target = document.createElement('div');
  document.body.append(target);
});
afterEach(async () => {
  if (component) await unmount(component);
  component = null;
  target.remove();
  vi.restoreAllMocks();
});
const shapes: MarkGeometry[] = [
  { kind: 'pin', at: { x: 0, y: 3000 } },
  {
    kind: 'polyline',
    points: [
      { x: 1.25, y: 2.5 },
      { x: 3100, y: 1200 },
    ],
  },
  {
    kind: 'arrow',
    points: [
      { x: 1.25, y: 2.5 },
      { x: 3100, y: 1200 },
    ],
  },
  { kind: 'ring', centre: { x: 350, y: 250 }, radiusM: 5000 },
  { kind: 'symbol', at: { x: 350, y: 250 }, symbol: 'flag' },
];
async function enterShape(shape: MarkGeometry) {
  await set('kind', shape.kind);
  if (shape.kind === 'polyline' || shape.kind === 'arrow')
    await set('points', shape.points.map((at) => `${at.x}, ${at.y}`).join('\n'));
  else if (shape.kind === 'ring') {
    await set('x', String(shape.centre.x));
    await set('y', String(shape.centre.y));
    await set('radius', String(shape.radiusM));
  } else if ('at' in shape) {
    await set('x', String(shape.at.x));
    await set('y', String(shape.at.y));
    if (shape.kind === 'symbol') await set('symbol', shape.symbol);
  }
}

describe('numeric personal fixture marks', () => {
  it.each(shapes)(
    'creates $kind from accessible text/numeric fields without snapping',
    async (shape) => {
      const options = await render();
      await enterShape(shape);
      await set('label', 'Player pencil label');
      await submit();
      expect(options.onCreate).toHaveBeenCalledExactlyOnceWith({
        label: 'Player pencil label',
        geometry: shape,
        source: { kind: 'manual' },
      });
      expect(control('label').value).toBe('');
      expect(target.textContent).toContain('Local fixture marks only');
      expect(target.textContent).toContain('Shared and server-backed marks are unavailable');
      expect(target.querySelector('fieldset legend')).not.toBeNull();
      expect(control('kind').closest('label')).not.toBeNull();
    },
  );
  it.each(shapes)(
    'edits $kind label/geometry without allowing source or placement changes',
    async (shape) => {
      const existing = mark(shape);
      const options = await render(props([existing]));
      button('Edit').click();
      await flush();
      expect(control('paperId')).toBeNull();
      expect(target.textContent).toContain('Frozen source');
      expect(target.textContent).toContain('300 game ms');
      expect(target.textContent).toContain('Unavailable');
      await set('label', 'Revised label');
      await submit();
      expect(options.onEdit).toHaveBeenCalledExactlyOnceWith(existing.id, {
        label: 'Revised label',
        geometry: shape,
      });
      expect(existing.source).toEqual(mark().source);
      expect(existing.placedAtGame).toBe(300);
    },
  );
  it('passes only a paper reference on creation and displays frozen dates/location on edit', async () => {
    const options = await render();
    await enterShape(shapes[0]!);
    await set('paperId', paper.id);
    await submit();
    expect(options.onCreate.mock.calls[0]![0].source).toEqual({
      kind: 'paper',
      paperId: 'paper-1',
    });
    await unmount(component!);
    component = null;
    await render(props([mark()]));
    button('Edit').click();
    await flush();
    expect(target.textContent).toContain('0 m east, 10 m south');
    expect(target.textContent).toContain('100 game ms');
    expect(target.textContent).toContain('200 game ms');
    expect(target.textContent).toContain(paper.text);
  });
  it.each(['create', 'edit'] as const)(
    'retains the form after a rejected %s callback',
    async (action) => {
      const options = props(action === 'edit' ? [mark()] : []);
      if (action === 'edit') options.onEdit.mockReturnValue(fail('Edit conflict'));
      else options.onCreate.mockReturnValue(fail('Create conflict'));
      await render(options);
      if (action === 'edit') {
        button('Edit').click();
        await flush();
      } else await enterShape(shapes[0]!);
      await set('label', 'Keep this label');
      await submit();
      expect(control('label').value).toBe('Keep this label');
      expect(target.textContent).toContain(action === 'edit' ? 'Edit conflict' : 'Create conflict');
    },
  );
  it('retains form and existing mark after rejected delete/reload and uses explicit Save', async () => {
    const options = props([mark()]);
    options.dirty = true;
    options.onDelete.mockReturnValue(fail('Delete conflict'));
    options.onReload.mockResolvedValue(fail('Reload conflict'));
    await render(options);
    button('Edit').click();
    await flush();
    await set('label', 'Keep local draft');
    button('Delete').click();
    await flush();
    expect(target.textContent).toContain('Delete conflict');
    expect(control('label').value).toBe('Keep local draft');
    expect(button('Reload local marks').disabled).toBe(true);
    target.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    await flush();
    button('Reload local marks').click();
    await flush();
    expect(target.textContent).toContain('Reload conflict');
    expect(control('label').value).toBe('Keep local draft');
    expect(target.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    button('Save local marks').click();
    await flush();
    expect(options.onSave).toHaveBeenCalledTimes(1);
    expect(options.onCreate).not.toHaveBeenCalled();
    expect(control('label').value).toBe('Keep local draft');
  });
  it('disables pending save mutations and prevents callback reentry even if props remain writable', async () => {
    const options = props([mark()]);
    options.dirty = true;
    let finish: ((result: Result<void>) => void) | undefined;
    options.onSave.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render(options);
    button('Save local marks').click();
    await flush();
    expect(target.textContent).toContain('Saving local marks');
    expect(target.querySelector('fieldset')!.disabled).toBe(true);
    expect(button('Edit').disabled).toBe(true);
    expect(button('Delete').disabled).toBe(true);
    expect(button('Reload local marks').disabled).toBe(true);
    await submit();
    button('Save local marks').click();
    expect(options.onCreate).not.toHaveBeenCalled();
    expect(options.onSave).toHaveBeenCalledTimes(1);
    finish!(fail('Quota denied'));
    await flush();
    expect(target.textContent).toContain('Quota denied');
    expect(button('Save local marks').disabled).toBe(false);
  });
  it.each([
    { busy: true, writable: true },
    { busy: false, writable: false },
  ])('guards initial busy/writable state %j', async (state) => {
    const options = { ...props([mark()]), ...state, dirty: true };
    await render(options);
    await submit();
    expect(target.querySelector('fieldset')!.disabled).toBe(true);
    expect(button('Edit').disabled).toBe(true);
    expect(button('Delete').disabled).toBe(true);
    expect(button('Save local marks').disabled).toBe(true);
    expect(options.onCreate).not.toHaveBeenCalled();
    expect(options.onEdit).not.toHaveBeenCalled();
    expect(button('Export marks as JSON').disabled).toBe(false);
  });
  it('exports the supplied accepted list as JSON, excluding form drafts and preserving plain text', async () => {
    const existing = { ...mark(), label: '<img src=x onerror=alert(1)>' };
    const options = props([existing]);
    options.dirty = true;
    await render(options);
    await set('label', 'Unsubmitted draft');
    button('Export marks as JSON').click();
    await flush();
    const exported = target.querySelector<HTMLTextAreaElement>('textarea.export')!;
    expect(JSON.parse(exported.value)).toEqual([existing]);
    expect(exported.readOnly).toBe(true);
    expect(target.textContent).toContain('unsaved changes included');
    expect(target.querySelector('img')).toBeNull();
    expect(target.textContent).toContain(existing.label);
    expect(exported.value).not.toContain('Unsubmitted draft');
  });
  it('requires an explicit reload discard confirmation for unsubmitted form edits even with clean marks', async () => {
    const options = await render();
    await set('label', 'Unsubmitted draft');
    expect(button('Reload local marks').disabled).toBe(true);
    button('Reload local marks').click();
    expect(options.onReload).not.toHaveBeenCalled();
    target.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    await flush();
    button('Reload local marks').click();
    await flush();
    expect(options.onReload).toHaveBeenCalledTimes(1);
    expect(control('label').value).toBe('');
  });
  it.each(['', 'NaN', 'Infinity', '1e309', '-1', '4000.01'])(
    'rejects invalid/bounded east coordinate %j and retains form',
    async (value) => {
      const options = await render();
      await set('x', value);
      await set('y', '0');
      await set('label', 'Draft');
      await submit();
      expect(options.onCreate).not.toHaveBeenCalled();
      expect(control('label').value).toBe('Draft');
      expect(target.querySelector('.feedback')!.textContent).toMatch(/finite|within/);
    },
  );
  it.each(['0', '-1', '5000.01', 'NaN'])('rejects invalid ring radius %s', async (value) => {
    const options = await render();
    await enterShape(shapes[3]!);
    await set('radius', value);
    await submit();
    expect(options.onCreate).not.toHaveBeenCalled();
    expect(control('radius').value).toBe(value);
  });
  it.each([
    '1, 2',
    '1, 2\n3',
    '1, 2\n4001, 2',
    Array.from({ length: 257 }, () => '1, 2').join('\n'),
  ])('rejects invalid/oversized line geometry', async (value) => {
    const options = await render();
    await set('kind', 'polyline');
    await set('points', value);
    await submit();
    expect(options.onCreate).not.toHaveBeenCalled();
    expect(control('points').value).toBe(value);
  });
  it('rejects oversized labels and a full mark list at the runtime boundary', async () => {
    const options = await render();
    await enterShape(shapes[0]!);
    await set('label', 'x'.repeat(257));
    await submit();
    expect(options.onCreate).not.toHaveBeenCalled();
    expect(target.textContent).toContain('256 characters');
    await unmount(component!);
    component = null;
    const full = props(Array.from({ length: 200 }, (_, i) => ({ ...mark(), id: `mark-${i}` })));
    await render(full);
    await enterShape(shapes[0]!);
    await submit();
    expect(full.onCreate).not.toHaveBeenCalled();
    expect(target.textContent).toContain('limit is 200');
  });
  it('focuses by ID through the root callback, without canceling its completion on panel teardown', async () => {
    const options = props([mark()]);
    let finish: ((result: Result<void>) => void) | undefined;
    options.onFocus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render(options);
    button('Focus on map').focus();
    expect(document.activeElement).toBe(button('Focus on map'));
    button('Focus on map').click();
    await flush();
    expect(options.onFocus).toHaveBeenCalledWith('mark-1');
    await unmount(component!);
    component = null;
    finish!(ok());
    await flush();
    expect(target.children.length).toBe(0);
  });
  it('surfaces a thrown callback safely and preserves input text', async () => {
    const options = props();
    options.onCreate.mockImplementationOnce(() => {
      throw new Error('private stack');
    });
    await render(options);
    await enterShape(shapes[0]!);
    await set('label', 'Keep me');
    await submit();
    expect(control('label').value).toBe('Keep me');
    expect(target.textContent).toContain('form has been retained');
    expect(target.textContent).not.toContain('private stack');
  });
});
it('Edit focuses the label after rendering; latest edit alone receives focus', async () => {
  const first = mark();
  const second = { ...mark(), id: 'second', label: 'Second' };
  await render(props([first, second]));
  const editButtons = Array.from(
    target.querySelectorAll<HTMLButtonElement>('button[data-edit-mark]'),
  );
  const focus = vi.spyOn(control('label'), 'focus');
  editButtons[0]!.click();
  editButtons[1]!.click();
  await flush();
  expect(document.activeElement).toBe(control('label'));
  expect(control('label').value).toBe('Second');
  expect(focus).toHaveBeenCalledTimes(1);
});
it('Delete transfers focus to next, previous, then stable list heading', async () => {
  const list = fromStore(
    writable([
      mark(),
      { ...mark(), id: 'second', label: 'Second' },
      { ...mark(), id: 'third', label: 'Third' },
    ]),
  );
  const options = props();
  Object.defineProperty(options, 'marks', { get: () => list.current });
  options.onDelete.mockImplementation((id) => {
    list.current = list.current.filter((mark) => mark.id !== id);
    return ok();
  });
  await render(options);
  const remove = (id: string) =>
    target.querySelector<HTMLButtonElement>(`[aria-label="Delete mark ${id}"]`)!.click();
  remove('Second');
  await flush();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Edit mark Third');
  remove('Third');
  await flush();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Edit mark Road junction');
  remove('Road junction');
  await flush();
  expect(document.activeElement).toBe(target.querySelector('h4[tabindex="-1"]'));
  expect(target.querySelectorAll('li')).toHaveLength(0);
});
it('a newer delete cancels editor focus, failed deletion keeps initiating focus, teardown cancels focus', async () => {
  const list = fromStore(writable([mark(), { ...mark(), id: 'second', label: 'Second' }]));
  const options = props();
  Object.defineProperty(options, 'marks', { get: () => list.current });
  options.onDelete.mockImplementation((id) => {
    list.current = list.current.filter((mark) => mark.id !== id);
    return ok();
  });
  await render(options);
  button('Edit').click();
  target.querySelector<HTMLButtonElement>('[aria-label="Delete mark Second"]')!.click();
  await flush();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Edit mark Road junction');
  options.onDelete.mockReturnValue(fail('Delete rejected'));
  const remove = button('Delete');
  remove.focus();
  remove.click();
  await flush();
  expect(document.activeElement).toBe(remove);
  const focus = vi.spyOn(HTMLElement.prototype, 'focus');
  button('Edit').click();
  const removal = unmount(component!);
  component = null;
  await removal;
  await flush();
  expect(focus).not.toHaveBeenCalled();
});
it('uses panel h3/subsection h4 outline and narrow wrapping including fieldset and focus target', async () => {
  const existing = { ...mark(), label: 'Long'.repeat(64) };
  await render(props([existing]));
  button('Edit').click();
  await flush();
  const headings = Array.from(target.querySelectorAll('h1,h2,h3,h4,h5,h6'));
  expect(headings.map((h) => h.tagName)).toEqual(['H3', 'H4', 'H4', 'H4']);
  const { readFileSync } = await import('node:fs');
  const source = readFileSync('src/hq/interactions/marks/Marks.svelte', 'utf8');
  expect(source).toMatch(/fieldset\s*\{[^}]*min-inline-size: 0/);
  expect(source).toContain('max-inline-size: 100%');
  expect(source).toContain('overflow-wrap: anywhere');
  expect(source).toMatch(/:focus-visible\s*\{[^}]*outline: 3px solid currentColor/);
});
it('newer export action cancels queued Edit focus', async () => {
  await render(props([mark()]));
  button('Edit').click();
  const exportButton = button('Export marks as JSON');
  exportButton.focus();
  exportButton.click();
  await flush();
  expect(document.activeElement).toBe(exportButton);
});
