import { z } from 'zod';

/** Longest draft text, the same as the longest order the umpire reads. */
export const MAX_DRAFT_TEXT = 2000;
/** Most drafts a side may keep (forks and merged drafts count). */
export const MAX_DRAFTS = 50;
/** Most log entries (edits, comments) one draft keeps; past it the draft takes no more and must be forked. */
export const MAX_DRAFT_REVS = 5000;
export const MAX_COMMENT = 1000;

/**
 * A text edit: a list of components applied left to right over the whole text. A positive number
 * keeps that many characters, a negative number deletes that many, a string inserts. Lengths are in
 * UTF-16 code units. The components must cover the text exactly: the kept and deleted lengths add up
 * to the length of the text the edit is against.
 */
export const TextOp = z
  .array(
    z.union([
      z
        .number()
        .int()
        .min(-MAX_DRAFT_TEXT)
        .max(MAX_DRAFT_TEXT)
        .refine((n) => n !== 0),
      z.string().min(1).max(MAX_DRAFT_TEXT),
    ]),
  )
  .max(400);
export type TextOp = z.infer<typeof TextOp>;

const Id = z.string().min(1).max(64);

/** A comment on a stretch of the text (`from` to `to`, equal for a point). Anchors follow later edits. */
export const DraftComment = z
  .object({
    id: Id,
    author: Id,
    /** Wall ms when the server took it. */
    at: z.number().finite().nonnegative(),
    from: z.number().int().nonnegative(),
    to: z.number().int().nonnegative(),
    body: z.string().min(1).max(MAX_COMMENT),
    replyTo: Id.optional(),
    resolved: z.boolean(),
  })
  .strict();
export type DraftComment = z.infer<typeof DraftComment>;

/** One step in a draft's history. `rev` counts steps from 1; every step, whatever its kind, has the next rev. */
export const DraftEntry = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('edit'),
      rev: z.number().int().positive(),
      author: Id,
      at: z.number().finite().nonnegative(),
      /** Echo of the client's `opId`, so the sender can tell its own edit coming back. */
      opId: Id.optional(),
      /** The edit as applied: already moved past anything that landed after the sender's `baseRev`. */
      op: TextOp,
      /** Set on an edit brought in by a merge: the fork it was written in. */
      viaFork: Id.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('comment'),
      rev: z.number().int().positive(),
      at: z.number().finite().nonnegative(),
      comment: DraftComment,
    })
    .strict(),
  z
    .object({
      kind: z.literal('resolve'),
      rev: z.number().int().positive(),
      author: Id,
      at: z.number().finite().nonnegative(),
      commentId: Id,
      resolved: z.boolean(),
    })
    .strict(),
]);
export type DraftEntry = z.infer<typeof DraftEntry>;

/** Who wrote a stretch of the current text. The runs cover the text end to end. */
export const AuthorRun = z.object({ author: Id, len: z.number().int().positive() }).strict();
export type AuthorRun = z.infer<typeof AuthorRun>;

/** Everything about one draft: current text, who wrote what, comments, receipts and the full history. */
export const DraftSnapshot = z
  .object({
    id: Id,
    title: z.string().max(80),
    createdBy: Id,
    rev: z.number().int().nonnegative(),
    text: z.string().max(MAX_DRAFT_TEXT),
    authors: z.array(AuthorRun),
    comments: z.array(DraftComment),
    /** Highest rev each reader has seen. */
    receipts: z.record(z.string(), z.number().int().nonnegative()),
    /** Set on a fork: the draft it came from and that draft's rev at the time. */
    forkOf: z.object({ draft: Id, rev: z.number().int().nonnegative() }).strict().optional(),
    /** Set once a fork has been merged back (it then takes no more edits). */
    mergedInto: Id.optional(),
    history: z.array(DraftEntry),
  })
  .strict();
export type DraftSnapshot = z.infer<typeof DraftSnapshot>;
