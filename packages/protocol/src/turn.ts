import { z } from 'zod';
import { Formation, Side, UnitId } from './common.js';

/**
 * The umpire's proposal for one turn of a turn-mode game (D39). It is master state: the umpire
 * sees everything and nothing here goes to a side directly. The engine validates and clamps it
 * against the hard limits (`validateProposal` in the engine) before `umpire.turn` applies it.
 *
 * Units are metres and compass degrees on the wire, as in `judgePlacement`. Outcomes are the
 * absolute values at the turn's end, not changes.
 */

/** The longest `account` and `departure` the umpire may write for one unit. */
export const TURN_ACCOUNT_MAX = 600;
/** The longest `summary` of a turn. */
export const TURN_SUMMARY_MAX = 2000;
/** The most rolls one proposal may ask for. */
export const TURN_ROLLS_MAX = 8;
/**
 * The most precedents one proposal may list (11.8). The engine keeps the first three, each cut
 * to 200 characters, in the umpire's journal; the schema is looser so a long list or ruling does
 * not waste the whole reply.
 */
export const TURN_PRECEDENTS_MAX = 8;

export const TURN_STATUSES = ['active', 'broken', 'destroyed', 'captured'] as const;
export const TURN_ORDER_RESULTS = [
  'carried-out',
  'partly',
  'misread',
  'refused',
  'not-arrived',
] as const;

const metresCoord = z.number().finite();

/** What a unit is still doing at the turn's end, carried into the next turn's projection. */
export const TurnContinuing = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('idle') }).strict(),
  z.object({ kind: z.literal('hold') }).strict(),
  z.object({ kind: z.literal('move'), x: metresCoord, y: metresCoord }).strict(),
]);
export type TurnContinuing = z.infer<typeof TurnContinuing>;

/** One unit at the turn's end, as the umpire has it. */
export const UnitOutcome = z
  .object({
    unitId: UnitId,
    x: metresCoord,
    y: metresCoord,
    facingDeg: z.number().finite(),
    formation: Formation,
    /** Loose sub-positions in metres from (x, y), in the unit's own frame (right, front). */
    shape: z.array(z.tuple([metresCoord, metresCoord])).optional(),
    /** Men at the turn's end. */
    strength: z.number().finite(),
    /** 0..100 at the turn's end; the engine clamps a value outside. */
    morale: z.number().finite(),
    /** 0..100; absent means the projected value. */
    fatigue: z.number().finite().optional(),
    ammo: z.number().finite().optional(),
    status: z.enum(TURN_STATUSES),
    continuing: TurnContinuing,
    orders: z.array(
      z.object({ orderId: z.string().min(1), result: z.enum(TURN_ORDER_RESULTS) }).strict(),
    ),
    /** What its commander did and why, in character. Master state; 11.9 filters it. */
    account: z.string().max(TURN_ACCOUNT_MAX),
    /**
     * Why it differs from the projection; required under `standard` beyond the tolerance. A `null`
     * is read as no reason, as models write it for "none" (#523).
     */
    departure: z
      .string()
      .max(TURN_ACCOUNT_MAX)
      .nullish()
      .transform((v) => v ?? undefined)
      .optional(),
    /** The rolls this outcome rests on. */
    rollIds: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type UnitOutcome = z.infer<typeof UnitOutcome>;

/** A side's unit `by` saw the enemy `unitId` at the turn's `start` or `end`. */
export const TurnObservation = z
  .object({
    side: Side,
    unitId: UnitId,
    by: UnitId,
    when: z.enum(['start', 'end']),
  })
  .strict();
export type TurnObservation = z.infer<typeof TurnObservation>;

/** A roll the umpire asks the engine to make (11.7): `chance` of success, strictly between 0 and 1. */
export const RollRequest = z
  .object({
    id: z.string().min(1),
    why: z.string().max(TURN_ACCOUNT_MAX),
    chance: z.number().gt(0).lt(1),
  })
  .strict();
export type RollRequest = z.infer<typeof RollRequest>;

/** A roll the engine made for a `RollRequest`. */
export const TurnRoll = RollRequest.extend({
  roll: z.number().min(0).lt(1),
  success: z.boolean(),
}).strict();
export type TurnRoll = z.infer<typeof TurnRoll>;

export const TurnProposal = z
  .object({
    /** Must equal the turn being resolved. */
    turn: z.number().int().positive(),
    /** Exactly one per unit not destroyed at the turn's start. */
    units: z.array(UnitOutcome),
    observations: z.array(TurnObservation),
    /** First call only (11.7). */
    rolls: z.array(RollRequest).max(TURN_ROLLS_MAX).optional(),
    /** The umpire's account for the record; never sent to a side. */
    summary: z.string().max(TURN_SUMMARY_MAX),
    /** Rulings set as precedent for the rest of the game (11.8): the umpire's journal; never sent to a side. */
    precedents: z.array(z.string().max(TURN_ACCOUNT_MAX)).max(TURN_PRECEDENTS_MAX).optional(),
  })
  .strict();
export type TurnProposal = z.infer<typeof TurnProposal>;
