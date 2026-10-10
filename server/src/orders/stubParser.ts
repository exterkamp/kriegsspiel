import type {
  Coord,
  OrderIntent,
  OrderParser,
  ParseContext,
  ParseFeature,
  ParseResult,
} from './orderParser.js';

/**
 * Rule-based stand-in for the LLM umpire. Understands a small grammar:
 *
 *   [unit] march|move|advance|go to <place> [and hold]
 *   [unit] hold|defend [<place>]
 *   [unit] withdraw|fall back|retreat to <place>
 *   [unit] attack|assault <place>
 *
 * Units are the issuing side's own, matched by name or id. Places are terrain features
 * (bridge, wood, road) found on the map, each as the anchor point of its feature. No wall clock, no randomness.
 */

type Verb = 'move' | 'hold' | 'withdraw' | 'attack';

const VERBS: [RegExp, Verb][] = [
  [/\b(march(?:es)?|move|advance|proceed|go)\b/, 'move'],
  [/\b(hold|defend|occupy)\b/, 'hold'],
  [/\b(withdraw|fall back|retreat|pull back)\b/, 'withdraw'],
  [/\b(attack|assault|storm)\b/, 'attack'],
];

const PLACE_TERRAIN: Record<string, string> = {
  bridge: 'bridge',
  bridges: 'bridge',
  wood: 'wood',
  woods: 'wood',
  forest: 'wood',
  road: 'road',
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The places on the map of one terrain kind, in feature id order. */
function features(map: ParseContext['map'], kind: string): ParseFeature[] {
  return map.features.filter((f) => f.kind === kind).sort((a, b) => (a.id < b.id ? -1 : 1));
}

type PlaceResult =
  | { ok: true; at: Coord }
  | { ok: false; kind: 'clarification'; question: string; options: string[] }
  | { ok: false; kind: 'rejection'; reason: string };

function resolvePlace(phrase: string, ctx: ParseContext): PlaceResult {
  const words = phrase.split(' ').filter((w) => w !== 'the' && w !== 'a');
  const word = words.find((w) => Object.hasOwn(PLACE_TERRAIN, w));
  if (word === undefined) {
    return { ok: false, kind: 'rejection', reason: `I don't know the place "${words.join(' ')}".` };
  }
  // Exactly one place word and nothing else, so a second clause is never silently dropped.
  if (words.length !== 1) {
    return {
      ok: false,
      kind: 'clarification',
      question: `I could not fully understand "${phrase}". Please give one action and one place at a time.`,
      options: [],
    };
  }
  const terrain = PLACE_TERRAIN[word] as string;
  const found = features(ctx.map, terrain);
  if (found.length === 0) {
    return { ok: false, kind: 'rejection', reason: `There is no ${terrain} on this map.` };
  }
  if (found.length > 1) {
    const options = found.map(
      (f) => `the ${f.name ?? terrain} at (${f.anchor.x / 1000}, ${f.anchor.y / 1000}) m`,
    );
    return {
      ok: false,
      kind: 'clarification',
      question: `Which ${terrain} do you mean?`,
      options,
    };
  }
  return { ok: true, at: { ...(found[0] as ParseFeature).anchor } };
}

export class StubOrderParser implements OrderParser {
  async parse(orderText: string, context: ParseContext): Promise<ParseResult> {
    const text = orderText;
    const reject = (reason: string): ParseResult => ({ kind: 'rejection', text, reason });
    const norm = normalize(orderText);
    if (norm === '') return reject('The order is empty.');

    const own = context.units.filter((u) => u.side === context.side);

    // Unit first: a unit name (or id) at the start of the order wins over any verb word inside
    // it ("Advance Guard march to the bridge"). Longest match wins ("1st Battalion Reserve").
    let unitId: string | undefined;
    let remainder: string | undefined;
    const text0 = norm.replace(/^the /, '');
    let bestLen = 0;
    let tied: string[] = [];
    for (const u of own) {
      for (const key of [normalize(u.name), u.id]) {
        if (key === '' || !(text0 === key || text0.startsWith(`${key} `))) continue;
        if (key.length > bestLen) {
          bestLen = key.length;
          tied = [u.id];
        } else if (key.length === bestLen && !tied.includes(u.id)) {
          tied.push(u.id);
        }
      }
    }
    if (tied.length > 1) {
      return {
        kind: 'clarification',
        text,
        question: `"${text0.slice(0, bestLen)}" could mean more than one unit. Which one?`,
        options: own.filter((u) => tied.includes(u.id)).map((u) => u.name),
      };
    }
    if (tied.length === 1) {
      unitId = tied[0];
      remainder = text0.slice(bestLen).trim();
    }

    // Otherwise the subject is whatever precedes the leftmost verb.
    let verb: Verb | undefined;
    let verbEnd = 0;
    const search = remainder ?? norm;
    let verbAt = Infinity;
    for (const [re, v] of VERBS) {
      const m = re.exec(search);
      if (m && m.index < verbAt) {
        verb = v;
        verbAt = m.index;
        verbEnd = m.index + m[0].length;
      }
    }
    if (verb === undefined)
      return reject('I could not find an action (march, hold, withdraw, attack) in that order.');
    if (remainder !== undefined && search.slice(0, verbAt).trim() !== '') {
      return reject(
        `I could not understand "${search.slice(0, verbAt).trim()}" before the action.`,
      );
    }

    if (unitId === undefined) {
      const subject = norm.slice(0, verbAt).replace(/^the /, '').trim();
      if (subject === '') {
        return {
          kind: 'clarification',
          text,
          question: 'Which unit is this order for?',
          options: own.map((u) => u.name),
        };
      }
      // An exact name or id beats a prefix match, so "1st Battalion" can be addressed
      // even when "1st Battalion Reserve" exists.
      const exact = own.filter((u) => subject === normalize(u.name) || subject === u.id);
      const matched =
        exact.length > 0
          ? exact
          : subject.length >= 3
            ? own.filter((u) => normalize(u.name).startsWith(subject))
            : [];
      if (matched.length > 1) {
        return {
          kind: 'clarification',
          text,
          question: `"${subject}" could mean more than one unit. Which one?`,
          options: matched.map((u) => u.name),
        };
      }
      if (matched.length === 0) return reject(`I don't know a unit called "${subject}".`);
      unitId = (matched[0] as (typeof own)[number]).id;
    }
    const rest0 = search.slice(verbEnd).trim();

    // Object: what follows the verb, split off a trailing "and hold".
    let rest = rest0;
    let thenHold = false;
    const tail = /\s*\band (?:then )?(?:hold|defend|occupy)(?: there| it)?$/.exec(rest);
    if (tail && verb === 'move') {
      thenHold = true;
      rest = rest.slice(0, tail.index);
    }
    // Drop a bare "back" ("fall back" is consumed, "pull back" etc.) and prepositions.
    const phrase = rest.replace(/^(?:back |on |in |at |to |towards |toward |into )+/, '').trim();

    const intents: OrderIntent[] = [];
    if (phrase === '') {
      if (verb === 'hold') {
        const unit = own.find((u) => u.id === unitId) as (typeof own)[number];
        intents.push({ kind: 'hold', at: { ...unit.center } });
        return { kind: 'intents', text, unitId, intents };
      }
      return {
        kind: 'clarification',
        text,
        question: `Where should they ${verb === 'move' ? 'march' : verb}?`,
      };
    }
    const place = resolvePlace(phrase, context);
    if (!place.ok) {
      return place.kind === 'rejection'
        ? reject(place.reason)
        : {
            kind: 'clarification',
            text,
            question: place.question,
            options: place.options.length > 0 ? place.options : undefined,
          };
    }
    const at = place.at;
    switch (verb) {
      case 'move':
        intents.push({ kind: 'move', to: at });
        if (thenHold) intents.push({ kind: 'hold', at: { ...at } });
        break;
      case 'hold':
        intents.push({ kind: 'hold', at });
        break;
      case 'withdraw':
        intents.push({ kind: 'withdraw', toward: at });
        break;
      case 'attack':
        intents.push({ kind: 'attack', target: at });
        break;
    }
    return { kind: 'intents', text, unitId, intents };
  }
}
