/**
 * The scripted opponent: a simple commander for a side whose `controller` is `scripted`, so one
 * human can play. See docs/architecture.md (Scripted opponent).
 *
 * It obeys the fog rules by construction. `think` takes an `EngineSideView`, the same filtered
 * view a human side gets from `viewFor`, and nothing else: it holds no reference to master
 * state, and `assertFogOnly` refuses anything that is not exactly a view. Its orders are plain
 * `AgentOrder`s that the game actor runs through the same order path as a human's (issue, courier
 * delay, delivery), so it suffers the same lag.
 *
 * Behaviour: advance on the objective; close on an enemy it sees or has lately seen near it; fall
 * back to HQ when a unit is weakened. A little randomness (hesitation, where on the objective each
 * unit aims) comes from an RNG seeded from the game seed and the think tick, so a decision depends
 * only on (seed, time, view, its own memory) and a restart repeats it.
 */
import { Rng, seedRng, type EngineSideView, type Point } from '@kriegsspiel/engine';
import type { OrderIntent } from '../orders/index.js';

/** One order the agent wants issued: a unit, the intent, and the wording kept in the log. */
export interface AgentOrder {
  unitId: string;
  text: string;
  intent: OrderIntent;
  /** The whole sequence when the order carries more than one step (a move, then a hold). Defaults to `[intent]`. */
  intents?: OrderIntent[];
}

/** A server-side agent playing one side. The actor calls `think` every `intervalMs` of game time. */
export interface SideAgent {
  readonly side: string;
  /** Game ms between decisions. */
  readonly intervalMs: number;
  think(view: EngineSideView): AgentOrder[];
  /**
   * For an agent that must wait on something slow (a model). When set, the actor calls this
   * instead of `think` and holds game time at the decision's moment until it settles (the LLM
   * barrier). `think` is then the fallback for a decision that fails or times out, and must work
   * on its own.
   */
  decide?(view: EngineSideView): Promise<AgentOrder[]>;
  /**
   * Whether the last `think` that issued no order did so because nothing needs doing, rather than
   * because it chose to wait. The actor stops asking an agent that is settled once the world is
   * quiet; one that is not settled is asked again at its next interval. Default: settled.
   */
  settled?(): boolean;
}

/** Game ms between decisions: five game minutes. */
export const THINK_INTERVAL_MS = 5 * 60_000;
/** An enemy this close (metres) to one of its units draws it into an attack. */
export const ENGAGE_RANGE_M = 900;
/** A last-known contact this young (game ms) still counts as a target. */
export const CONTACT_FRESH_MS = 10 * 60_000;
/** A unit below this morale (0..100), or this share of the strength it started with, falls back. */
export const WITHDRAW_MORALE = 40;
export const WITHDRAW_STRENGTH_FRACTION = 0.5;
/** Chance a unit sits out one decision while it has nothing to react to. */
export const HESITATE_CHANCE = 0.15;
/** Each unit aims this far (metres, either way) off the objective's centre. */
export const AIM_SPREAD_M = 60;
/** A target that moved less than this (metres) since the last order is not worth a new one. */
const RETARGET_M = 150;
/**
 * A unit this close (metres) to the objective stays on it instead of chasing an enemy, because
 * the objective only falls to a side that holds it for some minutes (D13).
 */
export const HOLD_RADIUS_M = 120;
/**
 * The scripted commander forms up for this long (game ms) before it marches, so the bridge is not
 * taken by whoever happens to start closest, and the first game has time for orders and answers.
 */
export const FORM_UP_MS = 10 * 60_000;

export interface ScriptedOpponentConfig {
  side: string;
  /** Seed of the game, mixed into the opponent's RNG. */
  seed: number;
  /** The point to take, in metres. Public knowledge from the scenario, not read from the world. */
  objective: Point;
  /** Where weakened units fall back to, in metres (own HQ). */
  fallbackTo: Point;
  intervalMs?: number;
}

const VIEW_KEYS = [
  'side',
  'time',
  'mapWidth',
  'mapHeight',
  'hq',
  'ownUnits',
  'visibleEnemies',
  'lastKnownContacts',
  'reports',
  'documents',
];
/** Keys of a master `GameState`: if any is present, the caller handed over more than a view. */
const MASTER_KEYS = ['units', 'sides', 'intel', 'map', 'victory', 'outcome', 'queue', 'world'];

/** Runtime half of the fog guarantee: throws unless `view` is exactly a side view for `side`. */
export function assertFogOnly(view: unknown, side: string): asserts view is EngineSideView {
  if (typeof view !== 'object' || view === null) throw new Error('opponent: view is not an object');
  const keys = Object.keys(view);
  const master = keys.filter((k) => MASTER_KEYS.includes(k));
  if (master.length > 0) {
    throw new Error(`opponent: refused master state (has ${master.join(', ')})`);
  }
  const extra = keys.filter((k) => !VIEW_KEYS.includes(k));
  if (extra.length > 0) throw new Error(`opponent: not a side view (extra ${extra.join(', ')})`);
  if ((view as { side?: unknown }).side !== side) {
    throw new Error(
      `opponent: view is for ${String((view as { side?: unknown }).side)}, not ${side}`,
    );
  }
}

const mmPoint = (p: Point): Point => ({ x: Math.round(p.x * 1000), y: Math.round(p.y * 1000) });
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const fmt = (p: Point) => `(${Math.round(p.x)}, ${Math.round(p.y)})`;

function hashSide(side: string): number {
  let h = 0;
  for (const ch of side) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return h;
}

type Standing = { kind: 'advance' | 'attack' | 'withdraw'; target: Point };

export class ScriptedOpponent implements SideAgent {
  readonly side: string;
  readonly intervalMs: number;
  /** What each unit was last told, so a decision that changes nothing issues no order. */
  private readonly standing = new Map<string, Standing>();
  /** The most men each unit has been seen with: the yardstick for "weakened". */
  private readonly peak = new Map<string, number>();
  /** Whether a unit sat out the last decision on a roll, which a later roll may reverse. */
  private hesitated = false;

  constructor(private readonly config: ScriptedOpponentConfig) {
    this.side = config.side;
    this.intervalMs = config.intervalMs ?? THINK_INTERVAL_MS;
  }

  think(view: EngineSideView): AgentOrder[] {
    assertFogOnly(view, this.side);
    this.hesitated = view.time < FORM_UP_MS;
    if (this.hesitated) return [];
    const tick = Math.floor(view.time / this.intervalMs);
    const rng = new Rng(seedRng(this.config.seed + hashSide(this.side) + tick * 7919));
    const threats: { id: string; position: Point }[] = [
      ...view.visibleEnemies,
      ...view.lastKnownContacts.filter((c) => c.ageMs <= CONTACT_FRESH_MS),
    ];
    const orders: AgentOrder[] = [];
    this.hesitated = false;
    for (const unit of view.ownUnits) {
      if (unit.strength <= 0) continue;
      const peak = Math.max(this.peak.get(unit.id) ?? 0, unit.strength);
      this.peak.set(unit.id, peak);
      const standing = this.standing.get(unit.id);
      const weak =
        unit.morale < WITHDRAW_MORALE || unit.strength < peak * WITHDRAW_STRENGTH_FRACTION;
      const near = threats
        .map((t) => ({ t, d: dist(unit.position, t.position) }))
        .sort((a, b) => a.d - b.d || (a.t.id < b.t.id ? -1 : 1))[0];

      let next: Standing | undefined;
      if (weak) next = { kind: 'withdraw', target: this.config.fallbackTo };
      else if (dist(unit.position, this.config.objective) <= HOLD_RADIUS_M) {
        // Already on the ground it was sent to take: nothing to order (this also covers a
        // restart that has lost its memory of earlier orders).
        if (!standing || standing.kind === 'advance') {
          this.standing.set(unit.id, standing ?? { kind: 'advance', target: unit.position });
          continue;
        }
        next = this.advanceOrder(rng);
      } else if (near && near.d <= ENGAGE_RANGE_M)
        next = { kind: 'attack', target: near.t.position };
      else if (rng.next() >= HESITATE_CHANCE || standing) next = this.advanceOrder(rng);
      if (!next) this.hesitated = true;
      if (!next || !this.changes(standing, next)) continue;
      this.standing.set(unit.id, next);
      orders.push(this.order(unit.id, unit.name, next));
    }
    return orders;
  }

  private advanceOrder(rng: Rng): Standing {
    const spread = () => (rng.next() * 2 - 1) * AIM_SPREAD_M;
    return {
      kind: 'advance',
      target: { x: this.config.objective.x + spread(), y: this.config.objective.y + spread() },
    };
  }

  settled(): boolean {
    return !this.hesitated;
  }

  /** Whether `next` differs enough from what the unit was last told to be worth an order. */
  private changes(standing: Standing | undefined, next: Standing): boolean {
    if (!standing || standing.kind !== next.kind) return true;
    // An advance is aimed once; an attack follows its target; a withdrawal is one-way.
    return next.kind === 'attack' && dist(standing.target, next.target) > RETARGET_M;
  }

  private order(unitId: string, name: string, s: Standing): AgentOrder {
    const to = mmPoint(s.target);
    switch (s.kind) {
      case 'withdraw':
        return {
          unitId,
          text: `${name} fall back to ${fmt(s.target)}`,
          intent: { kind: 'withdraw', toward: to },
        };
      case 'attack':
        // The engine has no attack intent in orders yet; closing on the enemy brings it into range.
        return {
          unitId,
          text: `${name} advance on the enemy at ${fmt(s.target)}`,
          intent: { kind: 'move', to },
        };
      case 'advance':
        return {
          unitId,
          text: `${name} advance to ${fmt(s.target)}`,
          intent: { kind: 'move', to },
        };
    }
  }
}
