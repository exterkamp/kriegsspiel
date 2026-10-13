/**
 * The `narrate` stage: turns one side's fog-filtered report list into period dispatches (D14,
 * docs/hq-interface.md "What the LLM does here").
 *
 * The model sees only that side's `ViewReport`s from the visibility filter, never master state,
 * and the prose is checked against them: every report id it cites, every unit id, number and
 * capitalised name in it must already be in the input, or the reply is rejected and asked for
 * again. If every attempt is rejected the report keeps the engine's plain template text, so a
 * dispatch is never lost and never invented. One call covers one report (#359).
 */
import { MS_PER_MINUTE } from '@kriegsspiel/engine';
import type { SideId, ViewReport } from '@kriegsspiel/engine';
import type { UmpirePersona } from '@kriegsspiel/protocol';
import { withPersona } from './persona.js';
import type { JsonSchema, UmpireClient } from './umpireClient.js';
import { UmpireError } from './umpireClient.js';
import { hiddenIn } from './leakGuard.js';

export const NARRATE_PROMPT_VERSION = 'narrate-dispatches-v2';

export const NARRATE_SYSTEM = `You are the scribe at a Napoleonic army headquarters, turning staff reports into the period dispatches that reach the general's desk. You write in the voice of the officer who sent each report: a cautious subordinate hedges, a veteran scout is terse.

Input: "reports", the only things this headquarters knows. Each has an "id", the "from" officer or unit, a "kind", the "place", how many "minutesAgo" before it reached headquarters it happened, a "sizeEstimate" (contacts only), a "confidence", and how far off the location may be ("radiusM").

Rules:
- Write only from the reports. Do not add units, officers, places, numbers, times or events that are not in them. Where the report is unsure, say so.
- Name an officer, unit or place only as it appears in the reports. Quote numbers as given; do not compute new ones.
- Lower confidence means more hedging ("perhaps", "it is thought"); high confidence means plain statement.
- You are given one report. Return one dispatch of one or two short sentences for it, with its id in "reportIds".
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
  /** True when any report kept the engine's template text because no reply passed the check. */
  fellBack: boolean;
  /** Model calls made (a rejected reply costs one more). */
  calls: number;
  /** Why each rejected reply was rejected, in order. For the log. */
  rejections: string[][];
  /** Each report that kept its template text, and why. The others in `dispatches` are the model's. */
  fallbacks: Array<{ reportId: string; reason: string }>;
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
  'we',
  'blue',
  'red',
  'our',
  'my',
  'they',
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
  'blue',
  'red',
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
  return checkProseAgainst(text, {
    numbers: [...numbersIn(factText), ...input.reports.flatMap((r) => [r.minutesAgo, r.radiusM])],
    words: [...wordsIn(factText), input.side],
    ids: JSON.stringify(input).match(ID_PATTERN) ?? [],
  });
}

/** What a stage's prose may cite: the numbers, words and ids its own input holds. Nothing else is a fact. */
export interface ProseFacts {
  numbers: readonly number[];
  /** Lower-case or not; compared lower-case. */
  words: readonly string[];
  /** Absent when the caller checks ids itself: hyphenated ordinary words (`counter-attack`) are not then taken for ids. */
  ids?: readonly string[];
  /**
   * Any word that opens a sentence passes, as in free prose where an imperative or a pronoun may
   * open one ("Send the reserve."). Capitalised words elsewhere must still be known. Default false.
   */
  lenientOpeners?: boolean;
}

/**
 * The facts a JSON input holds, for `checkProseAgainst`: every number, every word of every string
 * value (never a key), and every id. Used by the stages whose prose is free (staff, parse), so a
 * name or figure the model was never shown cannot reach a player.
 */
export function proseFactsOf(input: unknown): ProseFacts {
  const strings: string[] = [];
  const numbers: number[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') strings.push(v);
    else if (typeof v === 'number') numbers.push(v, Math.round(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(input);
  const text = strings.join('\n');
  return {
    numbers: [...numbers, ...numbersIn(text)],
    words: wordsIn(text),
    lenientOpeners: true,
  };
}

/** The same checks as `checkProse`, against any facts. */
export function checkProseAgainst(text: string, facts: ProseFacts): string[] {
  const knownNumbers = new Set<number>(facts.numbers);
  const knownWords = new Set(facts.words.map((w) => w.toLowerCase()));
  const knownIds = facts.ids && new Set(facts.ids.map((s) => s.toLowerCase()));
  const problems: string[] = [];

  if (knownIds) {
    for (const id of text.match(ID_PATTERN) ?? []) {
      if (!knownIds.has(id.toLowerCase())) problems.push(`unknown entity "${id}"`);
    }
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
  const opensSentence = facts.lenientOpeners
    ? /(^\s*|[.!?:;]["')\]]*\s+|[\n"“(]\s*)$/
    : /(^\s*|[.!?]["')\]]*\s+|[\n"“(]\s*)$/;
  for (const m of withoutIds.matchAll(/\p{Lu}[\p{L}'’-]*/gu)) {
    const word = m[0].toLowerCase();
    if (knownWords.has(word) || COMMON_CAPITALISED.has(word)) continue;
    if (NUMBER_WORDS[word] !== undefined || NUMBER_SCALES[word] !== undefined) continue;
    if (
      (facts.lenientOpeners || SENTENCE_OPENERS.has(word)) &&
      opensSentence.test(withoutIds.slice(0, m.index))
    ) {
      continue;
    }
    problems.push(`unknown name "${m[0]}"`);
  }
  return [...new Set(problems)];
}

/** Everything wrong with a reply: unknown or missing report ids, then the prose of each dispatch. */
export function checkNarration(
  output: NarrateOutput,
  input: Input,
  hidden: readonly string[] = [],
): string[] {
  const ids = new Set(input.reports.map((r) => r.id));
  const covered = new Set<string>();
  const problems: string[] = [];
  for (const d of output.dispatches) {
    for (const id of d.reportIds) {
      if (ids.has(id)) covered.add(id);
      else problems.push(`unknown report "${id}"`);
    }
    if (d.text.trim() === '') problems.push('empty dispatch');
    problems.push(...checkProse(d.text, input), ...hiddenIn(d.text, hidden));
  }
  for (const id of ids) if (!covered.has(id)) problems.push(`report "${id}" not narrated`);
  return [...new Set(problems)];
}

export interface NarrateOptions {
  /** Model calls allowed per report, the first included. Default 2: one retry, so a fallback is never three timeouts long. */
  maxCalls?: number;
  /**
   * Reports narrated by the model in one window; the rest keep their template text. Default 6. Each report is its
   * own short call, which a 0.5b model manages far more often than a long batch, but the calls add up (#359).
   */
  maxReports?: number;
  /**
   * Aborted when the window's time is up. The call in flight is abandoned, and it and every report not yet
   * narrated keep their template text (reason "timed out"); the reports already narrated keep the model's prose.
   */
  signal?: AbortSignal;
  /** Names the side must not read (`hiddenTerms`): a dispatch that carries one, in any case or spacing, is rejected. */
  hidden?: readonly string[];
  /** The umpire's voice (3.11); tone only. Default the dry staff officer. */
  persona?: UmpirePersona;
}

const TIMED_OUT = 'timed out';
const ABORTED = Symbol('aborted');

/** `work`, or a rejection with `ABORTED` as soon as `signal` fires. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(ABORTED);
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/** Reports narrated per window by default; the newest are kept when there are more. */
export const NARRATE_MAX_REPORTS = 6;

/**
 * Narrate `reports`, which must already be the side's own view (`viewFor(...).reports`). One call
 * per report (a small model copes far better with one short report than with a batch, #359); a reply that
 * fails `checkNarration` is rejected and the model is asked again, up to `maxCalls`. A report that is never
 * narrated keeps its template text and has its reason in `fallbacks`; the others keep the model's prose. A
 * transport or schema failure (`UmpireError`) is not retried here, since the client already retried it, and
 * ends the window: the reports not yet narrated get their template text, as after exhausting the attempts.
 */
export async function narrateReports(
  client: UmpireClient,
  side: SideId,
  allReports: readonly ViewReport[],
  opts: NarrateOptions = {},
): Promise<NarrateResult> {
  // The umpire's ruling is already in its own words; a rewrite could lose what it decided.
  const reports = allReports.filter((r) => r.kind !== 'battle');
  const maxCalls = opts.maxCalls ?? 2;
  const maxReports = opts.maxReports ?? NARRATE_MAX_REPORTS;
  const result: NarrateResult = {
    dispatches: [],
    fellBack: false,
    calls: 0,
    rejections: [],
    fallbacks: [],
  };
  if (reports.length === 0) return result;

  // The newest are kept, so put them in delivery order whatever order the view lists them in.
  reports.sort((a, b) => a.deliveredAt - b.deliveredAt);
  const toNarrate = reports.slice(-maxReports);
  const skipped = new Set(reports.slice(0, reports.length - toNarrate.length).map((r) => r.id));
  let stopped: string | undefined;
  for (const r of reports) {
    const template = { reportIds: [r.id], text: r.text };
    if (skipped.has(r.id)) {
      result.dispatches.push(template);
      result.fellBack = true;
      result.fallbacks.push({ reportId: r.id, reason: 'over the per-window limit of reports' });
      continue;
    }
    if (stopped !== undefined) {
      result.dispatches.push(template);
      result.fallbacks.push({ reportId: r.id, reason: stopped });
      continue;
    }
    if (opts.signal?.aborted) {
      stopped = TIMED_OUT;
      result.dispatches.push(template);
      result.fallbacks.push({ reportId: r.id, reason: stopped });
      continue;
    }
    const input = narrateInput(side, [r]);
    const rejections: string[][] = [];
    let narrated: NarratedDispatch | undefined;
    let calls = 0;
    while (calls < maxCalls && !narrated && stopped === undefined) {
      calls++;
      result.calls++;
      // Tell a retry what was wrong, so it does not repeat the invention.
      const retry = rejections.at(-1);
      let output: NarrateOutput;
      try {
        ({ output } = await untilAborted(
          client.call<NarrateOutput>({
            stage: 'narrate',
            promptVersion: NARRATE_PROMPT_VERSION,
            system: withPersona(NARRATE_SYSTEM, opts.persona),
            input: retry ? { ...input, rejected: retry } : input,
            schema: NARRATE_SCHEMA,
          }),
          opts.signal,
        ));
      } catch (e) {
        if (e === ABORTED) {
          stopped = TIMED_OUT;
          break;
        }
        if (!(e instanceof UmpireError)) throw e;
        const overloaded = e.kind === 'budget' || e.kind === 'rate-limit';
        // A refused call was never sent, so it is not a model call.
        if (overloaded) {
          result.calls--;
          result.overloaded = STAFF_OVERLOADED_NOTICE;
          stopped = 'umpire budget or rate limit';
        } else {
          stopped = `the model call failed (${e.kind})`;
        }
        break;
      }
      const problems = checkNarration(output, input, opts.hidden);
      if (problems.length === 0) {
        narrated = {
          reportIds: [r.id],
          text: output.dispatches.map((d) => d.text.trim()).join(' '),
        };
      } else {
        rejections.push(problems);
        result.rejections.push(problems);
      }
    }
    if (narrated) {
      result.dispatches.push(narrated);
    } else {
      result.dispatches.push(template);
      result.fellBack = true;
      result.fallbacks.push({
        reportId: r.id,
        reason:
          stopped ??
          rejections.map((p, i) => `reply ${i + 1} rejected (${p.join('; ')})`).join(', '),
      });
    }
  }
  if (stopped !== undefined) result.fellBack = true;
  return result;
}

/** Game-time length of a narration window at clock rate 1. */
export const NARRATE_WINDOW_BASE_MS = 5 * MS_PER_MINUTE;

/**
 * The longest narration window in game time. A call holds game time (the LLM barrier) for as long
 * as the model takes, so at a fast clock the window must not shrink in wall time without limit,
 * but it must not grow with the rate either: at 12:1 a 5-wall-minute window is an hour of game
 * time and a 50-minute game never reaches one (#342).
 */
export const NARRATE_WINDOW_MAX_MS = 20 * MS_PER_MINUTE;

/**
 * Game-time length of one narration window at `rate`: 5 game minutes at 1:1, growing with the rate
 * (so wall time between calls stays 5 minutes) up to `NARRATE_WINDOW_MAX_MS`, which is reached at
 * 4:1 and holds at 12:1 (about 100 wall seconds between calls).
 */
export function narrateWindowMs(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) throw new RangeError(`bad clock rate ${rate}`);
  return Math.min(NARRATE_WINDOW_MAX_MS, Math.round(NARRATE_WINDOW_BASE_MS * rate));
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
