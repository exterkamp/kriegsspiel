import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { SideView } from '@kriegsspiel/protocol';
import { initialState } from '@legacy/net/state';
import { fixtureView } from '@legacy/table/fixture';
import { STALE_MS } from '@legacy/desk/roster';
import { DeskStore } from '../desk.store';
import { stubGame } from '../testing';
import { RosterComponent } from './roster.component';

const view: SideView = { ...fixtureView, atGame: 3_600_000 };

describe('RosterComponent', () => {
  it('says so when nothing is reported', async () => {
    stubGame();
    const f = TestBed.createComponent(RosterComponent);
    await f.whenStable();
    expect((f.nativeElement as HTMLElement).textContent).toContain('No formations reported yet.');
  });

  it('renders aging and unknowns, and focuses a unit on the table when clicked', async () => {
    const u = { ...view.ownUnits[0]!, morale: NaN };
    stubGame({
      ...initialState,
      view: { ...view, ownUnits: [u] },
      clock: {
        gameMs: view.atGame + STALE_MS,
        localWallMs: Date.now(),
        rate: 12,
        status: 'paused',
      },
    });
    const desk = TestBed.inject(DeskStore);
    desk.activeView.set('roster');
    const f = TestBed.createComponent(RosterComponent);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const row = el.querySelector(`tr[data-unit="${u.id}"]`)!;
    expect(row.classList.contains('stale')).toBe(true);
    expect(row.textContent).toContain('unknown');
    expect(row.textContent).toContain('2 h old (stale)');
    row.querySelector('button')!.click();
    expect(desk.showOnTable()).toEqual(u.position);
    expect(desk.activeView()).toBe('table');
  });

  it('ages a running 12:1 clock in game time', async () => {
    const u = view.ownUnits[0]!;
    // 10 wall minutes at 12:1 is 2 game hours past the view date.
    stubGame({
      ...initialState,
      view: { ...view, ownUnits: [u] },
      clock: {
        gameMs: view.atGame,
        localWallMs: Date.now() - 10 * 60_000,
        rate: 12,
        status: 'running',
      },
    });
    const f = TestBed.createComponent(RosterComponent);
    await f.whenStable();
    const row = (f.nativeElement as HTMLElement).querySelector(`tr[data-unit="${u.id}"]`)!;
    expect(row.classList.contains('stale')).toBe(true);
    expect(row.textContent).toContain('2 h old (stale)');
  });

  it('re-reads the clock on a timer, so a row ages while it is watched', () => {
    vi.useFakeTimers();
    try {
      const u = view.ownUnits[0]!;
      stubGame({
        ...initialState,
        view: { ...view, ownUnits: [u] },
        clock: { gameMs: view.atGame, localWallMs: Date.now(), rate: 12, status: 'running' },
      });
      const f = TestBed.createComponent(RosterComponent);
      f.detectChanges();
      const row = () =>
        (f.nativeElement as HTMLElement).querySelector(`tr[data-unit="${u.id}"]`)!.textContent;
      const before = row();
      expect(before).not.toContain('2 h old');
      // 10 wall minutes at 12:1 is 2 game hours.
      vi.advanceTimersByTime(10 * 60_000);
      f.detectChanges();
      expect(row()).toContain('2 h old (stale)');
    } finally {
      vi.useRealTimers();
    }
  });
});
