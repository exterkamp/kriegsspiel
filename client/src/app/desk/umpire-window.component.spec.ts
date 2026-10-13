import { formatGameTime } from '@legacy/net/state';
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
const critique = {
  source: 'model',
  summary: 'Blue held the bridge.',
  points: [
    {
      kind: 'knowledge',
      side: 'blue',
      minute: 10,
      text: 'Blue learned of the advance ten minutes late.',
      cites: [{ id: 'fact-3', minute: 10, label: 'Blue received a report' }],
    },
  ],
};

function stubFetch(
  over: { timeline?: () => Promise<Response>; critique?: () => Promise<Response> } = {},
) {
  const at: number[] = [];
  const json = (b: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(b), { status }));
  const fn = vi.fn((url: string) => {
    if (url.includes('/window/at')) {
      const ms = Number(new URL(url, 'http://x').searchParams.get('at'));
      at.push(ms);
      return json(frameAt(ms));
    }
    if (url.endsWith('/critique')) return over.critique ? over.critique() : json(critique);
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

  it('shows the critique with each point dated and its cites, and jumps the scrubber to them', async () => {
    const f = stubFetch();
    const t = await open();
    expect(f.fn.mock.calls.map((c) => c[0])).toContain('/games/g1/critique');
    const sec = t.el.querySelector('.critique')!;
    expect(sec.textContent).toContain('Blue held the bridge.');
    expect(sec.textContent).toContain('What was known');
    expect(sec.textContent).toContain('Blue learned of the advance ten minutes late.');
    const cite = sec.querySelector<HTMLButtonElement>('button.cite')!;
    expect(cite.title).toBe('Blue received a report');
    cite.click();
    await t.settle();
    expect(f.at.at(-1)).toBe(600_000);
  });

  it('says so when the critique is the log wording, and when it cannot be loaded', async () => {
    stubFetch({
      critique: () =>
        Promise.resolve(new Response(JSON.stringify({ ...critique, source: 'template' }))),
    });
    const a = await open();
    expect(a.el.querySelector('.critique .why')!.textContent).toContain('straight from the log');
    TestBed.resetTestingModule();
    stubFetch({
      critique: () => Promise.resolve(new Response('{"error":"cannot_replay"}', { status: 422 })),
    });
    const b = await open();
    expect(b.el.querySelector('.critique .why')!.textContent).toContain('cannot_replay');
    expect(b.el.querySelector('output')).not.toBeNull();
  });

  it('says the umpire is writing while the critique is pending', async () => {
    stubFetch({ critique: () => new Promise(() => undefined) });
    const t = await open();
    expect(t.el.querySelector('.critique [role=status]')!.textContent).toContain('writing');
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

  it('says when the ruling was declared and when the game ended (#343)', async () => {
    stubFetch();
    const t = await open();
    t.desk.windowFrame.set({
      ...frameAt(3_600_000),
      rulings: [{ id: 'r1', time: 1_560_000, narrative: 'The bridge falls.', rationale: 'dice' }],
    } as unknown as WindowAt);
    await t.fixture.whenStable();
    const text = t.el.querySelector('.ended')!.textContent!;
    expect(text).toContain(`Declared ${formatGameTime(1_560_000)}`);
    expect(text).toContain(`ended ${formatGameTime(3_600_000)}`);
  });

  it('clears the frame and hover when it is closed', async () => {
    stubFetch();
    const t = await open();
    t.desk.windowHover.set('b1');
    t.fixture.destroy();
    expect(t.desk.windowFrame()).toBeUndefined();
    expect(t.desk.windowHover()).toBeUndefined();
  });

  it('sets no frame when the timeline lands after it is closed', async () => {
    let land!: (r: Response) => void;
    const f = stubFetch({ timeline: () => new Promise<Response>((r) => (land = r)) });
    const t = await open();
    t.fixture.destroy();
    land(new Response(JSON.stringify(timeline)));
    await t.settle();
    expect(f.at).toEqual([]);
    expect(t.desk.windowFrame()).toBeUndefined();
  });

  it('drops an older frame that lands after a newer one', async () => {
    const waiting = new Map<number, (r: Response) => void>();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (!url.includes('/window/at'))
          return Promise.resolve(new Response(JSON.stringify(timeline)));
        const ms = Number(new URL(url, 'http://x').searchParams.get('at'));
        return new Promise<Response>((r) => waiting.set(ms, r));
      }),
    );
    const t = await open();
    const reply = (ms: number) => waiting.get(ms)!(new Response(JSON.stringify(frameAt(ms))));
    const btn = t.el.querySelector<HTMLButtonElement>('button[aria-label="Previous event"]')!;
    // The end-of-game frame is still pending when the user steps back to the start.
    btn.click();
    await t.settle();
    reply(0);
    await t.settle();
    reply(3_600_000);
    await t.settle();
    expect(t.desk.windowFrame()?.gameMs).toBe(0);
  });

  it('fetches nothing without a game', async () => {
    const f = stubFetch();
    await open(null);
    expect(f.fn).not.toHaveBeenCalled();
  });
});
