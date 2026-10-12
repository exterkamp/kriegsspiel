// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { SideView } from '@kriegsspiel/protocol';
import { AGING_MS, STALE_MS, formatAge, freshness, pct, rosterRows } from './roster.js';
import { fixtureView } from '../table/fixture.js';

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

  it('shows the commander and dates each unit by its own report', () => {
    const u = { ...view.ownUnits[0]!, commander: 'Gen. Ney', reportedAt: view.atGame - 3_600_000 };
    const r = rosterRows({ ...view, ownUnits: [u] }, view.atGame)[0]!;
    expect(r).toMatchObject({ commander: 'Gen. Ney', reportedAt: u.reportedAt, ageMs: 3_600_000 });
    expect(rosterRows(view, view.atGame)[0]!.commander).toBeUndefined();
  });
});
