import { describe, expect, it } from 'vitest';
import {
  COURIER_DELAY_MS,
  EventRegistry,
  MS_PER_MINUTE,
  advanceTo,
  canSee,
  createState,
  issueMove,
  registerCombat,
  registerMovement,
  registerVisibility,
  schedule,
  startVisibility,
  viewFor,
  type GameState,
  type Unit,
} from './index.js';
import { miniWorld, wood as woodAt } from './scenario.testkit.js';

/** Tile-style (x, y) in hundreds of metres to the centre of that 100 m square, in metres. */
const at = (n: number) => n * 100 + 50;

function world(
  units: Array<[string, 'blue' | 'red', number, number, number?]>,
  wood: Array<[number, number]> = [],
): GameState {
  return miniWorld({
    features: wood.map(([x, y]) =>
      woodAt(`wood-${x}-${y}`, x * 100, y * 100, x * 100 + 100, y * 100 + 100),
    ),
    units: units.map(([id, side, x, y, strength]) => ({
      id,
      side,
      x: at(x),
      y: at(y),
      ...(strength === undefined ? {} : { strength }),
    })),
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

describe('canSee over free geometry', () => {
  const slant = (id: string) => ({
    id,
    kind: 'wood',
    polygon: [
      [900, 600],
      [1100, 400],
      [1150, 700],
    ],
  });

  it('is blocked by a wood of any shape and angle, and clear when the line passes beside it', () => {
    const base = [
      { id: 'b', x: 700, y: 550 },
      { id: 'r', side: 'red' as const, x: 1200, y: 550 },
    ];
    const blocked = miniWorld({ features: [slant('w')], units: base });
    expect(canSee(blocked, unit(blocked, 'b'), unit(blocked, 'r'))).toBe(false);
    const clear = miniWorld({
      features: [slant('w')],
      units: [base[0]!, { ...base[1]!, y: 1000, x: 850 }],
    });
    expect(canSee(clear, unit(clear, 'b'), unit(clear, 'r'))).toBe(true);
  });

  it('is not snapped to a grid: a few metres of offset makes the difference', () => {
    const wood = {
      id: 'w',
      kind: 'wood',
      polygon: [
        [700, 400],
        [760, 400],
        [760, 480],
        [700, 480],
      ],
    };
    const see = (ry: number) => {
      const w = miniWorld({
        features: [wood],
        units: [
          { id: 'b', x: 400, y: 450 },
          { id: 'r', side: 'red', x: 900, y: ry },
        ],
      });
      return canSee(w, unit(w, 'b'), unit(w, 'r'));
    };
    expect(see(450)).toBe(false);
    expect(see(480)).toBe(false); // at x=760 the line is at y=462: still inside the wood
    expect(see(520)).toBe(true); // at x=760 the line is at y=484: just clear
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
    expect(v.ownUnits[0]).toMatchObject({
      id: 'b',
      strength: 500,
      morale: 71,
      position: { x: 550, y: 550 },
      facing: 0,
      formation: 'line',
    });
    expect(v.ownUnits[0]!.footprint.frontage).toBeCloseTo(Math.sqrt(500 * 1.2 * 12), 2);
    expect(v.visibleEnemies).toEqual([
      {
        id: 'r',
        position: { x: 850, y: 550 },
        facing: 0,
        formation: 'line',
        footprint: { frontage: 80, depth: 10 },
        sizeEstimate: 'about a battalion',
      },
    ]);
    expect(v.mapWidth).toBe(3000);
    expect(v.mapHeight).toBe(2000);
  });

  it('reports positions in metres, to the millimetre, not mm', () => {
    const w = world([
      ['b', 'blue', 5, 5],
      ['r', 'red', 8, 5],
    ]);
    unit(w, 'r').center = { x: 851_234, y: 549_001 };
    expect(viewFor(w, 'blue').visibleEnemies[0]!.position).toEqual({ x: 851.234, y: 549.001 });
  });

  it('shows an enemy footprint only to the nearest 10 m, so strength cannot be backed out', () => {
    const w = world([
      ['b', 'blue', 5, 5],
      ['r', 'red', 8, 5, 437],
    ]);
    const near = viewFor(w, 'blue').visibleEnemies[0]!.footprint;
    unit(w, 'r').strength = 441;
    unit(w, 'r').footprint = { frontage: 76_000, depth: 6_000 };
    const same = viewFor(w, 'blue').visibleEnemies[0]!.footprint;
    expect(same).toEqual(near);
    expect(near.frontage % 10).toBe(0);
    expect(near.depth % 10).toBe(0);
    expect(near.depth).toBeGreaterThan(0);
  });

  it('shows an enemy in a loose formation by its sub-positions', () => {
    const w = world([
      ['b', 'blue', 5, 5],
      ['r', 'red', 8, 5],
    ]);
    const r = unit(w, 'r');
    r.formation = 'loose';
    r.shape = [
      { x: -50_000, y: 0 },
      { x: 0, y: 12_345 },
      { x: 50_000, y: 0 },
    ];
    expect(viewFor(w, 'blue').visibleEnemies[0]).toMatchObject({
      formation: 'loose',
      shape: [
        { x: -50, y: 0 },
        { x: 0, y: 12.345 },
        { x: 50, y: 0 },
      ],
    });
  });

  it('leaks nothing about unseen enemies', () => {
    const w = world([
      ['b', 'blue', 2, 2],
      ['r-secret', 'red', 25, 15, 463],
    ]);
    w.units.find((u) => u.id === 'r-secret')!.intent = {
      kind: 'hold',
      at: { x: 2_400_000, y: 1_400_000 },
    };
    const json = JSON.stringify(viewFor(w, 'blue'));
    for (const hidden of ['r-secret', '463', '"hold"', 'Unit r-secret', '2550', '1550']) {
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
    w.units.find((u) => u.id === 'r')!.intent = { kind: 'hold', at: { x: 850_000, y: 550_000 } };
    const json = JSON.stringify(viewFor(w, 'blue'));
    for (const s of ['463', 'intent', 'hold', 'Unit r', 'Unit r"']) {
      expect(json).not.toContain(s);
    }
    expect(json.match(/"morale"/g)).toHaveLength(1); // own unit only
    const enemy = viewFor(w, 'blue').visibleEnemies[0]!;
    expect(Object.keys(enemy).sort()).toEqual([
      'facing',
      'footprint',
      'formation',
      'id',
      'position',
      'sizeEstimate',
    ]);
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

    s = issueMove(s, 'r', { x: 2_550_000, y: 550_000 });
    s = advanceTo(s, 20 * MS_PER_MINUTE, reg).state;
    expect(unit(s.world, 'r').center.x).toBeGreaterThan(1_150_000);

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
    expect(c.uncertaintyRadius).toBe(n * 100);
    // Old position (where it was last seen, in metres), never the current one.
    expect(c.position).not.toEqual({ x: unit(s.world, 'r').center.x / 1000, y: 550 });
    expect(c.position.x).toBeLessThanOrEqual(1150);
    const json = JSON.stringify(v);
    expect(json).not.toContain('"intent"');
    expect(json).not.toContain(`"x":${unit(s.world, 'r').center.x / 1000},`);
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
    s = issueMove(s, 'r', { x: 2_550_000, y: 550_000 });
    s = advanceTo(s, 40 * MS_PER_MINUTE, reg).state;
    s = issueMove(s, 'r', { x: 850_000, y: 550_000 });
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
  it('grows 100 m a minute and is capped at the longer side of the map', () => {
    const w = world([
      ['b', 'blue', 5, 5],
      ['r', 'red', 20, 15],
    ]);
    w.intel.blue.contacts.push({
      id: 'r',
      position: { x: 2_050_000, y: 1_550_000 },
      seenAt: 0,
      sizeEstimate: 'about a battalion',
    });
    const young = viewFor(w, 'blue', 7 * MS_PER_MINUTE);
    expect(young.lastKnownContacts[0]!.uncertaintyRadius).toBe(700);
    const v = viewFor(w, 'blue', 180 * MS_PER_MINUTE);
    expect(v.lastKnownContacts[0]!.ageMs).toBe(180 * MS_PER_MINUTE);
    expect(v.lastKnownContacts[0]!.uncertaintyRadius).toBe(3000);
    expect(v.lastKnownContacts[0]!.position).toEqual({ x: 2050, y: 1550 });
  });
});
