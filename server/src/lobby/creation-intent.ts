import { createHash } from 'node:crypto';
import {
  DEFAULT_TURN_MINUTES,
  DEFAULT_UMPIRE_DIAL,
  DEFAULT_UMPIRE_PERSONA,
  DIALS,
  PERSONAS,
  GAME_MODES,
  MIN_TURN_MINUTES,
  MAX_TURN_MINUTES,
  MIN_TURN_DEADLINE_HOURS,
  MAX_TURN_DEADLINE_HOURS,
  assertBattlefieldBudget,
} from '@kriegsspiel/protocol';
import { z } from 'zod';
import {
  DEFAULT_HOLD_MS,
  DEFAULT_HOLDS_PER_GAME,
  DEFAULT_HOLDS_PER_PLAYER,
  DEFAULT_VOTE_TIMEOUT_MS,
} from '../pause.js';
import { nativeCanonicalJson, type NativeScenarioPinV1 } from '../game/native-scenario-pin.js';
import { SESSION_TYPES } from './store.js';

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/);
const pairing = z
  .object({ pairingId: id, revision: z.string().regex(/^engine-pairing-v1:sha256:[a-f0-9]{64}$/) })
  .strict();
const pause = z
  .object({
    rule: z.enum(['unanimous', 'majority']),
    voteTimeoutMs: z.number().int().min(1000).max(3_600_000).optional(),
    holdMs: z.number().int().min(1000).max(3_600_000).optional(),
    holdsPerPlayer: z.number().int().min(0).max(20).optional(),
    holdsPerGame: z.number().int().min(0).max(100).optional(),
    maxPauseMs: z
      .number()
      .int()
      .min(1000)
      .max(7 * 86_400_000)
      .optional(),
  })
  .strict();

/** Not mounted on the API until receipt/pin/activation integration is accepted. */
export const CreationRequestSchema = z
  .object({
    scenario: id.optional(),
    rate: z.number().finite().min(0.01).max(86_400).optional(),
    side: z.enum(['blue', 'red']).optional(),
    sessionType: z.enum(SESSION_TYPES).optional(),
    pause: pause.optional(),
    dial: z.enum(DIALS).optional(),
    persona: z.enum(PERSONAS).optional(),
    mode: z.enum(GAME_MODES).optional(),
    turnMinutes: z.number().int().min(MIN_TURN_MINUTES).max(MAX_TURN_MINUTES).optional(),
    turnDeadlineHours: z
      .number()
      .finite()
      .min(MIN_TURN_DEADLINE_HOURS)
      .max(MAX_TURN_DEADLINE_HOURS)
      .optional(),
    hierarchy: z.enum(['shared', 'chain']).optional(),
    lobby: z.boolean().optional(),
    pairing: pairing.optional(),
    requestId: z.uuid().optional(),
    battlefieldVersion: z.literal(1).optional(),
  })
  .strict()
  .superRefine((request, ctx) => {
    if (request.pairing && (!request.requestId || request.battlefieldVersion !== 1))
      ctx.addIssue({
        code: 'custom',
        message: 'Pairing selection requires a request ID and battlefield capability 1',
      });
  });
export type CreationRequest = z.infer<typeof CreationRequestSchema>;
export function decodeCreationRequest(value: unknown): CreationRequest {
  assertBattlefieldBudget(value, 16 * 1024);
  return CreationRequestSchema.parse(value);
}

export const CreationDefaultsSchema = z
  .object({
    schemaVersion: z.literal(1),
    scenarioId: id,
    defaultPairing: pairing,
    sides: z
      .array(
        z
          .object({ id: z.enum(['blue', 'red']), controller: z.enum(['human', 'scripted']) })
          .strict(),
      )
      .length(2),
    aiAvailable: z.boolean(),
    sessionType: z.enum(SESSION_TYPES),
    rate: z.number().finite().min(0.01).max(86_400),
    dial: z.enum(DIALS),
    persona: z.enum(PERSONAS),
    turnMinutes: z.number().int().min(MIN_TURN_MINUTES).max(MAX_TURN_MINUTES),
    pause: z
      .object({
        voteTimeoutMs: z.number().int().min(1000).max(3_600_000),
        holdMs: z.number().int().min(1000).max(3_600_000),
        holdsPerPlayer: z.number().int().min(0).max(20),
        holdsPerGame: z.number().int().min(0).max(100),
      })
      .strict(),
  })
  .strict();
export type CreationDefaults = z.infer<typeof CreationDefaultsSchema>;

/** Capture once at durable acceptance; retries must use this context, never latest defaults. */
export function creationDefaults(
  defaultPin: NativeScenarioPinV1,
  aiAvailable: boolean,
): CreationDefaults {
  if (!defaultPin.battlefield.isDefault)
    throw new Error('Creation defaults require a default pairing');
  return CreationDefaultsSchema.parse({
    schemaVersion: 1,
    scenarioId: defaultPin.publicScenarioId,
    defaultPairing: {
      pairingId: defaultPin.battlefield.pairing.id,
      revision: defaultPin.battlefield.pairing.revision,
    },
    sides: defaultPin.initialWorld.sides.map((side) => ({
      id: side.id,
      controller: side.controller,
    })),
    aiAvailable,
    sessionType: aiAvailable ? 'co_op_vs_ai' : 'team_vs_team',
    rate: 1,
    dial: DEFAULT_UMPIRE_DIAL,
    persona: DEFAULT_UMPIRE_PERSONA,
    turnMinutes: DEFAULT_TURN_MINUTES,
    pause: {
      voteTimeoutMs: DEFAULT_VOTE_TIMEOUT_MS,
      holdMs: DEFAULT_HOLD_MS,
      holdsPerPlayer: DEFAULT_HOLDS_PER_PLAYER,
      holdsPerGame: DEFAULT_HOLDS_PER_GAME,
    },
  });
}

/** No registry/time/policy reads: also suitable for comparing a retry against its accepted context. */
export function normalizeCreationIntent(request: CreationRequest, context: CreationDefaults) {
  const sessionType = request.sessionType ?? context.sessionType;
  const sides = context.sides.filter(
    (side) => sessionType !== 'co_op_vs_ai' || side.controller !== 'scripted',
  );
  const defaultSide = sides[0]?.id ?? context.sides[0]!.id;
  const side = sessionType === 'hot_seat' ? defaultSide : (request.side ?? defaultSide);
  const mode = request.mode ?? 'realtime';
  const result = {
    normalizerVersion: 1 as const,
    scenario: request.scenario ?? context.scenarioId,
    pairing: { ...(request.pairing ?? context.defaultPairing) },
    side,
    sessionType,
    rate: request.rate ?? context.rate,
    dial: request.dial ?? context.dial,
    persona: request.persona ?? context.persona,
    mode,
    turnMinutes: mode === 'turns' ? (request.turnMinutes ?? context.turnMinutes) : null,
    turnDeadlineHours: mode === 'turns' ? (request.turnDeadlineHours ?? null) : null,
    hierarchy: request.hierarchy ?? 'shared',
    lobby: request.lobby ?? false,
    pause: request.pause
      ? {
          rule: request.pause.rule,
          voteTimeoutMs: request.pause.voteTimeoutMs ?? context.pause.voteTimeoutMs,
          holdMs: request.pause.holdMs ?? context.pause.holdMs,
          holdsPerPlayer: request.pause.holdsPerPlayer ?? context.pause.holdsPerPlayer,
          holdsPerGame: request.pause.holdsPerGame ?? context.pause.holdsPerGame,
          maxPauseMs: request.pause.maxPauseMs ?? null,
        }
      : null,
  };
  assertBattlefieldBudget(result, 16 * 1024);
  return result;
}
export type CreationIntent = ReturnType<typeof normalizeCreationIntent>;

/** New acceptance only. An accepted receipt retry compares intent before applying latest policy. */
export function validateNewCreationIntent(intent: CreationIntent, context: CreationDefaults): void {
  if (intent.scenario !== context.scenarioId) throw new Error('bad_scenario');
  if (intent.sessionType === 'co_op_vs_ai' && !context.aiAvailable)
    throw new Error('no_ai_opponent');
  const sides = context.sides.filter(
    (side) => intent.sessionType !== 'co_op_vs_ai' || side.controller !== 'scripted',
  );
  if (!sides.length) throw new Error('bad_session');
  if (!sides.some((side) => side.id === intent.side)) throw new Error('bad_side');
}

export function creationIntentFingerprint(intent: CreationIntent): string {
  assertBattlefieldBudget(intent, 16 * 1024);
  return `game-creation-intent-v1:sha256:${createHash('sha256').update(nativeCanonicalJson(intent)).digest('hex')}`;
}
