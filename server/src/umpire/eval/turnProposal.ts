/**
 * D39's `TurnProposal`, as the benchmark (#398, story 11.2) grades it. This is a copy of the zod
 * schema PR #414 (11.5) adds to `packages/protocol/src/turn.ts`; when that lands, import it from
 * `@kriegsspiel/protocol` and delete this file. The JSON schema below is what a model is asked
 * to fill (Ollama `format`, Anthropic structured output, the exported Claude Code prompt); the
 * zod schema is what decides "passes the schema", so bounds the JSON schema cannot carry
 * (string lengths, the roll limit) are still checked.
 */
import { z } from 'zod';
import { FORMATIONS } from '@kriegsspiel/engine';
import type { JsonSchema } from '../umpireClient.js';

export const TURN_ACCOUNT_MAX = 600;
export const TURN_SUMMARY_MAX = 2000;
export const TURN_ROLLS_MAX = 8;

export const TURN_STATUSES = ['active', 'broken', 'destroyed', 'captured'] as const;
export const TURN_ORDER_RESULTS = [
  'carried-out',
  'partly',
  'misread',
  'refused',
  'not-arrived',
] as const;

const coord = z.number().finite();

export const TurnContinuing = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('idle') }).strict(),
  z.object({ kind: z.literal('hold') }).strict(),
  z.object({ kind: z.literal('move'), x: coord, y: coord }).strict(),
]);

export const UnitOutcome = z
  .object({
    unitId: z.string().min(1),
    x: coord,
    y: coord,
    facingDeg: z.number().finite(),
    formation: z.enum(FORMATIONS),
    shape: z.array(z.tuple([coord, coord])).optional(),
    strength: z.number().finite(),
    morale: z.number().finite(),
    fatigue: z.number().finite().optional(),
    ammo: z.number().finite().optional(),
    status: z.enum(TURN_STATUSES),
    continuing: TurnContinuing,
    orders: z.array(
      z.object({ orderId: z.string().min(1), result: z.enum(TURN_ORDER_RESULTS) }).strict(),
    ),
    account: z.string().max(TURN_ACCOUNT_MAX),
    departure: z.string().max(TURN_ACCOUNT_MAX).optional(),
    rollIds: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type UnitOutcome = z.infer<typeof UnitOutcome>;

export const TurnObservation = z
  .object({
    side: z.string().min(1),
    unitId: z.string().min(1),
    by: z.string().min(1),
    when: z.enum(['start', 'end']),
  })
  .strict();
export type TurnObservation = z.infer<typeof TurnObservation>;

export const RollRequest = z
  .object({
    id: z.string().min(1),
    why: z.string().max(TURN_ACCOUNT_MAX),
    chance: z.number().gt(0).lt(1),
  })
  .strict();

export const TurnProposal = z
  .object({
    turn: z.number().int().positive(),
    units: z.array(UnitOutcome),
    observations: z.array(TurnObservation),
    rolls: z.array(RollRequest).max(TURN_ROLLS_MAX).optional(),
    summary: z.string().max(TURN_SUMMARY_MAX),
  })
  .strict();
export type TurnProposal = z.infer<typeof TurnProposal>;

const num = { type: 'number' };
const str = { type: 'string' };
const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

/** The structured-output schema for the adjudicate call (a subset every provider accepts). */
export const TURN_PROPOSAL_JSON_SCHEMA: JsonSchema = obj(
  {
    turn: { type: 'integer' },
    units: {
      type: 'array',
      items: obj(
        {
          unitId: str,
          x: num,
          y: num,
          facingDeg: num,
          formation: { type: 'string', enum: [...FORMATIONS] },
          strength: num,
          morale: num,
          fatigue: num,
          ammo: num,
          status: { type: 'string', enum: [...TURN_STATUSES] },
          continuing: obj(
            { kind: { type: 'string', enum: ['idle', 'hold', 'move'] }, x: num, y: num },
            ['kind'],
          ),
          orders: {
            type: 'array',
            items: obj(
              { orderId: str, result: { type: 'string', enum: [...TURN_ORDER_RESULTS] } },
              ['orderId', 'result'],
            ),
          },
          account: str,
          departure: str,
          rollIds: { type: 'array', items: str },
        },
        [
          'unitId',
          'x',
          'y',
          'facingDeg',
          'formation',
          'strength',
          'morale',
          'status',
          'continuing',
          'orders',
          'account',
        ],
      ),
    },
    observations: {
      type: 'array',
      items: obj(
        { side: str, unitId: str, by: str, when: { type: 'string', enum: ['start', 'end'] } },
        ['side', 'unitId', 'by', 'when'],
      ),
    },
    rolls: {
      type: 'array',
      items: obj({ id: str, why: str, chance: num }, ['id', 'why', 'chance']),
    },
    summary: str,
  },
  ['turn', 'units', 'observations', 'summary'],
);
