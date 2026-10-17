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
 * - Orders as commanders write them (#536): a road named as the way to a place (`down the High
 *   road to the river`) is the route there; `follow X` is a march behind X, or by X to a place
 *   named after it; `form`/`deploy`/`rally` at a place is a step on the way when a march follows;
 *   `storm`/`clear` a place is an attack on it (an attack on troops, `charge the enemy column`, is
 *   marked as one); `push on` takes its place from what follows. Manner words (`at the bayonet`,
 *   `against all comers`), asides (`your right on the road`, `beside the Vanguard`, `so that ...`),
 *   fire (`take any column in the flank with your fire`, `spare your powder`) and sentences that
 *   only say how things stand (`the enemy column is on the bridge`) move nobody. A bank named with
 *   another place (`the north bank just east of the bridge`) puts the point on that bank. The
 *   side's other units, named in full, are masked while the order is read, so they are never the
 *   addressee nor a place.
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
  /** How far behind or in front, in metres, when the order says (`300 paces behind the bridge`). */
  relM?: number;
  /** On the unit's own left or right of the place, facing away from its side's rear. */
  flank?: 'left' | 'right';
  /**
   * A bank named with another place (`the north bank just east of the bridge`): the point is put on
   * that bank of this water, toward a compass point, the unit (`near`) or away from it (`far`).
   */
  bankOf?: string;
  bank?: Compass | 'near' | 'far';
  /** Then this far on toward a compass point (`ride west along the bank for a mile`). */
  go?: Compass;
  goM?: number;
}

export interface RulesIntent {
  kind: 'move' | 'hold' | 'attack' | 'withdraw';
  /** A place id, `here` (a hold where the unit stands) or `unit:<id>` (one of `refs`). */
  place: string;
  where?: RulesWhere;
  /** A road the unit takes to the place (`down the High road to the river`): it joins it first. */
  along?: string;
  /**
   * A point the next intent is measured from, not one to stop at: `300 paces short of the bridge,
   * east of the road` is one point, east of the road from the point short of the bridge.
   */
  via?: true;
  /** An attack on enemy troops rather than on a place (`charge the enemy column`). */
  target?: 'unit';
}

export interface RulesOutput extends Omit<ParseOrdersOutput, 'intents'> {
  intents?: RulesIntent[];
}

/**
 * `take` is a move then a hold; `watch` a hold where the unit is, whatever it watches; `form` a hold
 * that a later march makes only a step on the way (`deploy on the bank and take the bridge`);
 * `follow` a march behind another unit of the side, or by its route to a place named after it.
 */
type Kind = 'move' | 'hold' | 'attack' | 'withdraw' | 'take' | 'watch' | 'form' | 'follow';

const VERBS: [RegExp, Kind][] = [
  [
    /\b(?:fall(?:s|ing)? back|pull(?:s|ing)? back|withdraw(?:s|ing)?|retire|retreat(?:s|ing)?)\b/,
    'withdraw',
  ],
  [
    /\b(?:attack(?:s|ing)?|assault(?:s|ing)?|storm(?:s|ing)?|charge(?:s|ing)?|pursue(?:s|ing)?|clear(?= the\b| it\b))\b/,
    'attack',
  ],
  [/\b(?:take|seize|capture|secure)(?! up\b)\b/, 'take'],
  [/\b(?:watch|observe)\b/, 'watch'],
  [
    /\b(?:re-?form|form(?= line\b| column\b| square\b| up\b| on\b| at\b| in\b| into\b| behind\b| across\b| along\b| there\b| here\b)|deploy(?:s|ing)?|rally)\b/,
    'form',
  ],
  [
    /\b(?:hold(?:s|ing)?|defend(?:s|ing)?|screen(?:s|ing)?|picket|garrison|occupy|guard|stand|halt|remain|stay|wait|block|bar|close(?= it\b| the\b)|take up)\b/,
    'hold',
  ],
  [/\bfollow(?:s|ing)?\b/, 'follow'],
  [
    /\b(?:move|march(?:es|ing)?|advance|proceed|go|push|cross|redeploy|shift|continue|ride|reconnoit(?:re|er)|scout|return|come|rejoin|close(?= in\b| up\b| on\b))\b/,
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
  'support',
  'spare',
  'open',
  'look',
  'avoid',
  'pour',
  'swing',
  'wheel',
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
  'about',
  'again',
  'together',
  'yet',
  'men',
  's',
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
  return (
    s
      .toLowerCase()
      .replace(/\b(col|maj|gen|capt|lt|st|no|mr)\./g, '$1 ')
      .replace(/[.!?;]+(?!\d)/g, ' ; ')
      .replace(/(?<!\d):|:(?!\d)/g, ' ; ')
      .replace(/,/g, ' , ')
      .replace(/[^a-z0-9\s,;-]/g, ' ')
      .replace(/\b(first|second|third|fourth|fifth)\b/g, (w) => ORDINALS[w] as string)
      .replace(/\b(a|one|two|three|four|five|six|seven|eight|nine) hundred\b/g, (_, n: string) =>
        String(100 * (HUNDREDS[n] as number)),
      )
      // "The bridge-end" is the end of the bridge on the unit's own side.
      .replace(/\bbridge ?- ?(?:end|head)\b|\bbridgehead\b/g, 'near end of the bridge')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

const HUNDREDS: Record<string, number> = {
  a: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};

/**
 * A sentence that tells the officer how things stand rather than what to do ("The enemy column is
 * on the bridge.", "We will assault together next.", "You are cut off on the far bank."). It moves
 * nobody, and the order is read without it. "You are to hold the bridge" is an order.
 */
const INFO =
  /^(?:we (?:will|shall|are|have)|this is|that is|there (?:is|are)|it is|you are (?!to\b)|you will be|(?:the )?enemy\b[^;,]*?\b(?:is|are|has|have)\b)/;

/**
 * A clause that says how the unit stands with others, or why, and not where it goes: `your left
 * touching the 1st Battalion's right`, `so the two battalions cover the bridge-end`, `beside the
 * Vanguard`, `out of musket range`, `while the Vanguard prepares`.
 */
const ASIDE =
  /^(?:so|while|out of|beside|alongside|next to|(?:your|its|their|his|our) (?:left|right|flank|front|rear))\b/;

/** A clause that fires on something rather than going to it (`take any column in the flank with your fire`). */
const FIRE_CLAUSE =
  /\bwith (?:your |their |its |his |our |whatever )?(?:fire|volleys|musketry)\b|\bin the flank\b/;

/** Words that make an attack one on enemy troops, not on a place (`charge the enemy column`). */
const ENEMY_TROOPS =
  /\b(?:enemy|enemies|him|them|column|columns|battalion|battalions|squadron|squadrons|horse|cavalry|infantry|troops|battery|guns|skirmishers|pickets|rear|flank|head|whoever|any)\b/;

/** Kinds of unit a player may name as a group of the side's own (`behind our infantry`). */
const BRANCHES = new Set(['infantry', 'cavalry', 'horse', 'artillery', 'guns']);

/** Words of a unit's name that do not tell it from another. */
const GENERIC_NAME = new Set([
  'the',
  'battalion',
  'squadron',
  'regiment',
  'company',
  'battery',
  'brigade',
  'division',
  'line',
  'column',
]);

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
  '\\b(?:if|unless|when|whenever|until|(?<!\\bas )before|after|as soon as|' +
    'the moment (?:it|they|he|she|the|you|we)|' +
    'once (?:the|we|you|it|they|he|she|our|your|their|in|there|relieved|pressed|attacked)' +
    `|at ${CLOCK}|by ${CLOCK}|in (?:\\d+|an|a|half an) (?:minutes?|mins?|hours?|hrs?))\\b`,
);

/**
 * How long something is to go on ("fire for ten minutes"). What an order says after it comes after
 * that time, which the rules cannot carry out.
 */
const DURATION =
  /\bfor (?:\d+|a|an|one|two|three|four|five|ten|fifteen|twenty|thirty|half an?) (?:minutes?|mins?|hours?|hrs?)\b/;

/** Whether `sentence` says how long something is to go on, so what follows it is timed. */
export function hasDuration(sentence: string): boolean {
  return DURATION.test(sentence.toLowerCase());
}

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
  mile: 1609,
  miles: 1609,
};
const LENGTH = '(paces?|yards?|metres?|meters?|m)';
const metresOf = (n: string, unit: string) =>
  Math.round((/^\d+$/.test(n) ? Number(n) : 1) * (LENGTHS[unit] as number));

/**
 * Takes the "where at the place" words out of `object`: what is left names the place. `bank` says
 * the object names a bank, which `rulesParse` puts the point on when the place is not the water.
 */
function whereOf(object: string): { rest: string; where: RulesWhere; bank: boolean } {
  const where: RulesWhere = {};
  let rest = ` ${object} `;
  const take = (re: RegExp, f: (m: RegExpExecArray) => void, keep = '') => {
    const m = re.exec(rest);
    if (!m) return;
    f(m);
    rest = rest.slice(0, m.index) + ` ${keep} ` + rest.slice(m.index + m[0].length);
  };
  take(new RegExp(` (\\d+) ${LENGTH} short of `), (m) => {
    where.shortM = metresOf(m[1] as string, m[2] as string);
  });
  // "To within 300 paces of the bridge" stops as far short of it.
  take(new RegExp(` (?:to )?within (\\d+) ${LENGTH} of `), (m) => {
    where.shortM = metresOf(m[1] as string, m[2] as string);
  });
  take(new RegExp(` (\\d+) ${LENGTH} (?:to the )?(north|south|east|west)(?:ward)? of `), (m) => {
    where.offM = metresOf(m[1] as string, m[2] as string);
    where.off = m[3] as Compass;
  });
  // "Just east of the bridge": close by it.
  if (!where.off)
    take(/ just (?:to the )?(north|south|east|west)(?:ward)? of /, (m) => {
      where.off = m[1] as Compass;
      where.offM = 50;
    });
  if (!where.off)
    take(/ (?:to the )?(north|south|east|west)(?:ward)? of /, (m) => {
      where.off = m[1] as Compass;
    });
  take(new RegExp(` (\\d+) ${LENGTH} (behind|in front of) `), (m) => {
    where.relM = metresOf(m[1] as string, m[2] as string);
    where.rel = m[3] === 'behind' ? 'behind' : 'front';
  });
  if (!where.rel) take(/ behind /, () => (where.rel = 'behind'));
  if (!where.rel) take(/ in front of /, () => (where.rel = 'front'));
  // "Deploy on its left": the unit's own left of the place, as it faces the enemy.
  take(/ on (?:its|your|their|his|our|the) (left|right)(?: flank)? /, (m) => {
    where.flank = m[1] as 'left' | 'right';
  });
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
  const bank = /\b(?:bank|banks|riverbank|shore)\b/.test(object);
  if (where.part && bank && !/\bbanks?\b/.test(rest)) rest += ' bank ';
  // "Ride west along the bank for a mile": that far on, the way the order points.
  take(/ for (a|an|one|\d+) (miles?|paces?|yards?|metres?|meters?) /, (m) => {
    const dir = / (north|south|east|west)(?:wards?)? /.exec(rest);
    if (!dir) return;
    where.goM = metresOf(m[1] as string, m[2] as string);
    where.go = dir[1] as Compass;
  });
  return { rest: rest.replace(/\s+/g, ' ').trim(), where, bank };
}

/** Whether a clause says where at the place it means (an end, a distance short of it, a side). */
const hasWhere = (w: RulesWhere) => Object.keys(w).length > 0;

const sameIntent = (a: RulesIntent, b: RulesIntent) =>
  a.kind === b.kind && a.place === b.place && JSON.stringify(a.where) === JSON.stringify(b.where);

/** The parse stage's answer: `rulesParse` in the schema, with no "where at the place". */
export function testParse(input: ParseInput): ParseOrdersOutput {
  const out = rulesParse({ ...input, refs: [] });
  if (!out.intents) return out as ParseOrdersOutput;
  return {
    ...out,
    intents: out.intents.filter((i) => !i.via).map(({ kind, place }) => ({ kind, place })),
  };
}

/** Kinds of ground that are water: a bank is theirs. */
const WATER_KINDS = new Set(['river', 'stream']);

/** One of the side's other units named in an order, or several of a branch (`our infantry`). */
type RefMatch = UnitMatch | { kind: 'group'; units: Unit[]; phrase: string };

/**
 * One of the side's other units in `object`: by its name (masked as `refunit<n>` by `rulesParse`), an
 * alias (`the 1st`, `our infantry`, a group when it fits several) or a word only its name has
 * (`the Vanguard`).
 */
function findRef(object: string, refs: Unit[]): RefMatch {
  const masked = /\brefunit(\d+)\b/.exec(object);
  const named = masked ? refs[Number(masked[1])] : undefined;
  if (masked && named) return { kind: 'one', unit: named, phrase: masked[0] };
  const m = findUnit(object, refs);
  if (m.kind === 'many' && BRANCHES.has(m.phrase)) return { ...m, kind: 'group' };
  if (m.kind !== 'none') return m;
  const ws = words(object);
  for (const w of ws) {
    if (GENERIC_NAME.has(w) || HOW.has(w) || FILLER.has(w) || /^\d/.test(w)) continue;
    const found = refs.filter((u) => words(normalize(u.name)).includes(w));
    if (found.length === 1) return { kind: 'one', unit: found[0] as Unit, phrase: w };
  }
  return { kind: 'none' };
}

/**
 * The words before the order's first verb: where the unit it is for is named. It ends at the first
 * sentence's end, and at a verb that moves nobody (`swing your left wing so the whole battalion
 * fires`), so a unit named later is not taken for the one addressed.
 */
function leadOf(s: string): string {
  let end = leftmostVerb(s)?.index ?? 0;
  const stop = s.indexOf(';');
  if (stop >= 0 && stop < end) end = stop;
  for (const m of s.matchAll(/\b[a-z]+\b/g)) {
    if ((m.index as number) >= end) break;
    if (NO_MOVE.has(m[0])) {
      end = m.index as number;
      break;
    }
  }
  return s.slice(0, end);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

export function rulesParse(input: ParseInput): RulesOutput {
  const refs = input.refs ?? [];
  // A reference unit's name is masked while the order is read, so it is never the addressee's nor a
  // place; the answer names it again.
  const unmask = (s: string) =>
    s.replace(/\brefunit(\d+)\b/g, (t, n: string) => refs[Number(n)]?.name ?? t);
  const ask = (question: string, options?: string[]): RulesOutput => ({
    result: 'clarification',
    question: unmask(question),
    ...(options && options.length > 0 ? { options: options.map(unmask) } : {}),
  });
  const refuse = (reason: string): RulesOutput => ({ result: 'rejection', reason: unmask(reason) });
  const bare = (s: string) => s.replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim();

  const full = normalizeOrder(input.order);
  if (bare(full) === '') return refuse('There is no order here, sir.');
  if (INJECTION.test(bare(full))) return refuse('That is not an order for any unit of ours, sir.');
  // Sentences that say how things stand ("the enemy column is on the bridge") are not read.
  let text = full
    .split(/\s*;\s*/)
    .filter((s) => s !== '' && !INFO.test(s))
    .join(' ; ');
  refs.forEach((u, n) => {
    const name = normalize(u.name);
    if (name) text = text.replace(new RegExp(`\\b${escapeRe(name)}\\b`, 'g'), `refunit${n}`);
  });
  if (bare(text) === '') return refuse('There is no order here, sir.');
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
    const lead = leadOf(rest);
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
    const subject = words(leadOf(rest)).filter((w) => !FILLER.has(w));
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
  type Read = RulesIntent & { route?: boolean; form?: boolean; follow?: boolean };
  const intents: Read[] = [];
  let previous: { place: string; where?: RulesWhere } | undefined;
  let lastKind: Kind | undefined;
  let nearestTo: Place | undefined;
  const understood: string[] = [];
  // "Push on. Clear the south end of the bridge": a march with no place whose place follows.
  let bareMove: RulesOutput | undefined;
  const fail = (out: RulesOutput) => (bareMove && intents.length === 0 ? bareMove : out);
  const kindOf = (place: string) => input.places.find((p) => p.id === place)?.kind;
  const water = input.places.filter((p) => WATER_KINDS.has(p.kind));
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
    // How it stands with others, or why ("your left touching the 1st's right"): no place.
    if (ASIDE.test(clause)) continue;
    // "Drive the enemy off the south end and hold it": no move, but "it" is the south end.
    if (lead[0] === 'drive') {
      const off = / off (?:of )?(.+)$/.exec(` ${clause}`);
      if (off) {
        const { rest: pw, where: w } = whereOf(off[1] as string);
        const hit = findPlace(pw, input.places);
        if (hit.kind === 'one')
          previous = { place: hit.place.id, ...(hasWhere(w) ? { where: w } : {}) };
        else if (hit.kind === 'none' && hasWhere(w) && previous && previous.place !== 'here')
          previous = { place: previous.place, where: w };
      }
      continue;
    }
    // A clause that fires, reports or lets pass moves nobody.
    if (lead[0] && NO_MOVE.has(lead[0])) continue;
    // A tail that says what it is on the lookout for or whom it means ("for any enemy trying to
    // cross", "any enemy who wavers") has no verb of the order in it.
    const core = clause.replace(
      /\s\b(?:for (?!(?:a|an|one|\d+) (?:miles?|paces?|yards?|metres?|meters?)\b)|trying to|who|which|that)\b.*$/,
      '',
    );
    const found = leftmostVerb(core);
    // "Take any column on the bridge in the flank with your fire" fires; it takes nothing.
    if (FIRE_CLAUSE.test(clause) && (!found || found.kind === 'take' || found.kind === 'attack'))
      continue;
    if (!found && !lastKind) return fail(refuse('I cannot find an order in that, sir.'));
    // A clause with no verb of its own ("... and the ford") repeats the one before.
    const verb = found ?? { kind: lastKind as Kind, index: 0, end: 0 };
    let kind: Kind = verb.kind;
    // What follows the verb, without a trailing condition, time or purpose, nor how it is done.
    // Watching holds where the unit is; after a place is ordered it adds nothing.
    if (kind === 'watch' && intents.length > 0) {
      lastKind = 'watch';
      continue;
    }
    let object = core
      .slice(verb.end)
      .replace(
        /\b(?:at once|at the double|at the run|immediately|without delay|at the bayonet|with the bayonet|with bayonets|at a gallop|at the gallop|at the trot|as before|with all speed)\b/g,
        ' ',
      )
      .replace(
        /\b(?:if|unless|once|when|while|until|as soon as|as (?:it|they|he|she|we|you)|the moment|against|out of|for (?!(?:a|an|one|\d+) (?:miles?|paces?|yards?|metres?|meters?)\b)|at (?:dawn|dusk|noon|midnight)|in \d+ \w+|at all costs|to the last man|so that|so as to|in order to|to (?:hold|cover|support|watch|protect|guard|screen|stop|block|check|draw|keep|show|deceive|distract|fix|find|see|look|learn|discover|come|sweep)\b)\b.*$/,
        '',
      )
      .replace(/\bfacing\b.*$/, '')
      .replace(/\bwhere (?:you|they|it|he) (?:are|is|stand|stands|now stand)\b/g, ' here ')
      .replace(/\byour (?:line|lines|position|ground|post|place)\b/g, ' here ')
      .replace(/\bin place\b/g, ' here ')
      .replace(/\s+/g, ' ')
      .trim();
    // "Follow the Vanguard": a march behind it. "Follow it over the bridge": to the place.
    if (kind === 'follow') {
      const ref = findRef(object, refs);
      if (ref.kind === 'none' || ref.kind === 'many')
        return fail(
          ask(
            'Whom should they follow, sir?',
            refs.map((u) => u.name),
          ),
        );
      const after = removePhrase(object, ref.phrase).replace(/^(?:the )+/, '');
      const dest = findPlace(whereOf(after).rest, input.places);
      if (dest.kind === 'one' && dest.place.kind !== 'road') {
        kind = 'move';
        object = after;
      } else {
        const id = 'unit' in ref ? ref.unit.id : ref.units.map((u) => u.id).join(',');
        const at = new RegExp(`\\bat (\\d+) ${LENGTH}\\b`).exec(after);
        const where: RulesWhere = {
          rel: 'behind',
          ...(at ? { relM: metresOf(at[1] as string, at[2] as string) } : {}),
        };
        intents.push({ kind: 'move', place: `unit:${id}`, where, follow: true });
        previous = { place: `unit:${id}`, where };
        lastKind = 'move';
        understood.push(clause);
        continue;
      }
    }
    // "from the bridge to the ford": the place meant is the one after the last "to". "From the
    // bridge" alone names where they leave, not where they go.
    const ws = words(object);
    let fromOnly = false;
    if (ws.includes('from')) {
      const to = ws.map((w) => w === 'to' || w === 'toward' || w === 'towards').lastIndexOf(true);
      if (to > ws.indexOf('from')) object = ws.slice(to + 1).join(' ');
      else {
        object = ws.slice(0, ws.indexOf('from')).join(' ');
        fromOnly = kind === 'move' || kind === 'withdraw';
      }
    }
    // "Down the High road to the river": the road is the way there, the river the place.
    let along: string | undefined;
    const way =
      /^(.*?)\b(?:down|along|up|via|by)\b (.+?) \b(?:to|toward|towards|onto)\b (.+)$/.exec(object);
    if (way) {
      const road = findPlace(way[2] as string, input.places);
      const dest = `${way[1] as string} ${way[3] as string}`.trim();
      if (
        road.kind === 'one' &&
        road.place.kind === 'road' &&
        findPlace(whereOf(dest).rest, input.places).kind !== 'none'
      ) {
        along = road.place.id;
        object = dest;
      }
    }
    const { rest: placeWords, where, bank } = whereOf(object);
    const crossing =
      found !== undefined && kind === 'move' && clause.slice(found.index, found.end) === 'cross';
    // "Cross the bridge", "fall back over the river": to its far side.
    if (
      !hasWhere(where) &&
      (kind === 'move' || kind === 'withdraw') &&
      (crossing || /^(?:across|over)\b/.test(object))
    )
      where.part = 'far';
    const phrase = words(placeWords).filter((w) => !FILLER.has(w) && !HOW.has(w));
    let refersBack =
      kind === 'watch' ||
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
      const here = kind === 'watch' || phrase.includes('here');
      // "Cross at the bayonet" crosses the water or the bridge named before, not the road.
      const lastCrossing = [...intents]
        .reverse()
        .find((x) => ['bridge', 'ford', ...WATER_KINDS].includes(kindOf(x.place) ?? ''));
      const back = crossing
        ? lastCrossing && { place: lastCrossing.place }
        : here && kind !== 'watch'
          ? undefined
          : previous;
      const holdLike = kind === 'hold' || kind === 'watch' || kind === 'form';
      if (back && !fromOnly) {
        place = back.place;
        placeKind = kindOf(back.place);
        if (!hasWhere(where) && back.where) Object.assign(where, back.where);
      } else if (holdLike && !fromOnly) {
        // "Halt and hold here": one hold where it stands, not two.
        if (lastKind !== 'hold' && lastKind !== 'watch' && lastKind !== 'form')
          intents.push({ kind: 'hold', place: 'here' });
        previous = { place: 'here' };
        lastKind = 'hold';
        understood.push(clause);
        continue;
      } else {
        const question = ask(
          `Where should they ${kind === 'move' || kind === 'take' ? 'march' : kind === 'withdraw' ? 'fall back' : kind}, sir?`,
          input.places.map(placeLabel),
        );
        // "Push on" with the place in what follows: read on.
        if (kind === 'move' && found && intents.length === 0 && i < clauses.length - 1) {
          bareMove ??= question;
          lastKind = kind;
          continue;
        }
        return fail(question);
      }
    } else {
      const hit = findPlace(placeWords, input.places);
      const ref =
        hit.kind === 'none' && (where.rel || where.off || where.shortM !== undefined || where.flank)
          ? findRef(object, refs)
          : ({ kind: 'none' } as RefMatch);
      if (ref.kind === 'one') {
        place = `unit:${ref.unit.id}`;
      } else if (ref.kind === 'group') {
        place = `unit:${ref.units.map((u) => u.id).join(',')}`;
      } else if (ref.kind === 'many') {
        return fail(
          ask(
            `"${ref.phrase}" could mean more than one unit, sir. Which one?`,
            ref.units.map((u) => u.name),
          ),
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
        return fail(refuse(`I know of no place called "${phrase.join(' ')}", sir.`));
      } else if (hit.kind === 'many') {
        const noun = hit.noun || hit.places[0]?.kind || 'place';
        return fail(ask(`Which ${noun}, sir?`, hit.places.map(placeLabel)));
      } else {
        place = hit.place.id;
        placeKind = hit.place.kind;
        nearestTo ??= hit.place;
      }
      // "The north bank just east of the bridge": a point by the bridge, on that bank.
      if (bank && placeKind && !WATER_KINDS.has(placeKind) && water.length === 1) {
        where.bankOf = (water[0] as Place).id;
        where.bank = where.part ?? 'near';
        delete where.part;
      }
    }
    // A hold, and then in the same breath a march, an attack or a retreat, cannot both be done.
    if (
      kind !== 'hold' &&
      kind !== 'watch' &&
      kind !== 'form' &&
      lastKind === 'hold' &&
      found &&
      joined.length > 0 &&
      joined.every((j) => j === 'and' || j === ',') &&
      !/\b(?:if|unless|once|when|until)\b/.test(`${clauses[i - 1]?.text ?? ''} ${clause}`)
    ) {
      return ask('That order says to hold and to go elsewhere at once, sir. Which is meant?');
    }
    // ", east of the road" after "300 paces short of the bridge": the same point, put more exactly.
    const last = intents[intents.length - 1];
    if (!found && hasWhere(where) && joined.length > 0 && joined.every((j) => j === ',') && last)
      last.via = true;
    const w = hasWhere(where) ? { where: { ...where } } : {};
    const route =
      (kind === 'move' || kind === 'withdraw') &&
      placeKind === 'road' &&
      (!hasWhere(where) || (Object.keys(where).length === 1 && where.part !== undefined)) &&
      /\b(?:down|along|up|via|by)\b/.test(object) &&
      !/\b(?:to|toward|towards|onto)\b/.test(object);
    const at = { place: place as string, ...w };
    const extra = {
      ...(along ? { along } : {}),
      ...(kind === 'attack' &&
      ENEMY_TROOPS.test(object.replace(/\b(?:in|into) (?:column|columns|line|square)\b/g, ''))
        ? { target: 'unit' as const }
        : {}),
    };
    if (kind === 'take') {
      intents.push({ kind: 'move', ...at, ...extra }, { kind: 'hold', ...at });
    } else {
      const k = kind === 'watch' || kind === 'form' ? 'hold' : kind;
      intents.push({
        kind: k,
        ...at,
        ...extra,
        ...(route ? { route } : {}),
        ...(kind === 'form' ? { form: true } : {}),
      });
    }
    previous = at;
    lastKind = kind;
    understood.push(clause);
  }
  if (intents.length === 0) return bareMove ?? refuse('I cannot find an order in that, sir.');
  if (intents.some((x) => x.kind === 'withdraw') && intents.some((x) => x.kind === 'attack'))
    return ask('That order says both to fall back and to attack, sir. Which is meant?');

  // A road named as the way ("march down the road") is the route to what follows, not a place to
  // stop; with nothing after it, ask how far, unless the order already went somewhere ("cross the
  // bridge and scout along the road": the bridge).
  while (intents.length > 1 && intents[intents.length - 1]?.route) intents.pop();
  const last = intents[intents.length - 1] as Read;
  if (last.route) return ask('How far along the road, sir? Name the place to make for.');
  const moves = (x: Read) =>
    !x.via && !x.route && (x.kind === 'move' || x.kind === 'withdraw' || x.kind === 'attack');
  // "March down the road and halt short of the river" is a march to that point, then a halt.
  // "Follow the Vanguard ... and form on the bank": the following is how it gets there.
  // "Deploy on the bank and take the bridge": the deploying is a step on the way.
  const kept: RulesIntent[] = [];
  let road: string | undefined;
  for (const [i, x] of intents.entries()) {
    const { route, form, follow, ...intent } = x;
    if (route) {
      road = intent.place;
      continue;
    }
    const later = intents.slice(i + 1);
    if (follow && later.some((y) => !y.route)) continue;
    if (form && later.some(moves)) continue;
    const next: RulesIntent = { ...intent, ...(road && !intent.along ? { along: road } : {}) };
    road = undefined;
    if (next.kind === 'hold' && next.place !== 'here' && intents[i - 1]?.route)
      kept.push({ ...next, kind: 'move' });
    const prior = kept[kept.length - 1];
    if (prior && sameIntent(prior, next) && !prior.via) continue;
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
