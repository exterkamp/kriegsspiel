/**
 * The rules parser: the test provider's `parse` stage, and in turn mode the engine's reading of an
 * order (D39). It understands ordinary sentences with no model. It reads the same input the real
 * prompt gets (the order text, the side's units, the named places) and `testParse` answers in the
 * same schema, so the parser, its checks and the engine treat it like any model.
 *
 * Rules, all deterministic:
 * - A unit is found by id, full name, or an alias (`the cavalry`, `the guns`, `the 1st`). Several
 *   fits and no exact name: ask which. No unit named: the unit nearest the first place is meant.
 *   Words before the verb that fit no unit: refuse.
 * - The order is split into clauses at sentence ends, commas, `and`, `then` and `but`. Each clause
 *   has a verb (move/march/continue/reconnoitre, hold/defend/screen/stand/form/line, take/seize,
 *   withdraw/fall back, attack/pursue) and a place. `it`, `there`, `here`, `fast` or no place in a
 *   later `hold` clause means the place before it; a first `hold` with no place, or one at `your
 *   position` or `where you are`, holds `here`; `take X` is a move to X and a hold there; `watch`
 *   holds where the unit is, whatever it watches. A later clause with no verb but a place (`hold the
 *   bridge and the ford`) takes the verb before it; with neither, the clause is not understood and
 *   the first part is offered on its own. A later clause that has no verb and only points back
 *   (`and there`, `and it`) adds nothing and is skipped: the earlier clause already covers that
 *   place. A clause that only fires, reports, lets pass or otherwise does not move the unit (`fire
 *   on the bridge`, `report any movement`), and a restriction (`do not fire`), add nothing either.
 *   `from X to Y` means Y: the place after the last `to`/`toward`; `from X` alone names no
 *   destination. A road named as the way (`march down the road`) is the route, not the destination.
 * - An order that names several units (`the 1st and 2nd battalions`) asks which one first, since
 *   an answer carries one unit. A vague one (`a good position`, `as you see fit`) asks where, and a
 *   contradictory one (`hold your position and march to the road`, `advance but do not move`,
 *   `withdraw to the road and attack it`) asks which is meant.
 * - A place is found by its name, or by its kind (`the wood`, `the bank`) narrowed by words in its
 *   name (`the northern wood`). Several fits: ask which. None: refuse.
 * - Conditions and times ("if pressed", "at noon") are ignored; the intents are the plain order.
 * - With an `addressee` (the sender chose the unit), an order that names no unit is for it.
 *
 * `rulesParse` also says *where* at a place (`the south end of the bridge`, `400 paces short of the
 * river`, `west of the road`, `behind the 1st Battalion`), which the place-id schema cannot carry;
 * turn mode turns that into a point on the map (`server/src/game/rulesPlace.ts`). `testParse` is
 * `rulesParse` in the parse stage's schema, without it.
 */
import type { ParseOrdersOutput } from '../../orders/llmParser.js';

interface Unit {
  id: string;
  name: string;
  x: number;
  y: number;
}
interface Place {
  id: string;
  kind: string;
  name?: string;
  x: number;
  y: number;
}
interface ParseInput {
  order: string;
  units: Unit[];
  places: Place[];
  /**
   * The unit the order is addressed to, when the sender has already chosen it (turn mode, D39): an
   * order that names no unit is for it, not for the unit nearest its place.
   */
  addressee?: string;
  /**
   * Other units of the side that an order may name as a point of reference (`behind the 1st
   * Battalion`), never as the unit that carries it out. Turn mode only; the place is `unit:<id>`.
   */
  refs?: Unit[];
}

/** A compass point. */
export type Compass = 'north' | 'south' | 'east' | 'west';

/** Where at a place an intent goes; turn mode resolves it on the map (`rulesPlace.ts`). */
export interface RulesWhere {
  /** The end, edge, bank or side of the place toward a compass point, the unit (`near`) or away. */
  part?: Compass | 'near' | 'far';
  /** Stop this many metres short of the place, on the way from where the unit then is. */
  shortM?: number;
  /** The ground off the place toward a compass point (`west of the road`). */
  off?: Compass;
  /** How far off, in metres, when the order says (`300 paces west of the road`). */
  offM?: number;
  /** Behind the place, toward the side's own rear, or in front of it. */
  rel?: 'behind' | 'front';
}

export interface RulesIntent {
  kind: 'move' | 'hold' | 'attack' | 'withdraw';
  /** A place id, `here` (a hold where the unit stands) or `unit:<id>` (one of `refs`). */
  place: string;
  where?: RulesWhere;
}

export interface RulesOutput extends Omit<ParseOrdersOutput, 'intents'> {
  intents?: RulesIntent[];
}

/** `take` is a move then a hold; `watch` a hold where the unit is, whatever it watches. */
type Kind = 'move' | 'hold' | 'attack' | 'withdraw' | 'take' | 'watch';

const VERBS: [RegExp, Kind][] = [
  [
    /\b(?:fall(?:s|ing)? back|pull(?:s|ing)? back|withdraw(?:s|ing)?|retire|retreat(?:s|ing)?)\b/,
    'withdraw',
  ],
  [
    /\b(?:attack(?:s|ing)?|assault(?:s|ing)?|storm(?:s|ing)?|charge(?:s|ing)?|pursue(?:s|ing)?)\b/,
    'attack',
  ],
  [/\b(?:take|seize|capture|secure)(?! up\b)\b/, 'take'],
  [/\b(?:watch|observe)\b/, 'watch'],
  [
    /\b(?:hold(?:s|ing)?|defend(?:s|ing)?|screen(?:s|ing)?|picket|garrison|occupy|guard|stand|halt|remain|stay|block|bar|re-?form|form(?= line\b| column\b| square\b| up\b| on\b| at\b| in\b| behind\b| across\b| along\b)|close(?= it\b| the\b)|take up)\b/,
    'hold',
  ],
  [
    /\b(?:move|march(?:es|ing)?|advance|proceed|go|push|cross|redeploy|shift|continue|ride|reconnoit(?:re|er)|scout)\b/,
    'move',
  ],
];

/**
 * Verbs of a clause that adds nothing to where the unit goes: firing, reporting, letting another
 * unit by. The clause is skipped, so `hold the bridge and fire on anything that crosses` is a hold.
 */
const NO_MOVE = new Set([
  'fire',
  'give',
  'let',
  'drive',
  'report',
  'find',
  'bring',
  'use',
  'keep',
  'show',
  'cut',
  'deal',
  'stop',
  'engage',
  'skirmish',
  'send',
  'inform',
  'tell',
  'cover',
]);

/** Words a player uses for a kind of ground; the kind itself always counts too. */
const KIND_WORDS: Record<string, string[]> = {
  wood: ['wood', 'woods', 'woodland', 'forest', 'trees'],
  bridge: ['bridge', 'crossing'],
  river: ['river', 'stream', 'bank', 'banks', 'riverbank'],
  road: ['road', 'highway', 'track'],
  ford: ['ford'],
  hill: ['hill', 'heights', 'ridge', 'rise'],
  village: ['village', 'hamlet'],
  town: ['town'],
  farm: ['farm', 'farmhouse'],
};

/** Kinds of ground that carry a road over water; a player may use either word for the other. */
const CROSSINGS = ['bridge', 'ford'];

/** Words that name a branch of the army, mapped to words in a unit's name. */
const UNIT_ALIASES: Record<string, string[]> = {
  cavalry: [
    'cavalry',
    'squadron',
    'hussar',
    'hussars',
    'dragoon',
    'dragoons',
    'lancer',
    'lancers',
    'cuirassier',
    'cuirassiers',
  ],
  infantry: [
    'infantry',
    'battalion',
    'line',
    'vanguard',
    'regiment',
    'grenadier',
    'grenadiers',
    'jaegers',
  ],
  battalion: ['battalion'],
  squadron: ['squadron'],
  artillery: ['artillery', 'battery', 'guns', 'gun'],
  guns: ['artillery', 'battery', 'guns', 'gun'],
  horse: ['cavalry', 'squadron', 'hussar', 'hussars', 'dragoon', 'dragoons'],
};

const ORDINALS: Record<string, string> = {
  first: '1st',
  second: '2nd',
  third: '3rd',
  fourth: '4th',
  fifth: '5th',
};

const FILLER = new Set([
  'the',
  'a',
  'an',
  'to',
  'at',
  'on',
  'in',
  'into',
  'onto',
  'toward',
  'towards',
  'by',
  'of',
  'back',
  'up',
  'please',
  'your',
  'yourselves',
  'as',
  'down',
  'along',
  'across',
  'over',
  'through',
  'via',
  'straight',
  'reserve',
  'unseen',
  'with',
  'all',
  'speed',
  'haste',
  'is',
  'are',
  'will',
  'shall',
  'must',
  'now',
  'our',
  ',',
  ';',
]);

/** Words of a clause that say how, not where: formations, compass words, the picket's role. */
const HOW = new Set([
  'line',
  'lines',
  'column',
  'columns',
  'square',
  'order',
  'open',
  'skirmish',
  'picket',
  'north',
  'south',
  'east',
  'west',
  'northward',
  'southward',
  'eastward',
  'westward',
  'northwards',
  'southwards',
  'eastwards',
  'westwards',
  'forward',
  'forwards',
  'on',
  'ahead',
]);

/** Words that point back at the place before, or at where the unit stands. */
const BACK = ['it', 'there', 'them', 'here', 'position', 'ground', 'fast', 'firm', 'its'];

/** An order that leaves the place to the officer: ask where. */
const VAGUE =
  /\b(?:a good|a suitable|a strong|the best|somewhere|anywhere|wherever|as you see fit|as you think fit|useful)\b/;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\b(first|second|third|fourth|fifth)\b/g, (w) => ORDINALS[w] as string)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * An order as words, with its sentence ends kept as `;` and its commas as `,` so that clauses can be
 * told apart. "Col." and the like do not end a sentence, nor does the point or colon in a number.
 */
function normalizeOrder(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(col|maj|gen|capt|lt|st|no|mr)\./g, '$1 ')
    .replace(/[.!?;]+(?!\d)/g, ' ; ')
    .replace(/(?<!\d):|:(?!\d)/g, ' ; ')
    .replace(/,/g, ' , ')
    .replace(/[^a-z0-9\s,;-]/g, ' ')
    .replace(/\b(first|second|third|fourth|fifth)\b/g, (w) => ORDINALS[w] as string)
    .replace(/\s+/g, ' ')
    .trim();
}

const words = (s: string): string[] => s.split(' ').filter(Boolean);

/** `phrase` as whole words inside `text`. */
function hasPhrase(text: string, phrase: string): boolean {
  return phrase !== '' && ` ${text} `.includes(` ${phrase} `);
}

function removePhrase(text: string, phrase: string): string {
  return ` ${text} `.replace(` ${phrase} `, ' ').replace(/\s+/g, ' ').trim();
}

type UnitMatch =
  | { kind: 'none' }
  | { kind: 'one'; unit: Unit; phrase: string }
  | { kind: 'many'; units: Unit[]; phrase: string };

function findUnit(text: string, units: Unit[]): UnitMatch {
  // Exact: the longest full name (or id) in the text. "1st Battalion" beats "1st".
  let best = 0;
  let tied: Unit[] = [];
  let phrase = '';
  for (const u of units) {
    for (const key of [normalize(u.name), u.id.toLowerCase()]) {
      if (!hasPhrase(text, key)) continue;
      if (key.length > best) {
        best = key.length;
        tied = [u];
        phrase = key;
      } else if (key.length === best && !tied.includes(u)) tied.push(u);
    }
  }
  if (tied.length === 1) return { kind: 'one', unit: tied[0] as Unit, phrase };
  if (tied.length > 1) return { kind: 'many', units: tied, phrase };

  // Alias: a branch word ("cavalry") or an ordinal ("the 1st"), meeting the unit's name words.
  for (const word of words(text)) {
    const needles = UNIT_ALIASES[word] ?? (/^\d+(?:st|nd|rd|th)$/.test(word) ? [word] : undefined);
    if (!needles) continue;
    const found = units.filter((u) => {
      const nameWords = words(normalize(u.name));
      return needles.some((n) => nameWords.includes(n));
    });
    if (found.length === 1) return { kind: 'one', unit: found[0] as Unit, phrase: word };
    if (found.length > 1) return { kind: 'many', units: found, phrase: word };
  }
  return { kind: 'none' };
}

type PlaceMatch =
  | { kind: 'one'; place: Place }
  | { kind: 'many'; places: Place[]; noun: string }
  | { kind: 'none' };

const placeLabel = (p: Place): string => p.name ?? `the ${p.kind}`;

function nounsOf(kind: string): string[] {
  return [kind, ...(KIND_WORDS[kind] ?? [])];
}

function findPlace(clause: string, places: Place[]): PlaceMatch {
  // A name in full ("high road", "hollow wood") is the surest sign.
  const named = places
    .filter((p) => p.name && hasPhrase(clause, normalize(p.name).replace(/^the /, '')))
    .sort((a, b) => (b.name as string).length - (a.name as string).length);
  if (named.length > 0) {
    const longest = (named[0]?.name as string).length;
    const top = named.filter((p) => (p.name as string).length === longest);
    return top.length === 1
      ? { kind: 'one', place: top[0] as Place }
      : { kind: 'many', places: top, noun: '' };
  }
  // Otherwise a kind word, narrowed by the other words of each candidate's name ("northern").
  for (const w of words(clause)) {
    const kind =
      Object.keys(KIND_WORDS).find((k) => nounsOf(k).includes(w)) ??
      (places.some((p) => p.kind === w) ? w : undefined);
    if (!kind) continue;
    let ofKind = places.filter((p) => p.kind === kind);
    // A scenario with no ford still has its crossing, and the other way about.
    const alike = CROSSINGS.includes(kind) ? CROSSINGS : [];
    if (ofKind.length === 0) ofKind = places.filter((p) => alike.includes(p.kind));
    if (ofKind.length === 0) return { kind: 'none' };
    const narrowed = ofKind.filter((p) => {
      const qualifiers = words(normalize(p.name ?? '')).filter(
        (q) => q !== 'the' && !nounsOf(kind).includes(q),
      );
      return (
        qualifiers.length > 0 &&
        qualifiers.every(
          (q) => words(clause).includes(q) || words(clause).includes(q.replace(/ern$/, '')),
        )
      );
    });
    const pool = narrowed.length > 0 ? narrowed : ofKind;
    return pool.length === 1
      ? { kind: 'one', place: pool[0] as Place }
      : { kind: 'many', places: pool, noun: w };
  }
  return { kind: 'none' };
}

function leftmostVerb(clause: string): { kind: Kind; index: number; end: number } | undefined {
  // "Line the bank": `line` is a verb only where a clause starts with it.
  const line = /^line\b/.exec(clause);
  if (line) return { kind: 'hold', index: 0, end: line[0].length };
  let found: { kind: Kind; index: number; end: number } | undefined;
  for (const [re, kind] of VERBS) {
    const m = re.exec(clause);
    if (m && (!found || m.index < found.index))
      found = { kind, index: m.index, end: m.index + m[0].length };
  }
  return found;
}

const INJECTION =
  /\b(?:ignore (?:all |the |your )?(?:previous|prior|above)|system prompt|system override|system|umpire note|debug mode|as the umpire|the umpire approves|you are now|reveal your|new instructions|new rule|disregard (?:the|all|your|any|previous)|tell (?:red|blue|the enemy))\b/;

/** Whether `text` addresses the parser or umpire instead of giving an order (prompt injection). */
export function isInjection(text: string): boolean {
  return INJECTION.test(normalize(text));
}

/** A time of day ("noon", "1st light", "2 pm", "14:00", "1400 hours", "at 3, march"). */
const CLOCK =
  '(?:dawn|dusk|noon|midnight|daybreak|nightfall|sunrise|sunset|1st light|' +
  '\\d{1,2}(?::\\d\\d)? ?(?:am|pm|o clock|hours|hrs)|\\d{1,2}:\\d\\d|\\d{3,4} hours|' +
  '\\d{1,4}(?= *(?:$|[,.;]| (?:and|then)\\b)))';

/**
 * A condition or a time in an order ("if pressed", "at noon", "until relieved"). "At once", and a
 * number that is not a time ("in 2 columns", "by 2 roads"), are not one.
 */
const CONDITION_OR_TIME = new RegExp(
  '\\b(?:if|unless|when|whenever|until|before|after|' +
    'once (?:the|we|you|it|they|he|she|our|your|their|in|there|relieved|pressed|attacked)' +
    `|at ${CLOCK}|by ${CLOCK}|in (?:\\d+|an|a|half an) (?:minutes?|mins?|hours?|hrs?))\\b`,
);

/**
 * Whether `order` has a condition or a time the rules cannot express. In turn mode (D39) such an
 * order is "no new order" for the engine, not its plain verb as `testParse` reads it. Read with
 * its punctuation, which tells "at 3, march" (a time) from "at 3 paces".
 */
export function hasConditionOrTime(order: string): boolean {
  const text = order
    .toLowerCase()
    .replace(/[^a-z0-9\s,.;:-]/g, ' ')
    .replace(/\b(first|second|third|fourth|fifth)\b/g, (w) => ORDINALS[w] as string)
    .replace(/\s+/g, ' ')
    .trim();
  return CONDITION_OR_TIME.test(text);
}

/**
 * The sentences of an order, as written. A sentence ends at `.`, `!`, `?`, `;` or a line break; an
 * abbreviation ("Col.") or a number ("2.5") does not end one.
 */
export function sentencesOf(order: string): string[] {
  return order
    .split(/(?<=[.!?;])(?<!\b(?:Col|Maj|Gen|Capt|Lt|St|No|Mr)\.)(?!\d)\s*|\n+/i)
    .map((s) => s.trim())
    .filter((s) => /[a-z0-9]/i.test(s));
}

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

const COMPASS: Record<string, Compass> = {
  north: 'north',
  northern: 'north',
  south: 'south',
  southern: 'south',
  east: 'east',
  eastern: 'east',
  west: 'west',
  western: 'west',
};

/** Metres per unit of length an order may use. A pace is the drill-book 0.75 m. */
const LENGTHS: Record<string, number> = {
  pace: 0.75,
  paces: 0.75,
  yard: 0.9144,
  yards: 0.9144,
  metre: 1,
  metres: 1,
  meter: 1,
  meters: 1,
  m: 1,
};

/** Takes the "where at the place" words out of `object`: what is left names the place. */
function whereOf(object: string): { rest: string; where: RulesWhere } {
  const where: RulesWhere = {};
  let rest = ` ${object} `;
  const take = (re: RegExp, f: (m: RegExpExecArray) => void, keep = '') => {
    const m = re.exec(rest);
    if (!m) return;
    f(m);
    rest = rest.slice(0, m.index) + ` ${keep} ` + rest.slice(m.index + m[0].length);
  };
  take(/ (\d+) (paces?|yards?|metres?|meters?|m) short of /, (m) => {
    where.shortM = Math.round(Number(m[1]) * (LENGTHS[m[2] as string] as number));
  });
  take(
    / (\d+) (paces?|yards?|metres?|meters?|m) (?:to the )?(north|south|east|west)(?:ward)? of /,
    (m) => {
      where.offM = Math.round(Number(m[1]) * (LENGTHS[m[2] as string] as number));
      where.off = m[3] as Compass;
    },
  );
  if (!where.off)
    take(/ (?:to the )?(north|south|east|west)(?:ward)? of /, (m) => {
      where.off = m[1] as Compass;
    });
  take(/ behind /, () => (where.rel = 'behind'));
  take(/ in front of /, () => (where.rel = 'front'));
  // "the south end of the bridge", "its southern edge", "the far bank", "this bank": the part of
  // the place. A bank is still the river's, so the word stays to name it.
  take(
    / (north|south|east|west|northern|southern|eastern|western|near|nearer|far|farther|further|this|other|opposite|our|hither|enemy s|enemy) (end|side|edge|shore|half|bank|banks) /,
    (m) => {
      const w = m[1] as string;
      where.part =
        COMPASS[w] ?? (['near', 'nearer', 'this', 'our', 'hither'].includes(w) ? 'near' : 'far');
    },
  );
  if (where.part && /\b(?:bank|banks)\b/.test(object) && !/\bbanks?\b/.test(rest)) rest += ' bank ';
  return { rest: rest.replace(/\s+/g, ' ').trim(), where };
}

/** Whether a clause says where at the place it means (an end, a distance short of it, a side). */
const hasWhere = (w: RulesWhere) => Object.keys(w).length > 0;

const sameIntent = (a: RulesIntent, b: RulesIntent) =>
  a.kind === b.kind && a.place === b.place && JSON.stringify(a.where) === JSON.stringify(b.where);

/** The parse stage's answer: `rulesParse` in the schema, with no "where at the place". */
export function testParse(input: ParseInput): ParseOrdersOutput {
  const out = rulesParse({ ...input, refs: [] });
  if (!out.intents) return out as ParseOrdersOutput;
  return { ...out, intents: out.intents.map(({ kind, place }) => ({ kind, place })) };
}

export function rulesParse(input: ParseInput): RulesOutput {
  const text = normalizeOrder(input.order);
  const ask = (question: string, options?: string[]): RulesOutput => ({
    result: 'clarification',
    question,
    ...(options && options.length > 0 ? { options } : {}),
  });
  const refuse = (reason: string): RulesOutput => ({ result: 'rejection', reason });
  const bare = (s: string) => s.replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim();

  if (bare(text) === '') return refuse('There is no order here, sir.');
  if (INJECTION.test(bare(text))) return refuse('That is not an order for any unit of ours, sir.');
  if (!leftmostVerb(text))
    return refuse('I cannot find an order in that, sir: march, hold, withdraw or attack?');
  if (VAGUE.test(bare(text)))
    return ask('Where exactly, sir? Name the place.', input.places.map(placeLabel));

  // The unit, wherever it is named; then its words come out so they cannot be taken for a place.
  const match = findUnit(text, input.units);
  if (match.kind === 'many') {
    return ask(
      `"${match.phrase}" could mean more than one unit, sir. Which one?`,
      match.units.map((u) => u.name),
    );
  }
  const rest = match.kind === 'one' ? removePhrase(text, match.phrase) : text;

  if (match.kind === 'one') {
    // Other units named before the verb ("the 1st and 2nd battalions hold ...") are an order to
    // several units, which one answer cannot carry.
    const lead = rest.slice(0, leftmostVerb(rest)?.index ?? 0);
    const others = new Map<string, Unit>();
    let more = findUnit(lead, input.units);
    while (more.kind === 'one' && more.unit !== match.unit && !others.has(more.unit.id)) {
      others.set(more.unit.id, more.unit);
      more = findUnit(removePhrase(lead, more.phrase), input.units);
    }
    if (others.size > 0) {
      return ask(
        'That order names more than one unit, sir, and I can carry it to one at a time. Which first?',
        [match.unit, ...others.values()].map((u) => u.name),
      );
    }
    // A unit named only by a word of its name ("battalion") with more before it that fits nothing
    // ("2nd Battalion" to the 1st) is another unit, not this one.
    const exact = [normalize(match.unit.name), match.unit.id.toLowerCase()].includes(match.phrase);
    const leftover = words(lead).filter((w) => !FILLER.has(w));
    if (!exact && leftover.length > 0)
      return refuse(`I have no unit called "${[...leftover, match.phrase].join(' ')}", sir.`);
  }

  if (match.kind === 'none') {
    const first = leftmostVerb(rest);
    const subject = words(rest.slice(0, first?.index ?? 0)).filter((w) => !FILLER.has(w));
    if (subject.length > 0) return refuse(`I have no unit called "${subject.join(' ')}", sir.`);
  }

  // Clauses, each with its verb and place, and what joined it to the one before.
  const pieces = rest.split(/\s*(,|;|\band then\b|\bthen\b|\band\b|\bafterwards\b|\bbut\b)\s*/);
  const clauses: { text: string; joiner: string[] }[] = [];
  let joiner: string[] = [];
  for (const [i, p] of pieces.entries()) {
    if (i % 2 === 1) joiner.push(p);
    else if (p.trim() !== '') {
      clauses.push({ text: p.trim(), joiner });
      joiner = [];
    }
  }
  const intents: (RulesIntent & { route?: boolean })[] = [];
  let previous: { place: string; where?: RulesWhere } | undefined;
  let lastKind: Kind | undefined;
  let nearestTo: Place | undefined;
  const understood: string[] = [];
  for (const [i, { text: clause, joiner: joined }] of clauses.entries()) {
    const lead = words(clause).filter((w) => !FILLER.has(w));
    // A restriction ("do not fire", "but never cross") adds no move. "Advance but do not move"
    // contradicts itself.
    if (/^(?:do not|don t|dont|never|not|nor)\b/.test(clause)) {
      const v = leftmostVerb(clause);
      const after = v ? words(clause.slice(v.end)).filter((w) => !FILLER.has(w)) : [];
      if (v && (v.kind === 'move' || v.kind === 'withdraw') && after.length === 0) {
        if (intents.some((x) => x.kind !== 'hold'))
          return ask('That order both moves them and forbids it, sir. Which is meant?');
      }
      continue;
    }
    // A clause that fires, reports or lets pass moves nobody.
    if (lead[0] && NO_MOVE.has(lead[0])) continue;
    const found = leftmostVerb(clause);
    if (!found && !lastKind) return refuse('I cannot find an order in that, sir.');
    // A clause with no verb of its own ("... and the ford") repeats the one before.
    const verb = found ?? { kind: lastKind as Kind, end: 0 };
    // What follows the verb, without a trailing condition, time or purpose, nor how it is done.
    let object = clause
      .slice(verb.end)
      .replace(/\b(?:at once|at the double|at the run|immediately|without delay)\b/g, ' ')
      .replace(
        /\b(?:if|unless|once|when|until|at (?:dawn|dusk|noon|midnight)|in \d+ \w+|at all costs|to the last man|so that|so as to|in order to|to (?:hold|cover|support|watch|protect|guard|screen|stop|block|check|draw|keep|show|deceive|distract|fix|draw)\b)\b.*$/,
        '',
      )
      .replace(/\bfacing\b.*$/, '')
      .replace(/\bwhere (?:you|they|it|he) (?:are|is|stand|stands|now stand)\b/g, ' here ')
      .replace(/\byour (?:line|lines|position|ground|post|place)\b/g, ' here ')
      .replace(/\bin place\b/g, ' here ')
      .replace(/\s+/g, ' ')
      .trim();
    // "from the bridge to the ford": the place meant is the one after the last "to". "From the
    // bridge" alone names where they leave, not where they go.
    const ws = words(object);
    let fromOnly = false;
    if (ws.includes('from')) {
      const to = ws.map((w) => w === 'to' || w === 'toward' || w === 'towards').lastIndexOf(true);
      if (to > ws.indexOf('from')) object = ws.slice(to + 1).join(' ');
      else {
        object = ws.slice(0, ws.indexOf('from')).join(' ');
        fromOnly = verb.kind === 'move' || verb.kind === 'withdraw';
      }
    }
    const { rest: placeWords, where } = whereOf(object);
    // "Cross the bridge", "fall back over the river": to its far side.
    if (
      !hasWhere(where) &&
      (verb.kind === 'move' || verb.kind === 'withdraw') &&
      ((found && clause.slice(found.index, found.end) === 'cross') ||
        /^(?:across|over)\b/.test(object))
    )
      where.part = 'far';
    const phrase = words(placeWords).filter((w) => !FILLER.has(w) && !HOW.has(w));
    let refersBack =
      verb.kind === 'watch' ||
      phrase.length === 0 ||
      phrase.includes('here') ||
      phrase.every((w) => BACK.includes(w));
    if (!found && refersBack && !hasWhere(where)) continue;
    // "it to the enemy column": the place before, whatever follows.
    if (!refersBack && BACK.includes(phrase[0] as string)) {
      refersBack = findPlace(placeWords, input.places).kind === 'none';
    }
    let place: string | undefined;
    let placeKind: string | undefined;
    if (refersBack) {
      const here = verb.kind === 'watch' || phrase.includes('here');
      const back = here && verb.kind !== 'watch' ? undefined : previous;
      if (back && !fromOnly) {
        place = back.place;
        placeKind = input.places.find((p) => p.id === back.place)?.kind;
        if (!hasWhere(where) && back.where) Object.assign(where, back.where);
      } else if ((verb.kind === 'hold' || verb.kind === 'watch') && !fromOnly) {
        // "Halt and hold here": one hold where it stands, not two.
        if (lastKind !== 'hold' && lastKind !== 'watch')
          intents.push({ kind: 'hold', place: 'here' });
        previous = { place: 'here' };
        lastKind = 'hold';
        understood.push(clause);
        continue;
      } else {
        return ask(
          `Where should they ${verb.kind === 'move' || verb.kind === 'take' ? 'march' : verb.kind === 'withdraw' ? 'fall back' : verb.kind}, sir?`,
          input.places.map(placeLabel),
        );
      }
    } else {
      const hit = findPlace(placeWords, input.places);
      const ref =
        hit.kind === 'none' && (where.rel || where.off || where.shortM !== undefined)
          ? findUnit(object, input.refs ?? [])
          : ({ kind: 'none' } as UnitMatch);
      if (ref.kind === 'one') {
        place = `unit:${ref.unit.id}`;
      } else if (ref.kind === 'many') {
        return ask(
          `"${ref.phrase}" could mean more than one unit, sir. Which one?`,
          ref.units.map((u) => u.name),
        );
      } else if (hit.kind === 'none' && intents.length > 0) {
        // The one option is the first part as a whole order, for the desk to send as it stands.
        // No commas: the desk splits a clarification's options at ", ".
        const first = understood.join(' and then ');
        const whole = match.kind === 'one' ? `${match.unit.name} ${first}` : first;
        return ask(
          `I know of no place called "${phrase.join(' ')}", sir. Shall I send just the first part?`,
          [whole],
        );
      } else if (hit.kind === 'none') {
        return refuse(`I know of no place called "${phrase.join(' ')}", sir.`);
      } else if (hit.kind === 'many') {
        const noun = hit.noun || hit.places[0]?.kind || 'place';
        return ask(`Which ${noun}, sir?`, hit.places.map(placeLabel));
      } else {
        place = hit.place.id;
        placeKind = hit.place.kind;
        nearestTo ??= hit.place;
      }
    }
    const kind = verb.kind;
    // A hold, and then in the same breath a march, an attack or a retreat, cannot both be done.
    if (
      kind !== 'hold' &&
      kind !== 'watch' &&
      lastKind === 'hold' &&
      found &&
      joined.length > 0 &&
      joined.every((j) => j === 'and' || j === ',') &&
      !/\b(?:if|unless|once|when|until)\b/.test(`${clauses[i - 1]?.text ?? ''} ${clause}`)
    ) {
      return ask('That order says to hold and to go elsewhere at once, sir. Which is meant?');
    }
    const w = hasWhere(where) ? { where: { ...where } } : {};
    const route =
      (kind === 'move' || kind === 'withdraw') &&
      placeKind === 'road' &&
      !hasWhere(where) &&
      /\b(?:down|along|up|via|by)\b/.test(object) &&
      !/\b(?:to|toward|towards|onto)\b/.test(object);
    const at = { place: place as string, ...w };
    if (kind === 'take') {
      intents.push({ kind: 'move', ...at }, { kind: 'hold', ...at });
    } else {
      const k = kind === 'watch' ? 'hold' : kind;
      intents.push({ kind: k, ...at, ...(route ? { route } : {}) });
    }
    previous = at;
    lastKind = kind;
    understood.push(clause);
  }
  if (intents.length === 0) return refuse('I cannot find an order in that, sir.');
  if (intents.some((x) => x.kind === 'withdraw') && intents.some((x) => x.kind === 'attack'))
    return ask('That order says both to fall back and to attack, sir. Which is meant?');

  // A road named as the way ("march down the road") is the route to what follows, not a place to
  // stop; with nothing after it, ask how far.
  const last = intents[intents.length - 1] as (typeof intents)[number];
  if (last.route) return ask('How far along the road, sir? Name the place to make for.');
  // "March down the road and halt short of the river" is a march to that point, then a halt.
  const kept: RulesIntent[] = [];
  for (const [i, { kind, place, where, route }] of intents.entries()) {
    if (route) continue;
    const next: RulesIntent = { kind, place, ...(where ? { where } : {}) };
    if (kind === 'hold' && place !== 'here' && intents[i - 1]?.route)
      kept.push({ ...next, kind: 'move' });
    const prior = kept[kept.length - 1];
    if (prior && sameIntent(prior, next)) continue;
    kept.push(next);
  }

  let unit: Unit | undefined =
    match.kind === 'one' ? match.unit : input.units.find((u) => u.id === input.addressee);
  if (!unit) {
    // No unit named: the nearest to the first place, which is the one that can act soonest.
    const anchor = nearestTo;
    if (!anchor)
      return ask(
        'Which unit is this order for, sir?',
        input.units.map((u) => u.name),
      );
    unit = [...input.units].sort(
      (a, b) => distance(a, anchor) - distance(b, anchor) || (a.id < b.id ? -1 : 1),
    )[0];
  }
  if (!unit) return refuse('There is no unit to carry out that order, sir.');
  return { result: 'intents', unitId: unit.id, intents: kept };
}
