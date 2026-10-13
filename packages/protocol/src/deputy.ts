import { z } from 'zod';
import { GameMs, UnitId } from './common.js';

/** Longest statement of intent a player leaves their deputy. */
export const MAX_DEPUTY_INTENT = 600;

/** How much latitude a deputy has; see the engine's `DISCRETIONS` (hold < adjust < act). */
export const DeputyDiscretion = z.enum(['hold', 'adjust', 'act']);
export type DeputyDiscretion = z.infer<typeof DeputyDiscretion>;

/** What a player tells their deputy: whether it acts, how far, and what they are trying to do. */
export const DeputySettings = z
  .object({
    enabled: z.boolean(),
    discretion: DeputyDiscretion,
    /** The player's stated intent, in their own words. The deputy treats it as the aim to serve. */
    intent: z.string().max(MAX_DEPUTY_INTENT),
  })
  .strict();
export type DeputySettings = z.infer<typeof DeputySettings>;

/**
 * One turn of the deputy, as the player reads it on their return: the orders it signed in their
 * name, what it was forbidden to do and why, and its own report. Never carries what the player's
 * side does not know.
 */
export const DeputyAccount = z
  .object({
    id: z.string().min(1),
    atGame: GameMs,
    discretion: DeputyDiscretion,
    issued: z.array(z.object({ unitId: UnitId, unit: z.string(), text: z.string() }).strict()),
    refused: z.array(
      z
        .object({ unitId: UnitId.optional(), text: z.string(), reasons: z.array(z.string()) })
        .strict(),
    ),
    report: z.string(),
  })
  .strict();
export type DeputyAccount = z.infer<typeof DeputyAccount>;

/** A side's deputy as its HQ sees it. */
export const DeputyView = z
  .object({ settings: DeputySettings, account: z.array(DeputyAccount) })
  .strict();
export type DeputyView = z.infer<typeof DeputyView>;
