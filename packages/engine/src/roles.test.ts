import { describe, expect, it } from 'vitest';
import {
  ROLES,
  advanceTo,
  createState,
  EventRegistry,
  maySign,
  mayDraft,
  registerCombat,
  registerMovement,
  registerVisibility,
  startVisibility,
  viewFor,
  viewForRole,
  type GameState,
  type Seat,
} from './index.js';
import { miniWorld } from './scenario.testkit.js';
import { fileReport } from './visibility.js';

const at = (n: number) => n * 100 + 50;

/** Blue: b1 (sees r-near), b2 (far from everything). Red: r-near, r-far, r-secret. */
function world(): GameState {
  const w = miniWorld({
    units: [
      { id: 'b1', side: 'blue', x: at(5), y: at(5) },
      { id: 'b2', side: 'blue', x: at(2), y: at(14), strength: 777 },
      { id: 'r-near', side: 'red', x: at(8), y: at(5) },
      { id: 'r-far', side: 'red', x: at(25), y: at(15), strength: 463 },
    ],
  });
  return w;
}

function played(): GameState {
  const reg = new EventRegistry<GameState>();
  registerMovement(reg);
  registerCombat(reg);
  registerVisibility(reg);
  let s = startVisibility(createState(1, world(), 0));
  s = advanceTo(s, 20 * 60_000, reg).state;
  // Supply reports for b2.
  const w = fileReport(
    s.world,
    'lowAmmo',
    s.world.units.find((u) => u.id === 'b2')!,
    0,
  );
  return { ...w, time: s.time };
}

const seats: Record<string, Seat> = {
  commander: { role: 'commander' },
  chiefOfStaff: { role: 'chiefOfStaff' },
  intelligence: { role: 'intelligence' },
  quartermaster: { role: 'quartermaster' },
  subordinate: { role: 'subordinate', units: ['b2'] },
};

describe('viewForRole', () => {
  it('gives the commander and chief of staff the side view', () => {
    const w = played();
    const full = viewFor(w, 'blue');
    for (const role of ['commander', 'chiefOfStaff'] as const) {
      const { role: r, ...rest } = viewForRole(w, 'blue', seats[role]!);
      expect(r).toBe(role);
      expect(rest).toEqual(full);
    }
  });

  it('shows intelligence the enemy picture but not our condition', () => {
    const w = played();
    const v = viewForRole(w, 'blue', seats.intelligence!);
    expect(v.visibleEnemies.map((e) => e.id)).toEqual(['r-near']);
    expect(v.reports.every((r) => r.kind === 'contact')).toBe(true);
    expect(v.ownUnits).toHaveLength(2);
    const json = JSON.stringify(v.ownUnits);
    for (const k of ['strength', 'morale', 'fatigue', 'ammo']) {
      expect(json).not.toContain(k);
    }
  });

  it('shows the quartermaster our condition and supply reports but no enemy', () => {
    const w = played();
    const v = viewForRole(w, 'blue', seats.quartermaster!);
    expect(v.ownUnits.every((u) => 'ammo' in u && 'fatigue' in u)).toBe(true);
    expect(v.visibleEnemies).toEqual([]);
    expect(v.lastKnownContacts).toEqual([]);
    expect(v.documents).toEqual([]);
    expect(v.reports.map((r) => r.kind)).toEqual(['lowAmmo']);
  });

  it('limits a subordinate to their own units, sightings and reports', () => {
    const w = played();
    const blind = viewForRole(w, 'blue', seats.subordinate!);
    expect(blind.ownUnits.map((u) => u.id)).toEqual(['b2']);
    expect(blind.visibleEnemies).toEqual([]); // b1 sees r-near, b2 does not
    expect(blind.lastKnownContacts).toEqual([]);
    expect(blind.reports.map((r) => r.kind)).toEqual(['lowAmmo']);

    const sighted = viewForRole(w, 'blue', { role: 'subordinate', units: ['b1'] });
    expect(sighted.visibleEnemies.map((e) => e.id)).toEqual(['r-near']);
    expect(sighted.ownUnits.map((u) => u.id)).toEqual(['b1']);
    expect(sighted.reports.every((r) => r.from === 'Unit b1')).toBe(true);
  });

  it('ignores units a subordinate names that are not on their side', () => {
    const w = played();
    const v = viewForRole(w, 'blue', { role: 'subordinate', units: ['r-near', 'nobody'] });
    expect(v.ownUnits).toEqual([]);
    expect(v.visibleEnemies).toEqual([]);
    expect(v.reports).toEqual([]);
  });

  it('gives a subordinate with no formations an empty view', () => {
    const v = viewForRole(played(), 'blue', { role: 'subordinate' });
    expect(v.ownUnits).toEqual([]);
    expect(v.visibleEnemies).toEqual([]);
  });

  it('never gives any role more than the side view, or anything hidden', () => {
    const w = played();
    w.units.find((u) => u.id === 'r-far')!.intent = {
      kind: 'hold',
      at: { x: 2_400_000, y: 1_400_000 },
    };
    const full = viewFor(w, 'blue');
    const subsets = <T extends { id: string }>(sub: T[], all: T[]) =>
      sub.every((s) => all.some((a) => a.id === s.id));
    for (const seat of [
      ...Object.values(seats),
      { role: 'subordinate', units: ['b1', 'b2'] } as Seat,
    ]) {
      const v = viewForRole(w, 'blue', seat);
      expect(subsets(v.ownUnits, full.ownUnits)).toBe(true);
      expect(subsets(v.visibleEnemies, full.visibleEnemies)).toBe(true);
      expect(subsets(v.lastKnownContacts, full.lastKnownContacts)).toBe(true);
      expect(subsets(v.reports, full.reports)).toBe(true);
      expect(subsets(v.documents, full.documents)).toBe(true);
      const json = JSON.stringify(v);
      for (const hidden of ['r-far', '463', '"hold"', 'Unit r-far']) {
        expect(json).not.toContain(hidden);
      }
      // Enemy-side fields stay as coarse as in the side view.
      for (const e of v.visibleEnemies) {
        expect(Object.keys(e).sort()).toEqual([
          'facing',
          'footprint',
          'formation',
          'id',
          'position',
          'sizeEstimate',
        ]);
      }
    }
  });

  it('covers every role', () => {
    expect(Object.keys(seats).sort()).toEqual([...ROLES].sort());
  });
});

describe('permissions', () => {
  const w = world();
  it('lets the commander sign for any living unit of the side only', () => {
    expect(maySign(w, 'blue', seats.commander!, 'b1')).toBe(true);
    expect(maySign(w, 'blue', seats.commander!, 'b2')).toBe(true);
    expect(maySign(w, 'blue', seats.commander!, 'r-near')).toBe(false);
    expect(maySign(w, 'blue', seats.commander!, 'nobody')).toBe(false);
    const dead = { ...w, units: w.units.map((u) => (u.id === 'b1' ? { ...u, strength: 0 } : u)) };
    expect(maySign(dead, 'blue', seats.commander!, 'b1')).toBe(false);
  });

  it('lets a subordinate sign only for their own formations', () => {
    expect(maySign(w, 'blue', seats.subordinate!, 'b2')).toBe(true);
    expect(maySign(w, 'blue', seats.subordinate!, 'b1')).toBe(false);
    expect(maySign(w, 'blue', { role: 'subordinate', units: ['r-near'] }, 'r-near')).toBe(false);
  });

  it('never lets the staff sign', () => {
    for (const role of ['chiefOfStaff', 'intelligence', 'quartermaster'] as const) {
      expect(maySign(w, 'blue', seats[role]!, 'b1')).toBe(false);
    }
  });

  it('lets staff draft for any unit and a subordinate only for theirs', () => {
    for (const role of ['commander', 'chiefOfStaff', 'intelligence', 'quartermaster'] as const) {
      expect(mayDraft(w, 'blue', seats[role]!, 'b1')).toBe(true);
      expect(mayDraft(w, 'blue', seats[role]!, 'r-near')).toBe(false);
    }
    expect(mayDraft(w, 'blue', seats.subordinate!, 'b2')).toBe(true);
    expect(mayDraft(w, 'blue', seats.subordinate!, 'b1')).toBe(false);
  });
});
