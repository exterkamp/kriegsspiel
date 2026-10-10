import { describe, expect, it } from 'vitest';
import { holdTheBridge, loadScenario, MS_PER_MINUTE, ScenarioError, tileAt } from './index.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- tests mutate raw scenario data freely */
function clone(): any {
  return JSON.parse(JSON.stringify(holdTheBridge));
}

describe('Hold the Bridge scenario', () => {
  it('loads into a GameState', () => {
    const s = loadScenario(holdTheBridge);
    expect(s.time).toBe(0);
    expect(s.map.width).toBe(40);
    expect(s.map.height).toBe(30);
    expect(s.units.filter((u) => u.side === 'blue')).toHaveLength(3);
    expect(s.units.filter((u) => u.side === 'red')).toHaveLength(3);
    expect(s.victory.holdMs).toBe(180 * MS_PER_MINUTE);
    expect(tileAt(s.map, s.victory.objective)).toBe('bridge');
    const terrains = new Set(s.map.tiles);
    for (const t of ['open', 'wood', 'river', 'bridge', 'road']) expect(terrains).toContain(t);
  });

  it('round-trips through JSON', () => {
    const s = loadScenario(holdTheBridge);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('is loaded identically every time', () => {
    expect(loadScenario(holdTheBridge)).toEqual(loadScenario(clone()));
  });
});

describe('loader validation', () => {
  const bad = (mutate: (d: any) => void, message: RegExp) => {
    const d = clone();
    mutate(d);
    expect(() => loadScenario(d)).toThrow(ScenarioError);
    expect(() => loadScenario(d)).toThrow(message);
  };

  it('rejects a side HQ in the river', () => {
    bad((d) => (d.sides[0].hq = { x: 0, y: 14 }), /hq must be on passable ground/);
  });

  it('rejects a side without an HQ', () => {
    bad((d) => delete d.sides[0].hq, /sides\[0\]\.hq/);
  });

  it('rejects non-objects', () => {
    expect(() => loadScenario(null)).toThrow(ScenarioError);
    expect(() => loadScenario('x')).toThrow(/scenario must be an object/);
  });
  it('rejects ragged map rows', () => bad((d) => (d.map.rows[3] += '.'), /rows\[3\] has width 41/));
  it('rejects unknown tile characters', () =>
    bad((d) => (d.map.rows[0] = 'Z' + d.map.rows[0].slice(1)), /unknown tile "Z"/));
  it('rejects unknown terrain in legend', () => bad((d) => (d.map.legend['.'] = 'lava'), /legend/));
  it('rejects an empty map', () => bad((d) => (d.map.rows = []), /must not be empty/));
  it('rejects duplicate unit ids', () =>
    bad((d) => (d.units[1].id = d.units[0].id), /duplicate unit id/));
  it('rejects units off the map', () => bad((d) => (d.units[0].x = 99), /off the map/));
  it('rejects units in the river', () =>
    bad((d) => ((d.units[0].y = 14), (d.units[0].x = 5)), /in the river/));
  it('rejects stacked units', () =>
    bad((d) => ((d.units[1].x = d.units[0].x), (d.units[1].y = d.units[0].y)), /shares tile/));
  it('rejects bad morale', () => bad((d) => (d.units[0].morale = 101), /morale must be between/));
  it('rejects non-integer strength', () =>
    bad((d) => (d.units[0].strength = 1.5), /strength must be an integer/));
  it('rejects unknown facing', () =>
    bad((d) => (d.units[0].facing = 'UP'), /facing must be one of/));
  it('rejects unknown side on a unit', () =>
    bad((d) => (d.units[0].side = 'green'), /side must be one of/));
  it('rejects a side with no units', () =>
    bad((d) => d.units.forEach((u: any) => (u.side = 'blue')), /side "red" has no units/));
  it('rejects wrong number of sides', () => bad((d) => d.sides.pop(), /exactly two sides/));
  it('rejects an objective that is not a bridge', () =>
    bad((d) => (d.victory.objective = { x: 0, y: 0 }), /must be on a bridge tile/));
  it('rejects defender equal to attacker', () =>
    bad((d) => (d.victory.attacker = 'blue'), /must differ/));
  it('rejects a non-positive hold time', () =>
    bad((d) => (d.victory.holdMinutes = 0), /holdMinutes/));
  it('rejects a missing seed', () => bad((d) => delete d.seed, /seed must be an integer/));
});
