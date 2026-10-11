// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeRenderer {
    setPixelRatio(): void {}
    setSize(): void {}
    render(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

import { flushSync, mount, unmount } from 'svelte';
import Desk from './Desk.svelte';
import { activeView, gameId, gameState, windowOpen } from './store.js';
import { initialState } from '../net/state.js';
import { lossesBetween, reasonText, summaryLines, replayRequest, resultFor } from './gameOver.js';

describe('result mapping', () => {
  it('maps the winner to a result for each side', () => {
    expect(resultFor({ winner: 'blue' }, 'blue')).toBe('victory');
    expect(resultFor({ winner: 'blue' }, 'red')).toBe('defeat');
    expect(resultFor({ winner: 'red' }, 'red')).toBe('victory');
    expect(resultFor({ winner: 'red' }, 'blue')).toBe('defeat');
    expect(resultFor({ winner: null }, 'blue')).toBe('draw');
    expect(resultFor({ winner: null }, 'red')).toBe('draw');
  });
  it('words the reason', () => {
    expect(reasonText({ winner: 'red', reason: 'objective-held', atGame: 3_600_000 })).toMatch(
      /^Red held the objective at /,
    );
  });
  it('counts losses per side between two frames', () => {
    const u = (id: string, side: string, strength: number) => ({ id, side, strength });
    const start = { units: [u('a', 'blue', 100), u('b', 'red', 80), u('c', 'red', 50)] };
    const end = { units: [u('a', 'blue', 70), u('b', 'red', 0), u('c', 'red', 50)] };
    expect(lossesBetween(start, end, 'blue')).toEqual({ own: 30, enemy: 80 });
    expect(lossesBetween(start, end, 'red')).toEqual({ own: 80, enemy: 30 });
    expect(
      summaryLines({ winner: 'blue', reason: 'eliminated', atGame: 0 }, { own: 30, enemy: 80 }),
    ).toContain('Enemy losses: 80');
  });
  it('repeats scenario, rate, session type and side', () => {
    expect(replayRequest({ scenario: 's', rate: 12, sessionType: 'hot_seat' }, 'red')).toEqual({
      scenario: 's',
      rate: 12,
      sessionType: 'hot_seat',
      side: 'red',
    });
  });
});

describe('game-over screen', () => {
  let app: ReturnType<typeof mount> | undefined;
  afterEach(() => {
    if (app) void unmount(app);
    app = undefined;
    document.body.innerHTML = '';
    gameState.set(initialState);
    activeView.set('table');
    windowOpen.set(false);
    gameId.set(undefined);
    vi.restoreAllMocks();
  });

  const over = { winner: 'blue' as const, reason: 'eliminated' as const, atGame: 60_000 };

  it('appears on game over whatever view was open, and not before', () => {
    activeView.set('orders');
    app = mount(Desk, { target: document.body });
    flushSync();
    expect(document.querySelector('[role=dialog]')).toBeNull();
    gameState.update((s) => ({ ...s, gameOver: over }));
    flushSync();
    expect(document.querySelector('[role=dialog]')?.textContent).toMatch(/Game time elapsed/);
  });

  it('shows the screen on a finished game at load, and offers every exit', () => {
    gameId.set('g1');
    gameState.update((s) => ({ ...s, gameOver: over }));
    app = mount(Desk, { target: document.body });
    flushSync();
    const labels = [...document.querySelectorAll('[role=dialog] button')].map((b) => b.textContent);
    expect(labels).toEqual([
      "View the umpire's window",
      'Read the journal',
      'Play again',
      'New game',
      'Main menu',
    ]);
  });

  it('the journal button opens the journal and the window button the umpire window', () => {
    gameId.set('g1');
    gameState.update((s) => ({ ...s, gameOver: over }));
    app = mount(Desk, { target: document.body });
    flushSync();
    const journal = document.querySelectorAll<HTMLButtonElement>('[role=dialog] button')[1];
    journal!.click();
    flushSync();
    expect(document.querySelector('#over-h')).toBeNull();
    expect(document.querySelector('#view-journal')).not.toBeNull();
    activeView.set('table');
    flushSync();
    document.querySelector<HTMLButtonElement>('[role=dialog] button')!.click();
    flushSync();
    expect(document.querySelector('#over-h')).toBeNull();
  });

  it('Play again posts the same scenario, side and rate and enters the new game', async () => {
    gameId.set('g1');
    gameState.update((s) => ({
      ...s,
      gameOver: over,
      view: { side: 'red' } as never,
    }));
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
    app = mount(Desk, { target: document.body });
    flushSync();
    document.querySelectorAll<HTMLButtonElement>('[role=dialog] button')[2]!.click();
    await vi.waitFor(() => expect(assign).toHaveBeenCalled());
    expect(JSON.parse(calls.find(([u]) => u === '/games')![1]!.body as string)).toEqual({
      scenario: 'bridge',
      rate: 4,
      sessionType: 'team_vs_team',
      side: 'red',
    });
    expect(assign).toHaveBeenCalledWith('/?game=g2&side=red');
    vi.unstubAllGlobals();
  });
});
