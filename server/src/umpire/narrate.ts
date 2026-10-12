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

Input: "reports", the only things this headquarters knows. Each has an "id", the "from" officer or unit, a "kind", the "place", how many "minutesAgo" before it reached headquarters it happened, a "sizeEstimate" (contacts only), a "confidence", and how far off the location may be ("radiusM").

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
  /** Set when the game's budget or rate limit refused the call: the in-fiction notice to show. */
  overloaded?: string;
}

/** Shown in place of narration when the umpire's per-game budget or rate limit is hit. */
export const STAFF_OVERLOADED_NOTICE =
  'The staff are overwhelmed, sir. Dispatches reach you as written, without a fair copy.';

/** What the model sees for one report. Metres and minutes, no ids of anything the side cannot know. */
export function narrateInput(side: SideId, reports: readonly ViewReport[]) {
  return {
    side,
    reports: reports.map((r) => ({
      id: r.id,
      kind: r.kind,
      from: r.from,
      place: r.place,
      // Before it reached HQ, not before now: the text is read later, beside the time it was received.
      minutesAgo: Math.round((r.deliveredAt - r.observedAt) / MS_PER_MINUTE),
      ...(r.sizeEstimate === undefined ? {} : { sizeEstimate: r.sizeEstimate }),
      confidence: r.confidence,
      radiusM: Math.round(r.uncertaintyRadius),
    })),
  };
}

type Input = ReturnType<typeof narrateInput>;

const NUMBER_WORDS: Record<string, number> = {
  ...Object.fromEntries(
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
  ),
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
/** Number words that multiply what came before (or stand for the quantity alone: "a hundred"). */
const NUMBER_SCALES: Record<string, number> = {
  hundred: 100,
  thousand: 1000,
  dozen: 12,
  score: 20,
};

/**
 * Runs of spelled-out numbers in `text` with their value: "four hundred" is 400, "twenty-one" is
 * 21, "a thousand" is 1000. `words` is the run, for the known-word escape in `checkProse`.
 */
function spelledNumbers(text: string): { value: number; words: string[] }[] {
  const runs: { value: number; words: string[] }[] = [];
  let words: string[] = [];
  let total = 0;
  let current = 0;
  const flush = () => {
    if (words.length > 0) runs.push({ value: total + current, words });
    words = [];
    total = 0;
    current = 0;
  };
  for (const w of text.toLowerCase().match(/[\p{L}]+/gu) ?? []) {
    const unit = NUMBER_WORDS[w];
    const scale = NUMBER_SCALES[w];
    if (unit !== undefined) {
      current += unit;
    } else if (scale === 1000) {
      total += (current || 1) * scale;
      current = 0;
    } else if (scale !== undefined) {
      current = (current || 1) * scale;
    } else {
      flush();
      continue;
    }
    words.push(w);
  }
  flush();
  return runs;
}

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

/**
 * Ordinary words that may open a sentence (or a quotation or parenthesis) in period prose. Any
 * other capitalised word there must be one the input has, so an invented place or officer cannot
 * hide in the most natural spot for it.
 */
const SENTENCE_OPENERS = new Set([
  'a',
  'about',
  'after',
  'all',
  'although',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'before',
  'both',
  'but',
  'by',
  'could',
  'do',
  'each',
  'enemy',
  'every',
  'for',
  'from',
  'half',
  'has',
  'have',
  'he',
  'her',
  'his',
  'how',
  'i',
  'if',
  'in',
  'is',
  'it',
  'its',
  'later',
  'many',
  'more',
  'most',
  'my',
  'near',
  'no',
  'none',
  'nor',
  'not',
  'now',
  'of',
  'on',
  'one',
  'only',
  'or',
  'other',
  'our',
  'out',
  'perhaps',
  'scouts',
  'she',
  'since',
  'so',
  'some',
  'still',
  'such',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'though',
  'to',
  'under',
  'until',
  'upon',
  'us',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'whether',
  'which',
  'while',
  'who',
  'why',
  'will',
  'with',
  'within',
  'without',
  'would',
  'yet',
  'you',
  'your',
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
 * - every capitalised word must be a word the input has, or an ordinary one: a sentence opener
 *   (`The`, `We`, ...) at the start of a sentence, quotation or parenthesis, or `Sir` and the like.
 */
export function checkProse(text: string, input: Input): string[] {
  // Only the fields the model is meant to draw on: ids and JSON keys are not facts to cite.
  const facts = input.reports.flatMap((r) => [r.from, r.place, r.sizeEstimate ?? '']);
  const factText = facts.join('\n');
  const knownNumbers = new Set<number>([
    ...numbersIn(factText),
    ...input.reports.flatMap((r) => [r.minutesAgo, r.radiusM]),
  ]);
  const knownWords = new Set([...wordsIn(factText), input.side]);
  const knownIds = new Set(
    (JSON.stringify(input).match(ID_PATTERN) ?? []).map((s) => s.toLowerCase()),
  );
  const problems: string[] = [];

  for (const id of text.match(ID_PATTERN) ?? []) {
    if (!knownIds.has(id.toLowerCase())) problems.push(`unknown entity "${id}"`);
  }
  // Digits inside an id are covered above; the rest must be numbers the input contains.
  const withoutIds = text.replace(ID_PATTERN, ' ');
  for (const n of numbersIn(withoutIds)) {
    if (!knownNumbers.has(n)) problems.push(`unknown number ${n}`);
  }
  // A spelled-out number is fine when it is a known value ("four hundred" for 400) or the input
  // itself uses the word.
  for (const run of spelledNumbers(withoutIds)) {
    if (!knownNumbers.has(run.value) && !run.words.some((w) => knownWords.has(w))) {
      problems.push(`unknown number "${run.words.join(' ')}"`);
    }
  }

  // Capitalised words are proper nouns (units, officers, places) unless they open a sentence.
  const opensSentence = /(^|[.!?]["')\]]*\s+|[\n"“(]\s*)$/;
  for (const m of withoutIds.matchAll(/\p{Lu}[\p{L}'’-]*/gu)) {
    const word = m[0].toLowerCase();
    if (knownWords.has(word) || COMMON_CAPITALISED.has(word)) continue;
    if (NUMBER_WORDS[word] !== undefined || NUMBER_SCALES[word] !== undefined) continue;
    if (SENTENCE_OPENERS.has(word) && opensSentence.test(withoutIds.slice(0, m.index))) continue;
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
      if (e instanceof UmpireError) {
        const overloaded = e.kind === 'budget' || e.kind === 'rate-limit';
        return {
          dispatches: template(),
          fellBack: true,
          // A refused call was never sent, so it is not a model call.
          calls: overloaded ? calls - 1 : calls,
          rejections,
          ...(overloaded ? { overloaded: STAFF_OVERLOADED_NOTICE } : {}),
        };
      }
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
