import { z } from 'zod';
import { ClockState, Coord, Facing, Footprint, Formation, GameMs, Side, UnitId } from './common.js';

/** The officers a player can put a question to in the staff conference (docs/staff-conference.md). */
export const StaffRole = z.enum(['chiefOfStaff', 'intelligence', 'quartermaster', 'engineer']);
export type StaffRole = z.infer<typeof StaffRole>;

/**
 * One question put to a staff officer and the officer's answer, kept by the server so a reload or a
 * reconnect does not lose the conference (D6b). `text` is withheld until game time reaches `answerAtGame`.
 */
export const StaffExchange = z
  .object({
    questionId: z.string().min(1),
    role: StaffRole,
    question: z.string(),
    askedAtGame: GameMs,
    answerAtGame: GameMs,
    text: z.string().optional(),
    basedOnGame: GameMs.optional(),
    /** The staff stage gave no words, so `text` will never come (as opposed to being withheld until due). */
    textless: z.boolean().optional(),
    /** Which seat asked (server-side only; `toSideView` filters on it and never sends it). */
    askedBy: z.string().optional(),
    officer: z.object({ name: z.string(), traits: z.array(z.string()) }).strict(),
  })
  .strict();
export type StaffExchange = z.infer<typeof StaffExchange>;

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

/** The jobs on a side's staff; see the engine's `ROLES`. */
export const Role = z.enum([
  'commander',
  'chiefOfStaff',
  'intelligence',
  'quartermaster',
  'subordinate',
]);
export type Role = z.infer<typeof Role>;

export const OwnUnit = z
  .object({
    id: UnitId,
    name: z.string(),
    /** Who commands the formation, when the scenario names one. */
    commander: z.string().optional(),
    /** Centre of the footprint, in metres. */
    position: Coord,
    facing: Facing,
    formation: Formation,
    footprint: Footprint,
    shape: Shape.optional(),
    /** Game time of the report behind strength, morale and supply. Left out with them. */
    reportedAt: GameMs.optional(),
    // Left out when the viewer's role may not know a unit's condition (the intelligence officer).
    strength: z.number().nonnegative().optional(),
    morale: z.number().min(0).max(1).optional(),
    supply: z.number().min(0).max(1).optional(),
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
    /** Which way it faced when seen, to the nearest eighth of a turn; a guess once it has moved. */
    facing: Facing.optional(),
    observedAtGame: GameMs,
    ageMs: GameMs,
    uncertaintyRadius: z.number().finite().nonnegative(),
    sizeEstimate: z.string().optional(),
  })
  .strict();
export type LastKnownContact = z.infer<typeof LastKnownContact>;

/** One of the side's own orders in flight or planned routes, in metres, start first (#203). */
export const OrderRoute = z
  .object({
    id: z.string().min(1),
    unitId: UnitId,
    kind: z.enum(['order', 'route']),
    points: z.array(Coord).min(2),
  })
  .strict();
export type OrderRoute = z.infer<typeof OrderRoute>;

/** Everything one side may see. Built only by the engine's visibility filter. */
export const SideView = z
  .object({
    side: Side,
    /** The staff role this view was cut for. Absent in shared-HQ play, where everyone sees the whole side view. */
    role: Role.optional(),
    atGame: GameMs,
    /** Where this side's couriers set out from. */
    hq: Coord.optional(),
    ownUnits: z.array(OwnUnit),
    /** The side's own orders in flight and its units' planned routes. Absent when there are none. */
    orderRoutes: z.array(OrderRoute).optional(),
    visibleEnemies: z.array(VisibleEnemyUnit),
    lastKnownContacts: z.array(LastKnownContact),
    dispatches: z.array(Dispatch),
    /** The side's conference with its staff officers, oldest first. Absent when nobody has asked. */
    staffHistory: z.array(StaffExchange).optional(),
    /** The side's conference officers by role. Fixed per game (from the seed), so they do not change on a reload. */
    staffOfficers: z
      .record(StaffRole, z.object({ name: z.string(), traits: z.array(z.string()) }).strict())
      .optional(),
    clock: ClockState,
  })
  .strict();
export type SideView = z.infer<typeof SideView>;
