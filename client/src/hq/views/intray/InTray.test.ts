// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { mount, tick, unmount, type ComponentProps } from 'svelte';
import InTray from './InTray.svelte';
import Harness from './Harness.svelte';
import { MemoryStorage, paper, snapshot, scope } from './fakes';
import { storageKey } from './store';
import { collectPapers } from './papers';
let component: ReturnType<typeof mount> | null = null;
const flush = async () => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
    await tick();
  }
};
const buttons = () => Array.from(document.querySelectorAll('button'));
function button(name: string) {
  const b = buttons().find((b) => b.textContent?.trim() === name);
  if (!b) throw Error(`Missing button ${name}`);
  return b;
}
async function click(name: string) {
  button(name).click();
  await flush();
}
async function render(props: Partial<ComponentProps<typeof InTray>> = {}) {
  const storage = new MemoryStorage();
  const target = document.createElement('div');
  document.body.append(target);
  component = mount(InTray, {
    target,
    props: { snapshot: snapshot(), scope, storageFactory: () => storage, ...props },
  });
  await flush();
  return storage;
}
afterEach(async () => {
  if (component) await unmount(component);
  component = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
it('uses elapsed timestamps in arrival list and reader without changing supplied milliseconds', async () => {
  const supplied = paper('time', {
    writtenAtGame: 999,
    receivedAtGame: 90061007,
    observedAtGame: 0,
  });
  await render({ snapshot: snapshot([supplied]) });
  expect(document.querySelector('li span')?.textContent).toContain('25:01:01');
  await click('Open time — Supplied scout');
  const dates = [...document.querySelectorAll('article dd')].slice(2, 5);
  expect(dates.map((date) => date.textContent)).toEqual(['00:00:00', '25:01:01', '00:00:00']);
  expect(document.querySelector('article')?.textContent).not.toContain('game ms');
  expect(supplied.receivedAtGame).toBe(90061007);
});
it.each([-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])(
  'shows invalid paper timestamps %s as unavailable',
  async (time) => {
    await render({
      snapshot: snapshot([paper('invalid', { writtenAtGame: time, observedAtGame: time })]),
    });
    await click('Open invalid — Supplied scout');
    const dates = [...document.querySelectorAll('article dd')];
    expect(dates[2]?.textContent).toBe('Time unavailable');
    expect(dates[4]?.textContent).toBe('Time unavailable');
  },
);
it('shows six piles, sorts 200 arrivals, searches and safely reads full supplied text', async () => {
  const papers = Array.from({ length: 200 }, (_, i) =>
    paper(`p${i.toString().padStart(3, '0')}`, {
      receivedAtGame: i,
      category: ['urgent', 'scouts', 'subordinates', 'staff', 'intelligence', 'rumour'][
        i % 6
      ] as 'urgent',
      text: i === 199 ? '<script>evil()</script>\nFull body' : 'Other body',
    }),
  );
  await render({ snapshot: snapshot(papers) });
  expect(document.querySelectorAll('li')).toHaveLength(200);
  expect(document.querySelector('li')?.textContent).toContain('p199');
  expect(document.querySelectorAll('nav[aria-label="Category piles"] button')).toHaveLength(7);
  const search = document.querySelector('input[type="search"]') as HTMLInputElement;
  search.value = 'Full body';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await flush();
  expect(document.querySelectorAll('li')).toHaveLength(1);
  await click('Open p199 — Supplied scout');
  expect(document.querySelector('article')?.textContent).toContain('<script>evil()</script>');
  expect(document.querySelector('script')).toBeNull();
  expect(document.querySelector('article')?.textContent).toContain('Observed at Time unavailable');
  expect(document.body.textContent).toContain('Attachments and sketches unavailable.');
});
it('deduplicates exact IDs, excludes conflicting IDs and deterministically sorts ties', async () => {
  const a = paper('a');
  const papers = [paper('b'), a, { ...a }, paper('bad'), paper('bad', { text: 'different' })];
  expect(collectPapers(papers).papers.map((p) => p.id)).toEqual(['a', 'b']);
  await render({ snapshot: snapshot(papers) });
  expect(document.querySelectorAll('li')).toHaveLength(2);
  expect(document.body.textContent).toContain('1 conflicting paper IDs');
});
it('open preserves filed/discarded and file → discard → restore returns active/read', async () => {
  const storage = await render();
  await click('Open paper-1 — Supplied scout');
  await click('File');
  await click('filed');
  await click('Open paper-1 — Supplied scout');
  expect(JSON.parse(storage.values.get(storageKey(scope))!).records[0].status).toBe('filed');
  await click('Discard');
  await click('discarded');
  await click('Open paper-1 — Supplied scout');
  expect(JSON.parse(storage.values.get(storageKey(scope))!).records[0].status).toBe('discarded');
  await click('Restore to active');
  await click('active');
  expect(document.querySelectorAll('li')).toHaveLength(1);
  expect(JSON.parse(storage.values.get(storageKey(scope))!).records[0].status).toBe('read');
  expect(document.body.textContent).toContain('Unread: 0');
});
it('reading remains available with blocked storage and unavailable unread state', async () => {
  const storage = new MemoryStorage();
  storage.blocked = true;
  await render({ storageFactory: () => storage });
  await click('Open paper-1 — Supplied scout');
  expect(document.querySelector('article')).not.toBeNull();
  expect(document.body.textContent).toContain('Unread: unavailable');
  expect(button('File').disabled).toBe(true);
  expect(storage.writes).toBe(0);
});
it('opening while save is busy preserves reading selection without mutating status', async () => {
  await render({ snapshot: snapshot([paper('a'), paper('b')]) });
  button('Open a — Supplied scout').click();
  button('Open b — Supplied scout').click();
  await flush();
  expect(document.querySelector('article h4')?.textContent).toBe('Paper b');
  expect(document.body.textContent).toContain('Unread: 1');
});
it('retains dirty state on quota, exports JSON and guards explicit reload', async () => {
  const storage = await render();
  storage.quota = true;
  await click('Open paper-1 — Supplied scout');
  expect(document.body.textContent).toContain('Unsaved local changes');
  expect(button('Reload saved state').disabled).toBe(true);
  await click('Export JSON');
  expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toContain('"read"');
  const check = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
  check.click();
  await flush();
  await click('Reload saved state');
  expect(document.body.textContent).toContain('Unread: 1');
  expect(document.querySelector('article')).not.toBeNull();
});
it('retains accepted local records when papers arrive during save', async () => {
  const storage = new MemoryStorage();
  const target = document.createElement('div');
  document.body.append(target);
  const harness = mount(Harness, {
    target,
    props: { initial: snapshot([paper('a')]), scope, storage },
  });
  component = harness;
  await flush();
  button('Open a — Supplied scout').click();
  harness.emit(snapshot([paper('a'), paper('b')]));
  await flush();
  expect(document.querySelectorAll('li')).toHaveLength(2);
  expect(document.body.textContent).toContain('Unread: 1');
  expect(JSON.parse(storage.values.get(storageKey(scope))!).records).toEqual([
    { paperId: 'a', status: 'read' },
  ]);
});
it('does not auto-plot, keeps reader on callback failure, and allows root action after teardown', async () => {
  let finish!: (value: { ok: true; value: undefined }) => void;
  const callback = vi
    .fn()
    .mockResolvedValueOnce({
      ok: false,
      error: { code: 'internal', message: 'Plot rejected', retry: 'never' },
    })
    .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  await render({ onPlotPaper: callback });
  await click('Open paper-1 — Supplied scout');
  expect(callback).not.toHaveBeenCalled();
  await click('Plot paper');
  expect(document.body.textContent).toContain('Plot rejected');
  expect(document.querySelector('article')).not.toBeNull();
  button('Plot paper').click();
  await tick();
  expect(button('Plot paper').disabled).toBe(true);
  await unmount(component!);
  component = null;
  finish({ ok: true, value: undefined });
  await flush();
  expect(document.querySelector('article')).toBeNull();
  expect(callback).toHaveBeenCalledTimes(2);
});
it('blocks wrong-scope paper access and plotting', async () => {
  await render({ snapshot: snapshot([paper()], { ...scope, sideId: 'red' }) });
  expect(document.querySelectorAll('li')).toHaveLength(0);
  expect(document.body.textContent).toContain('Scope mismatch');
});
it('shows supplied zero dates and unknown fields without inventing observed dates', async () => {
  await render({
    snapshot: snapshot([
      paper('zero', { writtenAtGame: 0, receivedAtGame: 0, observedAtGame: 0, location: null }),
    ]),
  });
  await click('Open zero — Supplied scout');
  const values = Array.from(document.querySelectorAll('article dd')).map((n) => n.textContent);
  expect(values.slice(2, 5)).toEqual(['00:00:00', '00:00:00', '00:00:00']);
  expect(values.slice(5)).toEqual(['Unknown', 'Unknown', 'Unknown', 'Unknown']);
  expect(button('Plot paper').disabled).toBe(true);
});
it('retains filing across component remounts and shows unavailable after corrupt reload', async () => {
  const storage = await render();
  await click('Open paper-1 — Supplied scout');
  await click('File');
  await unmount(component!);
  component = null;
  document.body.replaceChildren();
  await render({ storageFactory: () => storage });
  await click('filed');
  expect(document.querySelectorAll('li')).toHaveLength(1);
  await click('Open paper-1 — Supplied scout');
  storage.values.set(storageKey(scope), '{');
  await click('Reload saved state');
  expect(document.querySelector('article')).not.toBeNull();
  expect(button('File').disabled).toBe(true);
  expect(document.body.textContent).toContain('Unread: unavailable');
  expect(storage.values.get(storageKey(scope))).toBe('{');
});
it('retains reader on thrown plot callback and late save teardown cannot commit', async () => {
  const storage = await render({
    onPlotPaper: async () => {
      throw Error('unsafe detail');
    },
  });
  await click('Open paper-1 — Supplied scout');
  await click('Plot paper');
  expect(document.body.textContent).toContain('Plot callback failed');
  expect(document.body.textContent).not.toContain('unsafe detail');
  expect(document.querySelector('article')).not.toBeNull();
  const writes = storage.writes;
  button('File').click();
  const removal = unmount(component!);
  component = null;
  await removal;
  await flush();
  expect(storage.writes).toBe(writes);
});
it('uses inherited paper/ink tokens for reader and controls, with ink-based visible focus', async () => {
  // jsdom does not resolve inherited CSS variables. Verify the actual authored
  // stylesheet contract; browser visual/high-contrast acceptance remains pending.
  const { readFileSync } = await import('node:fs');
  const source = readFileSync('src/hq/views/intray/InTray.svelte', 'utf8');
  const css = source.split('<style>')[1]!.split('</style>')[0]!;
  const reader = css.match(/\.intray\s*\{([^}]+)\}/)![1]!;
  const controls = css.match(/button,\s*input,\s*textarea\s*\{([^}]+)\}/)![1]!;
  expect(reader).toContain('color: var(--ink,');
  expect(reader).toContain('background: var(--paper,');
  expect(controls).toContain('color: inherit;');
  expect(controls).toContain('background: var(--paper,');
  expect(css).not.toMatch(/--hq-(ink|paper)/);
  expect(css).toMatch(/:focus-visible\s*\{[^}]*outline: 3px solid currentColor;/);
  await render();
  const search = document.querySelector('input[type="search"]') as HTMLInputElement;
  search.focus();
  expect(document.activeElement).toBe(search);
  await click('Open paper-1 — Supplied scout');
  const file = button('File');
  file.focus();
  expect(document.activeElement).toBe(file);
});
it.each(['writable', 'blocked', 'busy'])(
  'Open moves focus into the rendered reader when storage is %s',
  async (mode) => {
    const storage = new MemoryStorage();
    storage.blocked = mode === 'blocked';
    await render({ snapshot: snapshot([paper('a'), paper('b')]), storageFactory: () => storage });
    if (mode === 'busy') button('Open a — Supplied scout').click();
    const trigger = button('Open b — Supplied scout');
    trigger.focus();
    trigger.click();
    await flush();
    const reader = document.querySelector('article');
    expect(document.activeElement).toBe(reader);
    expect(reader?.querySelector('h4')?.textContent).toBe('Paper b');
  },
);
it('latest Open wins focus, and teardown cancels scheduled reader focus', async () => {
  await render({ snapshot: snapshot([paper('a'), paper('b')]) });
  const focus = vi.spyOn(HTMLElement.prototype, 'focus');
  button('Open a — Supplied scout').click();
  button('Open b — Supplied scout').click();
  await flush();
  expect(focus).toHaveBeenCalledTimes(1);
  expect(document.activeElement?.querySelector('h4')?.textContent).toBe('Paper b');
  focus.mockClear();
  button('Open a — Supplied scout').click();
  const removal = unmount(component!);
  component = null;
  await removal;
  await flush();
  expect(focus).not.toHaveBeenCalled();
});
it('keeps reader outline at h3/h4 and wraps long IDs and metadata with constrained controls', async () => {
  const id = 'a'.repeat(128);
  await render({
    snapshot: snapshot([
      paper(id, {
        from: 'Sender'.repeat(100),
        unitId: 'Unit'.repeat(100),
        text: 'Prose'.repeat(1000),
      }),
    ]),
  });
  await click(`Open ${id} — ${'Sender'.repeat(100)}`);
  expect(Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) => h.tagName)).toEqual([
    'H3',
    'H4',
    'H4',
    'H4',
  ]);
  expect(document.activeElement).toBe(document.querySelector('article'));
  const { readFileSync } = await import('node:fs');
  const source = readFileSync('src/hq/views/intray/InTray.svelte', 'utf8');
  expect(source).toContain('max-inline-size: 100%');
  expect(source).toContain('overflow-wrap: anywhere');
  expect(source).toMatch(/:focus-visible\s*\{[^}]*outline: 3px solid currentColor/);
});
it('measures mounted 200-paper headless reading, pile navigation and reopen scenario', async () => {
  const started = performance.now();
  await render({
    snapshot: snapshot(
      Array.from({ length: 200 }, (_, i) =>
        paper(`bench-${i}`, { receivedAtGame: i, category: i % 2 ? 'urgent' : 'scouts' }),
      ),
    ),
  });
  expect(document.querySelectorAll('li')).toHaveLength(200);
  await click('Open bench-199 — Supplied scout');
  expect(document.activeElement).toBe(document.querySelector('article'));
  await click('File');
  await click('filed');
  await click('Open bench-199 — Supplied scout');
  await click('Restore to active');
  await click('active');
  const search = document.querySelector('input[type="search"]') as HTMLInputElement;
  search.value = 'bench-198';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await flush();
  expect(document.querySelectorAll('li')).toHaveLength(1);
  await click('Open bench-198 — Supplied scout');
  expect(document.activeElement?.querySelector('h4')?.textContent).toBe('Paper bench-198');
  const elapsed = performance.now() - started;
  expect(Number.isFinite(elapsed)).toBe(true);
  console.info(
    `Headless jsdom 200-paper mounted reading/pile navigation scenario: ${elapsed.toFixed(1)} ms; not browser latency evidence.`,
  );
});
it('a newer pile action prevents queued Open from stealing navigation focus', async () => {
  await render();
  button('Open paper-1 — Supplied scout').click();
  const pile = button('filed');
  pile.focus();
  pile.click();
  await flush();
  expect(document.activeElement).toBe(pile);
  expect(document.querySelector('article')).not.toBeNull();
});
