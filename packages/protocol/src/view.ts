import { z } from 'zod';
import { ClockState, Coord, Facing, Footprint, Formation, GameMs, Side, UnitId } from './common.js';

/** Structured facts beside the prose, so the UI can place pins (see docs/hq-interface.md). */
export const Dispatch = z
  .object({
    id: z.string().min(1),
    from: z.string().min(1),
    writtenAtGame: GameMs,
    receivedAtGame: GameMs,
    category: z.enum(['urgent', 'scouts', 'subordinates', 'staff', 'intelligence', 'rumour']),
    location: Coord.optional(),
    unit: z.string().optional(),
    sizeEstimate: z.string().optional(),
    confidence: z.enum(['low', 'medium', 'high']).optional(),
    text: z.string(),
  })
  .strict();
export type Dispatch = z.infer<typeof Dispatch>;

/**
 * Offsets in metres from a unit's `position` in its own frame (x to its right, y to its front):
 * the sub-positions of a loose formation, such as a skirmish line along a treeline.
 */
export const Shape = z.array(Coord).min(1);

export const OwnUnit = z
  .object({
    id: UnitId,
    name: z.string(),
    /** Centre of the footprint, in metres. */
    position: Coord,
    facing: Facing,
    formation: Formation,
    footprint: Footprint,
    shape: Shape.optional(),
    strength: z.number().nonnegative(),
    morale: z.number().min(0).max(1),
    supply: z.number().min(0).max(1),
  })
  .strict();
export type OwnUnit = z.infer<typeof OwnUnit>;

/** An enemy in sight. Its footprint is what a watcher can judge, so the engine rounds it to 10 m. */
export const VisibleEnemyUnit = z
  .object({
    id: UnitId,
    position: Coord,
    facing: Facing,
    formation: Formation,
    footprint: Footprint,
    shape: Shape.optional(),
    sizeEstimate: z.string().optional(),
  })
  .strict();
export type VisibleEnemyUnit = z.infer<typeof VisibleEnemyUnit>;

/**
 * A stale sighting. `ageMs` is game time since it was observed. `position` is where the enemy
 * was seen; it may now be anywhere within `uncertaintyRadius` metres of it, a radius that
 * grows with age.
 */
export const LastKnownContact = z
  .object({
    id: z.string().min(1),
    position: Coord,
    observedAtGame: GameMs,
    ageMs: GameMs,
    uncertaintyRadius: z.number().finite().nonnegative(),
    sizeEstimate: z.string().optional(),
  })
  .strict();
export type LastKnownContact = z.infer<typeof LastKnownContact>;

/** Everything one side may see. Built only by the engine's visibility filter. */
export const SideView = z
  .object({
    side: Side,
    atGame: GameMs,
    ownUnits: z.array(OwnUnit),
    visibleEnemies: z.array(VisibleEnemyUnit),
    lastKnownContacts: z.array(LastKnownContact),
    dispatches: z.array(Dispatch),
    clock: ClockState,
  })
  .strict();
export type SideView = z.infer<typeof SideView>;
