import { describe, expect, it, vi } from 'vitest';
import { observeDisplayLifecycle } from './display-lifecycle.js';

class Display extends EventTarget {
  devicePixelRatio = 1;
  queries: { query: string; events: EventTarget }[] = [];
  matchMedia(query: string): MediaQueryList {
    const events = new EventTarget();
    this.queries.push({ query, events });
    return events as unknown as MediaQueryList;
  }
  transition(type: string, persisted: boolean): void {
    const event = new Event(type);
    Object.defineProperty(event, 'persisted', { value: persisted });
    this.dispatchEvent(event);
  }
}
describe('preview display lifecycle', () => {
  it('survives repeated cached-page restores and disposes only on a final departure', () => {
    const display = new Display();
    const redraw = vi.fn();
    const dispose = vi.fn();
    const stop = observeDisplayLifecycle(display as unknown as Window, redraw, dispose);
    for (let i = 0; i < 2; i++) {
      display.transition('pagehide', true);
      expect(dispose).not.toHaveBeenCalled();
      display.devicePixelRatio = 1 + i;
      display.transition('pageshow', true);
    }
    expect(redraw).toHaveBeenCalledTimes(2);
    expect(display.queries.at(-1)!.query).toBe('(resolution: 2dppx)');
    display.transition('pagehide', false);
    expect(dispose).toHaveBeenCalledTimes(1);
    stop();
  });
  it('redraws on repeated DPR changes without a resize and removes obsolete watchers', () => {
    const display = new Display();
    const redraw = vi.fn();
    const stop = observeDisplayLifecycle(display as unknown as Window, redraw, vi.fn());
    const old = display.queries[0]!.events;
    display.devicePixelRatio = 2;
    old.dispatchEvent(new Event('change'));
    expect(redraw).toHaveBeenCalledTimes(1);
    expect(display.queries[1]!.query).toBe('(resolution: 2dppx)');
    old.dispatchEvent(new Event('change'));
    expect(redraw).toHaveBeenCalledTimes(1);
    display.devicePixelRatio = 1.25;
    display.queries[1]!.events.dispatchEvent(new Event('change'));
    expect(redraw).toHaveBeenCalledTimes(2);
    expect(display.queries[2]!.query).toBe('(resolution: 1.25dppx)');
    stop();
    display.queries[2]!.events.dispatchEvent(new Event('change'));
    display.dispatchEvent(new Event('resize'));
    display.transition('pageshow', true);
    expect(redraw).toHaveBeenCalledTimes(2);
  });
  it('also refreshes on resize but leaves ordinary initial pageshow alone', () => {
    const display = new Display();
    const redraw = vi.fn();
    const stop = observeDisplayLifecycle(display as unknown as Window, redraw, vi.fn());
    display.transition('pageshow', false);
    expect(redraw).not.toHaveBeenCalled();
    display.dispatchEvent(new Event('resize'));
    expect(redraw).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe('transactional display registrations', () => {
  it('removes partial window and media registrations after add throws following registration', () => {
    const display = new Display(),
      redraw = vi.fn();
    const add = display.addEventListener.bind(display);
    vi.spyOn(display, 'addEventListener').mockImplementation((name, handler, options) => {
      add(name, handler, options);
      if (name === 'pageshow') throw new Error('register failure');
    });
    expect(() => observeDisplayLifecycle(display as unknown as Window, redraw, vi.fn())).toThrow(
      'register failure',
    );
    display.dispatchEvent(new Event('resize'));
    display.transition('pageshow', true);
    display.queries[0]!.events.dispatchEvent(new Event('change'));
    expect(redraw).not.toHaveBeenCalled();
  });
  it('releases later independent registrations when a removal throws and is idempotent', () => {
    const display = new Display(),
      redraw = vi.fn();
    const stop = observeDisplayLifecycle(display as unknown as Window, redraw, vi.fn());
    const remove = display.removeEventListener.bind(display);
    const calls = vi
      .spyOn(display, 'removeEventListener')
      .mockImplementation((name, handler, options) => {
        remove(name, handler, options);
        if (name === 'pagehide') throw new Error('release failure');
      });
    expect(stop).not.toThrow();
    stop();
    expect(calls).toHaveBeenCalledTimes(3);
    display.dispatchEvent(new Event('resize'));
    display.transition('pageshow', true);
    expect(redraw).not.toHaveBeenCalled();
  });
  it('holds one resolution listener and does not remove old query handles again at final release', () => {
    const display = new Display();
    const stop = observeDisplayLifecycle(display as unknown as Window, vi.fn(), vi.fn());
    const removals: ReturnType<typeof vi.spyOn>[] = [];
    for (let i = 0; i < 50; i++) {
      const events = display.queries.at(-1)!.events;
      removals.push(vi.spyOn(events, 'removeEventListener'));
      display.devicePixelRatio = 1 + i / 10;
      display.transition('pageshow', true);
      expect(removals[i]).toHaveBeenCalledOnce();
    }
    stop();
    for (const remove of removals) expect(remove).toHaveBeenCalledOnce();
  });
});
