import {
  type Contact,
  type Point,
  type Scenario,
  type Turn,
  type Unit,
  clock,
  dist,
  stageOf,
} from './sim';

/**
 * The chief of staff's summary of a turn (#443 point 4), from a template: what our units did, which fights they are in
 * and how those stand, and what we saw of the enemy. Each paragraph is a list of pieces; a piece that names a unit
 * carries its id, so the page can make the name a link that finds it on the board.
 */
export interface Piece {
  text: string;
  unit?: string;
}

export interface Report {
  heading: string;
  /** One line that says what matters most this turn. */
  gist: string;
  /** Our fights, one paragraph each, then one for the units not fighting. */
  paragraphs: Piece[][];
  /** One line per enemy body known, newest sighting first. */
  enemy: Piece[][];
}

const men = (n: number) => `${n} ${n === 1 ? 'man' : 'men'}`;

const STAGE_WORDS: Record<string, string> = {
  fresh: 'is fresh',
  engaged: 'is engaged',
  losses: 'is taking losses',
  wavering: 'is wavering',
  broken: 'has broken and is falling back',
};

/** A place name for a point: "at the bridge", "in Brandt wood", "800 m north of the bridge". */
export function placeName(s: Scenario, p: Point): string {
  const wood = s.features.find((f) => f.kind === 'wood');
  if (wood && inside(p, wood.points)) return `in ${wood.name}`;
  const bridge = s.features.find((f) => f.kind === 'bridge')!.points[0]!;
  const d = dist(p, bridge);
  if (d < 150) return 'at the bridge';
  const dir = compass(bridge, p);
  return `${Math.round(d / 100) * 100} m ${dir} of the bridge`;
}

function inside(p: Point, poly: Point[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

function compass(from: Point, to: Point): string {
  const a = (Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI;
  const names = [
    'north',
    'north-east',
    'east',
    'south-east',
    'south',
    'south-west',
    'west',
    'north-west',
  ];
  return names[(Math.round(((a + 360) % 360) / 45) % 8) as number]!;
}

const sizeWords = (c: Contact) => `${c.size[0]}–${c.size[1]}`;
const ARM_WORD: Record<string, string> = {
  infantry: 'infantry',
  cavalry: 'horse',
  artillery: 'guns',
};

export function enemyLabel(c: Contact): string {
  return `enemy ${ARM_WORD[c.arm]} ${c.letter} (${sizeWords(c)})`;
}

/**
 * The report for `turn`, comparing it with `prev`. Our own units are named; the enemy is described by what was
 * seen of it, never by its true name or strength.
 */
export function chiefOfStaffReport(s: Scenario, prev: Turn, turn: Turn): Report {
  const own = turn.units.filter((u) => u.side === 'blue');
  const before = new Map(prev.units.map((u) => [u.id, u]));
  const contacts = new Map(turn.contacts.map((c) => [c.id, c]));
  const unitPiece = (u: Unit): Piece => ({ text: u.name, unit: u.id });
  const enemyPiece = (id: string): Piece => {
    const c = contacts.get(id);
    return { text: c ? enemyLabel(c) : 'the enemy', unit: id };
  };

  const fights: Piece[][] = [];
  const quiet: Piece[] = [];
  for (const u of own) {
    const was = before.get(u.id)!;
    const lost = Math.round(was.strength - u.strength);
    const stage = stageOf(u);
    const contact = turn.events.find((e) => e.unit === u.id && e.kind === 'contact');
    if (stage === 'broken' && was.stage !== 'broken') {
      fights.push([
        unitPiece(u),
        {
          text: ` broke at ${clock(turn.events.find((e) => e.kind === 'broken' && e.unit === u.id)?.minute ?? turn.to)}`,
        },
        { text: lost > 0 ? ` after losing ${men(lost)} this turn` : '' },
        { text: ` and is falling back ${placeName(s, u.pos)}.` },
      ]);
    } else if (u.contact || was.contact) {
      const foe = (u.contact ?? was.contact)!;
      fights.push([
        unitPiece(u),
        { text: contact ? ` met ` : ` is fighting ` },
        enemyPiece(foe),
        { text: ` ${placeName(s, u.pos)}` },
        {
          text: `${contact ? ` at ${clock(contact.minute)}` : ''}; ${lost > 0 ? `lost ${men(lost)}, ` : ''}it ${STAGE_WORDS[stage]}.`,
        },
      ]);
    } else if (lost > 0) {
      fights.push([
        unitPiece(u),
        {
          text: ` came under fire ${placeName(s, u.pos)} and lost ${men(lost)}; it ${STAGE_WORDS[stage]}.`,
        },
      ]);
    } else {
      const metres = turn.events.find((e) => e.unit === u.id && e.kind === 'moved')?.metres;
      quiet.push(unitPiece(u), {
        text: metres
          ? ` moved ${Math.round(metres / 50) * 50} m to ${placeName(s, u.pos)}; `
          : ` holds ${placeName(s, u.pos)}; `,
      });
    }
  }

  const enemy: Piece[][] = [];
  const known = [...turn.contacts].sort((a, b) => b.seenAt - a.seenAt);
  for (const c of known) {
    const age = turn.to - c.seenAt;
    const moved = turn.events.find((e) => e.kind === 'enemy-moved' && e.unit === c.id);
    const isNew = !prev.contacts.some((p) => p.id === c.id);
    enemy.push([
      { text: isNew ? 'New: ' : '' },
      enemyPiece(c.id),
      {
        text:
          age === 0
            ? ` ${placeName(s, c.pos)}${moved ? `, moved ${Math.round((moved.metres ?? 0) / 50) * 50} m this turn` : ', not moving'}${c.stage === 'broken' ? ', in flight' : ''}.`
            : ` last seen ${placeName(s, c.pos)} at ${clock(c.seenAt)} (${age} min ago).`,
      },
    ]);
  }

  const broken = own.filter((u) => stageOf(u) === 'broken' && before.get(u.id)!.stage !== 'broken');
  const fighting = own.filter((u) => u.contact);
  const waver = own.filter((u) => stageOf(u) === 'wavering');
  const fleeing = turn.contacts.filter((c) => c.stage === 'broken' && turn.to === c.seenAt);
  const gist = broken.length
    ? `${broken.map((u) => u.name).join(' and ')} broke.`
    : fleeing.length
      ? `The enemy ${fleeing.length > 1 ? 'units' : 'unit'} at our front ${fleeing.length > 1 ? 'are' : 'is'} in flight.`
      : waver.length
        ? `${waver.map((u) => u.name).join(' and ')} ${waver.length > 1 ? 'are' : 'is'} wavering; support or withdraw ${waver.length > 1 ? 'them' : 'it'}.`
        : fighting.length
          ? `${fighting.map((u) => u.name).join(' and ')} ${fighting.length > 1 ? 'are' : 'is'} in action.`
          : turn.contacts.length
            ? `No fighting. ${turn.contacts.length} enemy ${turn.contacts.length > 1 ? 'bodies' : 'body'} known.`
            : 'No fighting and no enemy seen.';

  const paragraphs: Piece[][] = [...fights];
  if (quiet.length) paragraphs.push(trimTail(quiet));
  return {
    heading: `Turn ${turn.n}, ${clock(turn.from)} to ${clock(turn.to)}`,
    gist,
    paragraphs,
    enemy,
  };
}

/** End a run of "…; " pieces with a full stop. */
function trimTail(pieces: Piece[]): Piece[] {
  const last = pieces[pieces.length - 1]!;
  return [...pieces.slice(0, -1), { ...last, text: last.text.replace(/; $/, '.') }];
}
