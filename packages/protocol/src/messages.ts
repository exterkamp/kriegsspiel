import { z } from 'zod';
import { PROTOCOL_VERSION, ClockState, GameMs, Side } from './common.js';
import { DraftEntry, DraftSnapshot, MAX_COMMENT, MAX_DRAFT_TEXT, TextOp } from './drafts.js';
import { Mark } from './marks.js';
import { Dispatch, SideView, StaffRole } from './view.js';

const Id = z.string().min(1);
const Envelope = { v: z.literal(PROTOCOL_VERSION) };

/** Longest reason a player may give for a pause request. */
export const MAX_PAUSE_REASON = 200;

/** Longest question put to a staff officer. */
export const MAX_STAFF_QUESTION = 400;

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
    /** An emergency hold: the clock is already stopped and the vote ratifies it before it lapses. */
    hold: z.boolean().optional(),
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
      // Fast rides sooner and is likelier lost or garbled; safe the reverse. Absent: the ordinary ride.
      courier: z.enum(['fast', 'safe']).optional(),
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
  // Emergency hold (D5): stop the clock now for a short wall-clock time. It lapses unless the other
  // players ratify it with `vote`. Each player and each game has a fixed number of holds.
  z
    .object({
      ...Envelope,
      kind: z.literal('proposeHold'),
      reason: z.string().max(MAX_PAUSE_REASON).optional(),
    })
    .strict(),
  // Ask to resume a paused game. Voted on with `vote`, like a pause.
  z.object({ ...Envelope, kind: z.literal('proposeResume') }).strict(),
  z.object({ ...Envelope, kind: z.literal('vote'), proposal: Id, yes: z.boolean() }).strict(),
  // Create or replace one of the side's marks (by `mark.id`). Not game input: it never reaches the engine.
  z.object({ ...Envelope, kind: z.literal('putMark'), mark: Mark }).strict(),
  z.object({ ...Envelope, kind: z.literal('deleteMark'), markId: Id }).strict(),
  // Put a question to a staff officer. The server charges the officer's game-time cost (D6b): the
  // officer is busy until `staffQueued.answerAtGame`, and asking again before then is `staff_busy`.
  // `questionId` is chosen by the client; errors for it are prefixed `<questionId>: `.
  z
    .object({
      ...Envelope,
      kind: z.literal('askStaff'),
      questionId: Id.max(64),
      role: StaffRole,
      question: z.string().trim().min(1).max(MAX_STAFF_QUESTION),
    })
    .strict(),
  // Shared order drafts (D6c). None of these reach the engine or the input log. Drafts belong to the
  // sender's side; ids are chosen by the client and unique within a side.
  z
    .object({
      ...Envelope,
      kind: z.literal('createDraft'),
      draft: Id.max(64),
      text: z.string().max(MAX_DRAFT_TEXT).optional(),
      title: z.string().max(80).optional(),
    })
    .strict(),
  // An edit made on the draft as it stood at `baseRev` (the last rev the sender had applied).
  z
    .object({
      ...Envelope,
      kind: z.literal('draftEdit'),
      draft: Id,
      baseRev: z.number().int().nonnegative(),
      op: TextOp,
      /** Echoed on the entry that comes back, so the sender can tell it from other players' edits. */
      opId: Id.max(64).optional(),
    })
    .strict(),
  z
    .object({
      ...Envelope,
      kind: z.literal('draftComment'),
      draft: Id,
      baseRev: z.number().int().nonnegative(),
      comment: z
        .object({
          id: Id.max(64),
          from: z.number().int().nonnegative(),
          to: z.number().int().nonnegative(),
          body: z.string().min(1).max(MAX_COMMENT),
          replyTo: Id.max(64).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...Envelope,
      kind: z.literal('resolveComment'),
      draft: Id,
      commentId: Id,
      resolved: z.boolean(),
    })
    .strict(),
  // "I have seen this draft up to `rev`": the read receipt.
  z
    .object({
      ...Envelope,
      kind: z.literal('readDraft'),
      draft: Id,
      rev: z.number().int().nonnegative(),
    })
    .strict(),
  // Ask for the side's drafts again (the `drafts` snapshot), for a client that fell out of step.
  z.object({ ...Envelope, kind: z.literal('syncDrafts') }).strict(),
  // Copy a draft into a new one, to write an alternative plan.
  z.object({ ...Envelope, kind: z.literal('forkDraft'), draft: Id, newDraft: Id.max(64) }).strict(),
  // Fold a fork's edits back into the draft it came from.
  z.object({ ...Envelope, kind: z.literal('mergeDraft'), draft: Id }).strict(),
  // HQ (commander, chief of staff) passes a paper in its own view on to the subordinate commanding `unit`.
  z.object({ ...Envelope, kind: z.literal('forwardDispatch'), dispatchId: Id, unit: Id }).strict(),
]);
export type Command = z.infer<typeof Command>;

/** What a notification is about. Players pick which of these reach them (see the server's notifier). */
export const NotifyEvent = z.enum([
  'dispatch',
  'contact',
  'unitLost',
  'pauseProposed',
  'decision',
  'paused',
  'resumed',
  'gameOver',
]);
export type NotifyEvent = z.infer<typeof NotifyEvent>;

/** Server-to-player. Only fog-filtered data appears here. */
export const ServerMessage = z.discriminatedUnion('kind', [
  z.object({ ...Envelope, kind: z.literal('viewUpdate'), view: SideView }).strict(),
  z.object({ ...Envelope, kind: z.literal('dispatch'), dispatch: Dispatch }).strict(),
  // Every mark the side has made, sent on connect and again after any change by either connection.
  z.object({ ...Envelope, kind: z.literal('marks'), marks: z.array(Mark) }).strict(),
  // The orders the side has sent, oldest first, sent on connect so a reload can rebuild the war diary (#343).
  // `id` is the client's order id where the server kept it, else `log-<seq>`.
  z
    .object({
      ...Envelope,
      kind: z.literal('sentOrders'),
      orders: z.array(
        z
          .object({
            id: Id,
            text: z.string(),
            sentAtGame: GameMs,
            toName: z.string().optional(),
            courier: z.enum(['fast', 'safe']).optional(),
          })
          .strict(),
      ),
    })
    .strict(),
  // Every draft the side has, sent on connect. A player back after a while catches up from this.
  z.object({ ...Envelope, kind: z.literal('drafts'), drafts: z.array(DraftSnapshot) }).strict(),
  // One draft in full: sent when it is created or forked, and when a merge closes a fork.
  z.object({ ...Envelope, kind: z.literal('draftState'), draft: DraftSnapshot }).strict(),
  // The next step in a draft's history, to every connection of the side, the sender's included.
  // Entries arrive in rev order with no gaps; `entry.op` is already moved past anything that landed first.
  // A `drafts` snapshot sent on connect can already contain an entry that follows it, so a client
  // ignores any entry with `rev` at or below the rev of the draft it holds.
  z.object({ ...Envelope, kind: z.literal('draftEntry'), draft: Id, entry: DraftEntry }).strict(),
  z
    .object({
      ...Envelope,
      kind: z.literal('draftReceipt'),
      draft: Id,
      reader: Id,
      rev: z.number().int().nonnegative(),
    })
    .strict(),
  // The server took a staff question and charged its cost: the officer answers at `answerAtGame`
  // (`askedAtGame + costMs`, in game time, so a paused game does not move it).
  z
    .object({
      ...Envelope,
      kind: z.literal('staffQueued'),
      questionId: Id,
      role: StaffRole,
      askedAtGame: GameMs,
      answerAtGame: GameMs,
      costMs: GameMs,
    })
    .strict(),
  // The umpire's answer to a staff question, written from the asking seat's view at `basedOnGame`. The
  // client shows it once game time reaches the question's `answerAtGame`. No `text`: the staff stage is
  // off or failed, and the client falls back to its own canned answer.
  z
    .object({
      ...Envelope,
      kind: z.literal('staffAnswer'),
      questionId: Id,
      role: StaffRole,
      text: z.string().max(2000).optional(),
      basedOnGame: GameMs,
      officer: z.object({ name: z.string(), traits: z.array(z.string()) }).strict(),
    })
    .strict(),
  z.object({ ...Envelope, kind: z.literal('clockState'), clock: ClockState }).strict(),
  // The pause vote. Sent on connect (only to a game that has voters) and whenever the phase or the
  // open proposal changes, including each vote. Absent `proposal` means nothing is being voted on.
  z
    .object({
      ...Envelope,
      kind: z.literal('pauseState'),
      phase: PausePhase,
      proposal: PauseProposal.optional(),
      /** Emergency holds this player may still call (their own allowance or the game's, the smaller). */
      holdsLeft: z.number().int().nonnegative().optional(),
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
  // Sent once when a side returns after being away (no connection open): game time of its last
  // visit, game time now, and the ids of dispatches that arrived in between (all of them also in
  // the view). Nothing is sent to a side that has never visited or that is still connected.
  z
    .object({
      ...Envelope,
      kind: z.literal('catchUp'),
      sinceGame: GameMs,
      atGame: GameMs,
      dispatchIds: z.array(z.string().min(1)),
    })
    .strict(),
  // The game has ended. Public to both sides and sent once per connection, also to a late joiner.
  // `winner` is null when both sides were put out of the fight together.
  z
    .object({
      ...Envelope,
      kind: z.literal('gameOver'),
      winner: Side.nullable(),
      reason: z.enum([
        'objective-taken',
        'objective-held',
        'eliminated',
        'withdrawn',
        'attack-broken',
        'defence-broken',
      ]),
      atGame: GameMs,
      // Set when the loser had nobody left on the field (D13), so the screen can say it was wiped out.
      loserOut: z.enum(['eliminated', 'withdrawn']).optional(),
    })
    .strict(),
  // A heads-up for a player who has the game open: only a fixed title and line, never game content.
  z
    .object({
      ...Envelope,
      kind: z.literal('notification'),
      event: NotifyEvent,
      title: z.string().min(1),
      text: z.string().min(1),
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
