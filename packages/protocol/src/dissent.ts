import { z } from 'zod';
import { GameMs } from './common.js';

/** Longest dissent a staff officer or subordinate may put on record. */
export const MAX_DISSENT = 1000;

const Id = z.string().min(1).max(64);

/**
 * A dissenting comment on an order the side has signed (docs/gameplay.md, "Disputes and dissent").
 * The commander's order stands: dissent changes nothing in the engine, it is recorded in the side's
 * journal and handed to the post-game critique. `seat` names the job that dissented (a role, and
 * for a subordinate the formations they command), never the account behind it.
 */
export const Dissent = z
  .object({
    id: Id,
    orderId: Id,
    seat: z.string().min(1).max(200),
    body: z.string().min(1).max(MAX_DISSENT),
    atGame: GameMs,
  })
  .strict();
export type Dissent = z.infer<typeof Dissent>;

/** One line of a joiner's briefing: what the seat did before they arrived. */
export const BriefingItem = z
  .object({
    kind: z.enum(['order', 'dissent', 'draft', 'comment', 'question']),
    atGame: GameMs.optional(),
    text: z.string().max(2000),
  })
  .strict();
export type BriefingItem = z.infer<typeof BriefingItem>;

/**
 * What a player who takes over a role mid-game is told, built from the journal of the seat they
 * take: the orders it signed, drafts and comments it wrote, dissents it filed and questions it
 * put to the staff. Nothing the seat could not see itself (docs/gameplay.md, "Joining mid-game").
 */
export const Briefing = z
  .object({
    seat: z.string().min(1).max(200),
    atGame: GameMs,
    items: z.array(BriefingItem).max(200),
  })
  .strict();
export type Briefing = z.infer<typeof Briefing>;
