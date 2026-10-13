import { z } from 'zod';
import { GameMs, Side } from './common.js';

/**
 * Turn mode (D39): an order written for the turn. It is held, not parsed, until its side sends the
 * turn; the umpire reads `text` as written, and the engine's rules parser reads it at resolution.
 * `to` is the addressee chosen on the desk, never guessed from the text. `courier` absent is the
 * ordinary ride, as for a real-time order.
 */
export const TurnOrder = z
  .object({
    orderId: z.string().min(1).max(64),
    to: z.string().min(1).max(64),
    text: z.string().trim().min(1).max(2000),
    courier: z.enum(['fast', 'safe']).optional(),
  })
  .strict();
export type TurnOrder = z.infer<typeof TurnOrder>;

/** Most orders a side may hold for one turn. */
export const MAX_TURN_ORDERS = 40;

/** Why a turn closed: every human side sent, or its wall-clock deadline passed. */
export const TurnCause = z.enum(['all-sent', 'deadline']);
export type TurnCause = z.infer<typeof TurnCause>;

/**
 * Where the open turn stands, as one side sees it. `held` is that side's own held orders only;
 * other sides are named in `sent` once they have sent, never with their orders.
 */
export const TurnStateMessage = {
  /** Turn number, from 1. */
  turn: z.number().int().positive(),
  /** Game time the turn starts at (`T0`) and ends at (`T1`). */
  startsAt: GameMs,
  endsAt: GameMs,
  sent: z.array(Side),
  /** Wall time (ms since the epoch) the turn closes by itself; absent when it waits for every side. */
  deadline: z.number().finite().nonnegative().optional(),
  /** The turn has closed and is being resolved: nothing more can be held, withdrawn or sent. */
  resolving: z.boolean(),
  /** This side's orders for the turn: the ones it sent, or those it is still writing. */
  held: z.array(TurnOrder).max(MAX_TURN_ORDERS),
  /**
   * Set once the umpire has ruled the battle (D13): the turn is the pursuit, and the game closes by
   * this game time. Orders are still taken; a side may send none (#438).
   */
  pursuitUntil: GameMs.optional(),
};
