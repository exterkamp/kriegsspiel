import { z } from 'zod';
import { Coord, GameMs } from './common.js';

/** Most marks a side may keep on its table. */
export const MAX_MARKS = 500;
/** Most points in one pencil line. */
export const MAX_LINE_POINTS = 400;

const Base = {
  /** Chosen by the client that makes the mark; unique within a side. */
  id: z.string().min(1).max(64),
  /** A note written on the mark. */
  label: z.string().trim().max(80).optional(),
  /** Game time when the player made it. The mark ages from here. */
  madeAtGame: GameMs,
  /** The dispatch this mark was taken from, if any. */
  sourceReport: z.string().min(1).max(64).optional(),
};

/**
 * Something a player or their staff drew on the table. Marks are the player's own picture and are
 * never checked against the truth: the server stores them as sent and never moves or corrects one.
 */
export const Mark = z.discriminatedUnion('kind', [
  z.object({ ...Base, kind: z.literal('pin'), at: Coord }).strict(),
  z
    .object({
      ...Base,
      kind: z.literal('line'),
      points: z.array(Coord).min(2).max(MAX_LINE_POINTS),
    })
    .strict(),
  z.object({ ...Base, kind: z.literal('arrow'), from: Coord, to: Coord }).strict(),
  z
    .object({
      ...Base,
      kind: z.literal('ring'),
      at: Coord,
      radius: z.number().finite().positive(),
    })
    .strict(),
]);
export type Mark = z.infer<typeof Mark>;
export type MarkKind = Mark['kind'];
