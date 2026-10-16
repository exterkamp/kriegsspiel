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
import { EXHAUSTED_FATIGUE, LOW_AMMO, MS_PER_MINUTE } from '@kriegsspiel/engine';
import type { SideId, ViewReport, ViewUnit } from '@kriegsspiel/engine';
import type { UmpirePersona } from '@kriegsspiel/protocol';
import { withPersona } from './persona.js';
import type { JsonSchema, UmpireClient } from './umpireClient.js';
import { UmpireError } from './umpireClient.js';
import { hiddenIn } from './leakGuard.js';

export const NARRATE_PROMPT_VERSION = 'narrate-dispatches-v7';

/**
 * Short on purpose: a 0.5b model follows a few plain rules better than many (#419). Each rule but the
 * hedging one is enforced by the checks (`checkProse`, `checkFieldNote`), so a reply that obeys the
 * prompt passes.
 */
export const NARRATE_SYSTEM = `You write one hasty note from an officer in the field to his general, in the Napoleonic wars.

Input: one report. "kind" is what happened, "from" the unit, "place" where, "minutesAgo" how long before it reached the general, "sizeEstimate" and "confidence" how sure. It may also give the "commander" who writes, his "trait" (his manner) and his unit's "condition".

Write the note:
- In the first person, as the officer: "Sir, we ..." or "Sir, my men ...". Never call the unit or the commander "he", "it" or by name in the third person.
- Say what happened, using the report's own words for the kind and the place.
- Then his judgement or one short question for the general that fits the report and his manner: pursue a beaten enemy, hold or fall back when hard pressed or tired, engage or watch an enemy sighted.
- Use only the names, places and numbers in the report. Never say how long anything lasted, how strong a line is, or anything the report does not say.
- If "confidence" is low or medium, hedge: "perhaps", "I think".
- Mention his condition only if it matters, in at most one word from "condition", and never list it.
- Two or three short sentences, under 60 words.
- If "kind" is "unitLost", "courierLost" or "situation", the staff at headquarters write instead, in the third person, and ask nothing.

Return {"dispatches":[{"reportIds":[the report's id],"text":the note}]}. Reply with the JSON object only.`;

/**
 * The longest reply a note needs, in tokens: a short note in its JSON (#419). The keyless Ollama route
 * uses it as its narrate limit (`config.ts`); a route with its own `maxTokens` keeps that.
 */
export const NARRATE_MAX_TOKENS = 220;

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

/**
 * How a unit stands, in words and never in figures, so its note can say whether it can hold or
 * should fall back (#390). The side already sees its own units' state; no number reaches the prose.
 * "Spent" and "nearly gone" start where the engine files its `exhausted` and `lowAmmo` reports.
 */
export function unitCondition(u: Pick<ViewUnit, 'morale' | 'fatigue' | 'ammo'>): string {
  const morale = u.morale >= 70 ? 'steady' : u.morale >= 40 ? 'shaken' : 'wavering';
  const fatigue = u.fatigue < 30 ? 'fresh' : u.fatigue < EXHAUSTED_FATIGUE ? 'tiring' : 'spent';
  const ammo =
    u.ammo > 50
      ? 'well supplied'
      : u.ammo > LOW_AMMO
        ? 'ammunition running low'
        : 'ammunition nearly gone';
  return `${morale}, ${fatigue}, ${ammo}`;
}

/**
 * Report kinds the named unit did not write (it is destroyed, or never had the orders) and the chief of
 * staff's opening situation: HQ writes them.
 */
const STAFF_KINDS: ReadonlySet<ViewReport['kind']> = new Set([
  'unitLost',
  'courierLost',
  'situation',
]);

/**
 * What the model sees for one report. Metres and minutes, no ids of anything the side cannot know.
 * `ownUnits` (the side's own, from its view) gives the sender's commander, manner and condition,
 * so the note can carry his voice and judgement; a sender not among them gets none. Nor do the
 * kinds the unit did not write (`STAFF_KINDS`): HQ writes those.
 */
export function narrateInput(
  side: SideId,
  reports: readonly ViewReport[],
  ownUnits: readonly ViewUnit[] = [],
) {
  return {
    side,
    reports: reports.map((r) => {
      const sender = STAFF_KINDS.has(r.kind)
        ? undefined
        : ownUnits.find((u) => u.name === r.from && u.strength > 0);
      return {
        id: r.id,
        kind: r.kind,
        from: r.from,
        place: r.place,
        // Before it reached HQ, not before now: the text is read later, beside the time it was received.
        minutesAgo: Math.round((r.deliveredAt - r.observedAt) / MS_PER_MINUTE),
        ...(r.sizeEstimate === undefined ? {} : { sizeEstimate: r.sizeEstimate }),
        confidence: r.confidence,
        radiusM: Math.round(r.uncertaintyRadius),
        ...(sender?.commander === undefined ? {} : { commander: sender.commander }),
        ...(sender?.trait === undefined ? {} : { trait: sender.trait }),
        ...(sender === undefined ? {} : { condition: unitCondition(sender) }),
      };
    }),
  };
}

export type NarrateInput = ReturnType<typeof narrateInput>;
type Input = NarrateInput;

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
  'advance',
  'advise',
  'after',
  'alas',
  'all',
  'although',
  'am',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'attack',
  'await',
  'awaiting',
  'before',
  'blue',
  'both',
  'but',
  'by',
  'can',
  'come',
  'could',
  'did',
  'do',
  'does',
  'each',
  'enemy',
  'engaged',
  'every',
  'fall',
  'for',
  'forgive',
  'from',
  'get',
  'give',
  'half',
  'has',
  'hasten',
  'have',
  'he',
  'her',
  'his',
  'hold',
  'how',
  'i',
  'if',
  'in',
  'is',
  'it',
  'its',
  'later',
  'let',
  'many',
  'may',
  'men',
  'might',
  'more',
  'most',
  'must',
  'my',
  'near',
  'no',
  'none',
  'nor',
  'not',
  'nothing',
  'now',
  'of',
  'on',
  'one',
  'only',
  'or',
  'orders',
  'other',
  'our',
  'out',
  'perhaps',
  'pray',
  'pursue',
  'red',
  'request',
  'retire',
  'say',
  'scouts',
  'send',
  'shall',
  'she',
  'should',
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
  'unless',
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
  'withdraw',
  'within',
  'without',
  'would',
  'yet',
  'you',
  'your',
  'yours',
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
  const facts = input.reports.flatMap((r) => [
    r.from,
    r.place,
    r.sizeEstimate ?? '',
    r.commander ?? '',
    r.trait ?? '',
    r.condition ?? '',
  ]);
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
  /**
   * For the umpire's own prose, which estimates ranges (#530): a number given as a distance
   * ("about 200 paces", "two hundred metres") passes, and a hyphenated word of letters only
   * ("bridge-head", "re-forming") is an ordinary word, not an id, unless it begins with a side's
   * id ("red-hussars"). Every other number, id and capitalised word is checked as before. Default
   * false.
   */
  freeProse?: boolean;
}

/** A side's id opening a hyphenated token makes it an id ("red-3", "blue-r5", "red-hussars"). */
const SIDE_PREFIX = /^(?:blue|red)-/i;

/** A distance: a number in digits or words, then a unit of length. */
const DISTANCE = new RegExp(
  `(?:\\d+(?:[.,]\\d+)?|(?:(?:${[...Object.keys(NUMBER_WORDS), ...Object.keys(NUMBER_SCALES)].join('|')})[\\s-]+)*(?:${[...Object.keys(NUMBER_WORDS), ...Object.keys(NUMBER_SCALES)].join('|')}))\\s*(?:paces?|yards?|yds|met(?:re|er)s?|m|kilomet(?:re|er)s?|km|miles?)\\b`,
  'giu',
);

/** Whether an id-shaped token in free prose is only a compound word ("bridge-end"). */
const isCompoundWord = (token: string) => !/\d/.test(token) && !SIDE_PREFIX.test(token);

/** "Battalion's" is "battalion" with its possessive: the bare word decides. */
const withoutPossessive = (word: string) => word.replace(/['’]s?$/u, '');

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
      if (facts.freeProse && isCompoundWord(id)) continue;
      if (!knownIds.has(id.toLowerCase())) problems.push(`unknown entity "${id}"`);
    }
  }
  // Digits inside an id are covered above; the rest must be numbers the input contains. A compound
  // word in free prose stays, so a capitalised one is still checked as a name below; a distance
  // is taken out there, whatever its figure.
  const withoutIds = facts.freeProse
    ? text.replace(ID_PATTERN, (id) => (isCompoundWord(id) ? id : ' ')).replace(DISTANCE, ' ')
    : text.replace(ID_PATTERN, ' ');
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
    const word = withoutPossessive(m[0].toLowerCase());
    if (knownWords.has(word) || COMMON_CAPITALISED.has(word)) continue;
    // A known word's possessive, or a compound of known words ("Bridge-head"), names no one new.
    if (
      word.includes('-') &&
      word.split('-').every((p) => p === '' || knownWords.has(p) || COMMON_CAPITALISED.has(p))
    ) {
      continue;
    }
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

/** The longest dispatch accepted: the prompt asks for two or three short sentences (#419). */
export const NARRATE_MAX_CHARS = 360;
const NARRATE_MAX_SENTENCES = 4;

/** The words `unitCondition` uses, by what they describe; one unit is only ever one of each (#419). */
const CONDITION_GROUPS: readonly (readonly string[])[] = [
  ['steady', 'shaken', 'wavering'],
  ['fresh', 'tiring', 'spent'],
  ['well supplied', 'running low', 'nearly gone'],
];

/** Condition words a report of this kind already implies, so the note may use them whatever the unit's condition. */
const KIND_CONDITION: Partial<Record<ViewReport['kind'], readonly string[]>> = {
  broke: ['shaken', 'wavering'],
  heavyLosses: ['shaken', 'wavering'],
  exhausted: ['tiring', 'spent'],
  lowAmmo: ['running low', 'nearly gone'],
};

/**
 * Words of which a note on a report of this kind must use one, so it is about the reported event and
 * not about something the model made up (#419). Generous on purpose: any fair way of saying it passes.
 */
const EVENT_WORDS: Record<Exclude<ViewReport['kind'], 'battle' | 'notice'>, RegExp> = {
  situation:
    /\b(position|posted|placed|in place|in line|line|ready|deployed|formed|stand|standing|quiet|no enemy|nothing)\b/i,
  contact:
    /\b(see|seen|saw|sight|sighted|sighting|spotted|spied|observed|watch|watching|enemy|enemies|troops|column|columns|men|horse|foot|force|battalions?|squadrons?|regiments?|companies|company|brigades?|infantry|cavalry|guns|artillery|before us)\b/i,
  orderDelivered:
    /\b(order|orders|instructions|your note|your letter|despatch|dispatch|received|in hand|have them|obey)\b/i,
  lowAmmo: /\b(ammunition|cartridges?|powder|ball|shot|rounds|supply|supplies|resupply)\b/i,
  exhausted:
    /\b(exhausted|exhaustion|tired|tiring|weary|spent|fatigue|fatigued|rest|done in|worn|dropping|can go no further)\b/i,
  destroyed:
    /\b(destroyed|broken|broke|routed|rout|scattered|cut down|cut up|wiped|beaten|gone|fled|flight|dispersed)\b/i,
  engaged:
    /\b(engaged|engage|fight|fighting|fire|firing|attack|attacked|attacking|action|contact|skirmish|presses|pressing|press|hold|holding|battle|struggle|enemy)\b/i,
  heavyLosses:
    /\b(loss|losses|lost|casualties|fallen|dead|killed|wounded|cut up|bled|bleeding|thinned|heavy|dearly)\b/i,
  broke:
    /\b(broke|broken|break|fall back|falling back|fell back|retreat|retreating|rout|routed|flee|fled|fleeing|withdraw|withdrawing|gave way|give way|given way|rally|driven back|ran)\b/i,
  unitLost: /\b(lost|gone|destroyed|no word|silent|silence|missing|no more|cut off|perished)\b/i,
  courierLost: /\b(courier|rider|messenger|orders?|overdue|lost|no word)\b/i,
  turn: /\b(stand|standing|stood|stayed|stay|position|posted|ground|held|hold|holding|kept|keep|march|marched|marching|moved|move|went|advanced|advance|pushed|crossed|took|came up|come up|reached|occupied|formed|deployed|remain|remained|waited|watched|orders?|ordered|fall back|falling back|fell back|back|broken|broke|rallied|engaged|attacked|charged|fight|fought|halted|halt|retired|withdrew|withdrawn|lost)\b/i,
};

const FIRST_PERSON =
  /\b(i|i'm|i’m|i've|i’ve|i'd|i’d|we|we're|we’re|we've|we’ve|my|our|ours|me|us)\b/i;

/** A span of time the note says something lasted: "for 10 minutes", "for an hour", "twenty minutes long". */
const DURATION =
  /\bfor (?:(?:about|some|nearly|almost|over|fully|a full|the (?:last|past)) )?(?:\d+|an?|half an?|[a-z]+(?:[- ][a-z]+)?) (?:minutes?|hours?|quarters? of an hour)\b|\b(?:minutes?|hours?) (?:long|on end)\b/i;

/** Strength the reports never give: "a strong line", "a solid position". */
const STRENGTH =
  /\b(?:strong|solid|firm|stout|formidable|unbroken|powerful) (?:line|lines|position|front|defence|defense|force)\b/i;

const COMBAT_KINDS: ReadonlySet<ViewReport['kind']> = new Set([
  'engaged',
  'heavyLosses',
  'broke',
  'destroyed',
  'unitLost',
]);

/**
 * The next words that make a condition word describe something other than the sender's men: "fresh
 * troops" are the enemy's or a reinforcement, "a steady fire" is the firing, not the morale.
 */
const NOT_THE_MEN: Readonly<Record<string, string>> = {
  fresh:
    '(?:troops|regiments?|battalions?|columns?|reserves?|enemy|horses|supply|supplies|ammunition|cartridges)',
  steady: '(?:fire|volleys?|rain|advance|pace|march)',
  spent: '(?:balls?|shot|cartridges)',
};

/** The condition words (`CONDITION_GROUPS`) in `text` that describe the men, not the enemy or the firing. */
function conditionWordsIn(text: string): string[] {
  const lower = text.toLowerCase();
  return CONDITION_GROUPS.flat().filter((w) => {
    const not = NOT_THE_MEN[w];
    return new RegExp(`\\b${w}\\b${not ? `(?! ${not}\\b)` : ''}`).test(lower);
  });
}

/**
 * The problems with one dispatch as a field note on `report` (#419), beyond the fact check of
 * `checkProse`. The two notes a small model wrote in QA, and every rule here is aimed at them:
 * - a note from the unit is in its officer's own voice: one that never says "I", "we", "my" or "our"
 *   but names its own unit or commander is a third-person account, not his note;
 * - no span of time ("held for 10 minutes"): a report has an age, never a duration;
 * - no strength the report does not give ("a strong line"), and no fire on a report that is not a fight;
 * - condition words agree with each other and with the unit's condition (or the report's kind), and
 *   the note does not recite the whole condition list instead of judging it;
 * - it says what happened (a word for the report's kind), and it is short.
 */
export function checkFieldNote(
  text: string,
  report: Input['reports'][number],
  limits: { chars: number; sentences: number } = {
    chars: NARRATE_MAX_CHARS,
    sentences: NARRATE_MAX_SENTENCES,
  },
): string[] {
  const problems: string[] = [];
  const kind = report.kind as ViewReport['kind'];
  if (text.length > limits.chars) {
    problems.push(`too long (${text.length} characters, at most ${limits.chars})`);
  }
  // "Lt. Col. Aubry" is one name, not three sentences.
  const sentences = text
    .replace(/\b(Lt|Col|Maj|Gen|Capt|Sgt|Brig|St)\./g, '$1')
    .split(/[.!?]+(?:\s|$)/)
    .filter((x) => x.trim() !== '').length;
  if (sentences > limits.sentences) {
    problems.push(`too long (${sentences} sentences, at most ${limits.sentences})`);
  }
  const lower = text.toLowerCase();
  if (!STAFF_KINDS.has(kind) && !FIRST_PERSON.test(text)) {
    const self = [report.from, report.commander ?? ''].filter((n) => n !== '');
    const named = self.find((n) => lower.includes(n.toLowerCase()));
    if (named !== undefined) {
      problems.push(`not in the first person: names "${named}" as someone else would`);
    }
  }
  // A span the turn report's own account or orders give ("fire for ten minutes") is not invented.
  const given = JSON.stringify([
    (report as { account?: unknown }).account ?? '',
    (report as { orders?: unknown }).orders ?? [],
  ]).toLowerCase();
  const duration = text.match(DURATION);
  if (duration && !given.includes(duration[0].toLowerCase())) {
    problems.push(`invented duration "${duration[0]}"`);
  }
  const strength = text.match(STRENGTH);
  if (strength) problems.push(`invented strength "${strength[0]}"`);
  if (!COMBAT_KINDS.has(kind) && /\bunder fire\b/i.test(text)) {
    problems.push('invented event "under fire": the report is not of a fight');
  }

  const said = conditionWordsIn(text);
  for (const group of CONDITION_GROUPS) {
    const clash = group.filter((w) => said.includes(w));
    if (clash.length > 1) problems.push(`contradictory condition "${clash.join('" and "')}"`);
  }
  if (report.condition !== undefined) {
    // A turn report's account is the umpire's own words: a note may repeat them ("we met a
    // steady line") whatever the unit's condition (#530).
    const account = (report as { account?: unknown }).account;
    const allowed = [
      ...conditionWordsIn(report.condition),
      ...(KIND_CONDITION[kind] ?? []),
      ...(typeof account === 'string' ? conditionWordsIn(account) : []),
    ];
    for (const w of said) {
      if (!allowed.includes(w)) problems.push(`condition "${w}" is not the unit’s`);
    }
    if (conditionWordsIn(report.condition).every((w) => said.includes(w))) {
      problems.push('recites the unit’s condition instead of judging it');
    }
  }
  if (kind !== 'battle' && kind !== 'notice' && !EVENT_WORDS[kind].test(text)) {
    problems.push(`does not say what happened (${kind})`);
  }
  return problems;
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
    for (const r of input.reports) {
      if (d.reportIds.includes(r.id)) problems.push(...checkFieldNote(d.text, r));
    }
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
  /** The side's own units (`viewFor(...).ownUnits`): each sender's commander, manner and condition (#390). */
  ownUnits?: readonly ViewUnit[];
  /**
   * The game's circuit breaker (#419): asked before every model call, and told whether each passed. Once it
   * stops allowing calls, the reports not yet narrated keep their template text with `reason` as the reason.
   */
  breaker?: { allows(): boolean; record(ok: boolean): void; reason(): string };
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
  const reports = allReports.filter((r) => r.kind !== 'battle' && r.kind !== 'notice');
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
    const input = narrateInput(side, [r], opts.ownUnits);
    const rejections: string[][] = [];
    let narrated: NarratedDispatch | undefined;
    let calls = 0;
    while (calls < maxCalls && !narrated && stopped === undefined) {
      if (opts.breaker && !opts.breaker.allows()) {
        stopped = opts.breaker.reason();
        break;
      }
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
          opts.breaker?.record(false);
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
          opts.breaker?.record(false);
          stopped = `the model call failed (${e.kind})`;
        }
        break;
      }
      const problems = checkNarration(output, input, opts.hidden);
      opts.breaker?.record(problems.length === 0);
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
