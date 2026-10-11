// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import type { SideView } from '@kriegsspiel/protocol';
import Roster from './Roster.svelte';
import { AGING_MS, STALE_MS, formatAge, freshness, pct, rosterRows } from './roster.js';
import { activeView, gameState, showOnTable } from './store.js';
import { fixtureView } from '../table/fixture.js';
import { initialState } from '../net/state.js';

const view: SideView = { ...fixtureView, atGame: 3_600_000 };

describe('rosterRows', () => {
  it('is empty without a view', () => {
    expect(rosterRows(undefined, 0)).toEqual([]);
  });
  it('lists exactly the SideView formations, dated by the view', () => {
    const rows = rosterRows(view, view.atGame);
    expect(rows.map((r) => r.id)).toEqual(view.ownUnits.map((u) => u.id));
    expect(rows[0]).toMatchObject({ reportedAt: view.atGame, ageMs: 0, freshness: 'fresh' });
  });
  it('ages by game time only, so 1:1 and 12:1 agree for the same game minutes', () => {
    const later = view.atGame + 45 * 60_000;
    expect(rosterRows(view, later)[0]!.freshness).toBe('aging');
    expect(rosterRows(view, view.atGame + STALE_MS)[0]!.freshness).toBe('stale');
    expect(rosterRows(view, view.atGame - 5)[0]!.ageMs).toBe(0);
  });
  it('shows missing figures as unknown, not zero', () => {
    const u = { ...view.ownUnits[0]!, morale: NaN, supply: undefined as unknown as number };
    const r = rosterRows({ ...view, ownUnits: [u] }, view.atGame)[0]!;
    expect(r.morale).toBeUndefined();
    expect(r.supply).toBeUndefined();
    expect(pct(0)).toBe(0);
  });
  it('bands and formats ages', () => {
    expect(freshness(AGING_MS - 1)).toBe('fresh');
    expect(freshness(AGING_MS)).toBe('aging');
    expect(formatAge(0)).toBe('just now');
    expect(formatAge(45 * 60_000)).toBe('45 min');
    expect(formatAge(190 * 60_000)).toBe('3 h 10 min');
    expect(formatAge(26 * 3_600_000)).toBe('1 d 2 h');
  });
});

describe('Roster view', () => {
  let cmp: ReturnType<typeof mount> | undefined;
  afterEach(() => {
    if (cmp) unmount(cmp);
    cmp = undefined;
    document.body.innerHTML = '';
    gameState.set(initialState);
    activeView.set('table');
    showOnTable.set(undefined);
  });
  it('renders aging, unknowns, and focuses a unit on the table when clicked', () => {
    const u = { ...view.ownUnits[0]!, morale: NaN };
    gameState.set({
      ...initialState,
      view: { ...view, ownUnits: [u] },
      clock: {
        gameMs: view.atGame + STALE_MS,
        localWallMs: Date.now(),
        rate: 12,
        status: 'paused',
      },
    });
    cmp = mount(Roster, { target: document.body });
    flushSync();
    const row = document.querySelector(`tr[data-unit="${u.id}"]`)!;
    expect(row.classList.contains('stale')).toBe(true);
    expect(row.textContent).toContain('unknown');
    expect(row.textContent).toContain('2 h old (stale)');
    activeView.set('roster');
    row.querySelector('button')!.click();
    expect(get(showOnTable)).toEqual(u.position);
    expect(get(activeView)).toBe('table');
  });
  it('ages a running 12:1 clock in game time', () => {
    const u = view.ownUnits[0]!;
    // 10 wall minutes at 12:1 is 2 game hours past the view date.
    gameState.set({
      ...initialState,
      view: { ...view, ownUnits: [u] },
      clock: {
        gameMs: view.atGame,
        localWallMs: Date.now() - 10 * 60_000,
        rate: 12,
        status: 'running',
      },
    });
    cmp = mount(Roster, { target: document.body });
    flushSync();
    const row = document.querySelector(`tr[data-unit="${u.id}"]`)!;
    expect(row.classList.contains('stale')).toBe(true);
    expect(row.textContent).toContain('2 h old (stale)');
  });
});
