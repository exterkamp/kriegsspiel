// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { mount, tick, unmount, type ComponentProps } from 'svelte';
import Orders from './Orders.svelte';
import Harness from './Harness.svelte';
import { MemoryStorage, formation, snapshot, scope } from './fakes';
import { storageKey } from './repository';
let component: ReturnType<typeof mount> | null = null;
async function flush() {
  await tick();
  await Promise.resolve();
  await tick();
}
async function render(props: Partial<ComponentProps<typeof Orders>> = {}) {
  const storage = new MemoryStorage();
  const target = document.createElement('div');
  document.body.append(target);
  component = mount(Orders, {
    target,
    props: { scope, snapshot: snapshot(), storageFactory: () => storage, ...props },
  });
  await flush();
  return storage;
}
const editor = () => document.querySelector('textarea:not([readonly])') as HTMLTextAreaElement;
const recipient = () => document.querySelector('select') as HTMLSelectElement;
function button(name: string) {
  const value = Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === name,
  );
  if (!value) throw Error(`Missing ${name}`);
  return value;
}
function input(text: string) {
  editor().value = text;
  editor().dispatchEvent(new Event('input', { bubbles: true }));
}
function choose(id: string) {
  recipient().value = id;
  recipient().dispatchEvent(new Event('change', { bubbles: true }));
}
async function click(name: string) {
  button(name).click();
  await flush();
}
afterEach(async () => {
  if (component) await unmount(component);
  component = null;
  document.body.replaceChildren();
});
it('persists every keystroke synchronously and restores the last input after immediate teardown', async () => {
  const storage = await render();
  choose('own-1');
  input('March');
  expect(JSON.parse(storage.values.get(storageKey(scope))!).text).toBe('March');
  input('March at dawn.');
  expect(JSON.parse(storage.values.get(storageKey(scope))!).text).toBe('March at dawn.');
  await unmount(component!);
  component = null;
  document.body.replaceChildren();
  await render({ storageFactory: () => storage });
  expect(editor().value).toBe('March at dawn.');
  expect(recipient().value).toBe('own-1');
});
it('offers supplied own formations, never enemy contacts or invented commanders; signing remains disabled', async () => {
  await render({ snapshot: snapshot([formation(), formation('own-2', 'Second formation')]) });
  expect(Array.from(recipient().options).map((o) => o.textContent)).toEqual([
    'Choose an own unit',
    'First formation',
    'Second formation',
  ]);
  choose('own-1');
  await flush();
  expect(document.body.textContent).toContain('Commander: unknown');
  expect(document.body.textContent).not.toContain('Enemy contact');
  expect(button('Sign and send').disabled).toBe(true);
  expect(document.body.textContent).toContain(
    'Courier choice, courier risk, delivery estimate, annexes and delivery status unavailable.',
  );
});
it('labels a stored missing recipient until a current own unit is chosen', async () => {
  const storage = new MemoryStorage();
  storage.values.set(
    storageKey(scope),
    JSON.stringify({
      schemaVersion: 1,
      scope,
      revision: 'stored',
      recipientUnitId: 'gone',
      text: 'Retained draft',
    }),
  );
  await render({ storageFactory: () => storage });
  expect(recipient().value).toBe('gone');
  expect(document.body.textContent).toContain('Missing recipient: gone');
  expect(editor().value).toBe('Retained draft');
  choose('own-1');
  await flush();
  expect(document.body.textContent).not.toContain('Missing recipient: gone');
  expect(JSON.parse(storage.values.get(storageKey(scope))!).recipientUnitId).toBe('own-1');
});
it('keeps missing recipients honest across roster refreshes without resetting text', async () => {
  const storage = new MemoryStorage();
  const target = document.createElement('div');
  document.body.append(target);
  const harness = mount(Harness, { target, props: { initial: snapshot(), scope, storage } });
  component = harness;
  await flush();
  choose('own-1');
  input('Retained');
  harness.emit(snapshot([]));
  await flush();
  expect(document.body.textContent).toContain('Stored recipient is missing');
  expect(editor().value).toBe('Retained');
  expect(recipient().value).toBe('own-1');
});
it.each([
  '{',
  JSON.stringify({ schemaVersion: 2, scope, revision: 'future', recipientUnitId: null, text: '' }),
])('allows recoverable RAM writing after failed load, preserving bad storage', async (raw) => {
  const storage = new MemoryStorage();
  storage.values.set(storageKey(scope), raw);
  await render({ storageFactory: () => storage });
  expect(document.body.textContent).toContain('Saved draft unavailable');
  input('Recoverable local text');
  await flush();
  expect(editor().value).toBe('Recoverable local text');
  expect(document.body.textContent).toContain('Unsaved draft changes');
  expect(storage.values.get(storageKey(scope))).toBe(raw);
  await click('Export draft');
  const exports = Array.from(
    document.querySelectorAll('textarea[readonly]'),
  ) as HTMLTextAreaElement[];
  expect(exports[0]?.value).toBe('Recoverable local text');
  expect(JSON.parse(exports[1]!.value)).toMatchObject({
    text: 'Recoverable local text',
    unsaved: true,
    revision: null,
  });
  expect(exports[1]?.value).not.toContain('token');
});
it('retains quota-failed text and recipient, retries and never calls it saved prematurely', async () => {
  const storage = await render();
  storage.quota = true;
  choose('own-1');
  input('Keep in RAM');
  await flush();
  expect(editor().value).toBe('Keep in RAM');
  expect(recipient().value).toBe('own-1');
  expect(document.body.textContent).toContain('Unsaved draft changes');
  expect(document.body.textContent).toContain('Storage quota exceeded');
  expect(button('Retry save').disabled).toBe(false);
  storage.quota = false;
  await click('Retry save');
  expect(JSON.parse(storage.values.get(storageKey(scope))!).text).toBe('Keep in RAM');
  expect(document.body.textContent).toContain('Local draft saved');
});
it('keeps oversized pasted text recoverable and saves reduction against the valid baseline', async () => {
  const storage = await render();
  input('x'.repeat(16385));
  await flush();
  expect(editor().value).toHaveLength(16385);
  expect(storage.writes).toBe(0);
  await click('Export draft');
  expect((document.querySelector('textarea[readonly]') as HTMLTextAreaElement).value).toHaveLength(
    16385,
  );
  input('Reduced');
  expect(JSON.parse(storage.values.get(storageKey(scope))!).text).toBe('Reduced');
});
it('guards dirty reload and retains RAM on failed reload, including export indication', async () => {
  const storage = await render();
  storage.quota = true;
  input('Do not lose');
  await flush();
  expect(button('Reload saved draft').disabled).toBe(true);
  button('Reload saved draft').click();
  await flush();
  expect(editor().value).toBe('Do not lose');
  const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
  checkbox.click();
  await flush();
  storage.values.set(storageKey(scope), '{');
  await click('Reload saved draft');
  expect(editor().value).toBe('Do not lose');
  expect(document.body.textContent).toContain('Unsaved draft changes');
  await click('Export draft');
  expect(document.body.textContent).toContain('includes unsaved draft');
  storage.values.delete(storageKey(scope));
  await click('Reload saved draft');
  expect(editor().value).toBe('');
  expect(recipient().value).toBe('');
});
it('external deletion conflicts block autosave until confirmed reload and preserve form', async () => {
  const storage = await render();
  input('Saved');
  storage.values.delete(storageKey(scope));
  input('Unsaved');
  await flush();
  expect(document.body.textContent).toContain('Stored draft changed elsewhere');
  expect(editor().value).toBe('Unsaved');
  expect(button('Retry save').disabled).toBe(true);
  input('More unsaved');
  expect(storage.values.has(storageKey(scope))).toBe(false);
  const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
  checkbox.click();
  await flush();
  await click('Reload saved draft');
  input('New baseline');
  expect(JSON.parse(storage.values.get(storageKey(scope))!).text).toBe('New baseline');
});
it('renders prose as text, supports keyboard focus and inherits paper/ink tokens', async () => {
  const storage = await render();
  editor().focus();
  expect(document.activeElement).toBe(editor());
  input('<img src=x onerror=evil()>\nPlain text');
  await flush();
  expect(document.querySelector('article')?.textContent).toContain('<img src=x onerror=evil()>');
  expect(document.querySelector('img')).toBeNull();
  expect(storage.writes).toBe(1);
  recipient().focus();
  expect(document.activeElement).toBe(recipient());
  const { readFileSync } = await import('node:fs');
  const source = readFileSync('src/hq/views/orders/Orders.svelte', 'utf8');
  expect(source).toContain('color: var(--ink,');
  expect(source).toContain('background: var(--paper,');
  expect(source).not.toMatch(/--hq-(paper|ink)/);
});
it('wrong snapshot scope exposes no recipients and preserves editable unsaved draft without writing', async () => {
  const storage = await render({ snapshot: { ...snapshot(), scope: { ...scope, sideId: 'red' } } });
  expect(recipient().options).toHaveLength(1);
  input('Recover without crossing scopes');
  await flush();
  expect(document.body.textContent).toContain('Scope mismatch');
  expect(editor().value).toBe('Recover without crossing scopes');
  expect(storage.writes).toBe(0);
});
