import type { SideView } from '@kriegsspiel/protocol';
import { formatAge, pct } from './roster.js';

/** The four officers the player can consult (docs/hq-interface.md, "Staff conference"). */
export const CONFERENCE_ROLES = [
  'chiefOfStaff',
  'intelligence',
  'quartermaster',
  'engineer',
] as const;
export type ConferenceRole = (typeof CONFERENCE_ROLES)[number];

export interface StaffMember {
  role: ConferenceRole;
  title: string;
  name: string;
  /** Personality traits, shown to the player: they colour the advice. */
  traits: readonly string[];
  /** Game time a question takes this officer to answer. */
  costMs: number;
}

/** The fixture staff, used until the server reports the real officers (docs/staff-conference.md). */
export const FIXTURE_STAFF: readonly StaffMember[] = [
  {
    role: 'chiefOfStaff',
    title: 'Chief of staff',
    name: 'Colonel Fonteyn',
    traits: ['meticulous', 'cautious'],
    costMs: 10 * 60_000,
  },
  {
    role: 'intelligence',
    title: 'Intelligence officer',
    name: 'Major Dessau',
    traits: ['sceptical', 'terse'],
    costMs: 15 * 60_000,
  },
  {
    role: 'quartermaster',
    title: 'Quartermaster',
    name: 'Captain Brandt',
    traits: ['cautious', 'long-winded'],
    costMs: 10 * 60_000,
  },
  {
    role: 'engineer',
    title: 'Engineer',
    name: 'Major Girard',
    traits: ['bold', 'trusting'],
    costMs: 20 * 60_000,
  },
];

/** A question put to one officer. `askedAtGame` is the local game time when it was put. */
export interface ConferenceRequest {
  role: ConferenceRole;
  question: string;
  askedAtGame: number;
}

/** The officer's reply. Built only from the asking side's SideView; `basedOnGame` dates that view. */
export interface ConferenceAnswer {
  text: string;
  basedOnGame: number;
}

/** What the UI needs from a source of answers: the fixture below, or the server endpoint later. */
export interface ConferenceClient {
  ask(req: ConferenceRequest, view: SideView | undefined): Promise<ConferenceAnswer>;
}

/** One exchange in the conference log. The answer shows once game time reaches `answerAtGame`. */
export interface Exchange {
  id: number;
  role: ConferenceRole;
  question: string;
  askedAtGame: number;
  answerAtGame: number;
  answer?: ConferenceAnswer;
  failed?: boolean;
}

export const MAX_QUESTION_LENGTH = 400;

export const staffFor = (
  role: ConferenceRole,
  staff: readonly StaffMember[] = FIXTURE_STAFF,
): StaffMember => staff.find((s) => s.role === role) ?? FIXTURE_STAFF[0]!;

/** An exchange still waiting on its officer: asked, but not yet answered at `nowGame`. */
export const isPending = (e: Exchange, nowGame: number): boolean =>
  e.failed !== true && (e.answer === undefined || nowGame < e.answerAtGame);

/** The officer is busy while any question to them is pending, so questions cannot be stacked for free. */
export function busy(log: readonly Exchange[], role: ConferenceRole, nowGame: number): boolean {
  return log.some((e) => e.role === role && isPending(e, nowGame));
}

/** `10 min` of game time, the same at every clock rate. */
export const formatCost = (ms: number): string => formatAge(ms);

const list = (xs: string[]): string =>
  xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;

/** Terse officers say less; the rest add a note of caution or confidence. */
function voice(s: StaffMember, body: string, caveat: string): string {
  if (s.traits.includes('terse')) return body;
  const tone =
    s.traits.includes('cautious') || s.traits.includes('sceptical')
      ? caveat
      : 'I would not wait on it.';
  return `${body} ${tone}`;
}

/**
 * A canned answer from what the side's view holds and nothing else. It names only units and
 * contacts that are in `view`; where the view is silent it says so, never inventing a figure.
 */
export function fixtureAnswer(
  req: ConferenceRequest,
  view: SideView | undefined,
  staff: readonly StaffMember[] = FIXTURE_STAFF,
): ConferenceAnswer {
  const s = staffFor(req.role, staff);
  if (!view)
    return {
      text: `${s.name}: We have no reports to go on yet, sir.`,
      basedOnGame: req.askedAtGame,
    };
  const own = view.ownUnits;
  const lines: string[] = [];
  let caveat = 'Things may have changed since.';
  switch (req.role) {
    case 'chiefOfStaff': {
      lines.push(
        own.length
          ? `We have ${own.length} formation${own.length === 1 ? '' : 's'} reporting: ${list(own.map((u) => u.name))}.`
          : 'No formations are reporting.',
      );
      lines.push(
        `${view.visibleEnemies.length} enemy in sight, ${view.lastKnownContacts.length} older contact${view.lastKnownContacts.length === 1 ? '' : 's'}.`,
      );
      const dated = view.dispatches.length;
      lines.push(`${dated} dispatch${dated === 1 ? '' : 'es'} received so far.`);
      break;
    }
    case 'intelligence': {
      const seen = view.visibleEnemies.length;
      lines.push(
        seen
          ? `${seen} enemy unit${seen === 1 ? ' is' : 's are'} in sight now.`
          : 'No enemy is in sight now.',
      );
      for (const c of view.lastKnownContacts.slice(0, 3)) {
        lines.push(
          `A contact seen ${formatAge(c.ageMs)} ago${c.sizeEstimate ? `, ${c.sizeEstimate}` : ''}, may be anywhere within ${Math.round(c.uncertaintyRadius)} m of where it was seen.`,
        );
      }
      if (!seen && view.lastKnownContacts.length === 0)
        lines.push('We know nothing of their whereabouts.');
      caveat = 'Old sightings are only as good as the men who made them.';
      break;
    }
    case 'quartermaster': {
      const low = own.filter((u) => u.supply !== undefined && u.supply < 0.4);
      for (const u of own) {
        lines.push(
          u.supply === undefined
            ? `${u.name}: supply unknown.`
            : `${u.name}: supply ${pct(u.supply)}%.`,
        );
      }
      lines.push(
        low.length
          ? `${list(low.map((u) => u.name))} ${low.length === 1 ? 'is' : 'are'} running short.`
          : 'Nobody is short yet.',
      );
      if (!own.length) lines.push('I have no returns to report.');
      caveat = 'Returns lag behind the men on the road.';
      break;
    }
    case 'engineer': {
      lines.push(
        'I cannot judge roads, bridges or fords from these reports; I have no survey of the ground before me.',
      );
      if (own.length)
        lines.push(
          `I can say where ${list(own.map((u) => u.name))} stand, but not what lies between them.`,
        );
      caveat = 'Send word if you want the ground surveyed.';
      break;
    }
  }
  const text = `${s.name}: ${voice(s, lines.join(' '), caveat)}`;
  return { text, basedOnGame: view.atGame };
}

/** The fixture client: answers at once from `fixtureAnswer`. The delay in game time is applied by the UI. */
export const fixtureClient: ConferenceClient = {
  ask: (req, view) => Promise.resolve(fixtureAnswer(req, view)),
};

/** Start an exchange: it is answered `costMs` of game time after it was asked. */
export function newExchange(
  id: number,
  req: ConferenceRequest,
  staff: readonly StaffMember[] = FIXTURE_STAFF,
): Exchange {
  return {
    id,
    role: req.role,
    question: req.question.trim(),
    askedAtGame: req.askedAtGame,
    answerAtGame: req.askedAtGame + staffFor(req.role, staff).costMs,
  };
}

/** Why a question cannot be put, or undefined when it can. */
export function questionProblem(
  question: string,
  role: ConferenceRole,
  log: readonly Exchange[],
  nowGame: number,
): string | undefined {
  const q = question.trim();
  if (q === '') return 'Write a question first.';
  if (q.length > MAX_QUESTION_LENGTH)
    return `Keep the question under ${MAX_QUESTION_LENGTH} characters.`;
  if (busy(log, role, nowGame))
    return `${staffFor(role).name} is still answering your last question.`;
  return undefined;
}
