import { z } from 'zod';

/** Wire version carried by every message. Bump on breaking changes. */
export const PROTOCOL_VERSION = 1;

export const Coord = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
export type Coord = z.infer<typeof Coord>;

export const Side = z.string().min(1);
export type Side = z.infer<typeof Side>;

export const UnitId = z.string().min(1);
export type UnitId = z.infer<typeof UnitId>;

/** Game time in milliseconds since scenario start. */
export const GameMs = z.number().finite().nonnegative();

export const ClockState = z
  .object({
    gameMsAtAnchor: GameMs,
    wallMsAtAnchor: z.number().finite().nonnegative(),
    rate: z.number().finite().positive(),
    status: z.enum(['running', 'paused', 'stopped']),
  })
  .strict();
export type ClockState = z.infer<typeof ClockState>;

export const Pace = z.enum(['march', 'quick', 'forced']);

export interface MoveIntent {
  kind: 'move';
  to: Coord;
  route?: Coord[];
  pace?: z.infer<typeof Pace>;
}
export interface HoldIntent {
  kind: 'hold';
  at: Coord;
  posture?: 'defend' | 'screen';
}
export interface AttackIntent {
  kind: 'attack';
  target: Coord | UnitId;
}
export interface WithdrawIntent {
  kind: 'withdraw';
  toward: Coord;
}
export interface ReportIntent {
  kind: 'report';
}
export interface WhenIntent {
  kind: 'when';
  trigger: Trigger;
  then: Intent[];
}
export interface AtIntent {
  kind: 'at';
  gameTime: number;
  then: Intent[];
}
export type Intent =
  MoveIntent | HoldIntent | AttackIntent | WithdrawIntent | ReportIntent | WhenIntent | AtIntent;

/** Condition for a conditional order. Kept to a small closed set until the engine defines more. */
export const Trigger = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('contact'), near: Coord.optional() }).strict(),
  z.object({ kind: z.literal('arrived'), at: Coord }).strict(),
  z.object({ kind: z.literal('attacked') }).strict(),
]);
export type Trigger = z.infer<typeof Trigger>;

export const Intent: z.ZodType<Intent> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('move'),
        to: Coord,
        route: z.array(Coord).optional(),
        pace: Pace.optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('hold'),
        at: Coord,
        posture: z.enum(['defend', 'screen']).optional(),
      })
      .strict(),
    z.object({ kind: z.literal('attack'), target: z.union([Coord, UnitId]) }).strict(),
    z.object({ kind: z.literal('withdraw'), toward: Coord }).strict(),
    z.object({ kind: z.literal('report') }).strict(),
    z.object({ kind: z.literal('when'), trigger: Trigger, then: z.array(Intent) }).strict(),
    z.object({ kind: z.literal('at'), gameTime: GameMs, then: z.array(Intent) }).strict(),
  ]),
) as z.ZodType<Intent>;
