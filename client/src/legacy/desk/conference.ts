import type { SideView, StaffExchange } from '@kriegsspiel/protocol';
import type { LinkStatus, StaffCharge, StaffServerAnswer } from '../net/state.js';
import { formatGameTime } from '../net/state.js';
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
  /** The officer the umpire named in its answer: the real staff, in place of the fixture's name and traits. */
  officer?: { name: string; traits: readonly string[] };
  failed?: boolean;
  /** Set when the server is charging the cost: the id its reply carries, and the wall time it was sent. */
  questionId?: string;
  sentAtWall?: number;
  /** The server replied with no text: the fixture answers from the newest view once `answerAtGame` is reached. */
  textless?: boolean;
}

export const MAX_QUESTION_LENGTH = 400;

/** How long an exchange waits for the server's reply before it counts as lost (wall ms). */
export const SERVER_REPLY_TIMEOUT_MS = 15_000;

/** The next free exchange id: derived from the log, so it never depends on which mount asks. */
export const nextExchangeId = (log: readonly Exchange[]): number =>
  log.reduce((m, e) => Math.max(m, e.id), 0) + 1;

/** What the page knows about the server when it reconciles the log. */
export interface ServerStaffState {
  charges: Readonly<Record<string, StaffCharge>>;
  link: LinkStatus;
  /** Wall time of the last error that names no question (`game_closed`, `bad_message`). */
  faultAtWall?: number;
  nowWall: number;
}

/**
 * Settle the exchanges waiting on the server (`answerAtGame` is Infinity): take the cost from its
 * reply, fail the ones it refused, and fail any whose reply cannot come (link down, an unnamed
 * error since they were sent, or a timeout). Returns the same array when nothing changed.
 */
export function reconcileExchanges(
  log: readonly Exchange[],
  server: ServerStaffState,
): readonly Exchange[] {
  let changed = false;
  const next = log.map((e) => {
    if (e.answerAtGame !== Infinity || e.failed) return e;
    const c = e.questionId === undefined ? undefined : server.charges[e.questionId];
    let out: Exchange = e;
    if (c === 'refused') out = { ...e, failed: true };
    else if (c !== undefined)
      out = { ...e, askedAtGame: c.askedAtGame, answerAtGame: c.answerAtGame };
    else if (
      server.link !== 'open' ||
      (server.faultAtWall !== undefined &&
        e.sentAtWall !== undefined &&
        e.sentAtWall <= server.faultAtWall) ||
      (e.sentAtWall !== undefined && server.nowWall - e.sentAtWall >= SERVER_REPLY_TIMEOUT_MS)
    )
      out = { ...e, failed: true };
    if (out !== e) changed = true;
    return out;
  });
  return changed ? next : log;
}

/**
 * Give each exchange its answer from the umpire's reply (`staffAnswer`). A reply with no text (the
 * staff stage is off or failed) only marks the exchange `textless`: `settleTextless` builds its
 * answer once the answer is due, so it cites the newest reports. Returns the same array when
 * nothing changed.
 */
export function applyServerAnswers(
  log: readonly Exchange[],
  answers: Readonly<Record<string, StaffServerAnswer>>,
): readonly Exchange[] {
  let changed = false;
  const next = log.map((e) => {
    if (e.answer || e.textless || e.failed || e.questionId === undefined) return e;
    const a = answers[e.questionId];
    if (!a) return e;
    changed = true;
    if (a.text === undefined) return { ...e, textless: true };
    return {
      ...e,
      answer: { text: `${a.officer.name}: ${sirFirst(a.text)}`, basedOnGame: a.basedOnGame },
      officer: a.officer,
    };
  });
  return changed ? next : log;
}

/**
 * Take in the conference the server kept (`SideView.staffHistory`), so a reload or a reconnect
 * does not lose it. An exchange already in the log (by its question id) is left alone; the rest
 * are added with their officer and answer, or text-less when the stage gave no words (`textless`). One whose words were still withheld stays open and takes them from a later view. Returns the
 * same array when nothing changed.
 */
export function mergeStaffHistory(
  log: readonly Exchange[],
  history: readonly StaffExchange[] | undefined,
): readonly Exchange[] {
  const byId = new Map((history ?? []).map((h) => [h.questionId, h]));
  let changed = false;
  // An exchange kept before its answer was due carries no words yet; a later view brings them.
  const filled = log.map((e) => {
    const h = e.questionId === undefined ? undefined : byId.get(e.questionId);
    if (!h || h.text === undefined || e.answer || e.failed) return e;
    changed = true;
    const open = { ...e };
    delete open.textless;
    return {
      ...open,
      answer: {
        text: `${h.officer.name}: ${sirFirst(h.text)}`,
        basedOnGame: h.basedOnGame ?? h.askedAtGame,
      },
      officer: h.officer,
    };
  });
  const known = new Set(log.flatMap((e) => (e.questionId === undefined ? [] : [e.questionId])));
  const fresh = (history ?? []).filter((h) => !known.has(h.questionId));
  if (fresh.length === 0) return changed ? filled : log;
  let id = nextExchangeId(log);
  return [
    ...filled,
    ...fresh.map((h): Exchange => ({
      id: id++,
      role: h.role,
      question: h.question,
      askedAtGame: h.askedAtGame,
      answerAtGame: h.answerAtGame,
      questionId: h.questionId,
      officer: h.officer,
      // Words withheld until due leave the exchange open; only a stage that gave none is text-less.
      ...(h.text !== undefined
        ? {
            answer: {
              text: `${h.officer.name}: ${sirFirst(h.text)}`,
              basedOnGame: h.basedOnGame ?? h.askedAtGame,
            },
          }
        : h.textless
          ? { textless: true }
          : {}),
    })),
  ];
}

/**
 * Answer the text-less exchanges that are now due, from the view the page holds at `nowGame`, not
 * the one it held when the question went out. Returns the same array when nothing changed.
 */
export function settleTextless(
  log: readonly Exchange[],
  nowGame: number,
  view: SideView | undefined,
): readonly Exchange[] {
  let changed = false;
  const next = log.map((e) => {
    if (!e.textless || e.answer || e.failed || nowGame < e.answerAtGame) return e;
    changed = true;
    return {
      ...e,
      answer: fixtureAnswer(
        { role: e.role, question: e.question, askedAtGame: e.askedAtGame },
        view,
      ),
    };
  });
  return changed ? next : log;
}

/**
 * The officer for `role`: the one the umpire last named, else the one the server reports for the side
 * (`SideView.staffOfficers`, fixed per game), else the fixture. The fixture only shows offline, so the
 * name and traits do not change when the first answer or a reload brings the real ones (#342).
 */
export function officerFor(
  log: readonly Exchange[],
  role: ConferenceRole,
  officers?: Readonly<Partial<Record<ConferenceRole, { name: string; traits: readonly string[] }>>>,
): StaffMember {
  const named =
    [...log].reverse().find((e) => e.role === role && e.officer)?.officer ?? officers?.[role];
  return named ? { ...staffFor(role), ...named } : staffFor(role);
}

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

/**
 * Every officer addresses the commander the same way (#325): an answer opens "Sir, ...". An answer that already
 * does is left alone; otherwise the opening is added and the first word is lowered to fit.
 * Only "I" (and "I'm", "I'd"...) keeps its capital; an empty answer is returned as it is.
 */
export function sirFirst(text: string): string {
  const t = text.trim();
  if (!t || /^sir\b/i.test(t)) return t;
  const lower = /^I\b/.test(t) ? t : t[0]!.toLowerCase() + t.slice(1);
  return `Sir, ${lower}`;
}

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
      text: `${s.name}: ${sirFirst('We have no reports to go on yet.')}`,
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
      // A scout's report is word the side has received even when no contact stands in the tables.
      const scouts = view.dispatches
        .filter((d) => d.category === 'scouts' && d.sizeEstimate !== undefined)
        .sort((a, b) => b.receivedAtGame - a.receivedAtGame);
      if (scouts[0])
        lines.push(
          `The latest scouting word, received ${formatGameTime(scouts[0].receivedAtGame)}, is from ${scouts[0].from}: ${scouts[0].text}`,
        );
      if (!seen && view.lastKnownContacts.length === 0 && scouts.length === 0)
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
  const text = `${s.name}: ${sirFirst(voice(s, lines.join(' '), caveat))}`;
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
