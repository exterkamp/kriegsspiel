// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatGameMs, nextMarkIndex, prevMarkIndex, type ReplayMark } from './model.js';
import { ReplayPanel } from './replay.js';

const marks: ReplayMark[] = [
  { ms: 0, kind: 'input', label: 'a' },
  { ms: 60_000, kind: 'llm', label: 'b' },
  { ms: 120_000, kind: 'contact', label: 'c' },
  { ms: 180_000, kind: 'order', label: 'd' },
  { ms: 240_000, kind: 'contact', label: 'e' },
];

afterEach(() => {
  document.body.innerHTML = '';
});

describe('mark navigation', () => {
  it('steps to the next and previous mark, optionally by kind', () => {
    expect(nextMarkIndex(marks, 0)).toBe(1);
    expect(nextMarkIndex(marks, 120_000, 'contact')).toBe(4);
    expect(nextMarkIndex(marks, 240_000)).toBe(-1);
    expect(prevMarkIndex(marks, 180_000)).toBe(2);
    expect(prevMarkIndex(marks, 240_000, 'contact')).toBe(2);
    expect(prevMarkIndex(marks, 0)).toBe(-1);
  });
  it('formats game time', () => {
    expect(formatGameMs(125_000)).toBe('2:05');
  });
});

describe('ReplayPanel', () => {
  function setup() {
    const urls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      urls.push(url);
      const body = url.includes('/replay/at')
        ? { gameMs: 1, engine: { time: 1 }, views: { blue: {}, red: {} }, events: [], llmCalls: 0 }
        : { endMs: 240_000, marks };
      return { ok: true, status: 200, json: async () => body };
    });
    const root = document.createElement('section');
    document.body.append(root);
    const panel = new ReplayPanel(root, () => 'tok', fetchFn as never);
    return { root, panel, urls };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('loads the timeline, then jumps between contacts through the read-only API', async () => {
    const { root, panel, urls } = setup();
    await panel.setGame('g1');
    expect(urls[0]).toBe('/admin/api/games/g1/replay?token=tok');
    expect(urls[1]).toBe('/admin/api/games/g1/replay/at?at=0&token=tok');
    root.querySelector<HTMLButtonElement>('[data-jump="contact"][data-dir="1"]')!.click();
    await settle();
    expect(urls.at(-1)).toContain('at=120000');
    root.querySelector<HTMLButtonElement>('[data-jump="contact"][data-dir="1"]')!.click();
    await settle();
    expect(urls.at(-1)).toContain('at=240000');
    expect(root.querySelectorAll('details')).toHaveLength(4);
    expect(root.querySelector('output')!.textContent).toBe('4:00');
  });

  it('steps back by event', async () => {
    const { root, panel, urls } = setup();
    await panel.setGame('g1');
    root.querySelector<HTMLButtonElement>('[data-step="1"]')!.click();
    await settle();
    root.querySelector<HTMLButtonElement>('[data-step="1"]')!.click();
    await settle();
    root.querySelector<HTMLButtonElement>('[data-step="-1"]')!.click();
    await settle();
    expect(urls.at(-1)).toContain('at=60000');
  });
});
