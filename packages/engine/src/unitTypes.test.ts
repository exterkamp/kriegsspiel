import { describe, expect, it } from 'vitest';
import {
  EventRegistry,
  FORMATION_RULES,
  MS_PER_MINUTE,
  UNIT_DATA,
  UNIT_TYPES,
  UnitDataError,
  advanceTo,
  createState,
  holdTheBridge,
  issueAttack,
  issueFormation,
  issueMove,
  legDuration,
  loadScenario,
  msPerMetreOf,
  parseUnitData,
  pointMm,
  registerCombat,
  registerMovement,
  ScenarioError,
  startGame,
  unitTypeOf,
  type GameState,
} from './index.js';
import { miniWorld, type RawUnit } from './scenario.testkit.js';

const registry = () => {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerCombat(r);
  return r;
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const unit = (w: GameState, id: string) => w.units.find((u) => u.id === id)!;

describe('unit data loader', () => {
  it('accepts the shipped data and has the four unit types', () => {
    expect(() => parseUnitData(clone(UNIT_DATA))).not.toThrow();
    expect(Object.keys(UNIT_TYPES).sort()).toEqual([
      'artillery',
      'cavalry',
      'line_infantry',
      'skirmishers',
    ]);
    expect(unitTypeOf('infantry').id).toBe('line_infantry');
  });

  it('rejects bad data with a message that says where', () => {
    const bad = (edit: (d: typeof UNIT_DATA) => void, msg: RegExp) => {
      const d = clone(UNIT_DATA);
      edit(d);
      expect(() => parseUnitData(d)).toThrow(UnitDataError);
      expect(() => parseUnitData(d)).toThrow(msg);
    };
    bad((d) => (d.unitTypes[0]!.rangeM = -1), /unitTypes\[0\]\.rangeM/);
    bad((d) => d.unitTypes.push({ ...d.unitTypes[0]! }), /duplicate unit type "line_infantry"/);
    bad((d) => (d.unitTypes[3]!.defaultFormation = 'square'), /not in its formations/);
    bad((d) => ((d.unitTypes[0]!.formations as string[])[0] = 'wedge'), /formations\[0\]/);
    bad((d) => delete (d.formations as Partial<typeof d.formations>).square, /formations\.square/);
    bad((d) => (d.unitTypes[0]!.formationChangeMs = 1.5), /whole number/);
    bad((d) => (d.unitTypes = d.unitTypes.filter((t) => t.kind !== 'cavalry')), /kind "cavalry"/);
    expect(() => parseUnitData(null)).toThrow(UnitDataError);
  });
});

describe('scenario unit types', () => {
  it('the shipped scenario names data-driven types', () => {
    const w = loadScenario(holdTheBridge);
    expect(w.units.map((u) => u.type)).toEqual(w.units.map((u) => unitTypeOf(u).id));
    expect(w.units.every((u) => u.type in UNIT_TYPES)).toBe(true);
  });

  it('takes the kind and starting formation from the type', () => {
    const w = miniWorld({ units: [{ id: 's', type: 'skirmishers', x: 500, y: 500 }] });
    expect(unit(w, 's')).toMatchObject({
      kind: 'infantry',
      type: 'skirmishers',
      formation: 'skirmish',
    });
  });

  it("a bare kind means that arm's default type", () => {
    const w = miniWorld({ units: [{ id: 'c', kind: 'cavalry', x: 500, y: 500 }] });
    expect(unit(w, 'c')).toMatchObject({ type: 'cavalry', formation: 'line' });
  });

  it('rejects an unknown type, a clashing kind and a formation the type lacks', () => {
    expect(() => miniWorld({ units: [{ id: 'x', type: 'dragoons', x: 500, y: 500 }] })).toThrow(
      /not a known unit type/,
    );
    expect(() => loadWith({ type: 'cavalry', kind: 'infantry' })).toThrow(ScenarioError);
    expect(() =>
      miniWorld({ units: [{ id: 'g', kind: 'artillery', formation: 'square', x: 500, y: 500 }] }),
    ).toThrow(/not available to Artillery/);
  });
});

function loadWith(u: Record<string, unknown>) {
  const w = holdTheBridge as unknown as { units: Array<Record<string, unknown>> };
  return loadScenario({ ...holdTheBridge, units: [{ ...w.units[0], ...u }, ...w.units.slice(1)] });
}

describe('type and formation effects', () => {
  it('stats differ by type', () => {
    const pace = (id: string) => UNIT_TYPES[id]!.marchMetresPerMinute;
    expect(pace('cavalry')).toBeGreaterThan(pace('skirmishers'));
    expect(pace('skirmishers')).toBeGreaterThan(pace('line_infantry'));
    expect(pace('line_infantry')).toBeGreaterThan(pace('artillery'));
    expect(UNIT_TYPES.skirmishers!.breakMorale).toBeGreaterThan(
      UNIT_TYPES.line_infantry!.breakMorale,
    );
    expect(msPerMetreOf('infantry')).toBe(MS_PER_MINUTE / 100);
  });

  it('formation sets march pace', () => {
    const w = miniWorld({
      units: [
        { id: 'l', x: 500, y: 500, formation: 'line' },
        { id: 'c', x: 800, y: 500, formation: 'column' },
        { id: 'q', x: 1100, y: 500, formation: 'square' },
      ],
    });
    const a = pointMm(500, 1500);
    const b = pointMm(600, 1500);
    const d = (id: string) => legDuration(w.map, a, b, unit(w, id))!;
    expect(d('l')).toBe(MS_PER_MINUTE);
    expect(d('c')).toBeLessThan(d('l'));
    expect(d('q')).toBeGreaterThan(d('l'));
    expect(d('c')).toBe(Math.round(MS_PER_MINUTE / FORMATION_RULES.column.moveFactor));
  });

  it('formation sets the footprint: a column is narrower and deeper than a line', () => {
    const w = miniWorld({
      units: [
        { id: 'l', x: 500, y: 500, formation: 'line' },
        { id: 'c', x: 900, y: 500, formation: 'column' },
      ],
    });
    expect(unit(w, 'c').footprint.frontage).toBeLessThan(unit(w, 'l').footprint.frontage);
    expect(unit(w, 'c').footprint.depth).toBeGreaterThan(unit(w, 'l').footprint.depth);
  });

  it("changing formation takes the type's time, which differs by type", () => {
    const w = miniWorld({
      units: [
        { id: 'inf', x: 500, y: 500 },
        { id: 'cav', kind: 'cavalry', x: 900, y: 500 },
        { id: 'gun', kind: 'artillery', x: 1300, y: 500 },
      ],
    });
    for (const [id, ms] of [
      ['inf', unitTypeOf('infantry').formationChangeMs],
      ['cav', unitTypeOf('cavalry').formationChangeMs],
      ['gun', unitTypeOf('artillery').formationChangeMs],
    ] as const) {
      let s = createState(1, w, 0);
      s = issueFormation(s, id, 'column');
      const early = advanceTo(s, ms - 1, registry()).state;
      expect(unit(early.world, id).formation).toBe('line');
      expect(unit(early.world, id).intent.kind).toBe('reform');
      const done = advanceTo(early, ms, registry()).state;
      expect(unit(done.world, id).formation).toBe('column');
    }
    expect(unitTypeOf('artillery').formationChangeMs).toBeGreaterThan(
      unitTypeOf('cavalry').formationChangeMs,
    );
  });

  it('rejects a formation the type cannot take', () => {
    const w = miniWorld({ units: [{ id: 'gun', kind: 'artillery', x: 500, y: 500 }] });
    const r = advanceTo(issueFormation(createState(1, w, 0), 'gun', 'square'), 0, registry());
    expect(r.state.world.units.find((u) => u.id === 'gun')!.formation).toBe('line');
    expect(r.emitted).toContainEqual(
      expect.objectContaining({
        type: 'order.rejected',
        payload: { unitId: 'gun', reason: 'Artillery cannot form square' },
      }),
    );
  });

  it("a unit that has re-formed marches at the new formation's pace", () => {
    const w = miniWorld({ units: [{ id: 'u', x: 500, y: 500 }] });
    const total = (formation: 'line' | 'column') => {
      let s = createState(1, w, 0);
      if (formation === 'column')
        s = advanceTo(issueFormation(s, 'u', 'column'), 2 * MS_PER_MINUTE, registry()).state;
      const t0 = s.time;
      s = issueMove(s, 'u', pointMm(500, 1500), t0);
      let t = t0;
      while (unit(s.world, 'u').center.y !== 1_500_000 && t < t0 + 60 * MS_PER_MINUTE) {
        t += 1000;
        s = advanceTo(s, t, registry()).state;
      }
      return t - t0;
    };
    expect(total('column')).toBeLessThan(total('line'));
  });

  describe('in combat', () => {
    /** Red fires on blue from 100 m; same seed, so the same dice. Returns blue's strength after one tick. */
    const blueLeft = (blue: Partial<RawUnit>, red: Partial<RawUnit>) => {
      const w = miniWorld({
        units: [
          { id: 'blue-1', x: 1000, y: 1000, ...blue },
          { id: 'red-1', side: 'red', x: 1000, y: 1100, facingDeg: 0, ...red },
        ],
      });
      let s = startGame(createState(5, w, 0));
      s = issueAttack(s, 'red-1', 'blue-1');
      s = advanceTo(s, 2 * MS_PER_MINUTE, registry()).state;
      return unit(s.world, 'blue-1').strength;
    };

    it('a column shooter does less harm than a line', () => {
      expect(blueLeft({}, { formation: 'column' })).toBeGreaterThan(
        blueLeft({}, { formation: 'line' }),
      );
    });

    it('a column target takes more fire than a line, a skirmish screen less', () => {
      const line = blueLeft({ formation: 'line' }, {});
      expect(blueLeft({ formation: 'column' }, {})).toBeLessThan(line);
      expect(blueLeft({ type: 'skirmishers', formation: 'skirmish' }, {})).toBeGreaterThan(line);
    });

    it('a square shrugs off cavalry but not as much fire', () => {
      const cav = { kind: 'cavalry' as const };
      const line = blueLeft({ formation: 'line' }, cav);
      const square = blueLeft({ formation: 'square' }, cav);
      expect(square).toBeGreaterThan(line);
    });
  });
});
