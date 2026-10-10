import { describe, expect, it } from 'vitest';
import {
  COURIER_DELAY_MS,
  EventRegistry,
  MS_PER_MINUTE,
  advanceTo,
  canSee,
  createState,
  issueMove,
  loadScenario,
  registerCombat,
  registerMovement,
  registerVisibility,
  schedule,
  startVisibility,
  viewFor,
  type GameState,
  type Unit,
} from './index.js';

const rows = (wood: Array<[number, number]> = []) => {
  const g = Array.from({ length: 20 }, () => Array.from({ length: 30 }, () => '.'));
  for (const [x, y] of wood) g[y]![x] = 'W';
  return g.map((r) => r.join(''));
};

function world(
  units: Array<[string, 'blue' | 'red', number, number, number?]>,
  wood: Array<[number, number]> = [],
): GameState {
  return loadScenario({
    id: 't',
    seed: 1,
    map: {
      legend: { '.': 'open', W: 'wood', B: 'bridge' },
      rows: [...rows(wood).slice(0, 19), 'B' + '.'.repeat(29)],
    },
    sides: [
      { id: 'blue', name: 'Blue', controller: 'human', hq: { x: 0, y: 0 } },
      { id: 'red', name: 'Red', controller: 'scripted', hq: { x: 29, y: 0 } },
    ],
    units: units.map(([id, side, x, y, strength]) => ({
      id,
      side,
      kind: 'infantry',
      name: `Unit ${id}`,
      x,
      y,
      strength: strength ?? 437,
      morale: 71,
      facing: 'N',
    })),
    victory: { objective: { x: 0, y: 19 }, defender: 'blue', attacker: 'red', holdMinutes: 10 },
  });
}

function registry() {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerCombat(r);
  registerVisibility(r);
  return r;
}

const unit = (w: GameState, id: string): Unit => w.units.find((u) => u.id === id)!;

describe('canSee', () => {
  it('sees within range on open ground and not beyond', () => {
    const w = world([
      ['b', 'blue', 5, 5],
      ['r1', 'red', 10, 5],
      ['r2', 'red', 12, 5],
    ]);
    expect(canSee(w, unit(w, 'b'), unit(w, 'r1'))).toBe(true);
    expect(canSee(w, unit(w, 'b'), unit(w, 'r2'))).toBe(false);
  });

  it('is blocked by woods in between', () => {
    const w = world(
      [
        ['b', 'blue', 5, 5],
        ['r', 'red', 9, 5],
      ],
      [[7, 5]],
    );
    expect(canSee(w, unit(w, 'b'), unit(w, 'r'))).toBe(false);
  });

  it('hides a unit deep in a wood beyond 2 tiles', () => {
    const w = world(
      [
        ['b', 'blue', 5, 5],
        ['r', 'red', 9, 5],
      ],
      [[9, 5]],
    );
    expect(canSee(w, unit(w, 'b'), unit(w, 'r'))).toBe(false);
    const near = world(
      [
        ['b', 'blue', 5, 5],
        ['r', 'red', 7, 5],
      ],
      [[7, 5]],
    );
    expect(canSee(near, unit(near, 'b'), unit(near, 'r'))).toBe(true);
  });
});

describe('canSee symmetry', () => {
  it('gives the same answer from either end across a wood corner', () => {
    for (let wx = 3; wx <= 7; wx++) {
      for (let wy = 3; wy <= 7; wy++) {
        const w = world(
          [
            ['a', 'blue', 2, 2],
            ['b', 'red', 6, 5],
          ],
          [[wx, wy]],
        );
        expect(canSee(w, unit(w, 'a'), unit(w, 'b'))).toBe(canSee(w, unit(w, 'b'), unit(w, 'a')));
      }
    }
  });

  it('is symmetric on a diagonal-ish line over many layouts', () => {
    for (let wx = 0; wx < 12; wx++) {
      for (let wy = 0; wy < 12; wy++) {
        const w = world(
          [
            ['a', 'blue', 4, 7],
            ['b', 'red', 7, 4],
          ],
          [[wx, wy]],
        );
        if (
          [
            [4, 7],
            [7, 4],
          ].some(([x, y]) => x === wx && y === wy)
        )
          continue;
        expect(canSee(w, unit(w, 'a'), unit(w, 'b'))).toBe(canSee(w, unit(w, 'b'), unit(w, 'a')));
      }
    }
  });
});

describe('viewFor', () => {
  it('shows own units fully and visible enemies coarsely', () => {
    const w = world([
      ['b', 'blue', 5, 5, 500],
      ['r', 'red', 8, 5, 437],
    ]);
    const v = viewFor(w, 'blue');
    expect(v.ownUnits[0]).toMatchObject({ id: 'b', strength: 500, morale: 71 });
    expect(v.visibleEnemies).toEqual([
      { id: 'r', position: { x: 8, y: 5 }, sizeEstimate: 'about a battalion' },
    ]);
  });

  it('leaks nothing about unseen enemies', () => {
    const w = world([
      ['b', 'blue', 2, 2],
      ['r-secret', 'red', 25, 15, 463],
    ]);
    w.units.find((u) => u.id === 'r-secret')!.intent = { kind: 'hold', at: { x: 24, y: 14 } };
    const json = JSON.stringify(viewFor(w, 'blue'));
    for (const hidden of ['r-secret', '463', '"hold"', 'Unit r-secret']) {
      expect(json).not.toContain(hidden);
    }
    const v = viewFor(w, 'blue');
    expect(v.visibleEnemies).toEqual([]);
    expect(v.lastKnownContacts).toEqual([]);
  });

  it('never exposes enemy private fields even when seen', () => {
    const w = world([
      ['b', 'blue', 5, 5],
      ['r', 'red', 8, 5, 463],
    ]);
    w.units.find((u) => u.id === 'r')!.intent = { kind: 'hold', at: { x: 8, y: 5 } };
    const json = JSON.stringify(viewFor(w, 'blue'));
    for (const s of ['463', 'intent', 'hold', 'facing', 'Unit r', 'Unit r"']) {
      expect(json).not.toContain(s);
    }
    expect(json.match(/"morale"/g)).toHaveLength(1); // own unit only
    const enemy = viewFor(w, 'blue').visibleEnemies[0]!;
    expect(Object.keys(enemy).sort()).toEqual(['id', 'position', 'sizeEstimate']);
  });

  it('keeps a last-known contact at the old position after the enemy moves away', () => {
    const reg = registry();
    let s = startVisibility(
      createState(
        1,
        world([
          ['b', 'blue', 5, 5],
          ['r', 'red', 8, 5],
        ]),
        0,
      ),
    );
    s = advanceTo(s, 0, reg).state;
    const first = viewFor(s.world, 'blue', s.time);
    expect(first.visibleEnemies).toHaveLength(1);
    // Never both visible and last-known.
    expect(first.lastKnownContacts).toEqual([]);

    s = issueMove(s, 'r', { x: 25, y: 5 });
    s = advanceTo(s, 20 * MS_PER_MINUTE, reg).state;
    expect(unit(s.world, 'r').position.x).toBeGreaterThan(11);

    const v = viewFor(s.world, 'blue', s.time);
    expect(v.visibleEnemies).toEqual([]);
    expect(v.lastKnownContacts).toHaveLength(1);
    const c = v.lastKnownContacts[0]!;
    expect(c.id).toBe('r');
    // Last scan that saw it, and the exact age and radius since.
    const lastSeen = c.seenAt;
    expect(lastSeen).toBeGreaterThan(0);
    expect(lastSeen).toBeLessThan(20 * MS_PER_MINUTE);
    expect(lastSeen % MS_PER_MINUTE).toBe(0);
    const n = (s.time - lastSeen) / MS_PER_MINUTE;
    expect(c.ageMs).toBe(n * MS_PER_MINUTE);
    expect(c.uncertaintyTiles).toBe(n);
    // Old position (where it was last seen), never the current one.
    expect(c.position).not.toEqual(unit(s.world, 'r').position);
    expect(c.position.x).toBeLessThanOrEqual(11);
    const json = JSON.stringify(v);
    expect(json).not.toContain('"intent"');
    expect(json).not.toContain(`"x":${unit(s.world, 'r').position.x},`);
  });
});

describe('reports', () => {
  it('arrive only after the courier delay, with an age', () => {
    const reg = registry();
    let s = startVisibility(
      createState(
        1,
        world([
          ['b', 'blue', 5, 5],
          ['r', 'red', 8, 5],
        ]),
        0,
      ),
    );
    s = advanceTo(s, COURIER_DELAY_MS - 1, reg).state;
    expect(viewFor(s.world, 'blue', s.time).reports).toEqual([]);

    s = advanceTo(s, COURIER_DELAY_MS + 3 * MS_PER_MINUTE, reg).state;
    const [r] = viewFor(s.world, 'blue', s.time).reports;
    expect(r).toMatchObject({
      kind: 'contact',
      observedAt: 0,
      deliveredAt: COURIER_DELAY_MS,
      ageMs: COURIER_DELAY_MS + 3 * MS_PER_MINUTE,
      sizeEstimate: 'about a battalion',
    });
    expect(r!.text).toContain('sighted about a battalion');
    expect(JSON.stringify(r)).not.toContain('437');
  });

  it('reports a contact once per side while in sight', () => {
    const reg = registry();
    let s = startVisibility(
      createState(
        1,
        world([
          ['b', 'blue', 5, 5],
          ['r', 'red', 8, 5],
        ]),
        0,
      ),
    );
    s = advanceTo(s, 60 * MS_PER_MINUTE, reg).state;
    const blue = viewFor(s.world, 'blue', s.time).reports;
    expect(blue.filter((r) => r.kind === 'contact')).toHaveLength(1);
    expect(
      viewFor(s.world, 'red', s.time).reports.filter((r) => r.kind === 'contact'),
    ).toHaveLength(1);
  });

  it('reports nothing for an enemy that is never in sight', () => {
    const reg = registry();
    let s = startVisibility(
      createState(
        1,
        world([
          ['b', 'blue', 5, 5],
          ['r', 'red', 20, 15],
        ]),
        0,
      ),
    );
    s = advanceTo(s, 60 * MS_PER_MINUTE, reg).state;
    expect(viewFor(s.world, 'blue', s.time).reports).toEqual([]);
    expect(viewFor(s.world, 'red', s.time).reports).toEqual([]);
  });

  it('files a second contact report when the enemy leaves sight and comes back', () => {
    const reg = registry();
    let s = startVisibility(
      createState(
        1,
        world([
          ['b', 'blue', 5, 5],
          ['r', 'red', 8, 5],
        ]),
        0,
      ),
    );
    s = advanceTo(s, 0, reg).state;
    s = issueMove(s, 'r', { x: 25, y: 5 });
    s = advanceTo(s, 40 * MS_PER_MINUTE, reg).state;
    s = issueMove(s, 'r', { x: 8, y: 5 });
    s = advanceTo(s, 120 * MS_PER_MINUTE, reg).state;
    expect(viewFor(s.world, 'blue', s.time).visibleEnemies).toHaveLength(1);
    const contacts = viewFor(s.world, 'blue', s.time).reports.filter((r) => r.kind === 'contact');
    expect(contacts).toHaveLength(2);
  });

  it('files unit-lost and order-delivered reports for the unit side only', () => {
    const reg = registry();
    let s = createState(
      1,
      world([
        ['b', 'blue', 5, 5],
        ['r', 'red', 20, 15],
      ]),
      0,
    );
    s = schedule(s, [
      { time: 0, type: 'intel.report', payload: { kind: 'unitLost', unitId: 'b' } },
      { time: 0, type: 'intel.report', payload: { kind: 'orderDelivered', unitId: 'r' } },
    ]);
    s = advanceTo(s, COURIER_DELAY_MS, reg).state;
    expect(viewFor(s.world, 'blue', s.time).reports.map((r) => r.kind)).toEqual(['unitLost']);
    expect(viewFor(s.world, 'red', s.time).reports.map((r) => r.kind)).toEqual(['orderDelivered']);
  });
});

describe('intel.report validation', () => {
  it('throws on an unknown report kind or unit', () => {
    const reg = registry();
    const mk = (payload: Record<string, string>) =>
      schedule(
        createState(
          1,
          world([
            ['b', 'blue', 5, 5],
            ['r', 'red', 20, 15],
          ]),
          0,
        ),
        [{ time: 0, type: 'intel.report', payload }],
      );
    expect(() => advanceTo(mk({ kind: 'bogus', unitId: 'b' }), 1, reg)).toThrow(
      /unknown report kind/,
    );
    expect(() => advanceTo(mk({ kind: 'unitLost', unitId: 'nope' }), 1, reg)).toThrow(
      /unknown unit/,
    );
    expect(() => advanceTo(mk({ kind: 'unitLost' }), 1, reg)).toThrow(/unknown unit/);
  });
});

describe('uncertainty', () => {
  it('is capped at the longer side of the map', () => {
    const w = world([
      ['b', 'blue', 5, 5],
      ['r', 'red', 20, 15],
    ]);
    w.intel.blue.contacts.push({
      id: 'r',
      position: { x: 20, y: 15 },
      seenAt: 0,
      sizeEstimate: 'about a battalion',
    });
    const v = viewFor(w, 'blue', 180 * MS_PER_MINUTE);
    expect(v.lastKnownContacts[0]!.ageMs).toBe(180 * MS_PER_MINUTE);
    expect(v.lastKnownContacts[0]!.uncertaintyTiles).toBe(30);
  });
});
