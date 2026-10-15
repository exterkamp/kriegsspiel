import { z } from 'zod';
import {
  assertBattlefieldBudget,
  DIALS,
  PERSONAS,
  MIN_TURN_DEADLINE_HOURS,
  MAX_TURN_DEADLINE_HOURS,
  MIN_TURN_MINUTES,
  MAX_TURN_MINUTES,
} from '@kriegsspiel/protocol';
import {
  rateOf,
  turnMinutesOf,
  deadlineHoursOf,
  type CreateRequest,
  type Form,
} from './newGame.js';
const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/);
const selection = z
  .object({ pairingId: id, revision: z.string().regex(/^engine-pairing-v1:sha256:[a-f0-9]{64}$/) })
  .strict();
const request = z
  .object({
    scenario: id,
    side: id,
    rate: z.number().finite().min(0.01).max(86400),
    dial: z.enum(DIALS),
    persona: z.enum(PERSONAS),
    sessionType: z.literal('co_op_vs_ai').optional(),
    mode: z.literal('turns').optional(),
    turnMinutes: z.number().int().min(MIN_TURN_MINUTES).max(MAX_TURN_MINUTES).optional(),
    turnDeadlineHours: z
      .number()
      .finite()
      .min(MIN_TURN_DEADLINE_HOURS)
      .max(MAX_TURN_DEADLINE_HOURS)
      .optional(),
    pairing: selection,
    requestId: z.uuid(),
    battlefieldVersion: z.literal(1),
  })
  .strict();
const field = z.string().max(128);
const form = z
  .object({
    scenario: id,
    side: id,
    rate: field,
    customRate: field,
    dial: z.enum(DIALS),
    persona: z.enum(PERSONAS),
    mode: z.enum(['realtime', 'turns']),
    turnMinutes: field,
    deadlineHours: field,
  })
  .strict();
const draft = z.object({ request, form, selection }).strict();
export interface PendingCreation {
  request: CreateRequest;
  form: Form;
  selection: { pairingId: string; revision: string };
}
/** Browser storage is untrusted; corruption must not silently authorize a new allocation. */
export function decodePendingCreation(text: string): PendingCreation {
  if (text.length > 32768) throw new Error('Pending creation exceeds limit');
  const value: unknown = JSON.parse(text);
  assertBattlefieldBudget(value, 32768);
  const parsed = draft.parse(value);
  const { request: r, form: f, selection: s } = parsed;
  if (
    s.pairingId !== r.pairing.pairingId ||
    s.revision !== r.pairing.revision ||
    f.scenario !== r.scenario ||
    f.side !== r.side ||
    f.dial !== r.dial ||
    f.persona !== r.persona ||
    f.mode !== (r.mode ?? 'realtime') ||
    rateOf(f) !== r.rate ||
    (f.mode === 'turns' &&
      (turnMinutesOf(f) !== r.turnMinutes ||
        deadlineHoursOf(f) === undefined ||
        deadlineHoursOf(f) !== (r.turnDeadlineHours ?? null))) ||
    (f.mode === 'realtime' && (r.turnMinutes !== undefined || r.turnDeadlineHours !== undefined))
  )
    throw new Error('Pending creation intent mismatch');
  return parsed;
}
