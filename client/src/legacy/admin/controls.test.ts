// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ControlBar, clockSummary, parseRate } from './controls.js';
import type { AdminState } from './state.js';

const state = (over: Partial<AdminState> = {}): AdminState =>
  ({
    id: 'g',
    clock: { rate: 12, status: 'paused' },
    control: { mode: 'realtime', gameMs: 125_000 },
    engine: { time: 125_000 },
    sideViews: {},
    ...over,
  }) as AdminState;

describe('parseRate', () => {
  it('accepts positive numbers up to the cap only', () => {
    expect(parseRate('6')).toBe(6);
    expect(parseRate(' 2.5 ')).toBe(2.5);
    for (const bad of ['', '0', '-1', 'x', '1001', 'Infinity'])
      expect(parseRate(bad)).toBeUndefined();
  });
});

describe('clockSummary', () => {
  it('shows status, rate and game time, and the barrier when held', () => {
    expect(clockSummary(state())).toBe('paused ×12 · game 2:05');
    const held = state({ control: { mode: 'manual', gameMs: 60_000, barrierMs: 61_000 } });
    expect(clockSummary(held)).toContain('manual');
    expect(clockSummary(held)).toContain('held for the umpire at 1:01');
    expect(clockSummary(undefined)).toBe('no clock');
  });
});

describe('ControlBar', () => {
  const make = (fetchFn: typeof fetch) => {
    const root = document.createElement('div');
    const bar = new ControlBar(
      root,
      () => 'tok',
      fetchFn,
      () => undefined,
    );
    bar.setGame('abc');
    bar.setState(state());
    const click = (label: string) =>
      [...root.querySelectorAll('button')].find((b) => b.textContent === label)!.click();
    return { root, bar, click };
  };

  it('posts the chosen action with the token', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    const { click } = make(fetchFn as unknown as typeof fetch);
    click('Step 5 min');
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalled());
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('/admin/api/games/abc/clock?token=tok');
    expect(JSON.parse(init.body)).toEqual({ action: 'step', ms: 300_000 });
  });

  it('shows the server refusal', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ message: 'no event is queued' }),
    });
    const { root, click } = make(fetchFn as unknown as typeof fetch);
    click('Step to next event');
    await vi.waitFor(() => expect(root.textContent).toContain('Refused: no event is queued'));
  });

  it('says when the umpire held a step short', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ stalledAt: 61_000 }) });
    const { root, click } = make(fetchFn as unknown as typeof fetch);
    click('Step 5 min');
    await vi.waitFor(() => expect(root.textContent).toContain('Held for the umpire at 1:01.'));
  });

  it('drops the answer for a game that is no longer selected', async () => {
    let answer!: (r: unknown) => void;
    const fetchFn = vi.fn(() => new Promise((r) => (answer = r)));
    const { root, bar, click } = make(fetchFn as unknown as typeof fetch);
    click('Pause');
    bar.setGame('other');
    answer({ ok: false, status: 409, json: async () => ({ message: 'nope' }) });
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(root.textContent).not.toContain('Refused');
  });

  it('disables the controls for a finished game', () => {
    const { root, bar } = make(vi.fn() as unknown as typeof fetch);
    bar.setState(state({ clock: { status: 'stopped' } }));
    expect([...root.querySelectorAll('button')].every((b) => b.disabled)).toBe(true);
  });
});
