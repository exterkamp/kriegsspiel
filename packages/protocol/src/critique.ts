import { z } from 'zod';
import { Side } from './common.js';

/**
 * The post-game critique (docs/gameplay.md, After the game): the umpire's account of what each
 * side knew and when, the decisions that mattered, misreadings and pauses. Like the window it
 * carries master facts, so it is served only once the game has ended. Every point cites events
 * that exist in the game's log (`cites`), and the server refuses a critique that does not.
 */

export const CritiqueKind = z.enum(['knowledge', 'decision', 'misreading', 'pause', 'outcome']);
export type CritiqueKind = z.infer<typeof CritiqueKind>;

/** A logged happening a point rests on, resolved for display. `minute` is game minutes. */
export const CritiqueCite = z
  .object({
    id: z.string().min(1),
    minute: z.number().int().nonnegative(),
    label: z.string(),
  })
  .strict();
export type CritiqueCite = z.infer<typeof CritiqueCite>;

export const CritiquePoint = z
  .object({
    kind: CritiqueKind,
    /** The side it is about, or `both`. */
    side: z.union([Side, z.literal('both')]),
    /** Game minute the point is about; always the minute of one of its cites. */
    minute: z.number().int().nonnegative(),
    text: z.string().min(1),
    cites: z.array(CritiqueCite).min(1),
  })
  .strict();
export type CritiquePoint = z.infer<typeof CritiquePoint>;

export const Critique = z
  .object({
    /** `model` when the umpire wrote it and it passed the checks, `template` when the log's own wording stands in. */
    source: z.enum(['model', 'template']),
    summary: z.string().min(1),
    points: z.array(CritiquePoint),
  })
  .strict();
export type Critique = z.infer<typeof Critique>;
