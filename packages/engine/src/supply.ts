import { heldTurn } from './held.js';
import type { EventRegistry } from './events.js';
import { EXHAUSTED_FATIGUE, FATIGUE_RECOVERY_PER_MINUTE, STRAIN_MORALE_DRAIN } from './fatigue.js';
import { canReach } from './contact.js';
import { mm } from './geometry.js';
import { findPath } from './navigation.js';
import { fileReport } from './visibility.js';
import { unitTypeOf } from './unitTypes.js';
import { MS_PER_MINUTE, type GameState, type Point, type Unit, type UnitKind } from './types.js';

export const SUPPLY_TICK_EVENT = 'supply.tick';

/** Game time between supply ticks: rest, wagon arrivals and the slow wear on morale. */
export const SUPPLY_TICK_MS = 10 * MS_PER_MINUTE;

/** Ammunition a unit spends firing for one combat tick, as a percentage of a full load. */
export const AMMO_PER_FIRE_TICK: Record<UnitKind, number> = {
  infantry: 10,
  cavalry: 5,
  artillery: 12,
};

/** Multiplier on the casualties fire causes once the unit has no ammunition left. */
export const OUT_OF_AMMO_FACTOR = 0.1;

/** A unit at or below this much ammunition reports it is running low. */
export const LOW_AMMO = 25;

/** Ammunition (percent of a full load) a wagon train brings a resting unit per supply tick. */
export const RESUPPLY_PER_TICK = 25;

/**
 * How far a wagon can get from a depot, as march cost in metres: roads cost half, so a train
 * serves a unit 12 km away along a road, but only 6 km across open ground.
 */
export const WAGON_REACH_COST_M = 6000;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Where `unit`'s side loads wagons: its depots, or its HQ if the scenario names none. */
export function depotsOf(world: GameState, unit: Unit): Point[] {
  const side = world.sides.find((s) => s.id === unit.side);
  if (!side) return [];
  return side.depots && side.depots.length > 0 ? side.depots : [side.hq];
}

/** True if a wagon from one of the side's depots can reach `unit` where it stands. */
export function wagonsReach(world: GameState, unit: Unit): boolean {
  return depotsOf(world, unit).some((d) => {
    const route = findPath(world.map, d, unit.center);
    return route !== null && route.cost <= mm(WAGON_REACH_COST_M);
  });
}

/** Files the reports `after` has earned by just crossing a line its officers would report. */
export function noteWear(world: GameState, before: Unit, after: Unit, time: number): GameState {
  if (after.status === 'destroyed') return world;
  let w = world;
  if (before.ammo > LOW_AMMO && after.ammo <= LOW_AMMO) w = fileReport(w, 'lowAmmo', after, time);
  if (before.fatigue < EXHAUSTED_FATIGUE && after.fatigue >= EXHAUSTED_FATIGUE) {
    w = fileReport(w, 'exhausted', after, time);
  }
  return w;
}

/** Morale after a tick of strain, which wears it down to a unit's break point but no further. */
function strained(u: Unit): number {
  const floor = Math.min(u.morale, unitTypeOf(u).breakMorale);
  return Math.max(floor, u.morale - STRAIN_MORALE_DRAIN);
}

/**
 * Register the supply handler. Every `SUPPLY_TICK_MS` each active unit that is standing
 * still out of reach of the enemy sheds fatigue and, if a wagon train can reach it from a
 * depot, takes on ammunition. A unit that is exhausted or has no ammunition loses a point of
 * morale, down to its break point (exhaustion alone does not break a unit). Fatigue from
 * marching and fighting, and ammunition spent, are charged where they happen (movement and
 * combat); this tick only restores and wears. `startGame` queues the first tick.
 */
export function registerSupply(registry: EventRegistry<GameState>): void {
  registry.register(SUPPLY_TICK_EVENT, (world, ev) => {
    if (world.outcome) return { world };
    if (heldTurn(world, ev.time)) {
      return { world, schedule: [{ time: ev.time + SUPPLY_TICK_MS, type: SUPPLY_TICK_EVENT }] };
    }
    const active = world.units.filter((u) => u.status === 'active');
    const resting = (u: Unit) =>
      (u.intent.kind === 'idle' || u.intent.kind === 'hold') &&
      !u.leg &&
      !active.some((e) => e.side !== u.side && (canReach(u, e) || canReach(e, u)));
    const units = world.units.map((u) => {
      if (u.status !== 'active') return u;
      let next = u;
      if (resting(u)) {
        next = {
          ...next,
          fatigue: round2(
            Math.max(0, u.fatigue - (FATIGUE_RECOVERY_PER_MINUTE * SUPPLY_TICK_MS) / MS_PER_MINUTE),
          ),
        };
        if (u.ammo < 100 && wagonsReach(world, u)) {
          next = { ...next, ammo: Math.min(100, u.ammo + RESUPPLY_PER_TICK) };
        }
      }
      if (next.fatigue >= EXHAUSTED_FATIGUE || next.ammo <= 0) {
        next = { ...next, morale: round2(strained(next)) };
      }
      return next;
    });
    return {
      world: { ...world, time: ev.time, units },
      schedule: [{ time: ev.time + SUPPLY_TICK_MS, type: SUPPLY_TICK_EVENT }],
    };
  });
}
