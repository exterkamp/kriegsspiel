/**
 * The `narrate` stage: turns one side's fog-filtered report list into period dispatches (D14,
 * docs/hq-interface.md "What the LLM does here").
 *
 * The model sees only that side's `ViewReport`s from the visibility filter, never master state,
 * and the prose is checked against them: every report id it cites, every unit id, number and
 * capitalised name in it must already be in the input, or the reply is rejected and asked for
 * again. If every attempt is rejected the side gets the engine's plain template text, so a
 * dispatch is never lost and never invented. One call covers one side's whole window.
 */
import { MS_PER_MINUTE } from '@kriegsspiel/engine';
import type { SideId, ViewReport } from '@kriegsspiel/engine';
import type { JsonSchema, UmpireClient } from './umpireClient.js';
import { UmpireError } from './umpireClient.js';

export const NARRATE_PROMPT_VERSION = 'narrate-dispatches-v1';

export const NARRATE_SYSTEM = `You are the scribe at a Napoleonic army headquarters, turning staff reports into the period dispatches that reach the general's desk. You write in the voice of the officer who sent each report: a cautious subordinate hedges, a veteran scout is terse.

Input: "reports", the only things this headquarters knows. Each has an "id", the "from" officer or unit, a "kind", the "place", how many "minutesAgo" it happened, a "sizeEstimate" (contacts only), a "confidence", and how far off the location may be ("radiusM").

Rules:
- Write only from the reports. Do not add units, officers, places, numbers, times or events that are not in them. Where the report is unsure, say so.
- Name an officer, unit or place only as it appears in the reports. Quote numbers as given; do not compute new ones.
- Lower confidence means more hedging ("perhaps", "it is thought"); high confidence means plain statement.
- Return one dispatch per report, or one covering several reports of the same event. Each dispatch lists the "reportIds" it is drawn from.
Reply with the JSON object only.`;

export const NARRATE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    dispatches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          reportIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
          text: { type: 'string' },
        },
        required: ['reportIds', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['dispatches'],
  additionalProperties: false,
};

export interface NarrateOutput {
  dispatches: Array<{ reportIds: string[]; text: string }>;
}

/** One narrated dispatch. `reportIds` are the side's own report ids it was drawn from. */
export interface NarratedDispatch {
  reportIds: string[];
  text: string;
}

export interface NarrateResult {
  dispatches: NarratedDispatch[];
  /** True when no reply passed the check and the engine's template text was used. */
  fellBack: boolean;
  /** Model calls made (a rejected reply costs one more). */
  calls: number;
  /** Why each rejected reply was rejected, in order. For the log. */
  rejections: string[][];
}

/** What the model sees for one report. Metres and minutes, no ids of anything the side cannot know. */
export function narrateInput(side: SideId, reports: readonly ViewReport[]) {
  return {
    side,
    reports: reports.map((r) => ({
      id: r.id,
      kind: r.kind,
      from: r.from,
      place: r.place,
      minutesAgo: Math.round(r.ageMs / MS_PER_MINUTE),
      ...(r.sizeEstimate === undefined ? {} : { sizeEstimate: r.sizeEstimate }),
      confidence: r.confidence,
      radiusM: Math.round(r.uncertaintyRadius),
    })),
  };
}

type Input = ReturnType<typeof narrateInput>;

const NUMBER_WORDS: Record<string, number> = Object.fromEntries(
  [
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
    'thirteen',
    'fourteen',
    'fifteen',
    'sixteen',
    'seventeen',
    'eighteen',
    'nineteen',
    'twenty',
  ].map((w, i) => [w, i + 2]),
);

/** Words that may be capitalised mid-sentence in period prose without naming anything. */
const COMMON_CAPITALISED = new Set([
  'i',
  'sir',
  'general',
  'monsieur',
  'god',
  'majesty',
  'excellency',
]);

const ID_PATTERN = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/gi;
const NUMBER_PATTERN = /\d+(?:[.,]\d+)?/g;
const WORD_PATTERN = /[\p{L}][\p{L}'’-]*/gu;

function numbersIn(text: string): number[] {
  return (text.match(NUMBER_PATTERN) ?? []).map((n) => Number(n.replace(',', '.')));
}

function wordsIn(text: string): string[] {
  return (text.match(WORD_PATTERN) ?? []).map((w) => w.toLowerCase());
}

/**
 * The problems with `text` against the input it was written from. Empty means it passes:
 * - ids and hyphenated codes (`blue-1`) must be in the input;
 * - every number, in digits or words, must be one the input has;
 * - a capitalised word that does not start a sentence must be a word the input has.
 */
export function checkProse(text: string, input: Input): string[] {
  const corpus = JSON.stringify(input);
  const knownNumbers = new Set<number>(numbersIn(corpus));
  const knownWords = new Set(wordsIn(corpus));
  const knownIds = new Set((corpus.match(ID_PATTERN) ?? []).map((s) => s.toLowerCase()));
  const problems: string[] = [];

  for (const id of text.match(ID_PATTERN) ?? []) {
    if (!knownIds.has(id.toLowerCase())) problems.push(`unknown entity "${id}"`);
  }
  // Digits inside an id are covered above; the rest must be numbers the input contains.
  const withoutIds = text.replace(ID_PATTERN, ' ');
  for (const n of numbersIn(withoutIds)) {
    if (!knownNumbers.has(n)) problems.push(`unknown number ${n}`);
  }
  for (const w of wordsIn(withoutIds)) {
    const n = NUMBER_WORDS[w];
    if (n !== undefined && !knownNumbers.has(n) && !knownWords.has(w)) {
      problems.push(`unknown number "${w}"`);
    }
  }

  // Capitalised words after the first of a sentence are proper nouns: units, officers, places.
  const sentenceStart = /(^|[.!?]["')\]]*\s+|[\n"“(]\s*)$/;
  for (const m of withoutIds.matchAll(/\p{Lu}[\p{L}'’-]*/gu)) {
    const word = m[0].toLowerCase();
    if (sentenceStart.test(withoutIds.slice(0, m.index))) continue;
    if (knownWords.has(word) || COMMON_CAPITALISED.has(word)) continue;
    problems.push(`unknown name "${m[0]}"`);
  }
  return [...new Set(problems)];
}

/** Everything wrong with a reply: unknown or missing report ids, then the prose of each dispatch. */
export function checkNarration(output: NarrateOutput, input: Input): string[] {
  const ids = new Set(input.reports.map((r) => r.id));
  const covered = new Set<string>();
  const problems: string[] = [];
  for (const d of output.dispatches) {
    for (const id of d.reportIds) {
      if (ids.has(id)) covered.add(id);
      else problems.push(`unknown report "${id}"`);
    }
    if (d.text.trim() === '') problems.push('empty dispatch');
    problems.push(...checkProse(d.text, input));
  }
  for (const id of ids) if (!covered.has(id)) problems.push(`report "${id}" not narrated`);
  return [...new Set(problems)];
}

export interface NarrateOptions {
  /** Model calls allowed per window, the first included. Default 3. */
  maxCalls?: number;
}

/**
 * Narrate `reports`, which must already be the side's own view (`viewFor(...).reports`). One call
 * for the whole list; a reply that fails `checkNarration` is rejected and the model is asked again,
 * up to `maxCalls`. A transport or schema failure (`UmpireError`) is not retried here, since the
 * client already retried it; the caller gets the template text instead, as it does after
 * exhausting the attempts.
 */
export async function narrateReports(
  client: UmpireClient,
  side: SideId,
  reports: readonly ViewReport[],
  opts: NarrateOptions = {},
): Promise<NarrateResult> {
  const template = (): NarratedDispatch[] =>
    reports.map((r) => ({ reportIds: [r.id], text: r.text }));
  if (reports.length === 0) return { dispatches: [], fellBack: false, calls: 0, rejections: [] };

  const input = narrateInput(side, reports);
  const maxCalls = opts.maxCalls ?? 3;
  const rejections: string[][] = [];
  let calls = 0;
  while (calls < maxCalls) {
    calls++;
    // Tell a retry what was wrong, so it does not repeat the invention.
    const retry = rejections.at(-1);
    let output: NarrateOutput;
    try {
      ({ output } = await client.call<NarrateOutput>({
        stage: 'narrate',
        promptVersion: NARRATE_PROMPT_VERSION,
        system: NARRATE_SYSTEM,
        input: retry ? { ...input, rejected: retry } : input,
        schema: NARRATE_SCHEMA,
      }));
    } catch (e) {
      if (e instanceof UmpireError)
        return { dispatches: template(), fellBack: true, calls, rejections };
      throw e;
    }
    const problems = checkNarration(output, input);
    if (problems.length === 0) {
      return {
        dispatches: output.dispatches.map((d) => ({ reportIds: d.reportIds, text: d.text.trim() })),
        fellBack: false,
        calls,
        rejections,
      };
    }
    rejections.push(problems);
  }
  return { dispatches: template(), fellBack: true, calls, rejections };
}

/** Game-time length of a narration window at clock rate 1. */
export const NARRATE_WINDOW_BASE_MS = 5 * MS_PER_MINUTE;

/**
 * Game-time length of one narration window at `rate`. Wall-clock latency of a call is fixed, so
 * a faster clock needs a longer game-time window to keep calls per wall-clock minute steady.
 */
export function narrateWindowMs(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) throw new RangeError(`bad clock rate ${rate}`);
  return Math.round(NARRATE_WINDOW_BASE_MS * rate);
}

/**
 * The reports to narrate for the window that ends at `now`: delivered after `lastNarratedAt` and by `now`.
 * A window is closed only when `now` has reached `lastNarratedAt + narrateWindowMs(rate)`; before
 * that the reports wait, so a burst of events becomes one call.
 */
export function reportsDueForNarration(
  reports: readonly ViewReport[],
  lastNarratedAt: number,
  now: number,
  rate: number,
): ViewReport[] {
  if (now < lastNarratedAt + narrateWindowMs(rate)) return [];
  return reports.filter((r) => r.deliveredAt > lastNarratedAt && r.deliveredAt <= now);
}
