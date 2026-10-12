/**
 * The test provider's `parse` stage: understands ordinary sentences with no model. It reads the
 * same input the real prompt gets (the order text, the side's units, the named places) and answers
 * in the same schema, so the parser, its checks and the engine treat it like any model.
 *
 * Rules, all deterministic:
 * - A unit is found by id, full name, or an alias (`the cavalry`, `the guns`, `the 1st`). Several
 *   fits and no exact name: ask which. No unit named: the unit nearest the first place is meant.
 *   Words before the verb that fit no unit: refuse.
 * - The order is split into clauses at `and`, `then` and commas. Each clause has a verb (move,
 *   hold/defend/screen, withdraw/fall back, attack) and a place. `it`, `there` or no place in a
 *   later `hold` clause means the place before it; a first `hold` with no place holds `here`. A
 *   later clause with no verb but a place (`hold the bridge and the ford`) takes the verb before
 *   it; with neither, the clause is not understood and the first part is offered on its own.
 *   `from X to Y` means Y: the place after the last `to`/`toward`.
 * - An order that names several units (`the 1st and 2nd battalions`) asks which one first, since
 *   an answer carries one unit.
 * - A place is found by its name, or by its kind (`the wood`) narrowed by words in its name
 *   (`the northern wood`). Several fits: ask which. None: refuse.
 * - Conditions and times ("if pressed", "at noon") are ignored; the intents are the plain order.
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
}

type Kind = 'move' | 'hold' | 'attack' | 'withdraw';

const VERBS: [RegExp, Kind][] = [
  [
    /\b(?:fall(?:s|ing)? back|pull(?:s|ing)? back|withdraw(?:s|ing)?|retire|retreat(?:s|ing)?)\b/,
    'withdraw',
  ],
  [/\b(?:attack(?:s|ing)?|assault(?:s|ing)?|storm(?:s|ing)?|charge(?:s|ing)?)\b/, 'attack'],
  [
    /\b(?:hold(?:s|ing)?|defend(?:s|ing)?|screen(?:s|ing)?|picket|garrison|occupy|guard|stand)\b/,
    'hold',
  ],
  [/\b(?:move|march(?:es|ing)?|advance|proceed|go|push|cross|redeploy|shift)\b/, 'move'],
];

/** Words a player uses for a kind of ground; the kind itself always counts too. */
const KIND_WORDS: Record<string, string[]> = {
  wood: ['wood', 'woods', 'woodland', 'forest', 'trees'],
  bridge: ['bridge', 'crossing'],
  river: ['river', 'stream'],
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
  'toward',
  'towards',
  'by',
  'of',
  'back',
  'up',
  'please',
]);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
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
  let found: { kind: Kind; index: number; end: number } | undefined;
  for (const [re, kind] of VERBS) {
    const m = re.exec(clause);
    if (m && (!found || m.index < found.index))
      found = { kind, index: m.index, end: m.index + m[0].length };
  }
  return found;
}

const INJECTION =
  /\b(?:ignore (?:all |the |your )?(?:previous|prior|above)|system prompt|you are now|reveal your|new instructions)\b/;

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

export function testParse(input: ParseInput): ParseOrdersOutput {
  const text = normalize(input.order);
  const ask = (question: string, options?: string[]): ParseOrdersOutput => ({
    result: 'clarification',
    question,
    ...(options && options.length > 0 ? { options } : {}),
  });
  const refuse = (reason: string): ParseOrdersOutput => ({ result: 'rejection', reason });

  if (text === '') return refuse('There is no order here, sir.');
  if (INJECTION.test(text)) return refuse('That is not an order for any unit of ours, sir.');
  if (!leftmostVerb(text))
    return refuse('I cannot find an order in that, sir: march, hold, withdraw or attack?');

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
  }

  if (match.kind === 'none') {
    const first = leftmostVerb(rest);
    const subject = words(rest.slice(0, first?.index ?? 0)).filter((w) => !FILLER.has(w));
    if (subject.length > 0) return refuse(`I have no unit called "${subject.join(' ')}", sir.`);
  }

  // Clauses, each with its verb and place.
  const clauses = rest
    .split(/\s*(?:,|;|\band then\b|\bthen\b|\band\b|\bafterwards\b)\s*/)
    .map((c) => c.trim())
    .filter(Boolean);
  const intents: NonNullable<ParseOrdersOutput['intents']> = [];
  let previous: Place | undefined;
  let lastKind: Kind | undefined;
  let nearestTo: Place | undefined;
  for (const [i, clause] of clauses.entries()) {
    const found = leftmostVerb(clause);
    if (!found && !lastKind) return refuse('I cannot find an order in that, sir.');
    // A clause with no verb of its own ("... and the ford") repeats the one before.
    const verb = found ?? { kind: lastKind as Kind, end: 0 };
    // What follows the verb, without a trailing condition or time.
    let object = clause
      .slice(verb.end)
      .replace(
        /\b(?:if|unless|once|when|until|at (?:dawn|dusk|noon|midnight)|in \d+ \w+|at all costs)\b.*$/,
        '',
      )
      .trim();
    // "from the bridge to the ford": the place meant is the one after the last "to".
    const ws = words(object);
    if (ws.includes('from')) {
      const to = ws.map((w) => w === 'to' || w === 'toward' || w === 'towards').lastIndexOf(true);
      if (to >= 0) object = ws.slice(to + 1).join(' ');
    }
    const phrase = words(object).filter((w) => !FILLER.has(w));
    const refersBack =
      phrase.length === 0 ||
      phrase.every((w) => ['it', 'there', 'them', 'here', 'position', 'ground'].includes(w));
    if (!found && refersBack) continue;
    let place: Place | undefined;
    if (refersBack) {
      place = previous;
      if (!place && verb.kind === 'hold') {
        intents.push({ kind: 'hold', place: 'here' });
        lastKind = 'hold';
        continue;
      }
      if (!place)
        return ask(
          `Where should they ${verb.kind === 'move' ? 'march' : verb.kind === 'withdraw' ? 'fall back' : verb.kind}, sir?`,
          input.places.map(placeLabel),
        );
    } else {
      const hit = findPlace(object, input.places);
      if (hit.kind === 'none' && intents.length > 0) {
        // The one option is the first part as a whole order, for the desk to send as it stands.
        // No commas: the desk splits a clarification's options at ", ".
        const first = clauses.slice(0, i).join(' and then ');
        const whole = match.kind === 'one' ? `${match.unit.name} ${first}` : first;
        return ask(
          `I know of no place called "${phrase.join(' ')}", sir. Shall I send just the first part?`,
          [whole],
        );
      }
      if (hit.kind === 'none')
        return refuse(`I know of no place called "${phrase.join(' ')}", sir.`);
      if (hit.kind === 'many') {
        const noun = hit.noun || hit.places[0]?.kind || 'place';
        return ask(`Which ${noun}, sir?`, hit.places.map(placeLabel));
      }
      place = hit.place;
    }
    nearestTo ??= place;
    previous = place;
    lastKind = verb.kind;
    intents.push({ kind: verb.kind, place: place.id });
  }
  if (intents.length === 0) return refuse('I cannot find an order in that, sir.');

  let unit: Unit | undefined = match.kind === 'one' ? match.unit : undefined;
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
  return { result: 'intents', unitId: unit.id, intents };
}
