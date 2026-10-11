import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WindowAt, WindowTimeline } from '@kriegsspiel/protocol';
import { fakeGame } from './fake-game';
import { DeskStore } from './desk.store';
import { UmpireWindowComponent } from './umpire-window.component';

const fp = { frontage: 100, depth: 50 };
const unitOf = (id: string, side: 'blue' | 'red') => ({
  id,
  side,
  name: `${side} ${id}`,
  position: { x: 10, y: 10 },
  facing: 0,
  formation: 'line' as const,
  footprint: fp,
  strength: 400.4,
  morale: 80,
  ammo: 90,
});
const frameAt = (gameMs: number): WindowAt =>
  ({
    gameMs,
    units: [unitOf('b1', 'blue')],
    beliefs: {
      blue: { visibleEnemies: [], lastKnownContacts: [] },
      red: { visibleEnemies: [], lastKnownContacts: [] },
    },
    events: [],
    rulings: [],
  }) as unknown as WindowAt;
const timeline = {
  endMs: 3_600_000,
  outcome: { winner: 'blue', reason: 'objective taken', time: 3_600_000 },
  marks: [
    { ms: 600_000, kind: 'order', label: 'a' },
    { ms: 1_800_000, kind: 'event', label: 'b' },
  ],
} as unknown as WindowTimeline;

/** Answers the two window routes; `at` records each requested moment. */
function stubFetch(over: { timeline?: () => Promise<Response> } = {}) {
  const at: number[] = [];
  const json = (b: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(b), { status }));
  const fn = vi.fn((url: string) => {
    if (url.includes('/window/at')) {
      const ms = Number(new URL(url, 'http://x').searchParams.get('at'));
      at.push(ms);
      return json(frameAt(ms));
    }
    return over.timeline ? over.timeline() : json(timeline);
  });
  vi.stubGlobal('fetch', fn);
  return { fn, at };
}

async function open(gameId: string | null = 'g1') {
  const g = fakeGame({}, gameId ?? undefined);
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), { provide: g.provide, useValue: g.fake }],
  });
  const fixture = TestBed.createComponent(UmpireWindowComponent);
  const el = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    // Let the stubbed fetches resolve, then render.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
  };
  await settle();
  return { el, fixture, desk: TestBed.inject(DeskStore), settle };
}

afterEach(() => vi.unstubAllGlobals());

describe('UmpireWindowComponent', () => {
  it('loads the timeline, shows the outcome and the end of the game', async () => {
    const f = stubFetch();
    const t = await open();
    expect(f.fn.mock.calls[0]![0]).toBe('/games/g1/window');
    expect(f.at).toEqual([3_600_000]);
    expect(t.el.querySelector('.outcome')!.textContent).toContain('blue won');
    expect(t.el.querySelector('.outcome')!.textContent).toContain('objective taken');
    expect(t.desk.windowFrame()?.gameMs).toBe(3_600_000);
    expect(t.el.querySelector('output')!.textContent).toBe('Day 1 01:00');
    expect(t.el.querySelector('input[type=range]')!.getAttribute('aria-label')).toBe('Game time');
  });

  it('says it is rebuilding while the log loads', async () => {
    stubFetch({ timeline: () => new Promise(() => undefined) });
    const t = await open();
    expect(t.el.querySelector('[role=status]')!.textContent).toContain('Rebuilding');
  });

  it('explains a game that has not ended', async () => {
    stubFetch({
      timeline: () => Promise.resolve(new Response('{"error":"game_not_over"}', { status: 409 })),
    });
    const t = await open();
    expect(t.el.querySelector('[role=alert]')!.textContent).toBe(
      'Available once the game has ended.',
    );
  });

  it('steps between marks and back past the first to the start', async () => {
    const f = stubFetch();
    const t = await open();
    const btn = (label: string) =>
      t.el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    btn('Previous event').click();
    await t.settle();
    expect(f.at.at(-1)).toBe(1_800_000);
    btn('Previous event').click();
    await t.settle();
    expect(f.at.at(-1)).toBe(600_000);
    btn('Previous event').click();
    await t.settle();
    expect(f.at.at(-1)).toBe(0);
    btn('Next event').click();
    await t.settle();
    expect(f.at.at(-1)).toBe(600_000);
  });

  it('loads the moment the slider is released on', async () => {
    const f = stubFetch();
    const t = await open();
    const range = t.el.querySelector<HTMLInputElement>('input[type=range]')!;
    range.value = '1200000';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    await t.fixture.whenStable();
    expect(t.el.querySelector('output')!.textContent).toBe('Day 1 00:20');
    expect(f.at).toEqual([3_600_000]);
    range.dispatchEvent(new Event('change', { bubbles: true }));
    await t.settle();
    expect(f.at.at(-1)).toBe(1_200_000);
  });

  it('switches the overlay and closes', async () => {
    stubFetch();
    const t = await open();
    t.el.querySelector<HTMLInputElement>('input[name=belief][value=red]')!.click();
    await t.fixture.whenStable();
    expect(t.desk.windowBelief()).toBe('red');
    t.desk.windowOpen.set(true);
    [...t.el.querySelectorAll('button')].find((b) => b.textContent === 'Close')!.click();
    expect(t.desk.windowOpen()).toBe(false);
  });

  it('describes the unit under the pointer', async () => {
    stubFetch();
    const t = await open();
    expect(t.el.querySelector('.hover')!.textContent).toContain('Point at a unit');
    t.desk.windowHover.set('b1');
    await t.fixture.whenStable();
    const text = t.el.querySelector('.hover')!.textContent!;
    expect(text).toContain('blue b1');
    expect(text).toContain('strength 400, morale 80');
    expect(text).toContain('No fire or rulings');
  });

  it('clears the frame and hover when it is closed', async () => {
    stubFetch();
    const t = await open();
    t.desk.windowHover.set('b1');
    t.fixture.destroy();
    expect(t.desk.windowFrame()).toBeUndefined();
    expect(t.desk.windowHover()).toBeUndefined();
  });

  it('fetches nothing without a game', async () => {
    const f = stubFetch();
    await open(null);
    expect(f.fn).not.toHaveBeenCalled();
  });
});
