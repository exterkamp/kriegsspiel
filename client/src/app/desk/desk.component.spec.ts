import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtureView } from '@legacy/table/fixture';
import type { GameOver } from '@legacy/net/state';
import { DeskComponent } from './desk.component';
import { DeskStore } from './desk.store';
import { fakeGame } from './fake-game';

const over: GameOver = { winner: 'blue', reason: 'eliminated', atGame: 60_000 };

function mount(state: Parameters<typeof fakeGame>[0] = {}, gameId?: string) {
  const g = fakeGame(state, gameId);
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), { provide: g.provide, useValue: g.fake }],
  });
  const desk = TestBed.inject(DeskStore);
  const f = TestBed.createComponent(DeskComponent);
  const el = f.nativeElement as HTMLElement;
  const key = async (k: string, target: EventTarget = window) => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    await f.whenStable();
  };
  return { g, desk, f, el, key, tick: () => f.whenStable() };
}
const dialog = (el: HTMLElement) => el.querySelector('[role=dialog]');
const dialogButtons = (el: HTMLElement) => [
  ...el.querySelectorAll<HTMLButtonElement>('[role=dialog] button'),
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DeskComponent shell', () => {
  it('has a keyboard-reachable button per view with the table pressed', async () => {
    const { el, tick } = mount();
    await tick();
    const btns = [...el.querySelectorAll('nav button')];
    expect(btns).toHaveLength(6);
    expect(btns[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(btns[1]?.getAttribute('aria-keyshortcuts')).toBe('I');
  });

  it('switches views from the keyboard and clicks, Escape returns to the table', async () => {
    const { el, desk, key, tick } = mount();
    await tick();
    await key('j');
    expect(desk.activeView()).toBe('journal');
    expect(el.querySelector('#view-journal')).not.toBeNull();
    await key('Escape');
    expect(desk.activeView()).toBe('table');
    expect(el.querySelector('#view-journal')).toBeNull();
    el.querySelectorAll<HTMLButtonElement>('nav button')[3]!.click();
    await tick();
    expect(desk.activeView()).toBe('roster');
  });

  it('does not steal keys typed into a text field, but Escape still works there', async () => {
    const { el, desk, key, tick } = mount();
    await tick();
    const ta = document.createElement('textarea');
    el.append(ta);
    await key('j', ta);
    expect(desk.activeView()).toBe('table');
    desk.activeView.set('journal');
    await key('Escape', ta);
    expect(desk.activeView()).toBe('table');
  });

  it('moves focus into the view it opens', async () => {
    const { el, key, f } = mount({ view: fixtureView });
    document.body.append(el);
    await f.whenStable();
    await key('r');
    await f.whenStable();
    expect(document.activeElement).toBe(el.querySelector('#view-roster'));
    el.remove();
  });

  it('shows roster from the shared state, dims the table behind a desk view', async () => {
    const { el, key } = mount({ view: fixtureView });
    await key('r');
    expect(el.querySelector('#view-roster')?.textContent).toContain(fixtureView.ownUnits[0]!.name);
    expect(el.querySelector('.fade')?.classList.contains('on')).toBe(true);
  });

  it('offers the umpire window only once the game is over and has an id', async () => {
    const { el, g, tick } = mount({}, 'g1');
    await tick();
    expect(el.querySelectorAll('nav button')).toHaveLength(6);
    g.fake.set({ gameOver: over });
    await tick();
    expect(el.querySelectorAll('nav button')).toHaveLength(7);
  });
});

describe('the paper and the dock (#455)', () => {
  it("measures the dock into --dock-h, so a paper ends above it, and follows the dock's changes", async () => {
    let fire: () => void = () => undefined;
    const observed: Element[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          fire = cb;
        }
        observe(el: Element): void {
          observed.push(el);
        }
        disconnect = disconnect;
      },
    );
    let height = 276.4;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ height }) as DOMRect,
    );
    const { f, el, tick } = mount({ view: fixtureView });
    await tick();
    expect(observed).toEqual([el.querySelector('.dock')]);
    expect(el.style.getPropertyValue('--dock-h')).toBe('277px');
    height = 120;
    fire();
    expect(el.style.getPropertyValue('--dock-h')).toBe('120px');
    f.destroy();
    expect(disconnect).toHaveBeenCalled();
  });

  it('leaves the paper its default room where there is no ResizeObserver', async () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const { el, tick } = mount();
    await tick();
    expect(el.style.getPropertyValue('--dock-h')).toBe('');
  });
});

describe('game over screen (held PR #266)', () => {
  it('appears on game over whatever view was open, and not before', async () => {
    const { el, g, desk, tick } = mount();
    desk.activeView.set('orders');
    await tick();
    expect(dialog(el)).toBeNull();
    g.fake.set({ gameOver: over });
    await tick();
    expect(desk.activeView()).toBe('table');
    expect(dialog(el)?.textContent).toMatch(/Game time elapsed/);
  });

  it('shows on a finished game at load, offers every exit and focuses the first button', async () => {
    const { el, f } = mount({ gameOver: over }, 'g1');
    document.body.append(el);
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }));
    await f.whenStable();
    expect(dialogButtons(el).map((b) => b.textContent?.trim())).toEqual([
      "View the umpire's window",
      'Read the journal',
      'Play again',
      'New game',
      'Main menu',
    ]);
    expect(document.activeElement).toBe(dialogButtons(el)[0]);
    el.remove();
  });

  it('the journal button opens the journal and the window button the umpire window', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }));
    const { el, desk, tick } = mount({ gameOver: over }, 'g1');
    await tick();
    dialogButtons(el)[1]!.click();
    await tick();
    expect(el.querySelector('#over-h')).toBeNull();
    expect(el.querySelector('#view-journal')).not.toBeNull();
    desk.activeView.set('table');
    await tick();
    dialogButtons(el)[0]!.click();
    await tick();
    expect(el.querySelector('#over-h')).toBeNull();
    expect(desk.windowOpen()).toBe(true);
  });

  it('shows the umpire window only at the table, and its button brings the table back (#438)', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }));
    const { el, desk, tick } = mount({ gameOver: over }, 'g1');
    await tick();
    desk.windowOpen.set(true);
    await tick();
    expect(el.querySelector('ks-umpire-window')).not.toBeNull();
    // Another view of the desk is read on its own, with no outcome over it.
    desk.activeView.set('roster');
    await tick();
    expect(el.querySelector('#view-roster')).not.toBeNull();
    expect(el.querySelector('ks-umpire-window')).toBeNull();
    expect(el.querySelector('#over-h')).toBeNull();
    // The desk bar's window button opens it at the table.
    const button = [...el.querySelectorAll<HTMLButtonElement>('.desk-bar button')].find((b) =>
      b.textContent?.includes("Umpire's window"),
    )!;
    expect(button.getAttribute('aria-pressed')).toBe('false');
    button.click();
    await tick();
    expect(desk.activeView()).toBe('table');
    expect(desk.windowOpen()).toBe(true);
    expect(el.querySelector('ks-umpire-window')).not.toBeNull();
  });

  it('headlines the result for the side being played', async () => {
    const { el, tick } = mount({ gameOver: over, view: { ...fixtureView, side: 'red' } }, 'g1');
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }));
    await tick();
    expect(el.querySelector('#over-h')?.textContent).toBe('Defeat');
  });

  it('Main menu and New game disconnect and navigate', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }));
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const { el, g, tick } = mount({ gameOver: over }, 'g1');
    await tick();
    dialogButtons(el)[4]!.click();
    dialogButtons(el)[3]!.click();
    expect(assign.mock.calls).toEqual([['/'], ['/?lobby=1']]);
    expect(g.fake.disconnect).toHaveBeenCalledTimes(2);
  });

  it('Play again posts the same scenario, side and rate and enters the new game', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return url === '/games'
        ? new Response(JSON.stringify({ id: 'g2' }), { status: 200 })
        : new Response(
            JSON.stringify({
              id: 'g1',
              scenario: 'bridge',
              rate: 4,
              sessionType: 'team_vs_team',
              side: 'red',
            }),
            { status: 200 },
          );
    });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const { el, tick } = mount({ gameOver: over, view: { ...fixtureView, side: 'red' } }, 'g1');
    await tick();
    dialogButtons(el)[2]!.click();
    await vi.waitFor(() => expect(assign).toHaveBeenCalled());
    expect(JSON.parse(calls.find(([u]) => u === '/games')![1]!.body as string)).toEqual({
      scenario: 'bridge',
      rate: 4,
      sessionType: 'team_vs_team',
      side: 'red',
    });
    expect(assign).toHaveBeenCalledWith('/?game=g2&side=red');
  });

  it('shows an error and re-enables Play again when the new game cannot be made', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      url === '/games'
        ? new Response('{}', { status: 500 })
        : new Response(JSON.stringify({ scenario: 's', rate: 1, sessionType: 'solo' }), {
            status: 200,
          }),
    );
    const { el, tick } = mount({ gameOver: over }, 'g1');
    await tick();
    dialogButtons(el)[2]!.click();
    await vi.waitFor(() => expect(el.querySelector('[role=alert]')?.textContent).toMatch(/500/));
    await tick();
    expect(dialogButtons(el)[2]!.disabled).toBe(false);
  });

  describe('losses', () => {
    const fp = { frontage: 100, depth: 50 };
    const u = (id: string, side: string, strength: number) => ({
      id,
      side,
      name: id,
      position: { x: 0, y: 0 },
      facing: 0,
      formation: 'line',
      footprint: fp,
      strength,
      morale: 80,
      ammo: 90,
    });
    const frame = (gameMs: number, units: ReturnType<typeof u>[]) => ({
      gameMs,
      units,
      beliefs: {},
      events: [],
      rulings: [],
    });

    it('fetches the first and final frames for the side and shows the losses', async () => {
      const urls: string[] = [];
      vi.stubGlobal('fetch', async (url: string) => {
        urls.push(url);
        return new Response(
          JSON.stringify(
            url.includes('at=0&')
              ? frame(0, [u('a', 'blue', 100), u('b', 'red', 80)])
              : frame(60_000, [u('a', 'blue', 70), u('b', 'red', 0)]),
          ),
          { status: 200 },
        );
      });
      const { el, tick } = mount({ gameOver: over, view: { ...fixtureView, side: 'blue' } }, 'g1');
      await tick();
      await vi.waitFor(() => expect(dialog(el)?.textContent).toMatch(/Your losses: 30/));
      expect(dialog(el)?.textContent).toMatch(/Enemy losses: 80/);
      expect(urls.sort()).toEqual([
        '/games/g1/window/at?at=0&side=blue',
        '/games/g1/window/at?at=60000&side=blue',
      ]);
    });

    it('omits the losses lines when the fetch fails', async () => {
      const f = vi.fn(async () => new Response('{}', { status: 500 }));
      vi.stubGlobal('fetch', f);
      const { el, tick } = mount({ gameOver: over, view: { ...fixtureView, side: 'blue' } }, 'g1');
      await tick();
      await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(2));
      await new Promise((r) => setTimeout(r, 0));
      await tick();
      const text = dialog(el)?.textContent ?? '';
      expect(text).toMatch(/Game time elapsed/);
      expect(text).not.toMatch(/losses/i);
    });
  });
});
