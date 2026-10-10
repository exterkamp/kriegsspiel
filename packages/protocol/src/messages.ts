import { z } from 'zod';
import { PROTOCOL_VERSION, ClockState, GameMs, Side } from './common.js';
import { Dispatch, SideView } from './view.js';

const Id = z.string().min(1);
const Envelope = { v: z.literal(PROTOCOL_VERSION) };

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
    .object({ ...Envelope, kind: z.literal('proposePause'), reason: z.string().optional() })
    .strict(),
  z.object({ ...Envelope, kind: z.literal('vote'), proposal: Id, yes: z.boolean() }).strict(),
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
  z.object({ ...Envelope, kind: z.literal('clockState'), clock: ClockState }).strict(),
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
