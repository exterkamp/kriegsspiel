import { z } from 'zod';
import { PROTOCOL_VERSION, ClockState, GameMs, Side } from './common.js';
import { Mark } from './marks.js';
import { Dispatch, SideView } from './view.js';

const Id = z.string().min(1);
const Envelope = { v: z.literal(PROTOCOL_VERSION) };

/** Longest reason a player may give for a pause request. */
export const MAX_PAUSE_REASON = 200;

/** Where the pause vote stands, as the server's state machine has it (docs/architecture.md). */
export const PausePhase = z.enum(['running', 'pause_proposed', 'paused', 'resume_proposed']);
export type PausePhase = z.infer<typeof PausePhase>;

/** The open pause or resume proposal, as one player sees it. Votes are tallies, not names. */
export const PauseProposal = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['pause', 'resume']),
    /** The side of the player who asked; absent when the server cannot tell. */
    bySide: Side.optional(),
    /** This player asked. */
    byYou: z.boolean(),
    reason: z.string().optional(),
    yes: z.number().int().nonnegative(),
    no: z.number().int().nonnegative(),
    /** How many players vote in all. */
    voters: z.number().int().positive(),
    /** This player's own vote, once cast. */
    myVote: z.boolean().optional(),
    /** Wall ms until the vote closes and is cancelled. */
    msLeft: z.number().finite().nonnegative(),
  })
  .strict();
export type PauseProposal = z.infer<typeof PauseProposal>;

/** Player-to-server. Every command is logged for replay. */
export const Command = z.discriminatedUnion('kind', [
  // Signs a shared draft, or (until drafts exist) sends the order wording directly as `text`.
  // Exactly one of `draft` and `text` is given.
  z
    .object({
      ...Envelope,
      kind: z.literal('issueOrder'),
      orderId: Id,
      draft: Id.optional(),
      text: z.string().trim().min(1).max(2000).optional(),
    })
    .strict()
    .refine((c) => (c.draft === undefined) !== (c.text === undefined), {
      message: 'issueOrder needs exactly one of draft and text',
    }),
  z.object({ ...Envelope, kind: z.literal('setReady'), ready: z.boolean() }).strict(),
  z
    .object({
      ...Envelope,
      kind: z.literal('proposePause'),
      reason: z.string().max(MAX_PAUSE_REASON).optional(),
    })
    .strict(),
  // Ask to resume a paused game. Voted on with `vote`, like a pause.
  z.object({ ...Envelope, kind: z.literal('proposeResume') }).strict(),
  z.object({ ...Envelope, kind: z.literal('vote'), proposal: Id, yes: z.boolean() }).strict(),
  // Create or replace one of the side's marks (by `mark.id`). Not game input: it never reaches the engine.
  z.object({ ...Envelope, kind: z.literal('putMark'), mark: Mark }).strict(),
  z.object({ ...Envelope, kind: z.literal('deleteMark'), markId: Id }).strict(),
  // Stub: edit ops are undefined until the drafting UI is designed.
  z
    .object({ ...Envelope, kind: z.literal('draftEdit'), draft: Id, ops: z.array(z.unknown()) })
    .strict(),
]);
export type Command = z.infer<typeof Command>;

/** Server-to-player. Only fog-filtered data appears here. */
export const ServerMessage = z.discriminatedUnion('kind', [
  z.object({ ...Envelope, kind: z.literal('viewUpdate'), view: SideView }).strict(),
  z.object({ ...Envelope, kind: z.literal('dispatch'), dispatch: Dispatch }).strict(),
  // Every mark the side has made, sent on connect and again after any change by either connection.
  z.object({ ...Envelope, kind: z.literal('marks'), marks: z.array(Mark) }).strict(),
  z.object({ ...Envelope, kind: z.literal('clockState'), clock: ClockState }).strict(),
  // The pause vote. Sent on connect (only to a game that has voters) and whenever the phase or the
  // open proposal changes, including each vote. Absent `proposal` means nothing is being voted on.
  z
    .object({
      ...Envelope,
      kind: z.literal('pauseState'),
      phase: PausePhase,
      proposal: PauseProposal.optional(),
    })
    .strict(),
  // A pause or resume vote has been settled, or the pause was ended some other way.
  z
    .object({
      ...Envelope,
      kind: z.literal('pauseResult'),
      outcome: z.enum(['paused', 'resumed', 'cancelled']),
      cause: z.enum(['all-yes', 'majority-yes', 'no-vote', 'timeout', 'max-pause', 'forced']),
      /** What the cancelled proposal was for; set when `outcome` is `cancelled`. */
      proposalKind: z.enum(['pause', 'resume']).optional(),
      bySide: Side.optional(),
    })
    .strict(),
  // "Staff at work": the umpire is still on something game time depends on. While `working`, game
  // time may be held at `needAtMs` (the earliest game time that needs a result); it carries on
  // from there when the result arrives.
  z
    .object({
      ...Envelope,
      kind: z.literal('staffAtWork'),
      working: z.boolean(),
      needAtMs: GameMs.optional(),
    })
    .strict(),
  // The server was down and the game came back paused; game time did not move. `downMs` is the
  // wall time it was away (an estimate). Sent once per connection.
  z
    .object({
      ...Envelope,
      kind: z.literal('serverRestarted'),
      downMs: z.number().finite().nonnegative(),
    })
    .strict(),
  // The game has ended. Public to both sides and sent once per connection, also to a late joiner.
  // `winner` is null when both sides were put out of the fight together.
  z
    .object({
      ...Envelope,
      kind: z.literal('gameOver'),
      winner: Side.nullable(),
      reason: z.enum(['objective-taken', 'objective-held', 'eliminated', 'withdrawn']),
      atGame: GameMs,
    })
    .strict(),
  z
    .object({
      ...Envelope,
      kind: z.literal('error'),
      code: z.string().min(1),
      message: z.string(),
    })
    .strict(),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Exported for tests only; not re-exported from the package index. */
export function parseWith<T>(schema: z.ZodType<T>, json: string): ParseResult<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
  try {
    const r = schema.safeParse(raw);
    return r.success ? { ok: true, value: r.data } : { ok: false, error: r.error.message };
  } catch {
    // Pathological payloads (e.g. a deeply nested Intent) can overflow the stack inside zod.
    return { ok: false, error: 'payload could not be validated' };
  }
}

export const parseCommand = (json: string): ParseResult<Command> => parseWith(Command, json);
export const parseServerMessage = (json: string): ParseResult<ServerMessage> =>
  parseWith(ServerMessage, json);

/** Validates before serialising, so a malformed message never reaches the wire. */
export const serializeCommand = (c: Command): string => JSON.stringify(Command.parse(c));
export const serializeServerMessage = (m: ServerMessage): string =>
  JSON.stringify(ServerMessage.parse(m));
