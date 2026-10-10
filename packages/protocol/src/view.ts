import { z } from 'zod';
import { ClockState, Coord, GameMs, Side, UnitId } from './common.js';

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

export const OwnUnit = z
  .object({
    id: UnitId,
    name: z.string(),
    position: Coord,
    strength: z.number().nonnegative(),
    morale: z.number().min(0).max(1),
    supply: z.number().min(0).max(1),
  })
  .strict();
export type OwnUnit = z.infer<typeof OwnUnit>;

export const VisibleEnemyUnit = z
  .object({
    id: UnitId,
    position: Coord,
    sizeEstimate: z.string().optional(),
  })
  .strict();
export type VisibleEnemyUnit = z.infer<typeof VisibleEnemyUnit>;

/** A stale sighting. `ageMs` is game time since it was observed. */
export const LastKnownContact = z
  .object({
    id: z.string().min(1),
    position: Coord,
    observedAtGame: GameMs,
    ageMs: GameMs,
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
