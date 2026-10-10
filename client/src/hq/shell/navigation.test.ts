import { describe, expect, it, vi } from 'vitest';
import { createHqNavigation } from './navigation';
import { makePorts, ok, scope } from './fakes';
import type { Selection, ShellState } from '../contracts';
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('navigation transaction and immutable publication', () => {
  it('rolls back view, camera, active state and focus when canceled during delayed focus', async () => {
    const { surface } = makePorts();
    let finish: (() => void) | undefined;
    const focus = vi.fn<(view: string) => void | Promise<void>>();
    focus.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const nav = createHqNavigation({ surface, reducedMotion: () => true, focus });
    const controller = new AbortController();
    const result = nav.navigate('orders', 'orders', { signal: controller.signal });
    await flush();
    expect(nav.getState().view).toBe('orders');
    controller.abort();
    finish!();
    expect((await result).ok).toBe(false);
    expect(nav.getState().view).toBe('table');
    expect(surface.restoreCamera).toHaveBeenCalledWith(
      expect.objectContaining({ mapId: 'public-map' }),
    );
    expect(surface.setActive).toHaveBeenLastCalledWith(true);
    expect(focus).toHaveBeenLastCalledWith('table', 'orders', expect.any(AbortSignal));
  });
  it('finishes rollback before a successor starts after canceling delayed focus', async () => {
    const { surface } = makePorts();
    const views: string[] = [];
    let finish: (() => void) | undefined;
    let restore: (() => void) | undefined;
    const focus = vi.fn<(view: string) => void | Promise<void>>();
    focus.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const nav = createHqNavigation({ surface, reducedMotion: () => true, focus });
    nav.subscribe((state) => views.push(state.view));
    const first = nav.navigate('orders', 'orders', { signal: new AbortController().signal });
    await flush();
    vi.mocked(surface.transitionTo).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          restore = () => resolve(ok(undefined));
        }),
    );
    const second = nav.navigate('journal', 'journal', { signal: new AbortController().signal });
    finish!();
    await flush();
    expect(surface.transitionTo).toHaveBeenCalledTimes(2);
    expect(views).toEqual(['table', 'orders']);
    restore!();
    expect((await first).ok).toBe(false);
    expect((await second).ok).toBe(true);
    expect(views).toEqual(['table', 'orders', 'table', 'journal']);
    expect(nav.getState().view).toBe('journal');
  });
  it('clones incoming scope and selections and freezes all published nested objects', () => {
    const mutableScope = { ...scope };
    const { surface } = makePorts(mutableScope);
    const nav = createHqNavigation({ surface, reducedMotion: () => true, focus: vi.fn() });
    const selection = { kind: 'unit' as const, id: 'one', scope: { ...scope } };
    nav.select(selection);
    selection.id = 'changed';
    selection.scope.playerId = 'other';
    mutableScope.gameId = 'other';
    expect(nav.scope).toEqual(scope);
    expect(nav.getState().selection).toEqual({ kind: 'unit', id: 'one', scope });
    const current = nav.getState();
    expect(Object.isFrozen(current)).toBe(true);
    expect(Object.isFrozen(current.scope)).toBe(true);
    expect(Object.isFrozen(current.selection)).toBe(true);
    if (current.selection.kind !== 'none')
      expect(Object.isFrozen(current.selection.scope)).toBe(true);
    expect(() => {
      (current as { view: string }).view = 'orders';
    }).toThrow();
    const received: ShellState[] = [];
    nav.subscribe((state) => {
      (state.scope as { playerId: string }).playerId = 'attacker';
    });
    nav.subscribe((state) => received.push(state));
    nav.select({ kind: 'none' });
    expect(received).toHaveLength(2);
    expect(received.at(-1)?.scope).toEqual(scope);
    expect(nav.getState().view).toBe('table');
  });
  it('rejects accessor-based runtime selections without executing their getters', () => {
    const { surface } = makePorts();
    const nav = createHqNavigation({ surface, reducedMotion: () => true, focus: vi.fn() });
    const read = vi.fn(() => {
      throw new Error('external getter');
    });
    const selection = Object.defineProperty({}, 'kind', { enumerable: true, get: read });
    expect(nav.select(selection as Selection)).toMatchObject({
      ok: false,
      error: { code: 'invalid-data' },
    });
    expect(read).not.toHaveBeenCalled();
  });
  it.each([
    null,
    {},
    { kind: 'enemy', id: 'x', scope },
    { kind: 'unit', id: '', scope },
    { kind: 'unit', id: 'x'.repeat(129), scope },
    { kind: 'unit', id: 'x', scope: null },
    { kind: 'none', extra: true },
    { kind: 'unit', id: 'x', scope: { ...scope, hidden: true } },
  ])('rejects malformed runtime selection %j without throwing or publishing', (selection) => {
    const { surface } = makePorts();
    const nav = createHqNavigation({ surface, reducedMotion: () => true, focus: vi.fn() });
    const listener = vi.fn();
    nav.subscribe(listener);
    expect(nav.select(selection as Selection)).toMatchObject({
      ok: false,
      error: { code: 'invalid-data' },
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(nav.getState().selection.kind).toBe('none');
  });
});
