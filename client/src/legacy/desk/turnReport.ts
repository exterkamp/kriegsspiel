/**
 * What a turn did, for a first-time player of a turn-mode game (D39, #439): each own unit's status on the desk,
 * the staff's summary paper filed after each turn, and where the turn's fighting was. Pure, and built only from
 * what the side's own view and papers say: nothing here knows more than the side does.
 */
import type { Coord, Dispatch, SideView, TurnOrder } from '@kriegsspiel/protocol';
import type { PendingOrder } from '../net/state.js';
import { ENGAGE_RANGE_M } from '../table/sceneState.js';
import { orderProgress } from './orders.js';
import { timeOfDay } from './turn.js';

/** An own unit as it stood when a turn opened, kept to tell what the turn changed. */
export interface UnitSnap {
  id: string;
  name: string;
  position: Coord;
  strength?: number;
}

export const snapUnits = (view: Pick<SideView, 'ownUnits'>): UnitSnap[] =>
  view.ownUnits.map((u) => ({
    id: u.id,
    name: u.name,
    position: u.position,
    ...(u.strength === undefined ? {} : { strength: u.strength }),
  }));

/**
 * The turn a paper came in with. Turn `n` covers `[(n - 1) x turnMs, n x turnMs)` (D39), and what is handed in at
 * its end comes with it, so a paper received at exactly `n x turnMs` is turn `n`'s.
 */
export const turnOfPaper = (receivedAtGame: number, turnMs: number): number =>
  Math.max(1, Math.ceil(receivedAtGame / turnMs));

/** The papers that came in with turn `n`. */
export const papersOfTurn = (
  dispatches: readonly Dispatch[],
  n: number,
  turnMs: number,
): Dispatch[] => dispatches.filter((d) => turnOfPaper(d.receivedAtGame, turnMs) === n);

/** `about 750 men`: a unit's strength as the staff would round it. */
export function menBand(men: number | undefined): string {
  if (men === undefined || !Number.isFinite(men)) return 'not reported';
  if (men <= 0) return 'none left';
  if (men < 50) return 'a handful of men';
  return `about ${Math.round(men / 50) * 50} men`;
}

/** Morale in a word, from the 0..1 figure. */
export function moraleBand(morale: number | undefined): string {
  if (morale === undefined || !Number.isFinite(morale)) return 'not reported';
  if (morale >= 0.75) return 'steady';
  if (morale >= 0.5) return 'shaken';
  if (morale >= 0.25) return 'wavering';
  return 'breaking';
}

const roundLoss = (lost: number): string =>
  lost < 10 ? 'a few men' : `about ${Math.round(lost / 10) * 10} men`;

/** A turn's loss in a band and a round figure: `none`, `light, about 20 men`, `heavy, about 120 men`. */
export function lossBand(before: number, after: number): string {
  const lost = Math.max(0, Math.round(before - after));
  if (lost === 0) return 'none';
  const f = before > 0 ? lost / before : 1;
  const word = f < 0.05 ? 'light' : f < 0.15 ? 'moderate' : f < 0.3 ? 'heavy' : 'very heavy';
  return `${word}, ${roundLoss(lost)}`;
}

/** Eight-point compass word for a move of `dx` east and `dy` south. */
export function compass(dx: number, dy: number): string {
  const names = [
    'east',
    'south-east',
    'south',
    'south-west',
    'west',
    'north-west',
    'north',
    'north-east',
  ];
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return names[((octant % 8) + 8) % 8]!;
}

/** Closer than this, two papers or fights are taken to be about the same place. */
const SAME_PLACE_M = 300;

const dist = (a: Coord, b: Coord): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Fighting, as the papers report it: a unit in action, hurt, broken or lost, or an enemy destroyed. */
const FIGHT_KINDS = new Set<Dispatch['kind']>([
  'engaged',
  'heavyLosses',
  'broke',
  'destroyed',
  'unitLost',
]);

export const isFight = (d: Dispatch): boolean => FIGHT_KINDS.has(d.kind);

const byWritten = (a: Dispatch, b: Dispatch): number =>
  a.writtenAtGame - b.writtenAtGame || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** `00:12`, or `00:12 to 00:18` for a span. */
const span = (from: number, to: number): string =>
  from === to ? timeOfDay(from) : `${timeOfDay(from)} to ${timeOfDay(to)}`;

/** Sightings of one enemy body: papers that saw the same strength at the same place. */
export interface Sighting {
  size: string;
  place: string;
  papers: Dispatch[];
}

/**
 * Contact papers merged where they report the same thing: the same strength at the same place (in words, or
 * within 300 m when a paper gives no place). Scouts watching one battalion for a turn send a paper each time
 * they look; this is that battalion once (#439). In written order.
 */
export function sightings(papers: readonly Dispatch[]): Sighting[] {
  const out: Sighting[] = [];
  for (const d of [...papers].filter((x) => x.kind === 'contact').sort(byWritten)) {
    const size = d.sizeEstimate ?? 'enemy troops';
    const same = out.find(
      (s) =>
        s.size === size &&
        (d.place !== undefined && s.papers[0]!.place !== undefined
          ? s.papers[0]!.place === d.place
          : !!d.location &&
            !!s.papers[0]!.location &&
            dist(d.location, s.papers[0]!.location) <= SAME_PLACE_M),
    );
    if (same) same.papers.push(d);
    else out.push({ size, place: d.place ?? 'where the sketch shows', papers: [d] });
  }
  return out;
}

/** A place where the turn's papers report fighting, for the map table. */
export interface TurnFight {
  id: string;
  position: Coord;
  /** `Fought 00:12`, or `Fought 00:12 to 00:18`. */
  label: string;
}

/** Where the turn's papers report fighting, one marker per place, with the times (#439). */
export function turnFights(papers: readonly Dispatch[], turn: number): TurnFight[] {
  const spots: { position: Coord; from: number; to: number }[] = [];
  for (const d of [...papers].filter(isFight).sort(byWritten)) {
    if (!d.location) continue;
    const near = spots.find((s) => dist(s.position, d.location!) <= SAME_PLACE_M);
    if (near) near.to = Math.max(near.to, d.writtenAtGame);
    else spots.push({ position: d.location, from: d.writtenAtGame, to: d.writtenAtGame });
  }
  return spots.map((s, i) => ({
    id: `fought-${turn}-${i}`,
    position: s.position,
    label: `Fought ${span(s.from, s.to)}`,
  }));
}

/** What a unit is doing, as its latest paper or the table says. */
function doingOf(
  unit: SideView['ownUnits'][number],
  papers: readonly Dispatch[],
  marching: boolean,
  enemies: SideView['visibleEnemies'],
): string {
  if (unit.strength !== undefined && unit.strength <= 0) return 'Destroyed';
  const own = papers.filter((d) => d.from === unit.name).sort(byWritten);
  // A sighting after a fight does not end the fight: the latest word that is not a sighting tells.
  const last = own.filter((d) => d.kind !== 'contact').at(-1) ?? own.at(-1);
  if (last?.kind === 'unitLost') return 'Lost';
  if (last?.kind === 'broke') return 'Broken, falling back';
  if (last?.kind === 'heavyLosses') return 'In action, with heavy losses';
  if (last?.kind === 'engaged') return 'In action';
  // An enemy in sight within fire, as the table marks a fight.
  if (enemies.some((e) => dist(e.position, unit.position) <= ENGAGE_RANGE_M)) return 'In action';
  if (last?.kind === 'destroyed') return 'Has beaten the enemy before it';
  if (marching) return 'On the march';
  if (last?.kind === 'lowAmmo') return 'Short of ammunition';
  if (last?.kind === 'exhausted') return 'Exhausted';
  if (last?.kind === 'contact') return 'Watching the enemy';
  return 'Standing';
}

/** One own unit at a glance (#439): what it was told, where it is, what it is doing, its men and spirit. */
export interface UnitStatus {
  id: string;
  name: string;
  /** Its latest order in its own words, or `No orders sent`. */
  told: string;
  /** Where that order stands: `Held for this turn`, `With the courier`, `Delivered at 00:04; acted on`. */
  orderState?: string;
  where: string;
  doing: string;
  men: string;
  morale: string;
}

const short = (text: string, max = 90): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/**
 * The status of each own unit, from the side's own view only. `held` is this turn's held (or sent) orders,
 * `pending` every order sent, `papers` the latest decided turn's papers (what the units are doing now).
 */
export function unitStatuses(a: {
  view: SideView;
  held: readonly TurnOrder[];
  pending: readonly PendingOrder[];
  dispatches: readonly Dispatch[];
  papers: readonly Dispatch[];
  /** The side has sent this turn's orders: the held ones are with the couriers. */
  sent: boolean;
}): UnitStatus[] {
  const marching = new Set(
    (a.view.orderRoutes ?? []).filter((r) => r.kind === 'route').map((r) => r.unitId),
  );
  return a.view.ownUnits.map((u) => {
    const hold = [...a.held].reverse().find((o) => o.to === u.id);
    const sent = [...a.pending]
      .map((p, i) => ({ p, i }))
      .filter((x) => x.p.toName === u.name)
      .sort((x, y) => y.p.sentAtGame - x.p.sentAtGame || y.i - x.i)[0]?.p;
    let told = 'No orders sent';
    let orderState: string | undefined;
    if (hold && !a.sent) {
      told = short(hold.text);
      orderState = 'Held for this turn';
    } else if (sent) {
      told = short(sent.words ?? sent.text);
      orderState =
        orderProgress(sent, a.dispatches, timeOfDay)?.label ??
        `Sent at ${timeOfDay(sent.sentAtGame)}; with the courier`;
    }
    return {
      id: u.id,
      name: u.name,
      told,
      ...(orderState ? { orderState } : {}),
      where: u.place ?? 'not reported',
      doing: doingOf(u, a.papers, marching.has(u.id), a.view.visibleEnemies),
      men: menBand(u.strength),
      morale: moraleBand(u.morale),
    };
  });
}

/** The staff's summary paper for a turn: its id, so it is filed once and the in-tray can put it first. */
export const summaryId = (turn: number): string => `turn-summary-${turn}`;
export const isSummary = (d: Pick<Dispatch, 'id'>): boolean => d.id.startsWith('turn-summary-');

const list = (items: readonly string[]): string =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join('; ')}; and ${items[items.length - 1]}`;

/**
 * The staff's summary of a decided turn (#439), filed before its other papers: what moved, what was seen, what
 * was fought and the losses in bands. `before` is the side's units as the turn opened; without it (the desk was
 * not open then) movement and losses are left out and the paper says so. `papers` are the turn's own papers.
 */
export function turnSummary(a: {
  turn: number;
  startsAt: number;
  endsAt: number;
  view: Pick<SideView, 'ownUnits'>;
  before?: readonly UnitSnap[];
  papers: readonly Dispatch[];
}): Dispatch {
  const lines = [
    `Sir, the staff's summary of turn ${a.turn}, ${timeOfDay(a.startsAt)} to ${timeOfDay(a.endsAt)}.`,
  ];
  const was = new Map((a.before ?? []).map((u) => [u.id, u]));
  if (a.before) {
    const moved = a.view.ownUnits.flatMap((u) => {
      const b = was.get(u.id);
      if (!b) return [];
      const d = dist(b.position, u.position);
      if (d < 50) return [];
      const where = u.place ? `, now ${u.place}` : '';
      return [
        `${u.name} about ${Math.round(d / 50) * 50} m ${compass(u.position.x - b.position.x, u.position.y - b.position.y)}${where}`,
      ];
    });
    lines.push(moved.length ? `Moved: ${list(moved)}.` : 'Moved: no unit moved.');
  } else {
    const at = a.view.ownUnits.filter((u) => u.place).map((u) => `${u.name} ${u.place}`);
    if (at.length) lines.push(`Where they stand: ${list(at)}.`);
  }
  const seen = sightings(a.papers).map((s) => {
    const first = s.papers[0]!.writtenAtGame;
    const last = s.papers.at(-1)!.writtenAtGame;
    const n = s.papers.length;
    return `${s.size} ${s.place} (${n === 1 ? `at ${timeOfDay(first)}` : `${n} reports, ${span(first, last)}`})`;
  });
  lines.push(seen.length ? `Seen: ${list(seen)}.` : 'Seen: nothing of the enemy.');
  const fights = new Map<string, { units: Set<string>; from: number }>();
  for (const d of [...a.papers].filter(isFight).sort(byWritten)) {
    const where = d.place ?? 'where the sketch shows';
    const f = fights.get(where) ?? { units: new Set<string>(), from: d.writtenAtGame };
    f.units.add(d.from);
    fights.set(where, f);
  }
  const fought = [...fights].map(
    ([where, f]) => `${[...f.units].join(' and ')} ${where}, from ${timeOfDay(f.from)}`,
  );
  lines.push(fought.length ? `Fought: ${list(fought)}.` : 'Fought: no fighting reported.');
  if (a.before) {
    let total = 0;
    let known = false;
    const losses = a.view.ownUnits.flatMap((u) => {
      const b = was.get(u.id)?.strength;
      if (b === undefined || u.strength === undefined) return [];
      known = true;
      total += Math.max(0, b - u.strength);
      return [`${u.name} ${lossBand(b, u.strength)}`];
    });
    if (known) {
      const all = total > 0 ? ` In all ${roundLoss(Math.round(total))}.` : '';
      lines.push(`Losses: ${list(losses)}.${all}`);
    } else lines.push('Losses: the staff have no figures for the units.');
  } else {
    lines.push(
      'The desk was not open when the turn began, so the staff cannot say what moved or what it cost.',
    );
  }
  const lost = a.papers.filter((d) => d.kind === 'courierLost').length;
  if (lost) lines.push(lost === 1 ? 'One courier was lost.' : `${lost} couriers were lost.`);
  lines.push('The papers follow.');
  return {
    id: summaryId(a.turn),
    from: 'Chief of staff',
    writtenAtGame: a.endsAt,
    receivedAtGame: a.endsAt,
    category: 'staff',
    kind: 'situation',
    text: lines.join('\n'),
  };
}

/** What the desk keeps of a turn game between visits (#439): units as each turn opened, and the summaries filed. */
export interface TurnRecord {
  starts: Record<number, UnitSnap[]>;
  summaries: Dispatch[];
}

const recordKey = (game: string): string => `kriegsspiel.turns.${game}`;

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

const isCoord = (c: unknown): c is Coord =>
  typeof c === 'object' &&
  c !== null &&
  Number.isFinite((c as Coord).x) &&
  Number.isFinite((c as Coord).y);

const isSnap = (u: unknown): u is UnitSnap =>
  typeof u === 'object' &&
  u !== null &&
  typeof (u as UnitSnap).id === 'string' &&
  typeof (u as UnitSnap).name === 'string' &&
  isCoord((u as UnitSnap).position) &&
  ((u as UnitSnap).strength === undefined || Number.isFinite((u as UnitSnap).strength));

const isPaper = (d: unknown): d is Dispatch =>
  typeof d === 'object' &&
  d !== null &&
  isSummary(d as Dispatch) &&
  typeof (d as Dispatch).text === 'string' &&
  Number.isFinite((d as Dispatch).writtenAtGame) &&
  Number.isFinite((d as Dispatch).receivedAtGame);

/** The saved record for this game, or an empty one when there is none or storage is unavailable or damaged. */
export function loadTurnRecord(game: string): TurnRecord {
  try {
    const raw = safeStorage()?.getItem(recordKey(game));
    const o = raw ? (JSON.parse(raw) as Partial<TurnRecord>) : {};
    const starts: Record<number, UnitSnap[]> = {};
    for (const [k, v] of Object.entries(o.starts ?? {})) {
      const n = Number(k);
      if (Number.isInteger(n) && n > 0 && Array.isArray(v) && v.every(isSnap)) starts[n] = v;
    }
    const summaries = Array.isArray(o.summaries)
      ? o.summaries
          .filter(isPaper)
          .map((d) => ({ ...d, from: 'Chief of staff', category: 'staff' as const }))
      : [];
    return { starts, summaries };
  } catch {
    return { starts: {}, summaries: [] };
  }
}

export function saveTurnRecord(game: string, r: TurnRecord): void {
  try {
    safeStorage()?.setItem(recordKey(game), JSON.stringify(r));
  } catch {
    // Private mode or a full quota: the record lasts for this session only.
  }
}
