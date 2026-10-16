import type { WindowAt, WindowTurn } from '@kriegsspiel/protocol';
import { describe, expect, it } from 'vitest';
import { fixtureMap } from '../table/fixture.js';
import {
  buildWindowScene,
  decidedBy,
  lossesText,
  stepMark,
  stepTurn,
  turnAt,
  unitChange,
  unitNotes,
} from './model.js';

const fp = { frontage: 100, depth: 50 };
const frame: WindowAt = {
  gameMs: 3_600_000,
  units: [
    {
      id: 'b1',
      side: 'blue',
      name: 'Blue 1',
      position: { x: 10, y: 10 },
      facing: 0,
      formation: 'line',
      footprint: fp,
      strength: 400,
      morale: 80,
      ammo: 90,
    },
    {
      id: 'r1',
      side: 'red',
      name: 'Red 1',
      position: { x: 90, y: 90 },
      facing: 3,
      formation: 'column',
      footprint: fp,
      strength: 300,
      morale: 70,
      ammo: 50,
    },
    {
      id: 'r2',
      side: 'red',
      name: 'Red dead',
      position: { x: 50, y: 50 },
      facing: 3,
      formation: 'column',
      footprint: fp,
      strength: 0,
      morale: 0,
      ammo: 0,
    },
  ],
  beliefs: {
    blue: {
      visibleEnemies: [],
      lastKnownContacts: [
        {
          id: 'r1',
          position: { x: 80, y: 80 },
          observedAtGame: 0,
          ageMs: 3_600_000,
          uncertaintyRadius: 500,
        },
      ],
    },
    red: { visibleEnemies: [], lastKnownContacts: [] },
  },
  events: [
    {
      time: 3_500_000,
      type: 'combat.fire',
      payload: {
        attacker: 'r1',
        target: 'b1',
        distance: 0.4,
        cover: 'wood',
        aspect: 'flank',
        melee: false,
        die: 5,
        casualties: 12.4,
        targetStrength: 400,
        targetMorale: 80,
      },
    },
    {
      time: 100,
      type: 'combat.fire',
      payload: {
        attacker: 'r1',
        target: 'b1',
        distance: 0.4,
        cover: null,
        aspect: null,
        melee: false,
        die: 2,
        casualties: 1,
        targetStrength: 1,
        targetMorale: 1,
      },
    },
  ],
  rulings: [
    {
      id: 'k1',
      time: 3_000_000,
      unitId: 'b1',
      rationale: 'road is narrow',
      narrative: 'strung out',
    },
  ],
};

describe("umpire's window model", () => {
  it('shows every living unit at its true place, whatever either side believed', () => {
    const scene = buildWindowScene(frame, 'none', fixtureMap);
    expect(scene.own.map((p) => [p.id, p.side])).toEqual([
      ['b1', 'blue'],
      ['r1', 'red'],
    ]);
    expect(scene.ghosts).toEqual([]);
  });

  it("overlays one side's belief as ghosts with their uncertainty", () => {
    const scene = buildWindowScene(frame, 'blue', fixtureMap);
    expect(scene.ghosts).toHaveLength(1);
    expect(scene.ghosts[0]).toMatchObject({
      id: 'r1',
      position: { x: 80, y: 80 },
      uncertaintyRadius: 500,
    });
    // The belief differs from the truth, which is still drawn.
    expect(scene.own.find((p) => p.id === 'r1')!.position).toEqual({ x: 90, y: 90 });
  });

  it('explains recent dice, modifiers and rulings for a unit', () => {
    const notes = unitNotes(frame, 'b1');
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain('Die 5');
    expect(notes[0]).toContain('cover wood');
    expect(notes[0]).toContain('flank aspect');
    expect(notes[1]).toContain('strung out');
    expect(unitNotes(frame, 'r2')).toEqual([]);
  });

  it('steps between marks', () => {
    const marks = [10, 20, 30].map((ms) => ({ ms, kind: 'event' as const, label: 'x' }));
    expect(stepMark(marks, 20, 1)).toBe(2);
    expect(stepMark(marks, 20, -1)).toBe(0);
    expect(stepMark(marks, 30, 1)).toBe(-1);
    expect(stepMark(marks, 10, -1)).toBe(-1);
  });
});

describe("the window's turns (D39, 11.11)", () => {
  const turn = (n: number, extra: Partial<WindowTurn> = {}): WindowTurn => ({
    n,
    startMs: (n - 1) * 600_000,
    endMs: n * 600_000,
    adjudicator: 'umpire',
    fellBack: false,
    losses: { blue: 0, red: 0 },
    units: [],
    corrections: 0,
    rolls: [],
    ...extra,
  });
  const turns = [turn(1), turn(2, { adjudicator: 'engine', fellBack: true }), turn(3)];

  it('shows the turn under way, or the one that ended at the time shown', () => {
    expect(turnAt(turns, 0)!.n).toBe(1);
    expect(turnAt(turns, 300_000)!.n).toBe(1);
    expect(turnAt(turns, 600_000)!.n).toBe(1);
    expect(turnAt(turns, 600_001)!.n).toBe(2);
    expect(turnAt(turns, 1_800_000)!.n).toBe(3);
    expect(turnAt(turns, 1_800_001)).toBeUndefined();
    expect(turnAt([], 0)).toBeUndefined();
  });

  it('says who decided a turn and what it cost', () => {
    expect(decidedBy(turns[0]!)).toBe('Decided by the umpire.');
    expect(decidedBy(turns[1]!)).toMatch(/^Decided by the tables: the umpire could not/);
    expect(decidedBy(turn(4, { adjudicator: 'engine' }))).toBe('Decided by the tables.');
    expect(lossesText(turn(1, { losses: { blue: 40, red: 0 } }))).toBe(
      'Blue lost 40 men, Red none.',
    );
  });

  it('says what a turn did to a unit', () => {
    const u = {
      id: 'r1',
      side: 'red' as const,
      name: 'Vanguard',
      lost: 172,
      from: 'active',
      to: 'withdrawn',
    };
    expect(unitChange(u)).toBe('lost 172 men, active → withdrawn');
    expect(unitChange({ ...u, lost: 0 })).toBe('active → withdrawn');
    expect(unitChange({ ...u, to: 'active' })).toBe('lost 172 men');
  });

  it('steps between turn marks only', () => {
    const marks = [
      { ms: 0, kind: 'turn' as const, label: 'turn 1 begins' },
      { ms: 300_000, kind: 'event' as const, label: 'x' },
      { ms: 600_000, kind: 'turn' as const, label: 'turn 1 decided' },
    ];
    expect(stepTurn(marks, 0, 1)).toBe(2);
    expect(stepTurn(marks, 600_000, 1)).toBe(-1);
    expect(stepTurn(marks, 600_000, -1)).toBe(0);
  });
});
