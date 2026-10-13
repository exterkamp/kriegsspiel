/**
 * Board spike (#443): a tiny deterministic battle, so the board can be tried without a server. It is not the engine.
 * It keeps the few things the board needs to show: where every unit went each minute, who saw whom, who is in contact,
 * and the stages of a fight (engaged, taking losses, wavering, broken), with the combat numbers the spike proposes
 * (docs/board-spike.md, point 5). A turn is ten game minutes, run as ten one-minute steps.
 */

export type Side = 'blue' | 'red';
export type Arm = 'infantry' | 'cavalry' | 'artillery';
export type Verb = 'move' | 'hold' | 'attack' | 'withdraw' | 'screen';
export type Stage = 'fresh' | 'engaged' | 'losses' | 'wavering' | 'broken';

export interface Point {
  x: number;
  y: number;
}

/** A structured order: what the player sets by clicking. The note is for the umpire and changes nothing here. */
export interface Order {
  verb: Verb;
  /** Points to pass through in turn; the last is the destination. */
  waypoints: Point[];
  /** For `attack`: the enemy unit to close with. */
  target?: string;
  note?: string;
}

export interface Unit {
  id: string;
  side: Side;
  name: string;
  /** Short designation for the counter, e.g. "1/12". */
  short: string;
  arm: Arm;
  pos: Point;
  /** Radians, 0 = north, clockwise. */
  facing: number;
  strength: number;
  startStrength: number;
  morale: number;
  home: Point;
  order: Order;
  stage: Stage;
  /** Enemy id this unit is in contact with, if any. */
  contact?: string;
}

export interface Feature {
  id: string;
  kind: 'river' | 'bridge' | 'wood' | 'road';
  /** Polyline (river, road) or polygon (wood); a bridge is a single point. */
  points: Point[];
  name: string;
}

export interface Scenario {
  width: number;
  height: number;
  features: Feature[];
  units: Unit[];
  /** Where the river may be crossed; units route through the nearest. */
  crossings: Point[];
  /** The river's y at x, so the sim knows which bank a point is on. */
  riverY: (x: number) => number;
  /** Red's orders, by turn number (1-based). */
  redScript: Record<number, Record<string, Order>>;
  /** Blue's orders as the fixture plays them, by turn; a player's order replaces these. */
  blueScript: Record<number, Record<string, Order>>;
  startMinute: number;
}

/** What a side knows of one enemy unit. */
export interface Contact {
  id: string;
  /** The staff's name for it, by order of first sighting: A, B, C. Never the enemy's own name. */
  letter: string;
  arm: Arm;
  pos: Point;
  facing: number;
  /** Game minute it was last seen. */
  seenAt: number;
  /** A band, never the true number: "400–650". */
  size: [number, number];
  stage: Stage;
}

export type EventKind =
  | 'moved'
  | 'contact'
  | 'losses'
  | 'wavering'
  | 'broken'
  | 'spotted'
  | 'lost-sight'
  | 'enemy-moved'
  | 'halted';

/** One thing that happened in a turn, as the report needs it. */
export interface TurnEvent {
  kind: EventKind;
  minute: number;
  unit: string;
  other?: string;
  metres?: number;
  lost?: number;
}

/** One side's record of a finished turn. */
export interface Turn {
  n: number;
  /** Game minute at the start of the turn. */
  from: number;
  to: number;
  /** All units at the end of the turn (the sim's truth; the board shows a side only its own and its contacts). */
  units: Unit[];
  /** Each unit's position at each minute of the turn, start included. */
  tracks: Record<string, Point[]>;
  /** What blue knew of red at the end, and the seen positions of each red unit during the turn. */
  contacts: Contact[];
  enemyTracks: Record<string, Point[]>;
  events: TurnEvent[];
  /** The orders blue's units were under during the turn. */
  orders: Record<string, Order>;
}

export interface Rules {
  /** Units stop at the contact line rather than marching into each other (the spike's proposal). */
  contactLine: boolean;
}

export const TURN_MINUTES = 10;
/** Centre distance at which marching units stop and are in contact. */
export const CONTACT_M = 140;
const SPEED: Record<Arm, number> = { infantry: 80, cavalry: 220, artillery: 60 };
const RANGE: Record<Arm, number> = { infantry: 200, cavalry: 60, artillery: 600 };
const SIGHT: Record<Arm, number> = { infantry: 800, cavalry: 1100, artillery: 700 };
const FIRE_RATE: Record<Arm, number> = { infantry: 0.03, cavalry: 0.05, artillery: 0.06 };
/** Seen inside a wood only from this close. */
const WOOD_SIGHT_M = 250;
/** The proposed combat numbers (docs/board-spike.md): morale lost per % lost, the per-tick cap and the strain of fire. */
const MORALE_PER_LOSS_PERCENT = 2;
const SHOCK_CAP = 6;
const UNDER_FIRE = 1;
const LONG_RANGE = 0.5;
const BREAK_MORALE = 25;
const WAVER_MORALE = 45;
const COMBAT_TICK = 2;

/** Seeded RNG (mulberry32), so a turn is the same every time it is run. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const bearing = (a: Point, b: Point) => Math.atan2(b.x - a.x, -(b.y - a.y));

export function inPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

const clone = (u: Unit): Unit => ({
  ...u,
  pos: { ...u.pos },
  home: { ...u.home },
  order: { ...u.order, waypoints: u.order.waypoints.map((p) => ({ ...p })) },
});

/** The stage a unit shows: what the board and the report call its state in a fight. */
export function stageOf(u: Unit): Stage {
  if (u.stage === 'broken') return 'broken';
  if (u.morale < WAVER_MORALE) return 'wavering';
  if (u.strength < u.startStrength * 0.95) return 'losses';
  return u.contact ? 'engaged' : 'fresh';
}

/** The width of the band a side guesses an enemy's strength in. */
export function sizeBand(strength: number): [number, number] {
  const lo = Math.max(50, Math.floor((strength * 0.75) / 50) * 50);
  const hi = Math.ceil((strength * 1.15) / 50) * 50;
  return [lo, hi];
}

export class Battle {
  readonly turns: Turn[] = [];
  private units: Unit[];
  private minute: number;
  private known = new Map<string, Contact>();
  private readonly random: () => number;

  constructor(
    readonly scenario: Scenario,
    readonly rules: Rules = { contactLine: true },
    seed = 7,
  ) {
    this.units = scenario.units.map(clone);
    this.minute = scenario.startMinute;
    this.random = rng(seed);
    this.spot([]);
    this.turns.push(this.record(0, this.minute, {}, [], {}, {}));
  }

  get current(): Turn {
    return this.turns[this.turns.length - 1]!;
  }

  /**
   * Run one turn. `blueOrders` are the player's orders for this turn, by unit; a unit without one keeps its order,
   * or takes the fixture's for this turn.
   */
  play(blueOrders: Record<string, Order> = {}): Turn {
    const n = this.turns.length;
    const script = {
      ...(this.scenario.redScript[n] ?? {}),
      ...(this.scenario.blueScript[n] ?? {}),
      ...blueOrders,
    };
    for (const u of this.units) {
      const o = script[u.id];
      if (o && u.stage !== 'broken') u.order = { ...o, waypoints: this.routed(u.pos, o.waypoints) };
    }
    const from = this.minute;
    const events: TurnEvent[] = [];
    const tracks: Record<string, Point[]> = {};
    const enemyTracks: Record<string, Point[]> = {};
    for (const u of this.units) tracks[u.id] = [{ ...u.pos }];
    for (const c of this.known.values()) enemyTracks[c.id] = [{ ...c.pos }];
    const startStage = new Map(this.units.map((u) => [u.id, stageOf(u)]));
    for (let m = 0; m < TURN_MINUTES; m++) {
      this.minute++;
      this.step(events);
      if ((this.minute - from) % COMBAT_TICK === 0) this.fight(events);
      this.spot(events);
      for (const u of this.units) tracks[u.id]!.push({ ...u.pos });
      for (const u of this.units) {
        if (u.side !== 'red' || !this.seenNow(u.id)) continue;
        (enemyTracks[u.id] ??= []).push({ ...u.pos });
      }
    }
    for (const u of this.units) {
      const t = tracks[u.id]!;
      const metres = t.slice(1).reduce((s, p, i) => s + dist(p, t[i]!), 0);
      if (u.side === 'blue' && metres > 30) {
        events.push({ kind: 'moved', minute: this.minute, unit: u.id, metres: Math.round(metres) });
      }
      const before = startStage.get(u.id);
      if (u.side === 'blue' && u.strength < u.startStrength && before !== stageOf(u)) {
        // The losses of the turn, for the report, once per unit whose stage changed.
        events.push({
          kind: 'losses',
          minute: this.minute,
          unit: u.id,
          lost: Math.round(tracksLoss(this.turns, u)),
        });
      }
    }
    for (const [id, t] of Object.entries(enemyTracks)) {
      if (t.length < 2) continue;
      const metres = dist(t[0]!, t[t.length - 1]!);
      if (metres > 50) events.push({ kind: 'enemy-moved', minute: this.minute, unit: id, metres: Math.round(metres) });
    }
    const orders = Object.fromEntries(this.units.filter((u) => u.side === 'blue').map((u) => [u.id, u.order]));
    const turn = this.record(n, from, tracks, events, enemyTracks, orders);
    this.turns.push(turn);
    return turn;
  }

  /** Insert the crossing when a route crosses the river. */
  private routed(from: Point, waypoints: Point[]): Point[] {
    const out: Point[] = [];
    let at = from;
    const bank = (p: Point) => Math.sign(p.y - this.scenario.riverY(p.x));
    for (const w of waypoints) {
      if (bank(at) !== bank(w)) {
        const c = [...this.scenario.crossings].sort(
          (a, b) => dist(at, a) + dist(a, w) - (dist(at, b) + dist(b, w)),
        )[0]!;
        const side = bank(at);
        out.push({ x: c.x, y: c.y + side * 40 }, { x: c.x, y: c.y - side * 40 });
      }
      out.push({ ...w });
      at = w;
    }
    return out;
  }

  private enemiesOf(u: Unit): Unit[] {
    return this.units.filter((e) => e.side !== u.side && e.stage !== 'broken' && e.strength > 0);
  }

  private nearestEnemy(u: Unit): Unit | undefined {
    return this.enemiesOf(u).sort((a, b) => dist(u.pos, a.pos) - dist(u.pos, b.pos))[0];
  }

  /** One minute of movement. */
  private step(events: TurnEvent[]): void {
    for (const u of this.units) {
      if (u.strength <= 0) continue;
      const speed = SPEED[u.arm] * (u.stage === 'broken' ? 1.3 : 1);
      if (u.stage === 'broken') {
        this.moveTowards(u, u.home, speed);
        continue;
      }
      const o = u.order;
      let goal: Point | undefined = o.waypoints[0];
      if (o.verb === 'attack' && o.target) {
        const t = this.units.find((x) => x.id === o.target);
        if (t && t.stage !== 'broken' && t.strength > 0) {
          if (o.waypoints.length === 0) goal = t.pos;
          if (dist(u.pos, t.pos) <= Math.max(CONTACT_M, Math.min(RANGE[u.arm], 180))) goal = undefined;
        }
      }
      if (o.verb === 'hold') goal = undefined;
      if (o.verb === 'screen') {
        const e = this.nearestEnemy(u);
        if (e && dist(u.pos, e.pos) < 500) {
          const away = bearing(e.pos, u.pos);
          goal = { x: u.pos.x + Math.sin(away) * 300, y: u.pos.y - Math.cos(away) * 300 };
          goal = this.routed(u.pos, [goal])[0];
        }
      }
      if (!goal) {
        const e = this.nearestEnemy(u);
        if (e && dist(u.pos, e.pos) < RANGE[u.arm] + 200) u.facing = bearing(u.pos, e.pos);
        continue;
      }
      // The contact rule: a unit that is not withdrawing stops at the contact line with the enemy ahead of it.
      if (this.rules.contactLine && o.verb !== 'withdraw' && o.verb !== 'screen') {
        const blocker = this.enemiesOf(u).find((e) => {
          const d = dist(u.pos, e.pos);
          if (d > CONTACT_M + speed) return false;
          const next = this.ahead(u.pos, goal!, speed);
          return dist(next, e.pos) < d;
        });
        if (blocker) {
          const d = dist(u.pos, blocker.pos);
          if (d > CONTACT_M) this.moveTowards(u, blocker.pos, d - CONTACT_M);
          u.facing = bearing(u.pos, blocker.pos);
          if (u.contact !== blocker.id) events.push({ kind: 'halted', minute: this.minute, unit: u.id, other: blocker.id });
          continue;
        }
      }
      const arrived = this.moveTowards(u, goal, speed);
      if (arrived && o.waypoints.length > 0) o.waypoints = o.waypoints.slice(1);
    }
    this.markContacts(events);
  }

  private ahead(from: Point, to: Point, metres: number): Point {
    const d = dist(from, to);
    if (d <= metres) return { ...to };
    return { x: from.x + ((to.x - from.x) * metres) / d, y: from.y + ((to.y - from.y) * metres) / d };
  }

  /** Move up to `metres` towards `to`; true when there. */
  private moveTowards(u: Unit, to: Point, metres: number): boolean {
    const d = dist(u.pos, to);
    if (d < 1) return true;
    if (u.stage !== 'broken') u.facing = bearing(u.pos, to);
    u.pos = this.ahead(u.pos, to, metres);
    return d <= metres;
  }

  private markContacts(events: TurnEvent[]): void {
    for (const u of this.units) {
      const e = u.stage === 'broken' ? undefined : this.nearestEnemy(u);
      const was = u.contact;
      u.contact = e && dist(u.pos, e.pos) <= CONTACT_M + 20 ? e.id : undefined;
      if (u.contact && u.contact !== was && u.side === 'blue') {
        events.push({ kind: 'contact', minute: this.minute, unit: u.id, other: u.contact });
      }
    }
  }

  /** One combat tick: every unit fires at the nearest enemy in range, then losses and morale are applied. */
  private fight(events: TurnEvent[]): void {
    const lost = new Map<string, number>();
    const shock = new Map<string, number>();
    for (const u of this.units) {
      if (u.stage === 'broken' || u.strength <= 0) continue;
      const t = this.enemiesOf(u)
        .filter((e) => dist(u.pos, e.pos) <= RANGE[u.arm] || e.id === u.contact)
        .sort((a, b) => dist(u.pos, a.pos) - dist(u.pos, b.pos))[0];
      if (!t) continue;
      const d = dist(u.pos, t.pos);
      // Across the contact line the fire is close but not point-blank; further off it falls to half at the edge of range.
      const reach = u.contact === t.id ? 0.8 : 1 - (1 - LONG_RANGE) * Math.min(1, d / RANGE[u.arm]);
      const die = 1 + Math.floor(this.random() * 6);
      const aspect = Math.abs(angleDiff(t.facing, bearing(t.pos, u.pos))) > Math.PI / 3 ? 1.5 : 1;
      const cas = u.strength * FIRE_RATE[u.arm] * (die / 3.5) * (0.5 + u.morale / 200) * reach * aspect;
      lost.set(t.id, (lost.get(t.id) ?? 0) + cas);
      shock.set(t.id, (shock.get(t.id) ?? 0) + (cas / t.strength) * 100 * MORALE_PER_LOSS_PERCENT * (aspect > 1 ? 1.25 : 1));
    }
    for (const u of this.units) {
      const cas = lost.get(u.id);
      if (!cas) continue;
      const before = stageOf(u);
      const lossPercent = (cas / u.strength) * 100;
      u.strength = Math.max(0, u.strength - cas);
      let m = Math.min(SHOCK_CAP, (shock.get(u.id) ?? 0) + UNDER_FIRE);
      if (lossPercent >= 4) {
        const roll = 2 + Math.floor(this.random() * 6) + Math.floor(this.random() * 6);
        if (roll > Math.round(((u.morale - m) / 100) * 12)) m += 2;
      }
      u.morale = Math.max(0, u.morale - m);
      if (u.morale < BREAK_MORALE && u.stage !== 'broken') {
        u.stage = 'broken';
        u.contact = undefined;
        u.order = { verb: 'withdraw', waypoints: this.routed(u.pos, [u.home]) };
        events.push({ kind: 'broken', minute: this.minute, unit: u.id });
        continue;
      }
      const after = stageOf(u);
      u.stage = after;
      if (after === 'wavering' && before !== 'wavering') events.push({ kind: 'wavering', minute: this.minute, unit: u.id });
    }
    for (const u of this.units) if (u.stage !== 'broken') u.stage = stageOf(u);
  }

  private seenNow(id: string): boolean {
    return this.known.get(id)?.seenAt === this.minute;
  }

  /** Blue's sight of red: within sight range of any blue unit, and inside a wood only from close by. */
  private spot(events: TurnEvent[]): void {
    const woods = this.scenario.features.filter((f) => f.kind === 'wood');
    for (const r of this.units) {
      if (r.side !== 'red' || r.strength <= 0) continue;
      const hidden = woods.some((w) => inPolygon(r.pos, w.points));
      const seen = this.units.some(
        (b) => b.side === 'blue' && b.strength > 0 && dist(b.pos, r.pos) <= (hidden ? WOOD_SIGHT_M : SIGHT[b.arm]),
      );
      const was = this.known.get(r.id);
      if (seen) {
        if (!was || was.seenAt < this.minute - 1) events.push({ kind: 'spotted', minute: this.minute, unit: r.id });
        this.known.set(r.id, {
          id: r.id,
          letter: was?.letter ?? String.fromCharCode(65 + this.known.size),
          arm: r.arm,
          pos: { ...r.pos },
          facing: r.facing,
          seenAt: this.minute,
          size: sizeBand(r.strength),
          stage: stageOf(r),
        });
      } else if (was && was.seenAt === this.minute - 1) {
        events.push({ kind: 'lost-sight', minute: this.minute, unit: r.id });
      }
    }
  }

  private record(
    n: number,
    from: number,
    tracks: Record<string, Point[]>,
    events: TurnEvent[],
    enemyTracks: Record<string, Point[]>,
    orders: Record<string, Order>,
  ): Turn {
    return {
      n,
      from,
      to: this.minute,
      units: this.units.map(clone),
      tracks,
      contacts: [...this.known.values()].map((c) => ({ ...c, pos: { ...c.pos } })),
      enemyTracks,
      events,
      orders,
    };
  }
}

function tracksLoss(turns: Turn[], u: Unit): number {
  const prev = turns[turns.length - 1]!.units.find((x) => x.id === u.id);
  return (prev?.strength ?? u.startStrength) - u.strength;
}

export function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** "10:20" from a game minute counted from midnight. */
export function clock(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
