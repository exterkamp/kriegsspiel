/** Pure rules for the new-game form: state, validation and the request it makes. The DOM lives in NewGame.svelte. */
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
}

export interface CreateRequest {
  scenario: string;
  side: string;
  rate: number;
  sessionType?: 'co_op_vs_ai';
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
  };
}

/** Switching scenario resets the side and rate to that scenario's defaults. */
export function chooseScenario(o: ScenarioOptions, id: string): Form | undefined {
  const s = o.scenarios.find((x) => x.id === id);
  return s ? formFor(s, o.opponent) : undefined;
}

/** The chosen clock rate, or undefined when a custom value is unusable. */
export function rateOf(f: Form): number | undefined {
  return parseRate(f.rate === 'custom' ? f.customRate : f.rate);
}

function span(minutes: number): string {
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))} seconds`;
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
  const battle = `about ${span(lengthMinutes)} of battle`;
  return rate ? `${battle}, ${span(lengthMinutes / rate)} at this rate` : battle;
}

/** Why the form cannot be sent, or undefined when it can. */
export function validate(f: Form, o: ScenarioOptions): string | undefined {
  const s = o.scenarios.find((x) => x.id === f.scenario);
  if (!s) return 'Choose a scenario.';
  if (!allowedSides(s, o.opponent).some((x) => x.id === f.side)) return 'Choose a side.';
  if (rateOf(f) === undefined) {
    return `Clock rate must be a number from ${MIN_RATE} to ${MAX_RATE}, for example 12 or 12:1.`;
  }
  return undefined;
}

export function toRequest(f: Form, o: ScenarioOptions): CreateRequest {
  return {
    scenario: f.scenario,
    side: f.side,
    rate: rateOf(f)!,
    ...(o.opponent ? { sessionType: 'co_op_vs_ai' as const } : {}),
  };
}

export const OPPONENT_LABEL: Record<NonNullable<Opponent>, string> = {
  scripted: 'Scripted opponent plays the other side.',
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
