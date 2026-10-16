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
    kind: z.enum(['input', 'event', 'contact', 'order', 'llm', 'turn']),
    label: z.string(),
  })
  .strict();
export type WindowMark = z.infer<typeof WindowMark>;

/** A unit a turn changed: men lost, or a new status. */
export const WindowTurnUnit = z
  .object({
    id: z.string().min(1),
    side: Side,
    name: z.string(),
    lost: z.number().nonnegative(),
    from: z.string(),
    to: z.string(),
  })
  .strict();
export type WindowTurnUnit = z.infer<typeof WindowTurnUnit>;

/**
 * One turn of a turn-mode game (D39, 11.11), as the window shows it after the game: who decided
 * it, the umpire's own account, what it cost each side, the corrections and the dice. `journal` is
 * the umpire's log (its notes and precedents) as it stood after the turn.
 */
export const WindowTurn = z
  .object({
    n: z.number().int().positive(),
    startMs: GameMs,
    /** Where the turn ended: its scheduled end, or the outcome's time if the game ended inside it. */
    endMs: GameMs,
    /** `umpire`, or `engine` when the rules (the tables) decided it. */
    adjudicator: z.string(),
    /** The umpire failed and the tables decided the turn. */
    fellBack: z.boolean(),
    /** The umpire's account of the turn, for the record; absent when the tables decided it. */
    summary: z.string().optional(),
    /** Men lost in the turn, per side. */
    losses: z.record(z.string(), z.number()),
    units: z.array(WindowTurnUnit),
    /** How many of the umpire's outcomes the engine corrected against the hard limits. */
    corrections: z.number().int().nonnegative(),
    rolls: z.array(
      z.object({ why: z.string(), chance: z.number(), success: z.boolean() }).strict(),
    ),
    journal: z
      .object({
        notes: z.array(z.object({ turn: z.number(), note: z.string() }).strict()),
        precedents: z.array(z.object({ turn: z.number(), ruling: z.string() }).strict()),
      })
      .strict()
      .optional(),
  })
  .strict();
export type WindowTurn = z.infer<typeof WindowTurn>;

export const WindowTimeline = z
  .object({
    endMs: GameMs,
    outcome: z.object({ winner: Side.nullable(), reason: z.string(), time: GameMs }).strict(),
    marks: z.array(WindowMark),
    /** Turn mode only: every turn played, in order. */
    turns: z.array(WindowTurn).optional(),
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
