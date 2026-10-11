import { canSee, coarseMetres, viewFor } from './visibility.js';
import type { EngineSideView, ViewEnemy, ViewReport, ViewUnit } from './visibility.js';
import type { GameState, GameTime, SideId } from './types.js';

/** The jobs on a side's staff (docs/gameplay.md, "Multiplayer collaborative mode"). */
export const ROLES = [
  'commander',
  'chiefOfStaff',
  'intelligence',
  'quartermaster',
  'subordinate',
] as const;
export type Role = (typeof ROLES)[number];

/**
 * One seat at a side's table. A subordinate (wing or division) commander also names the unit
 * ids of the formations they command; the other roles serve the whole side and name none.
 */
export interface Seat {
  role: Role;
  units?: string[];
}

/**
 * Where a unit is and what formation it is in, without its condition. The footprint is coarse
 * (nearest 10 m, as an enemy's is) and the loose `shape` is left out, since both follow from
 * strength and would give it away.
 */
export type ViewUnitOutline = Pick<
  ViewUnit,
  'id' | 'name' | 'kind' | 'position' | 'facing' | 'formation' | 'footprint'
>;

/** What one role may see: the side view cut down. Never has anything the side view lacks. */
export interface EngineRoleView extends Omit<EngineSideView, 'ownUnits'> {
  role: Role;
  ownUnits: Array<ViewUnit | ViewUnitOutline>;
}

/** The units of `side` a subordinate's seat really commands. Others named in it are ignored. */
function commanded(world: GameState, side: SideId, seat: Seat): Set<string> {
  const mine = new Set(world.units.filter((u) => u.side === side).map((u) => u.id));
  return new Set((seat.units ?? []).filter((id) => mine.has(id)));
}

const outline = (u: ViewUnit): ViewUnitOutline => ({
  id: u.id,
  name: u.name,
  kind: u.kind,
  position: u.position,
  facing: u.facing,
  formation: u.formation,
  footprint: {
    frontage: coarseMetres(u.footprint.frontage),
    depth: coarseMetres(u.footprint.depth),
  },
});

const SUPPLY_REPORTS: Array<ViewReport['kind']> = ['lowAmmo', 'exhausted'];

/**
 * What `seat` on `side` may see. Pure. Every role gets a subset of `viewFor`, never more:
 * - commander and chief of staff: the whole HQ picture, which is the side view;
 * - intelligence: all enemy information (sightings, contacts, contact reports, captured
 *   dispatches), and where our units stand, but not their strength, morale, fatigue or ammunition;
 * - quartermaster: our units in full and the supply reports, but nothing about the enemy;
 * - subordinate: only their own units, the enemy those units can see themselves, and the
 *   reports their own units filed. What HQ forwards to them is not built yet.
 */
export function viewForRole(
  world: GameState,
  side: SideId,
  seat: Seat,
  now: GameTime = world.time,
): EngineRoleView {
  const full = viewFor(world, side, now);
  const { role } = seat;
  switch (role) {
    case 'commander':
    case 'chiefOfStaff':
      return { ...full, role };
    case 'intelligence':
      return {
        ...full,
        role,
        ownUnits: full.ownUnits.map(outline),
        reports: full.reports.filter((r) => r.kind === 'contact'),
      };
    case 'quartermaster':
      return {
        ...full,
        role,
        visibleEnemies: [],
        lastKnownContacts: [],
        documents: [],
        reports: full.reports.filter((r) => SUPPLY_REPORTS.includes(r.kind)),
      };
    case 'subordinate': {
      const ids = commanded(world, side, seat);
      const state = { ...world, time: now };
      const watchers = state.units.filter((u) => ids.has(u.id) && u.strength > 0);
      const seenIds = new Set(
        state.units
          .filter(
            (u) => u.side !== side && u.strength > 0 && watchers.some((w) => canSee(state, w, u)),
          )
          .map((u) => u.id),
      );
      const names = new Set(state.units.filter((u) => ids.has(u.id)).map((u) => u.name));
      return {
        ...full,
        role,
        ownUnits: full.ownUnits.filter((u) => ids.has(u.id)),
        visibleEnemies: full.visibleEnemies.filter((e: ViewEnemy) => seenIds.has(e.id)),
        lastKnownContacts: [],
        documents: [],
        reports: full.reports.filter((r) => names.has(r.from)),
      };
    }
  }
}

/**
 * Whether `seat` may sign (stamp and send) an order to `unitId`. The commander signs for any
 * unit of the side, a subordinate only for the formations they command, and the staff roles
 * never: they draft, and the commander signs.
 */
export function maySign(world: GameState, side: SideId, seat: Seat, unitId: string): boolean {
  const unit = world.units.find((u) => u.id === unitId);
  if (!unit || unit.side !== side || unit.strength <= 0) return false;
  if (seat.role === 'commander') return true;
  if (seat.role === 'subordinate') return commanded(world, side, seat).has(unitId);
  return false;
}

/**
 * Whether `seat` may put text into the shared draft of an order to `unitId`. Anyone on the
 * staff may draft for any living unit of the side; a subordinate only for their own formations.
 */
export function mayDraft(world: GameState, side: SideId, seat: Seat, unitId: string): boolean {
  const unit = world.units.find((u) => u.id === unitId);
  if (!unit || unit.side !== side || unit.strength <= 0) return false;
  if (seat.role === 'subordinate') return commanded(world, side, seat).has(unitId);
  return true;
}
