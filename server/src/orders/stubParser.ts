import type { Coord, OrderIntent, OrderParser, ParseContext, ParseResult } from './orderParser.js';

/**
 * Rule-based stand-in for the LLM umpire. Understands a small grammar:
 *
 *   [unit] march|move|advance|go to <place> [and hold]
 *   [unit] hold|defend [<place>]
 *   [unit] withdraw|fall back|retreat to <place>
 *   [unit] attack|assault <place>
 *
 * Units are the issuing side's own, matched by name or id. Places are terrain features
 * (bridge, wood, road) found on the map. No wall clock, no randomness.
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

/** 4-connected components of `terrain` tiles, each reduced to the tile nearest its centroid. */
function features(map: ParseContext['map'], terrain: string): Coord[] {
  const seen = new Set<number>();
  const out: Coord[] = [];
  for (let start = 0; start < map.tiles.length; start++) {
    if (map.tiles[start] !== terrain || seen.has(start)) continue;
    const members: Coord[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const i = stack.pop() as number;
      const x = i % map.width;
      const y = Math.floor(i / map.width);
      members.push({ x, y });
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        const j = ny * map.width + nx;
        if (map.tiles[j] === terrain && !seen.has(j)) {
          seen.add(j);
          stack.push(j);
        }
      }
    }
    members.sort((a, b) => a.y - b.y || a.x - b.x);
    const cx = members.reduce((s, m) => s + m.x, 0) / members.length;
    const cy = members.reduce((s, m) => s + m.y, 0) / members.length;
    let best = members[0] as Coord;
    let bestD = Infinity;
    for (const m of members) {
      const d = (m.x - cx) ** 2 + (m.y - cy) ** 2;
      if (d < bestD) {
        best = m;
        bestD = d;
      }
    }
    out.push(best);
  }
  return out;
}

type PlaceResult =
  | { ok: true; at: Coord }
  | { ok: false; kind: 'clarification'; question: string; options: string[] }
  | { ok: false; kind: 'rejection'; reason: string };

function resolvePlace(phrase: string, ctx: ParseContext): PlaceResult {
  const words = phrase.split(' ').filter((w) => w !== 'the' && w !== 'a');
  const word = words.find((w) => w in PLACE_TERRAIN);
  if (word === undefined) {
    return { ok: false, kind: 'rejection', reason: `I don't know the place "${words.join(' ')}".` };
  }
  const terrain = PLACE_TERRAIN[word] as string;
  const found = features(ctx.map, terrain);
  if (found.length === 0) {
    return { ok: false, kind: 'rejection', reason: `There is no ${terrain} on this map.` };
  }
  if (found.length > 1) {
    const options = found.map((c) => `the ${terrain} at (${c.x}, ${c.y})`);
    return {
      ok: false,
      kind: 'clarification',
      question: `Which ${terrain} do you mean?`,
      options,
    };
  }
  return { ok: true, at: found[0] as Coord };
}

export class StubOrderParser implements OrderParser {
  async parse(orderText: string, context: ParseContext): Promise<ParseResult> {
    const text = orderText;
    const reject = (reason: string): ParseResult => ({ kind: 'rejection', text, reason });
    const norm = normalize(orderText);
    if (norm === '') return reject('The order is empty.');

    let verb: Verb | undefined;
    let verbAt = Infinity;
    let verbEnd = 0;
    for (const [re, v] of VERBS) {
      const m = re.exec(norm);
      if (m && m.index < verbAt) {
        verb = v;
        verbAt = m.index;
        verbEnd = m.index + m[0].length;
      }
    }
    if (verb === undefined)
      return reject('I could not find an action (march, hold, withdraw, attack) in that order.');

    // Subject: whatever precedes the verb.
    const subject = norm.slice(0, verbAt).replace(/^the /, '').trim();
    const own = context.units.filter((u) => u.side === context.side);
    let unitId: string | undefined;
    if (subject === '') {
      return {
        kind: 'clarification',
        text,
        question: 'Which unit is this order for?',
        options: own.map((u) => u.name),
      };
    }
    for (const u of own) {
      const name = normalize(u.name);
      if (
        subject === name ||
        subject === u.id ||
        (name.startsWith(subject) && subject.length >= 3)
      ) {
        if (unitId !== undefined && unitId !== u.id) {
          return {
            kind: 'clarification',
            text,
            question: `"${subject}" could mean more than one unit. Which one?`,
            options: own.filter((o) => normalize(o.name).startsWith(subject)).map((o) => o.name),
          };
        }
        unitId = u.id;
      }
    }
    if (unitId === undefined) return reject(`I don't know a unit called "${subject}".`);

    // Object: what follows the verb, split off a trailing "and hold".
    let rest = norm.slice(verbEnd).trim();
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
        intents.push({ kind: 'hold', at: { ...unit.position } });
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
        : { kind: 'clarification', text, question: place.question, options: place.options };
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
