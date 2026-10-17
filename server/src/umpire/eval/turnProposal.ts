/**
 * The structured-output schema for the adjudicate call (#398): D39's `TurnProposal` as a JSON
 * schema a model is asked to fill (Ollama `format`, Anthropic structured output, the exported
 * Claude Code prompt). What decides "passes the schema" is the zod `TurnProposal` in
 * `@kriegsspiel/protocol` (11.5, #401), so bounds the JSON schema cannot carry (string lengths,
 * the roll limit) are still checked.
 */
import { FORMATIONS } from '@kriegsspiel/engine';
import { TURN_ORDER_RESULTS, TURN_STATUSES } from '@kriegsspiel/protocol';
import type { JsonSchema } from '../umpireClient.js';

export { TurnProposal } from '@kriegsspiel/protocol';
export type { UnitOutcome } from '@kriegsspiel/protocol';

/** Radians (0 north, clockwise) to whole compass degrees in [0, 360). */
export const deg = (radians: number) => ((Math.round((radians * 180) / Math.PI) % 360) + 360) % 360;

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
    precedents: { type: 'array', items: str },
  },
  ['turn', 'units', 'observations', 'summary'],
);
