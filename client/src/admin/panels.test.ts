// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminPage } from './admin.js';
import { EntryStore, formatGameTime, toRow, type TraceEntry, type TraceKind } from './entries.js';
import { ListPanel, ROW_HEIGHT } from './listPanel.js';
import { EVENTS_PANEL, REQUESTS_PANEL } from './panels.js';

let seq = 0;
function entry(kind: TraceKind, data: unknown, correlationId = 'none'): TraceEntry {
  seq++;
  return { seq, ts: 1_700_000_000_000 + seq, gameId: 'g', correlationId, kind, data };
}
const ev = (time: number, type: string, payload: unknown, cid?: string) =>
  entry('engine', { time, type, payload }, cid);
const req = (path: string, extra: object = {}, cid?: string) =>
  entry(
    'request',
    { transport: 'http', method: 'POST', path, ok: true, durationMs: 5, bytes: 10, ...extra },
    cid,
  );

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.useRealTimers();
  seq = 0;
});

describe('EntryStore', () => {
  it('derives unit, side and game time from an engine event', () => {
    const r = toRow(ev(65_000, 'unit.moved', { unitId: 'u1', side: 'blue', x: 3 }));
    expect([r.type, r.unit, r.side, formatGameTime(r.gameMs)]).toEqual([
      'unit.moved',
      'u1',
      'blue',
      '01:05',
    ]);
  });

  it('ignores duplicate seqs from a replayed stream', () => {
    const s = new EntryStore();
    const e = ev(0, 'a', {});
    expect(s.add(e)).toBe(true);
    expect(s.add({ ...e })).toBe(false);
    expect(s.size).toBe(1);
    expect(s.lastSeq).toBe(e.seq);
  });

  it('filters by type, unit, side, game-time window and text', () => {
    const s = new EntryStore();
    s.add(ev(1000, 'unit.moved', { unitId: 'alpha-1', side: 'blue' }));
    s.add(ev(5000, 'unit.moved', { unitId: 'bravo-2', side: 'red' }));
    s.add(ev(9000, 'contact.seen', { unitId: 'alpha-1', side: 'blue', note: 'Hill Forty' }));
    s.add(req('/games'));
    const kinds = ['engine'] as const;
    const count = (f: object) => s.filter({ kinds, ...f }).length;
    expect(count({})).toBe(3);
    expect(count({ type: 'unit.moved' })).toBe(2);
    expect(count({ unit: 'ALPHA' })).toBe(2);
    expect(count({ side: 'red' })).toBe(1);
    expect(count({ fromMs: 2000, toMs: 6000 })).toBe(1);
    expect(count({ text: 'hill forty' })).toBe(1);
    expect(count({ text: 'hill nothing' })).toBe(0);
  });

  it('filters requests by transport, outcome and duration', () => {
    const s = new EntryStore();
    s.add(req('/a'));
    s.add(req('/b', { ok: false, durationMs: 900 }));
    s.add(req('/c', { transport: 'ws', durationMs: 50 }));
    const kinds = ['request'] as const;
    expect(s.filter({ kinds, transport: 'ws' }).map((r) => r.summary)).toEqual(['/c ok']);
    expect(s.filter({ kinds, outcome: 'error' }).map((r) => r.summary)).toEqual(['/b FAILED']);
    expect(s.filter({ kinds, minDurationMs: 40 })).toHaveLength(2);
  });

  it('returns the whole chain for a correlation id, but nothing for "none"', () => {
    const s = new EntryStore();
    const r = req('/orders', {}, 'c1');
    const c = entry('command', { seq: 1 }, 'c1');
    const e = ev(0, 'order.issued', {}, 'c1');
    const other = ev(0, 'tick', {}, 'c2');
    const loose = ev(0, 'tick', {});
    const loose2 = ev(1, 'tick', {});
    [r, c, e, other, loose, loose2].forEach((x) => s.add(x));
    expect(s.chain(e).map((x) => x.entry.kind)).toEqual(['request', 'command', 'engine']);
    expect(s.chain(loose)).toHaveLength(1);
  });

  it('filters and searches 10,000 entries quickly', () => {
    const s = new EntryStore();
    for (let i = 0; i < 10_000; i++)
      s.add(
        ev(i * 1000, i % 2 ? 'unit.moved' : 'contact.seen', {
          unitId: `u${i % 50}`,
          side: i % 3 ? 'blue' : 'red',
          note: `n${i}`,
        }),
      );
    const t0 = performance.now();
    for (let i = 0; i < 20; i++)
      s.filter({ kinds: ['engine'], type: 'unit.moved', unit: 'u7', text: 'n99' });
    const perFilter = (performance.now() - t0) / 20;
    expect(s.filter({ kinds: ['engine'], text: 'n9999' })).toHaveLength(1);
    expect(perFilter).toBeLessThan(50);
  });
});

describe('ListPanel', () => {
  function mount(config = EVENTS_PANEL) {
    document.body.innerHTML = '<section id="p"></section>';
    const store = new EntryStore();
    const panel = new ListPanel(document.getElementById('p')!, store, config);
    return { store, panel, el: document.getElementById('p')! };
  }
  const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.lp-row')];

  it('puts only the visible window of a 10,000-row table in the DOM', () => {
    const { store, panel, el } = mount();
    for (let i = 0; i < 10_000; i++) store.add(ev(i, 'tick', { unitId: `u${i}` }));
    panel.renderNow();
    expect(panel.visibleRows).toHaveLength(10_000);
    expect(rows(el).length).toBeLessThan(60);
    expect(el.querySelector<HTMLElement>('.lp-spacer')!.style.height).toBe(
      `${10_000 * ROW_HEIGHT}px`,
    );
    // Following the tail: the last row is rendered.
    expect(rows(el).at(-1)!.dataset.seq).toBe('10000');
  });

  it('narrows the table from the toolbar controls and the search text', () => {
    const { store, panel, el } = mount();
    store.add(ev(0, 'unit.moved', { unitId: 'a', side: 'blue' }));
    store.add(ev(0, 'unit.moved', { unitId: 'b', side: 'red' }));
    store.add(ev(0, 'contact.seen', { unitId: 'c', side: 'red' }));
    store.add(req('/ignored'));
    panel.renderNow();
    expect(panel.visibleRows).toHaveLength(3);
    const side = el.querySelector<HTMLSelectElement>('[data-control=side]')!;
    expect([...side.options].map((o) => o.value)).toEqual(['', 'blue', 'red']);
    side.value = 'red';
    side.dispatchEvent(new Event('input'));
    panel.renderNow();
    expect(panel.visibleRows).toHaveLength(2);
    panel.setText('contact');
    panel.renderNow();
    expect(panel.visibleRows.map((r) => r.type)).toEqual(['contact.seen']);
  });

  it('shows the raw JSON and the correlated chain, and can drill into the chain', () => {
    const { store, panel, el } = mount();
    store.add(req('/orders', {}, 'cid-1'));
    store.add(entry('llm', { model: 'm' }, 'cid-1'));
    const target = ev(2000, 'order.issued', { unitId: 'u1' }, 'cid-1');
    store.add(target);
    store.add(ev(3000, 'unrelated', {}, 'cid-2'));
    panel.renderNow();
    panel.select(target);
    const chain = [...el.querySelectorAll('.lp-chain button')].map((b) => b.textContent);
    expect(chain).toHaveLength(3);
    expect(chain[0]).toContain('request');
    expect(chain[1]).toContain('llm');
    expect(el.querySelector('pre')!.textContent).toContain('"order.issued"');
    // Look at another entry of the chain without leaving the detail pane.
    el.querySelector<HTMLButtonElement>('.lp-chain button[data-seq="2"]')!.click();
    expect(el.querySelector('pre')!.textContent).toContain('"model"');
    // Show the chain in the table: all kinds, only that correlation id.
    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.startsWith('show chain'))!
      .click();
    panel.renderNow();
    expect(panel.visibleRows.map((r) => r.entry.kind)).toEqual(['request', 'llm', 'engine']);
    el.querySelector<HTMLButtonElement>('.lp-chip button')!.click();
    panel.renderNow();
    expect(panel.visibleRows).toHaveLength(2);
  });

  it('freezes the table while paused and catches up on resume', () => {
    const { store, panel, el } = mount();
    store.add(ev(0, 'a', {}));
    panel.renderNow();
    panel.setPaused(true);
    store.add(ev(0, 'b', {}));
    store.add(ev(0, 'c', {}));
    panel.renderNow();
    expect(panel.visibleRows).toHaveLength(1);
    expect(el.querySelector('.lp-toolbar button:last-of-type')!.textContent).toBe('resume (2 new)');
    panel.setPaused(false);
    expect(panel.visibleRows).toHaveLength(3);
  });

  it('pauses itself when the reader scrolls up, and resumes at the bottom', () => {
    const { store, panel, el } = mount();
    for (let i = 0; i < 200; i++) store.add(ev(i, 'tick', {}));
    panel.renderNow();
    const list = el.querySelector<HTMLElement>('.lp-list')!;
    list.scrollTop = 0;
    list.dispatchEvent(new Event('scroll'));
    expect(panel.isPaused).toBe(true);
    list.scrollTop = 200 * ROW_HEIGHT;
    list.dispatchEvent(new Event('scroll'));
    expect(panel.isPaused).toBe(false);
  });

  it('lists requests with status, timing and size', () => {
    const { store, panel, el } = mount(REQUESTS_PANEL);
    store.add(req('/games', { ok: false, durationMs: 12, bytes: 2048, responseBytes: 5 }));
    store.add(ev(0, 'not-a-request', {}));
    panel.renderNow();
    expect(panel.visibleRows).toHaveLength(1);
    const cells = [...el.querySelectorAll('.lp-row [role=gridcell]')].map((c) => c.textContent);
    expect(cells).toContain('/games');
    expect(cells).toContain('error');
    expect(cells).toContain('12');
    expect(cells).toContain('2.0 kB → 5 B');
  });
});

describe('AdminPage panels', () => {
  class ES {
    static last: ES | undefined;
    static CLOSED = 2;
    readyState = 1;
    onopen?: () => void;
    onerror?: () => void;
    onmessage?: (e: { data: string }) => void;
    constructor(public url: string) {
      ES.last = this;
    }
    close() {}
  }

  it('fills the Events and Requests panels from the stream, deduping a replay', async () => {
    vi.stubGlobal('EventSource', ES);
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="app"></div>';
    const fetchFn = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ games: [{ id: 'g', open: true, entries: 0 }] }),
      }),
    );
    const page = new AdminPage(document.getElementById('app')!, '', fetchFn as never);
    page.start();
    await vi.advanceTimersByTimeAsync(0);
    const send = (e: TraceEntry) => ES.last!.onmessage!({ data: JSON.stringify(e) });
    const e1 = ev(1000, 'unit.moved', { unitId: 'u1' });
    send(e1);
    send(e1);
    send(req('/orders'));
    await vi.advanceTimersByTimeAsync(50);
    const rowsIn = (panel: string) =>
      document.querySelectorAll(`section[data-panel=${panel}] .lp-row`).length;
    expect(rowsIn('Events')).toBe(1);
    expect(rowsIn('Requests')).toBe(1);
    // The shared filter box feeds the visible panel.
    const filter = document.querySelector<HTMLInputElement>('#filter')!;
    filter.value = 'nomatch';
    filter.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(50);
    expect(rowsIn('Events')).toBe(0);
    // A reopened stream resumes after what the page already holds.
    ES.last!.onerror!();
    page.stop();
  });
});
