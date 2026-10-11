/**
 * The `staff` stage: staff officers (the LLM, with personality traits) fill the roles no human
 * holds, so a one-human side still has a full staff (D6, docs/gameplay.md "Multiplayer
 * collaborative mode").
 *
 * An officer sees only what `viewForRole` gives their seat, and may only send reports, draft
 * suggestions and give advice. A suggestion is a draft text for a unit the seat may draft for
 * (`mayDraft`); an officer never signs, so nothing they write is an order. A human can claim a
 * seat at any time, and the officer then goes quiet, even for a reply still in flight.
 */
import { MS_PER_MINUTE, ROLES, mayDraft, viewForRole } from '@kriegsspiel/engine';
import type { EngineRoleView, GameState, Role, Seat, SideId } from '@kriegsspiel/engine';
import type { JsonSchema, UmpireClient } from './umpireClient.js';
import { UmpireError } from './umpireClient.js';
import { narrateWindowMs } from './narrate.js';

export const STAFF_PROMPT_VERSION = 'staff-officer-v1';

export const STAFF_SYSTEM = `You are a staff officer at a Napoleonic army headquarters, standing in for an absent colleague. Input: "officer" (your name, your "role" and your personality "traits"), "view" (everything your post can see, and nothing else), and "now" (game minutes). Optionally "rejected", the problems with your last reply.

Rules:
- Write in your own voice, shaped by your traits, as a short note to the commander.
- Use only what is in "view". Do not invent units, places, numbers or events. Where information is thin or doubtful, say so.
- Stay inside your role: the chief of staff coordinates and spots gaps; the intelligence officer weighs enemy information; the quartermaster warns of shortages and fatigue; a subordinate commander speaks for their own units; a deputy commander advises but cannot sign.
- Each message has a "kind": "report" (what you observe), "suggestion" (draft wording for an order to one unit, given in "unitId" for a unit of "view.ownUnits"), or "advice" (a warning or judgement). You cannot sign or send orders. The commander does that.
- Send nothing unless you have something useful to say: an empty "messages" list is fine.
Reply with the JSON object only.`;

export const STAFF_MESSAGE_KINDS = ['report', 'suggestion', 'advice'] as const;
export type StaffMessageKind = (typeof STAFF_MESSAGE_KINDS)[number];

export const STAFF_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    messages: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...STAFF_MESSAGE_KINDS] },
          unitId: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['kind', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['messages'],
  additionalProperties: false,
};

export interface StaffOutput {
  messages: Array<{ kind: StaffMessageKind; unitId?: string; text: string }>;
}

/** A staff officer: who stands in for a role, and how they carry it. */
export interface StaffOfficer {
  name: string;
  role: Role;
  traits: string[];
}

const NAMES = [
  'Major Aldous',
  'Captain Brandt',
  'Colonel Cavel',
  'Major Dessau',
  'Captain Evrard',
  'Colonel Fonteyn',
  'Major Girard',
  'Captain Halvorsen',
];
const TRAIT_PAIRS: Array<[string, string]> = [
  ['cautious', 'bold'],
  ['meticulous', 'hasty'],
  ['terse', 'long-winded'],
  ['sceptical', 'trusting'],
];

/** Small deterministic hash, so an officer is the same in every replay of a game. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The officer for `role` in a game with `seed`. Pure: same seed and role, same officer. */
export function staffOfficer(seed: number, side: SideId, role: Role, ordinal = 0): StaffOfficer {
  const h = hash(`${seed}|${side}|${role}|${ordinal}`);
  const picks = TRAIT_PAIRS.map(([a, b], i) => (((h >>> i) & 1) === 0 ? a : b)).slice(0, 3);
  return { name: NAMES[h % NAMES.length]!, role, traits: picks };
}

export interface StaffSeat extends Seat {
  /** Who holds the seat. Absent: a staff officer plays it. */
  human?: string;
}

/**
 * The seats of one side's table, and which of them a human holds. A seat with no human is played
 * by a staff officer. `claim` and `release` can be called at any time; each bumps the seat's
 * generation so that a reply written for the old holder can be recognised and dropped.
 */
export class StaffRoster {
  private readonly seats: StaffSeat[];
  private readonly generations = new Map<StaffSeat, number>();
  private readonly lastSpoke = new Map<StaffSeat, number>();

  /**
   * `seats` defaults to one of each non-subordinate role. Add `{ role: 'subordinate', units }`
   * seats for each wing or division command.
   */
  constructor(
    readonly side: SideId,
    seats: readonly Seat[] = ROLES.filter((r) => r !== 'subordinate').map((role) => ({ role })),
  ) {
    this.seats = seats.map((s) => ({ ...s, ...(s.units ? { units: [...s.units] } : {}) }));
  }

  all(): readonly StaffSeat[] {
    return this.seats;
  }

  /** Seats no human holds, which staff officers play. */
  vacant(): StaffSeat[] {
    return this.seats.filter((s) => s.human === undefined);
  }

  private find(role: Role, units?: readonly string[]): StaffSeat | undefined {
    const withRole = this.seats.filter((s) => s.role === role);
    if (role !== 'subordinate' || !units) return withRole[0];
    return withRole.find((s) => units.every((u) => s.units?.includes(u)));
  }

  /** A human takes over a seat. Returns false if no such seat exists or it is already held. */
  claim(role: Role, human: string, units?: readonly string[]): boolean {
    const seat = this.find(role, units);
    if (!seat || seat.human !== undefined) return false;
    seat.human = human;
    this.generations.set(seat, (this.generations.get(seat) ?? 0) + 1);
    return true;
  }

  /** A human leaves a seat, and a staff officer takes it up again. */
  release(role: Role, human: string, units?: readonly string[]): boolean {
    const seat = this.find(role, units);
    if (!seat || seat.human !== human) return false;
    delete seat.human;
    this.generations.set(seat, (this.generations.get(seat) ?? 0) + 1);
    return true;
  }

  generation(seat: StaffSeat): number {
    return this.generations.get(seat) ?? 0;
  }

  lastSpokeAt(seat: StaffSeat): number {
    return this.lastSpoke.get(seat) ?? Number.NEGATIVE_INFINITY;
  }

  markSpoke(seat: StaffSeat, at: number): void {
    this.lastSpoke.set(seat, at);
  }
}

/** One note from a staff officer. `unitId` is set on a suggestion, which is draft text only. */
export interface StaffMessage {
  from: string;
  role: Role;
  kind: StaffMessageKind;
  unitId?: string;
  text: string;
  /** Game ms when it was written. */
  at: number;
}

export interface StaffTurn {
  role: Role;
  officer: StaffOfficer;
  messages: StaffMessage[];
  /** True when no usable reply came and the officer said nothing. */
  silent: boolean;
  calls: number;
  rejections: string[][];
}

/** What the model sees: the officer, and the seat's own view. Nothing more. */
export function staffInput(officer: StaffOfficer, view: EngineRoleView, now: number) {
  const rest: Omit<EngineRoleView, 'role'> & { role?: Role } = { ...view };
  delete rest.role;
  return {
    officer: { name: officer.name, role: officer.role, traits: officer.traits },
    now: Math.round(now / MS_PER_MINUTE),
    view: rest,
  };
}

const ID_PATTERN = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/gi;

/** The problems with a reply, against the seat's view. Empty means it passes. */
export function checkStaffOutput(
  output: StaffOutput,
  world: GameState,
  side: SideId,
  seat: Seat,
  input: ReturnType<typeof staffInput>,
): string[] {
  const known = new Set(
    (JSON.stringify(input.view).match(ID_PATTERN) ?? []).map((s) => s.toLowerCase()),
  );
  const own = new Set(input.view.ownUnits.map((u) => u.id));
  const problems: string[] = [];
  for (const m of output.messages) {
    if (m.text.trim() === '') problems.push('empty message');
    for (const id of m.text.match(ID_PATTERN) ?? []) {
      if (!known.has(id.toLowerCase())) problems.push(`unknown entity "${id}"`);
    }
    if (m.kind === 'suggestion') {
      if (!m.unitId) problems.push('suggestion without a unitId');
      else if (!own.has(m.unitId) || !mayDraft(world, side, seat, m.unitId)) {
        problems.push(`cannot draft for "${m.unitId}"`);
      }
    } else if (m.unitId !== undefined) {
      problems.push(`${m.kind} must not name a unitId`);
    }
  }
  return [...new Set(problems)];
}

export interface StaffOptions {
  /** Model calls allowed per officer per turn, the first included. Default 2. */
  maxCalls?: number;
  /** Clock rate, for the speaking interval. Default 1. */
  rate?: number;
  /** Game ms in the world. Default `world.time`. */
  now?: number;
}

/**
 * Let every officer standing in for a vacant seat speak, if their turn is due. An officer is due
 * when a narration window (`narrateWindowMs`) has passed since they last spoke. Each officer
 * is called with their seat's view alone. A reply that breaks `checkStaffOutput` is rejected
 * and asked again, up to `maxCalls`, after which the officer is silent. If a human claims the
 * seat while the call is out, the reply is discarded. The call is made for the seat as it
 * stood, so the world is never changed here.
 */
export async function runStaff(
  client: UmpireClient,
  world: GameState,
  roster: StaffRoster,
  opts: StaffOptions = {},
): Promise<StaffTurn[]> {
  const now = opts.now ?? world.time;
  const window = narrateWindowMs(opts.rate ?? 1);
  const maxCalls = opts.maxCalls ?? 2;
  const side = roster.side;
  const due = roster.vacant().filter((s) => now >= roster.lastSpokeAt(s) + window);
  return Promise.all(
    due.map(async (seat): Promise<StaffTurn> => {
      const ordinal = roster
        .all()
        .filter((s) => s.role === seat.role)
        .indexOf(seat);
      const officer = staffOfficer(world.seed, side, seat.role, ordinal);
      const gen = roster.generation(seat);
      const view = viewForRole(world, side, seat, now);
      const input = staffInput(officer, view, now);
      const turn: StaffTurn = {
        role: seat.role,
        officer,
        messages: [],
        silent: true,
        calls: 0,
        rejections: [],
      };
      roster.markSpoke(seat, now);
      while (turn.calls < maxCalls) {
        turn.calls++;
        const retry = turn.rejections.at(-1);
        let output: StaffOutput;
        try {
          ({ output } = await client.call<StaffOutput>({
            stage: 'staff',
            promptVersion: STAFF_PROMPT_VERSION,
            system: STAFF_SYSTEM,
            input: retry ? { ...input, rejected: retry } : input,
            schema: STAFF_SCHEMA,
          }));
        } catch (e) {
          if (e instanceof UmpireError) return turn;
          throw e;
        }
        if (roster.generation(seat) !== gen || seat.human !== undefined) {
          // A human took the seat while the officer was thinking.
          return { ...turn, messages: [] };
        }
        const problems = checkStaffOutput(output, world, side, seat, input);
        if (problems.length === 0) {
          turn.messages = output.messages.map((m) => ({
            from: officer.name,
            role: seat.role,
            kind: m.kind,
            ...(m.unitId === undefined ? {} : { unitId: m.unitId }),
            text: m.text.trim(),
            at: now,
          }));
          turn.silent = false;
          return turn;
        }
        turn.rejections.push(problems);
      }
      return turn;
    }),
  );
}
