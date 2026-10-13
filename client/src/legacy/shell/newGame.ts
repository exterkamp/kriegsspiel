/** Pure rules for the new-game form: state, validation and the request it makes. The DOM lives in NewGame.svelte. */
import {
  DEFAULT_TURN_MINUTES,
  DEFAULT_UMPIRE_DIAL,
  DEFAULT_UMPIRE_PERSONA,
  DIALS,
  DIAL_INFO,
  MAX_TURN_DEADLINE_HOURS,
  MAX_TURN_MINUTES,
  MIN_TURN_DEADLINE_HOURS,
  MIN_TURN_MINUTES,
  PERSONAS,
  PERSONA_INFO,
  type GameMode,
  type UmpireDial,
  type UmpirePersona,
} from '@kriegsspiel/protocol';
import { MAX_RATE, MIN_RATE, RATE_PRESETS, parseRate } from '../lobby/model.js';

export interface ScenarioInfo {
  id: string;
  name: string;
  briefing: string;
  lengthMinutes: number;
  sides: Array<{ id: string; name: string; controller: 'human' | 'scripted' }>;
  defaults: { side: string; rate: number };
}

/** Who plays a side nobody sits at; undefined when the server has no computer opponent. */
export type Opponent = 'scripted' | 'ai_commander' | undefined;

export interface ScenarioOptions {
  scenarios: ScenarioInfo[];
  opponent: Opponent;
}

export interface Form {
  scenario: string;
  side: string;
  /** A preset's number as text, or `custom`. */
  rate: string;
  customRate: string;
  /** Rigid-to-free dial (3.11). */
  dial: UmpireDial;
  /** The umpire's voice (3.11). */
  persona: UmpirePersona;
  /** Real time on the running clock, or turns the umpire decides (D39). */
  mode: GameMode;
  /** Turn mode: game minutes per turn, as typed. */
  turnMinutes: string;
  /** Turn mode: wall-clock hours each turn waits for orders, as typed; empty waits for every side. */
  deadlineHours: string;
}

export interface CreateRequest {
  scenario: string;
  side: string;
  rate: number;
  dial: UmpireDial;
  persona: UmpirePersona;
  sessionType?: 'co_op_vs_ai';
  /** Present only for a turn-mode game, so a real-time request is unchanged. */
  mode?: 'turns';
  turnMinutes?: number;
  turnDeadlineHours?: number;
}

/** Sides the player may take: with a computer opponent, only those the scenario does not script. */
export function allowedSides(s: ScenarioInfo, opponent: Opponent): ScenarioInfo['sides'] {
  if (!opponent) return s.sides;
  const human = s.sides.filter((x) => x.controller === 'human');
  return human.length > 0 ? human : s.sides;
}

/** First scenario, its default side, and its default rate (12:1 unless the scenario says otherwise). */
export function initialForm(o: ScenarioOptions): Form | undefined {
  const s = o.scenarios[0];
  if (!s) return undefined;
  return formFor(s, o.opponent);
}

function formFor(s: ScenarioInfo, opponent: Opponent): Form {
  const sides = allowedSides(s, opponent);
  const side = sides.find((x) => x.id === s.defaults.side) ?? sides[0]!;
  const preset = (RATE_PRESETS as readonly number[]).includes(s.defaults.rate);
  return {
    scenario: s.id,
    side: side.id,
    rate: preset ? String(s.defaults.rate) : 'custom',
    customRate: preset ? '' : String(s.defaults.rate),
    dial: DEFAULT_UMPIRE_DIAL,
    persona: DEFAULT_UMPIRE_PERSONA,
    mode: 'realtime',
    turnMinutes: String(DEFAULT_TURN_MINUTES),
    deadlineHours: '',
  };
}

/** Switching scenario resets the side and rate to that scenario's defaults. */
export function chooseScenario(o: ScenarioOptions, id: string, keep?: Form): Form | undefined {
  const s = o.scenarios.find((x) => x.id === id);
  if (!s) return undefined;
  const next = formFor(s, o.opponent);
  // The umpire's dial and persona, and how the game is played, are the player's taste, not the scenario's.
  return keep
    ? {
        ...next,
        dial: keep.dial,
        persona: keep.persona,
        mode: keep.mode,
        turnMinutes: keep.turnMinutes,
        deadlineHours: keep.deadlineHours,
      }
    : next;
}

export const DIAL_CHOICES = DIALS.map((id) => ({ id, ...DIAL_INFO[id] }));

/** What the dial means in a turn-mode game, where it picks who decides the turn (D39). */
export const TURN_DIAL_INFO: Readonly<Record<UmpireDial, string>> = {
  rigid:
    'The tables alone decide each turn, with no umpire: the real-time rules played in fixed steps.',
  standard:
    'The umpire decides each turn, starting from what the tables would give and departing from them only for a stated reason.',
  free: 'The umpire decides each turn as a free-Kriegsspiel umpire would, with the tables as advice only.',
};

export const MODE_CHOICES: ReadonlyArray<{ id: GameMode; label: string; description: string }> = [
  {
    id: 'realtime',
    label: 'Real time',
    description:
      'The clock runs at the rate you choose; orders ride by courier while the battle goes on.',
  },
  {
    id: 'turns',
    label: 'Turns, umpire decides',
    description:
      'Each side writes its orders for a slice of time and sends them together; nothing moves until the turn is decided. Take as long as you like, or set a deadline.',
  },
];

/** Game minutes per turn, or undefined when the text is not a whole number in range. */
export function turnMinutesOf(f: Pick<Form, 'turnMinutes'>): number | undefined {
  const n = Number(f.turnMinutes.trim());
  return Number.isInteger(n) && n >= MIN_TURN_MINUTES && n <= MAX_TURN_MINUTES ? n : undefined;
}

/** The deadline in hours; null for none (empty), undefined when the text is unusable. */
export function deadlineHoursOf(f: Pick<Form, 'deadlineHours'>): number | null | undefined {
  const t = f.deadlineHours.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= MIN_TURN_DEADLINE_HOURS && n <= MAX_TURN_DEADLINE_HOURS
    ? n
    : undefined;
}

/** "About 4 hours of battle in 12 turns of 20 minutes." */
export function turnsLine(lengthMinutes: number, turnMinutes: number | undefined): string {
  if (lengthMinutes <= 0) return '';
  const battle = `About ${span(lengthMinutes)} of battle`;
  if (!turnMinutes) return `${battle}.`;
  const n = Math.ceil(lengthMinutes / turnMinutes);
  return `${battle} in ${n} ${n === 1 ? 'turn' : 'turns'} of ${span(turnMinutes)}.`;
}
export const PERSONA_CHOICES = PERSONAS.map((id) => ({ id, ...PERSONA_INFO[id] }));

/** The chosen clock rate, or undefined when a custom value is unusable. */
export function rateOf(f: Form): number | undefined {
  return parseRate(f.rate === 'custom' ? f.customRate : f.rate);
}

function span(minutes: number): string {
  if (minutes < 1) {
    const sec = Math.max(1, Math.round(minutes * 60));
    return sec === 1 ? 'one second' : `${sec} seconds`;
  }
  if (minutes < 120) {
    const m = Math.round(minutes);
    return m === 1 ? 'one minute' : `${m} minutes`;
  }
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} hours`;
}

/** "12:1 means one hour of battle passes in five minutes." */
export function rateExplanation(rate: number): string {
  const m = 60 / rate;
  const five = m === 5 ? 'five minutes' : span(m);
  return rate === 1
    ? '1:1 is real time: one hour of battle takes an hour.'
    : `${rate}:1 means one hour of battle passes in ${five}.`;
}

/** Plain-language length: "about 4 hours of battle, 20 minutes at this rate". */
export function lengthLine(lengthMinutes: number, rate: number | undefined): string {
  if (lengthMinutes <= 0) return '';
  const battle = `About ${span(lengthMinutes)} of battle`;
  return rate ? `${battle}, ${span(lengthMinutes / rate)} at this rate.` : `${battle}.`;
}

/** Why the form cannot be sent, or undefined when it can. */
export function validate(f: Form, o: ScenarioOptions): string | undefined {
  const s = o.scenarios.find((x) => x.id === f.scenario);
  if (!s) return 'Choose a scenario.';
  if (!allowedSides(s, o.opponent).some((x) => x.id === f.side)) return 'Choose a side.';
  if (f.mode === 'turns') {
    if (turnMinutesOf(f) === undefined)
      return `A turn must be a whole number of minutes from ${MIN_TURN_MINUTES} to ${MAX_TURN_MINUTES}.`;
    if (deadlineHoursOf(f) === undefined)
      return `The deadline must be from ${MIN_TURN_DEADLINE_HOURS} to ${MAX_TURN_DEADLINE_HOURS} hours, or empty for none.`;
    return undefined;
  }
  if (rateOf(f) === undefined) {
    return `Clock rate must be a number from ${MIN_RATE} to ${MAX_RATE}, for example 12 or 12:1.`;
  }
  return undefined;
}

/** The turn settings of the request, for a turn-mode form; empty for real time. */
export function turnRequest(
  f: Pick<Form, 'mode' | 'turnMinutes' | 'deadlineHours'>,
): Pick<CreateRequest, 'mode' | 'turnMinutes' | 'turnDeadlineHours'> {
  if (f.mode !== 'turns') return {};
  const minutes = turnMinutesOf(f);
  const hours = deadlineHoursOf(f);
  return {
    mode: 'turns',
    ...(minutes === undefined ? {} : { turnMinutes: minutes }),
    ...(hours === null || hours === undefined ? {} : { turnDeadlineHours: hours }),
  };
}

export function toRequest(f: Form, o: ScenarioOptions): CreateRequest {
  return {
    scenario: f.scenario,
    side: f.side,
    // A turn-mode game ignores the rate (D39); a usable one is still sent, as the server expects a number.
    rate: rateOf(f) ?? 1,
    dial: f.dial,
    persona: f.persona,
    ...(o.opponent ? { sessionType: 'co_op_vs_ai' as const } : {}),
    ...turnRequest(f),
  };
}

export const OPPONENT_LABEL: Record<NonNullable<Opponent>, string> = {
  scripted: 'A computer opponent plays the other side.',
  ai_commander: 'An AI commander plays the other side.',
};

const MESSAGES: Record<string, string> = {
  not_signed_in: 'You are signed out. Sign in again, then press Start.',
  bad_request: 'The server did not accept those options. Check the clock rate.',
  bad_scenario: 'That scenario is no longer available. Choose another.',
  bad_side: 'That side is not available in this scenario. Choose another.',
  no_ai_opponent: 'This server has no computer opponent.',
  start_failed: 'The server could not start the game. Try again in a moment.',
};

/** A readable message for a failed create, from the server's `error` code or HTTP status. */
export function createErrorMessage(status: number, code: string, detail?: string): string {
  if (MESSAGES[code]) return MESSAGES[code];
  if (status === 401) return MESSAGES.not_signed_in!;
  if (status === 429 || /limit/.test(code)) {
    return 'You have reached the limit on games. Finish or leave one, then try again.';
  }
  return detail
    ? `Could not start the game: ${detail}`
    : `Could not start the game (${code || status}).`;
}
