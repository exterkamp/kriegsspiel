import { describe, expect, it } from 'vitest';
import { ADJUST_RANGE_M, DISCRETIONS, HOLD_RANGE_M, deputyProblems } from './deputy.js';
import type { OrderIntent } from './orders.js';
import type { Seat } from './roles.js';
import { miniWorld } from './scenario.testkit.js';

const world = miniWorld({
  units: [
    { id: 'b1', side: 'blue', x: 500, y: 500 },
    { id: 'b2', side: 'blue', x: 1500, y: 500 },
    { id: 'r1', side: 'red', x: 2500, y: 500 },
  ],
});
const b1 = world.units.find((u) => u.id === 'b1')!;
const commander: Seat = { role: 'commander' };
const near = (m: number) => ({ x: b1.center.x + m, y: b1.center.y });
const check = (
  d: (typeof DISCRETIONS)[number],
  intents: OrderIntent[],
  seat = commander,
  id = 'b1',
) => deputyProblems(world, 'blue', seat, d, id, intents);

describe('deputy discretion', () => {
  it('hold: refuses a move, allows a withdrawal and holding where it stands', () => {
    expect(check('hold', [{ kind: 'move', to: near(100) }])).toHaveLength(1);
    expect(check('hold', [{ kind: 'withdraw', toward: near(-5000) }])).toEqual([]);
    expect(check('hold', [{ kind: 'hold', at: near(HOLD_RANGE_M - 10) }])).toEqual([]);
    expect(check('hold', [{ kind: 'hold', at: near(HOLD_RANGE_M + 100) }])).toHaveLength(1);
  });

  it('adjust: moves a short way at the ordinary pace, not further or forced', () => {
    expect(check('adjust', [{ kind: 'move', to: near(ADJUST_RANGE_M - 50) }])).toEqual([]);
    expect(check('adjust', [{ kind: 'move', to: near(ADJUST_RANGE_M + 500) }])).toHaveLength(1);
    expect(check('adjust', [{ kind: 'move', to: near(500), pace: 'forced' }])).toHaveLength(1);
  });

  it('act: anything the player could sign', () => {
    expect(check('act', [{ kind: 'move', to: near(9000), pace: 'forced' }])).toEqual([]);
  });

  it('judges what a conditional order would do, since it fires with no one watching', () => {
    const trigger = { kind: 'timeReached', gameTime: 60_000 } as never;
    const far: OrderIntent = { kind: 'move', to: near(9000) };
    expect(check('adjust', [{ kind: 'at', gameTime: 60_000, then: [far] }])).toHaveLength(1);
    expect(check('adjust', [{ kind: 'when', trigger, then: [far] }])).toHaveLength(1);
    expect(check('act', [{ kind: 'at', gameTime: 60_000, then: [far] }])).toEqual([]);
  });

  it('never exceeds the player: a subordinate deputy cannot order a formation they do not command', () => {
    const sub: Seat = { role: 'subordinate', units: ['b2'] };
    const stay: OrderIntent[] = [{ kind: 'hold', at: b1.center }];
    expect(check('act', stay, sub, 'b1')[0]).toMatch(/could not sign/);
    expect(check('act', [{ kind: 'hold', at: world.units[1]!.center }], sub, 'b2')).toEqual([]);
  });

  it('refuses the enemy, the missing and the dead', () => {
    expect(check('act', [], commander, 'r1')[0]).toMatch(/not a living formation/);
    expect(check('act', [], commander, 'nobody')[0]).toMatch(/not a living formation/);
    const dead = {
      ...world,
      units: world.units.map((u) => (u.id === 'b1' ? { ...u, strength: 0 } : u)),
    };
    expect(deputyProblems(dead, 'blue', commander, 'act', 'b1', [])[0]).toMatch(/not a living/);
  });

  it('is monotone: whatever hold allows, adjust and act allow', () => {
    const intents: OrderIntent[][] = [
      [{ kind: 'withdraw', toward: near(-3000) }],
      [{ kind: 'hold', at: near(50) }],
    ];
    for (const i of intents) {
      expect(check('hold', i)).toEqual([]);
      expect(check('adjust', i)).toEqual([]);
      expect(check('act', i)).toEqual([]);
    }
  });
});
