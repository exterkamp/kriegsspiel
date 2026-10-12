import { z } from 'zod';
import { Coord, Facing, Footprint, Formation, GameMs, Side } from './common.js';
import { LastKnownContact, Shape, VisibleEnemyUnit } from './view.js';

/**
 * The post-game umpire's window (docs/gameplay.md, After the game). Served only once the game has
 * ended: it carries master state that a live game never sends to a client.
 */

/** Where the scrubber can stop. */
export const WindowMark = z
  .object({
    ms: GameMs,
    kind: z.enum(['input', 'event', 'contact', 'order', 'llm']),
    label: z.string(),
  })
  .strict();
export type WindowMark = z.infer<typeof WindowMark>;

export const WindowTimeline = z
  .object({
    endMs: GameMs,
    outcome: z.object({ winner: Side.nullable(), reason: z.string(), time: GameMs }).strict(),
    marks: z.array(WindowMark),
  })
  .strict();
export type WindowTimeline = z.infer<typeof WindowTimeline>;

/** A unit as it truly stood. */
export const TrueUnit = z
  .object({
    id: z.string().min(1),
    side: Side,
    name: z.string(),
    position: Coord,
    facing: Facing,
    formation: Formation,
    footprint: Footprint,
    shape: Shape.optional(),
    strength: z.number().nonnegative(),
    /** 0..100. */
    morale: z.number(),
    ammo: z.number(),
  })
  .strict();
export type TrueUnit = z.infer<typeof TrueUnit>;

/** What one side believed about the enemy at that time. */
export const Belief = z
  .object({
    visibleEnemies: z.array(VisibleEnemyUnit),
    lastKnownContacts: z.array(LastKnownContact),
  })
  .strict();
export type Belief = z.infer<typeof Belief>;

/** One thing that happened: a shot with its die and modifiers, a contact, an order arriving. */
export const WindowEvent = z
  .object({ time: GameMs, type: z.string(), payload: z.unknown() })
  .strict();
export type WindowEvent = z.infer<typeof WindowEvent>;

export const WindowRuling = z
  .object({
    id: z.string(),
    time: GameMs,
    /** The unit a placement ruling is about; a battle ruling is about the whole field and has none. */
    unitId: z.string().optional(),
    rationale: z.string(),
    narrative: z.string(),
  })
  .strict();
export type WindowRuling = z.infer<typeof WindowRuling>;

export const WindowAt = z
  .object({
    gameMs: GameMs,
    units: z.array(TrueUnit),
    beliefs: z.record(z.string(), Belief),
    /** Events up to `gameMs`, in firing order. */
    events: z.array(WindowEvent),
    rulings: z.array(WindowRuling),
  })
  .strict();
export type WindowAt = z.infer<typeof WindowAt>;
