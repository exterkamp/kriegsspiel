import {
  ASPECT_FACTOR,
  ATTACK_INTENT_EVENT,
  COMBAT_CHECK_EVENT,
  COMBAT_TICK_EVENT,
  MELEE_FACTOR,
  RALLY_EVENT,
  VICTORY_DEADLINE_EVENT,
  aspectOf,
  bearingTo,
  canReach,
  isRouted,
  pursuable,
  distanceMm,
  inMelee,
  onObjective,
  rangeFactor,
  type Aspect,
} from './contact.js';
import type { EngineState, EventRegistry, HandlerResult, Json, NewEvent } from './events.js';
import { mm, polygonCentroid } from './geometry.js';
import { FIELD_REPORT_DELAY_MS, fileReport } from './visibility.js';
import { describePlace } from './place.js';
import { positionAt, rejectOrder, startMarch } from './movement.js';
import { FATIGUE_PER_FIGHT_TICK } from './fatigue.js';
import { FIRE_RULES, MORALE_RULES, RALLY_RULES } from './combatRules.js';
import { schedule } from './queue.js';
import { heldTurn } from './held.js';
import {
  AMMO_PER_FIRE_TICK,
  OUT_OF_AMMO_FACTOR,
  SUPPLY_TICK_EVENT,
  SUPPLY_TICK_MS,
  registerSupply,
  noteWear,
} from './supply.js';
import { terrainAt } from './terrain.js';
import { FORMATION_RULES, unitTypeOf } from './unitTypes.js';
import {
  DEFAULT_TAKE_MS,
  MS_PER_MINUTE,
  type BattleRuling,
  type GameTime,
  type GameState,
  type Outcome,
  type Point,
  type Report,
  type SideId,
  type Unit,
  type UnitKind,
} from './types.js';

/** Game time between combat ticks while units are in contact. */
export const COMBAT_TICK_MS = 2 * MS_PER_MINUTE;

/**
 * Casualties per tick are `strength * fireRate * (die / 3.5) * moraleFactor * cover`, times
 * a range factor (or the melee factor), a flank or rear factor, the shooter's formation
 * `fireFactor` and the target's formation vulnerability, so a 600-man line battalion on a
 * fair roll costs a target about 18 men every 2 minutes. `fireRate` and the rest come from
 * each unit's type and formation (`unitTypes.ts`); this table lists the default types' rates.
 */
export const FIRE_RATE: Record<UnitKind, number> = {
  infantry: unitTypeOf('infantry').fireRate,
  cavalry: unitTypeOf('cavalry').fireRate,
  artillery: unitTypeOf('artillery').fireRate,
};

/** Multiplier on casualties taken by a target on ground with the given `cover` (0..1). */
export function coverFactor(cover: number): number {
  return 1 - cover;
}

/** Morale lost per percent of strength lost in one tick. */
export const MORALE_PER_LOSS_PERCENT = MORALE_RULES.lossPerPercent;
/** The morale below which a default-type unit breaks and withdraws; each type has its own. */
export const BREAK_MORALE = unitTypeOf('infantry').breakMorale;

/**
 * A force is broken (D13) when the fighting strength it has left, its men weighted by morale,
 * falls below this share of the men it started with, once at least one of its units has been
 * broken or destroyed. Red's last cavalry squadron alone is about 12% of Red's start.
 */
export const BROKEN_FORCE_FRACTION = 0.25;
/** Game time between the umpire declaring a battle and the game closing: the pursuit is played out. */
export const BATTLE_CLOSE_MS = 20 * MS_PER_MINUTE;
/** Casualty multiplier on fire or steel against a routed unit, which cannot form to answer. */
export const ROUT_FACTOR = FIRE_RULES.routFactor;
/** A unit reports heavy losses when its strength falls below this share of its start. */
export const HEAVY_LOSS_FRACTION = 0.5;
/** A unit already reported engaged says so again only after this long without a report. */
export const ENGAGED_REPEAT_MS = 10 * MS_PER_MINUTE;
/** Cavalry that is idle or holding rides after a routed enemy this close (metres) to it. */
export const PURSUIT_RANGE_M = 1500;

/** Morale shock multiplier by the side the blow came from. */
const SHOCK_FACTOR: Record<Aspect, number> = {
  front: 1,
  flank: MORALE_RULES.flankShock,
  rear: MORALE_RULES.rearShock,
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Queue an order for `unitId` to close on and fight `targetId`, firing at `time` (default: now). */
export function issueAttack(
  state: EngineState<GameState>,
  unitId: string,
  targetId: string,
  time = state.time,
): EngineState<GameState> {
  return schedule(state, [
    { time, type: ATTACK_INTENT_EVENT, payload: { unitId, target: targetId } },
  ]);
}

/**
 * Arm the victory clock and look for contact at the current time. Call once on a
 * freshly created state, before the first `advanceTo`. If the clock is already past
 * the hold time (a restored state, a very short hold) the deadline fires at once.
 */
export function startGame(state: EngineState<GameState>): EngineState<GameState> {
  return schedule(state, [
    { time: state.time, type: COMBAT_CHECK_EVENT },
    { time: Math.max(state.time, state.world.victory.holdMs), type: VICTORY_DEADLINE_EVENT },
    { time: state.time + SUPPLY_TICK_MS, type: SUPPLY_TICK_EVENT },
  ]);
}

function activeUnits(world: GameState): Unit[] {
  return world.units.filter((u) => u.status === 'active');
}

/** Every pair (in unit order) where at least one side can hit the other. */
function contactPairs(world: GameState, time: number): Array<[Unit, Unit]> {
  const active = activeUnits(world);
  const targets = world.units.filter((u) => pursuable(u, time));
  const pairs: Array<[Unit, Unit]> = [];
  const seen = new Set<string>();
  for (const a of active) {
    for (const b of targets) {
      if (a.side === b.side || (!canReach(a, b) && !(b.status === 'active' && canReach(b, a))))
        continue;
      const [x, y] = a.id < b.id ? [a, b] : [b, a];
      const key = `${x.id}|${y.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([x, y]);
    }
  }
  return pairs.sort((p, q) => (p[0].id + p[1].id < q[0].id + q[1].id ? -1 : 1));
}

function sideOut(world: GameState, side: SideId): 'eliminated' | 'withdrawn' | null {
  const mine = world.units.filter((u) => u.side === side);
  if (mine.some((u) => u.status === 'active')) return null;
  return mine.every((u) => u.status === 'destroyed') ? 'eliminated' : 'withdrawn';
}

/** Men that can still fight, weighted by morale, as a share of the men the side started with. */
function fightingShare(world: GameState, side: SideId): number | null {
  const start = world.startStrength;
  if (!start) return null;
  const mine = world.units.filter((u) => u.side === side);
  const total = mine.reduce((n, u) => n + (start[u.id] ?? u.strength), 0);
  if (total <= 0) return null;
  const fit = mine
    .filter((u) => u.status === 'active')
    .reduce((n, u) => n + (u.strength * u.morale) / 100, 0);
  return fit / total;
}

/** True when the side has lost units and what is left is below `BROKEN_FORCE_FRACTION`. */
export function forceBroken(world: GameState, side: SideId): boolean {
  const share = fightingShare(world, side);
  if (share === null) return false;
  const lostSome = world.units.some((u) => u.side === side && u.status !== 'active');
  return lostSome && share < BROKEN_FORCE_FRACTION;
}

/**
 * When a victory timer (the objective's hold, a declared battle's close) starts counting. In turn
 * mode it counts from the game minute, as the clock shows it, so a hold or close that completes in
 * the minute a turn ends at decides that turn, not a turn opened after it (#429). Real-time play
 * counts from the event itself.
 */
function timerFrom(world: GameState, time: number): number {
  return world.turn ? Math.floor(time / MS_PER_MINUTE) * MS_PER_MINUTE : time;
}

/**
 * When a declared battle closes (D13): the pursuit runs `BATTLE_CLOSE_MS` from the ruling, counted
 * from its game minute in turn mode. It closes sooner if a side has nobody left. Undefined until a
 * battle is declared. Public, like the ruling.
 */
export function pursuitEndsAt(world: GameState): GameTime | undefined {
  return world.battle && timerFrom(world, world.battle.declaredAt) + BATTLE_CLOSE_MS;
}

/** True while only the attacker's active units have their centres on the objective. */
function attackerHolds(world: GameState): boolean {
  const { attacker, objective } = world.victory;
  const holders = activeUnits(world).filter((u) => onObjective(u, objective));
  return holders.length > 0 && holders.every((u) => u.side === attacker);
}

/**
 * Start or reset the hold timer as of `time`. When the attacker has just taken the ground,
 * a check is queued for the moment the hold would be complete.
 */
function trackHold(world: GameState, time: number): { world: GameState; schedule: NewEvent[] } {
  const holds = attackerHolds(world);
  const since = world.heldSince ?? null;
  if (!holds)
    return { world: since === null ? world : { ...world, heldSince: null }, schedule: [] };
  if (since !== null) return { world, schedule: [] };
  const takeMs = world.victory.takeMs ?? DEFAULT_TAKE_MS;
  const from = timerFrom(world, time);
  return {
    world: { ...world, heldSince: from },
    schedule: [{ time: Math.max(time, from + takeMs), type: COMBAT_CHECK_EVENT }],
  };
}

/** The result of the game as of `time`, or null if it goes on. Exported for tests only. */
export function evaluateVictory(world: GameState, time: number): Outcome | null {
  const { attacker } = world.victory;
  const battle = world.battle;
  const out = new Map<SideId, 'eliminated' | 'withdrawn'>();
  for (const s of world.sides) {
    const o = sideOut(world, s.id);
    if (o) out.set(s.id, o);
  }
  // A declared battle decides the game (D13, #417): it closes after the pursuit, or at once when
  // a side has nobody left, and a side leaving the field after the ruling does not overturn it.
  if (battle) {
    const loser = world.sides.find((s) => s.id !== battle.winner)!.id;
    const loserOut = out.get(loser);
    if (out.size === 0 && time < pursuitEndsAt(world)!) return null;
    return {
      winner: battle.winner,
      reason: battle.reason,
      time,
      ...(loserOut ? { loserOut } : {}),
    };
  }
  if (out.size === world.sides.length) {
    const reason = [...out.values()].every((r) => r === 'eliminated') ? 'eliminated' : 'withdrawn';
    return { winner: null, reason, time };
  }
  for (const s of world.sides) {
    const reason = out.get(s.id);
    if (reason) {
      return { winner: world.sides.find((o) => o.id !== s.id)!.id, reason, time };
    }
  }
  const since = world.heldSince ?? null;
  if (
    since !== null &&
    attackerHolds(world) &&
    time - since >= (world.victory.takeMs ?? DEFAULT_TAKE_MS)
  ) {
    return { winner: attacker, reason: 'objective-taken', time };
  }
  return null;
}

/**
 * The one victory check at the end of an umpire turn (D39): the objective (held since the turn
 * end from which only the attacker held it), a broken force, and the time limit, which the turn
 * that contains it ends at.
 */
export function turnVictory(world: GameState, time: number): HandlerResult<GameState> {
  if (world.outcome) return { world };
  const held = trackHold(world, time);
  world = held.world;
  // A force broken in this turn is ruled on before the time limit is read (#417).
  const declared = declareBattle(world, time);
  if (declared) world = declared.world;
  const emit = declared?.emit ?? [];
  const outcome =
    evaluateVictory(world, time) ??
    (time >= world.victory.holdMs ? timeLimitOutcome(world, time) : null);
  if (outcome) {
    const end = conclude(world, outcome);
    return { ...end, emit: [...emit, ...(end.emit ?? [])] };
  }
  return { world, schedule: [...held.schedule, ...(declared?.schedule ?? [])], emit };
}

/**
 * The result when the clock reaches the time limit and `evaluateVictory` found none (D13, #417).
 * A declared battle is decided: its ruling closes the game now, cutting the pursuit short, so
 * the hold timer never overrides it. Only a game with no ruling goes to the defender.
 */
function timeLimitOutcome(world: GameState, time: number): Outcome {
  const battle = world.battle;
  return battle
    ? { winner: battle.winner, reason: battle.reason, time }
    : { winner: world.victory.defender, reason: 'objective-held', time };
}

/**
 * Declare the battle if one side's force is broken and the other's is not (D13): record the
 * umpire's ruling, file it as a report to both sides (no figures, so nothing hidden leaks) and
 * queue the check that closes the game once the pursuit has played out. Pure.
 */
function declareBattle(
  world: GameState,
  time: number,
): {
  world: GameState;
  schedule: NewEvent[];
  emit: Array<{ type: string; payload?: Json }>;
} | null {
  if (world.battle || world.outcome) return null;
  const { attacker, defender } = world.victory;
  const brokenA = forceBroken(world, attacker) || sideOut(world, attacker) !== null;
  const brokenD = forceBroken(world, defender) || sideOut(world, defender) !== null;
  if (brokenA === brokenD) return null;
  const loser = brokenA ? attacker : defender;
  const winner = brokenA ? defender : attacker;
  const reason = brokenA ? 'attack-broken' : 'defence-broken';
  const name = sideName(world);
  const { centre, where, closed } = objectivePlace(world);
  const narrative = brokenA
    ? `${name(loser)}'s attack ${closed} has been broken; ${name(winner)} holds the field.`
    : `${name(loser)}'s defence ${closed} has been broken; ${name(winner)} holds the field.`;
  const rationale =
    `${name(loser)} has lost its fighting strength (units broken or destroyed, the rest below ` +
    `${Math.round(BROKEN_FORCE_FRACTION * 100)}% of its start, morale counted) while ${name(winner)} is still in the fight.`;
  const ruling: BattleRuling = {
    id: `ruling-${world.rulings.length + 1}`,
    time,
    kind: 'battle',
    winner,
    loser,
    reason,
    rationale,
    narrative,
  };
  const w: GameState = {
    ...world,
    rulings: [...world.rulings, ruling],
    battle: { winner, reason, declaredAt: time },
    intel: fileToAll(world, {
      from: 'Dispatch from the field',
      time,
      centre,
      place: where,
      text: narrative,
    }),
  };
  return {
    world: w,
    schedule: [
      {
        time: Math.max(time, pursuitEndsAt(w)!),
        type: COMBAT_CHECK_EVENT,
      },
    ],
    emit: [
      {
        type: 'umpire.ruling',
        payload: { rulingId: ruling.id, kind: 'battle', winner, reason },
      },
    ],
  };
}

/**
 * End the game. A decided battle always has the umpire's ruling on record, also when a side
 * left the field altogether and there is no pursuit left to play out.
 */
function conclude(world: GameState, outcome: Outcome): HandlerResult<GameState> {
  const declared = outcome.winner === null ? null : declareBattle(world, outcome.time);
  const battle = declared?.world.battle ?? world.battle;
  // A side that left the field after its force broke lost the battle: say so, not just that it left.
  const said: Outcome =
    battle && (outcome.reason === 'withdrawn' || outcome.reason === 'eliminated')
      ? { ...outcome, reason: battle.reason, loserOut: outcome.reason }
      : outcome;
  const end = finish(declared?.world ?? world, said);
  return { ...end, emit: [...(declared?.emit ?? []), ...(end.emit ?? [])] };
}

/** The unit's own fight reports, in the order written. */
const FIGHT_REPORTS: ReadonlySet<Report['kind']> = new Set(['engaged', 'heavyLosses', 'broke']);

/**
 * How a unit in the fight stands as it writes (#438): `routed` while it is broken and falling back,
 * so its note does not say it holds; `rallied` in its first report of the fight since it rallied
 * from a break, so the note says so before it says it holds again.
 */
export function standing(world: GameState, u: Unit): Pick<Report, 'routed' | 'rallied'> {
  // Broken, or breaking in this very tick (its `broke` report follows this one).
  if (u.status === 'withdrawn' && u.brokenAt !== undefined) return { routed: true };
  if (u.status === 'active' && u.morale < unitTypeOf(u).breakMorale) return { routed: true };
  const mine = world.intel[u.side].reports.filter(
    (r) => r.from === u.name && FIGHT_REPORTS.has(r.kind),
  );
  const last = mine.at(-1);
  return last && (last.kind === 'broke' || last.routed) ? { rallied: true } : {};
}

function finish(world: GameState, outcome: Outcome): HandlerResult<GameState> {
  // The game is over: every unit stops where it stands and takes no further orders.
  const units = world.units.map((u) => {
    const center = positionAt(world.map, u, outcome.time);
    const stopped: Unit = { ...u, center, intent: { kind: 'idle' } };
    delete stopped.leg;
    return stopped;
  });
  // The game is over: reports still on the road are handed in, so the closing dispatches are read.
  // One dated after the end is never written, so it stays undelivered: HQ gives a courier up only
  // once it is overdue, and that paper is filed ahead of its time (#438).
  const intel = Object.fromEntries(
    Object.entries(world.intel).map(([side, i]) => [
      side,
      {
        ...i,
        reports: i.reports.map((r) =>
          r.deliverAt > outcome.time && r.observedAt <= outcome.time
            ? { ...r, deliverAt: outcome.time }
            : r,
        ),
        // Dispatches taken before the end are read too, though captured ones are dated to the
        // turn's end in turn mode (#438).
        documents: i.documents.map((d) =>
          d.deliverAt > outcome.time && d.capturedAt <= outcome.time
            ? { ...d, deliverAt: outcome.time }
            : d,
        ),
      },
    ]),
  ) as GameState['intel'];
  const papers = world.turn ? outcomePapers({ ...world, intel }, outcome) : intel;
  return {
    world: { ...world, units, intel: papers, time: outcome.time, combatActive: false, outcome },
    emit: [
      {
        type: 'game.end',
        payload: { winner: outcome.winner, reason: outcome.reason },
      },
    ],
  };
}

/**
 * The umpire's closing paper in a turn-mode game (#429): each side is told in its in-tray how the
 * game was decided, at the minute it was, as the turn's last report. Public, like the outcome, so it
 * names no unit and no figure. Real-time play has the game-over screen alone, as before.
 */
function outcomePapers(world: GameState, outcome: Outcome): GameState['intel'] {
  const place = objectivePlace(world);
  return fileToAll(world, {
    from: "The umpire's ruling",
    time: outcome.time,
    centre: place.centre,
    place: place.where,
    text: outcomeText(world, outcome, place),
  });
}

/** The objective's centre and how it reads in a paper: `where` carries its own preposition. */
function objectivePlace(world: GameState): { centre: Point; where: string; closed: string } {
  const centre = polygonCentroid(world.victory.objective);
  const where = describePlace(world.map, centre);
  // A place with a clause in it ("at the bridge, on the High road") is closed by a comma.
  return { centre, where, closed: where.includes(',') ? `${where},` : where };
}

const sideName = (world: GameState) => (id: SideId) =>
  world.sides.find((s) => s.id === id)?.name ?? id;

/** One public paper, delivered at once to every side's in-tray as its next report. */
function fileToAll(
  world: GameState,
  paper: { from: string; time: number; centre: Point; place: string; text: string },
): GameState['intel'] {
  const intel = { ...world.intel };
  for (const { id: side } of world.sides) {
    const i = intel[side];
    const report: Report = {
      id: `${side}-r${i.reports.length + 1}`,
      kind: 'battle',
      observedAt: paper.time,
      deliverAt: paper.time,
      from: paper.from,
      location: { ...paper.centre },
      place: paper.place,
      uncertainty: 0,
      confidence: 'high',
      text: paper.text,
    };
    intel[side] = { ...i, reports: [...i.reports, report] };
  }
  return intel;
}

/** How the game was decided, in the umpire's words. Exported for tests only. */
export function outcomeText(
  world: GameState,
  outcome: Outcome,
  { closed } = objectivePlace(world),
): string {
  const name = sideName(world);
  const winner = outcome.winner === null ? null : name(outcome.winner);
  const loserId = world.sides.find((s) => s.id !== outcome.winner)?.id;
  const loser = loserId === undefined ? '' : name(loserId);
  switch (outcome.reason) {
    case 'objective-taken':
      return `${winner} has taken the objective ${closed} and held it. The game is over: ${winner} wins.`;
    case 'objective-held':
      // Also the outcome when the attacker stands on it with the take not complete: say only what is true.
      return `The time limit is reached and ${loser} has not taken the objective ${closed}. The game is over: ${winner} wins.`;
    case 'attack-broken':
    case 'defence-broken': {
      const what = outcome.reason === 'attack-broken' ? 'attack' : 'defence';
      return `${loser}'s ${what} has been broken and ${winner} holds the field. The game is over: ${winner} wins.`;
    }
    case 'eliminated':
      return winner === null
        ? 'Both forces have been destroyed. The game is over: neither side wins.'
        : `${loser} has no force left on the field. The game is over: ${winner} wins.`;
    case 'withdrawn':
      return winner === null
        ? 'Both forces have left the field. The game is over: neither side wins.'
        : `${loser}'s force has left the field. The game is over: ${winner} wins.`;
  }
}

interface Shot {
  shooter: Unit;
  target: Unit;
  distance: number;
  cover: number;
  aspect: Aspect;
  melee: boolean;
  die: number;
  casualties: number;
  /** The factors that made `casualties`, so the combat log can be read back (post-game reveal). */
  factors: {
    fireRate: number;
    formation: number;
    vulnerability: number;
    morale: number;
    range: number;
    ammo: number;
    aspect: number;
    rout: number;
  };
}

/** Whom `shooter` fires at: its attack target if reachable, else the nearest enemy (ties: lowest id). */
function chooseTarget(shooter: Unit, enemies: Unit[]): Unit | undefined {
  const inReach = enemies.filter((e) => canReach(shooter, e));
  // Fighting units come first; a routed one is fired on only when nothing else is in reach.
  const standing = inReach.filter((e) => e.status === 'active');
  const reachable = standing.length > 0 ? standing : inReach;
  if (shooter.intent.kind === 'attack') {
    const wanted = shooter.intent.target;
    const t = reachable.find((e) => e.id === wanted);
    if (t) return t;
  }
  let best: Unit | undefined;
  for (const e of reachable) {
    if (
      !best ||
      distanceMm(shooter.center, e.center) < distanceMm(shooter.center, best.center) ||
      (distanceMm(shooter.center, e.center) === distanceMm(shooter.center, best.center) &&
        e.id < best.id)
    ) {
      best = e;
    }
  }
  return best;
}

/**
 * Register the combat and victory handlers.
 *
 * Contact: whenever a step changes the picture, `combat.check` looks for opposing
 * active units within reach of each other (`RANGE_M`). The first contact starts a
 * chain of `combat.tick` events every 2 game minutes; the chain stops at the first
 * tick that finds no contact. A tick lets every active unit fire once at its
 * target, all hits being worked out from the strengths at the start of the tick
 * (so fire is simultaneous), then applies casualties and morale, breaks units
 * and checks for victory. Dice come only from the seeded game RNG, rolled in unit order.
 */
export function registerCombat(registry: EventRegistry<GameState>): void {
  registerSupply(registry);
  registry.register(ATTACK_INTENT_EVENT, (world, ev) => {
    if (heldTurn(world, ev.time)) return { world };
    const { unitId, target: targetId } = ev.payload as unknown as {
      unitId: string;
      target: string;
    };
    const unit = world.units.find((u) => u.id === unitId);
    if (!unit) return rejectOrder(world, unitId, 'unknown unit');
    if (unit.status !== 'active') return rejectOrder(world, unitId, 'unit not active');
    // Several checks at one instant may each ask for a re-plan; the first one is enough.
    if (
      unit.intent.kind === 'attack' &&
      unit.intent.target === targetId &&
      unit.intent.startedAt === ev.time
    ) {
      return { world };
    }
    const target = world.units.find((u) => u.id === targetId);
    if (!target) return rejectOrder(world, unitId, 'unknown target');
    if (target.side === unit.side) return rejectOrder(world, unitId, 'target is friendly');
    if (target.status === 'destroyed') return rejectOrder(world, unitId, 'target not active');
    if (target.status === 'withdrawn' && !isRouted(target, ev.time)) {
      return rejectOrder(world, unitId, 'target not active');
    }
    const check: NewEvent = { time: ev.time, type: COMBAT_CHECK_EVENT };
    if (canReach(unit, target)) {
      return {
        world: {
          ...world,
          time: ev.time,
          units: world.units.map((u) =>
            u.id === unitId
              ? {
                  ...u,
                  intent: {
                    kind: 'attack' as const,
                    target: targetId,
                    to: { ...u.center },
                    startedAt: ev.time,
                  },
                }
              : u,
          ),
        },
        schedule: [check],
      };
    }
    const res = startMarch(world, unit, target.center, ev.time, targetId);
    if (res.emit?.some((e) => e.type === 'unit.moveBlocked')) {
      // No way to the target. A unit that was already attacking it gives up, or
      // `combat.check` would ask for the same chase again at this very instant.
      const stale = unit.intent.kind === 'attack' && unit.intent.target === targetId;
      const w = stale
        ? {
            ...res.world,
            units: res.world.units.map((u) =>
              u.id === unitId ? { ...u, intent: { kind: 'idle' as const } } : u,
            ),
          }
        : res.world;
      return { ...res, world: w };
    }
    return { ...res, schedule: [...(res.schedule ?? []), check] };
  });

  registry.register(COMBAT_CHECK_EVENT, (world, ev) => {
    // In an umpire turn the umpire decides the fighting, and `umpire.turn` checks victory.
    if (world.outcome || heldTurn(world, ev.time)) return { world };
    const held = trackHold(world, ev.time);
    world = held.world;
    const outcome = evaluateVictory(world, ev.time);
    if (outcome) return conclude(world, outcome);
    const declared = declareBattle(world, ev.time);
    if (declared) world = declared.world;
    // An attacker that stopped in reach (its `to` is where it stands) and whose target
    // has since moved out of reach gives chase again.
    const chase: NewEvent[] = [];
    for (const u of activeUnits(world)) {
      if (u.intent.kind !== 'attack') continue;
      if (u.intent.to.x !== u.center.x || u.intent.to.y !== u.center.y) continue;
      const foe = world.units.find((x) => x.id === (u.intent as { target: string }).target);
      if (foe && pursuable(foe, ev.time) && !canReach(u, foe)) {
        chase.push({
          time: ev.time,
          type: ATTACK_INTENT_EVENT,
          payload: { unitId: u.id, target: foe.id },
        });
      }
    }
    chase.push(...held.schedule, ...(declared?.schedule ?? []));
    const declaredEmit = declared?.emit ?? [];
    if (world.combatActive) return { world, schedule: chase, emit: declaredEmit };
    const pairs = contactPairs(world, ev.time);
    if (pairs.length === 0) return { world, schedule: chase, emit: declaredEmit };
    return {
      world: { ...world, time: ev.time, combatActive: true },
      schedule: [{ time: ev.time + COMBAT_TICK_MS, type: COMBAT_TICK_EVENT }, ...chase],
      emit: [
        {
          type: 'contact.begin',
          payload: { pairs: pairs.map(([a, b]) => [a.id, b.id]) },
        },
        ...declaredEmit,
      ],
    };
  });

  registry.register(VICTORY_DEADLINE_EVENT, (world, ev) => {
    if (world.outcome || heldTurn(world, ev.time)) return { world };
    // The deadline was queued at the start, before this minute's combat tick, so it steps
    // behind whatever is already queued for the minute: a break that tick makes is ruled on
    // first (#417). A tick queues its successor 2 minutes on, so one step back is enough.
    if (!(ev.payload as { last?: boolean } | null)?.last) {
      return {
        world,
        schedule: [{ time: ev.time, type: VICTORY_DEADLINE_EVENT, payload: { last: true } }],
      };
    }
    // A force broken at this very minute is ruled on before the time limit is read (#417).
    const declared = declareBattle(world, ev.time);
    if (declared) world = declared.world;
    const end = conclude(
      world,
      evaluateVictory(world, ev.time) ?? timeLimitOutcome(world, ev.time),
    );
    return { ...end, emit: [...(declared?.emit ?? []), ...(end.emit ?? [])] };
  });

  registry.register(RALLY_EVENT, (world, ev, rng) => {
    // The result of a declared battle stands, so a rally after it changes nothing.
    if (world.outcome || world.battle) return { world };
    const { unitId } = ev.payload as unknown as { unitId: string };
    const u = world.units.find((x) => x.id === unitId);
    if (!u || u.status !== 'withdrawn' || u.brokenAt === undefined) return { world };
    if (ev.time - u.brokenAt > RALLY_RULES.giveUpMs) return { world };
    // A held turn rolls no rally: the try waits for the next one. The chain still ends when the
    // unit rallies, is lost or gives up, so a later break starts only one chain.
    if (heldTurn(world, ev.time)) {
      return {
        world,
        schedule: [{ time: ev.time + RALLY_RULES.retryMs, type: RALLY_EVENT, payload: { unitId } }],
      };
    }
    const start = world.startStrength?.[u.id] ?? u.strength;
    if (u.strength < RALLY_RULES.minStrengthShare * start) return { world };
    const retry: NewEvent = {
      time: ev.time + RALLY_RULES.retryMs,
      type: RALLY_EVENT,
      payload: { unitId },
    };
    const where = positionAt(world.map, u, ev.time);
    const pressed = world.units.some(
      (e) =>
        e.side !== u.side &&
        e.status === 'active' &&
        distanceMm(where, e.center) <= mm(RALLY_RULES.enemyClearM),
    );
    if (pressed) {
      return {
        world,
        schedule: [retry],
        emit: [{ type: 'unit.rallyFailed', payload: { unitId, reason: 'pressed' } }],
      };
    }
    const die = rng.die(6);
    if (die < RALLY_RULES.dieAtLeast) {
      return {
        world,
        schedule: [retry],
        emit: [{ type: 'unit.rallyFailed', payload: { unitId, reason: 'die', die } }],
      };
    }
    const rallied: Unit = {
      ...u,
      center: where,
      status: 'active',
      morale: Math.max(u.morale, RALLY_RULES.moraleAfter),
      intent: { kind: 'idle' },
    };
    delete rallied.leg;
    delete rallied.brokenAt;
    return {
      world: {
        ...world,
        time: ev.time,
        units: world.units.map((x) => (x.id === unitId ? rallied : x)),
      },
      schedule: [{ time: ev.time, type: COMBAT_CHECK_EVENT }],
      emit: [{ type: 'unit.rallied', payload: { unitId, die, morale: rallied.morale } }],
    };
  });

  registry.register(COMBAT_TICK_EVENT, (world, ev, rng) => {
    if (world.outcome) return { world };
    // The chain ends in a held turn; the check `umpire.turn` queues just past the turn's end
    // starts it again if units are still in contact.
    if (heldTurn(world, ev.time)) return { world: { ...world, combatActive: false } };
    const active = activeUnits(world);
    const shots: Shot[] = [];
    for (const shooter of active) {
      const target = chooseTarget(
        shooter,
        world.units.filter((u) => u.side !== shooter.side && pursuable(u, ev.time)),
      );
      if (!target) continue;
      const die = rng.die(6);
      const cover = coverFactor(terrainAt(world.map, target.center)?.attrs.cover ?? 0);
      const moraleFactor = 0.5 + shooter.morale / 200;
      const aspect = aspectOf(shooter, target);
      // Cavalry on a routed unit rides it down: a sabre blow in the back, not a volley.
      const melee =
        inMelee(shooter, target) || (shooter.kind === 'cavalry' && target.status === 'withdrawn');
      // Melee is a blow at arm's length: no range falloff, but a heavier one than fire.
      const reach = melee ? MELEE_FACTOR : rangeFactor(shooter, target);
      const factors = {
        fireRate: unitTypeOf(shooter).fireRate,
        formation: FORMATION_RULES[shooter.formation].fireFactor,
        vulnerability: melee
          ? FORMATION_RULES[target.formation].meleeVulnerability
          : FORMATION_RULES[target.formation].fireVulnerability,
        morale: moraleFactor,
        range: reach,
        // A shooter with no cartridges left is nearly harmless; steel in melee is not fired.
        ammo: !melee && shooter.ammo <= 0 ? OUT_OF_AMMO_FACTOR : 1,
        aspect: ASPECT_FACTOR[aspect],
        rout: target.status === 'withdrawn' ? ROUT_FACTOR : 1,
      };
      const casualties = round2(
        shooter.strength *
          factors.fireRate *
          factors.formation *
          factors.vulnerability *
          (die / 3.5) *
          factors.morale *
          cover *
          factors.range *
          factors.ammo *
          factors.aspect *
          factors.rout,
      );
      shots.push({
        shooter,
        target,
        distance: distanceMm(shooter.center, target.center),
        cover,
        aspect,
        melee,
        die,
        casualties,
        factors,
      });
    }
    if (shots.length === 0) {
      return {
        world: { ...world, time: ev.time, combatActive: false },
        emit: [{ type: 'contact.end' }],
      };
    }

    const emit: Array<{ type: string; payload?: Json }> = [];
    const next: NewEvent[] = [{ time: ev.time + COMBAT_TICK_MS, type: COMBAT_TICK_EVENT }];
    const lost = new Map<string, number>();
    for (const s of shots) lost.set(s.target.id, (lost.get(s.target.id) ?? 0) + s.casualties);

    let w: GameState = { ...world, time: ev.time };
    const fate = new Map<string, Unit>();
    const moraleLog: Array<Record<string, Json>> = [];
    // Melee is settled by who dealt more: the side that came off worse loses heart.
    const meleeDealt = new Map<string, number>();
    const meleeTaken = new Map<string, number>();
    for (const s of shots) {
      if (!s.melee) continue;
      meleeDealt.set(s.shooter.id, (meleeDealt.get(s.shooter.id) ?? 0) + s.casualties);
      meleeTaken.set(s.target.id, (meleeTaken.get(s.target.id) ?? 0) + s.casualties);
    }
    for (const u of world.units) {
      const taken = Math.min(lost.get(u.id) ?? 0, u.strength);
      if (taken === 0) continue;
      const strength = round2(u.strength - taken) < 0.01 ? 0 : round2(u.strength - taken);
      // Shock scales with where the blows came from: a hit in the back unnerves more.
      let shock = 0;
      for (const s of shots) {
        if (s.target.id !== u.id) continue;
        const share = (s.casualties / u.strength) * 100 * MORALE_RULES.lossPerPercent;
        shock += share * SHOCK_FACTOR[s.aspect];
      }
      let morale = Math.max(0, round2(u.morale - shock));
      const lossPercent = round2((taken / u.strength) * 100);
      // A unit that lost real men takes a morale check: two dice against its morale.
      if (strength > 0 && lossPercent >= MORALE_RULES.checkLossPercent) {
        const roll = rng.die(6) + rng.die(6);
        const needed = Math.round((morale / 100) * 12);
        const passed = roll <= needed;
        if (!passed) morale = Math.max(0, round2(morale - MORALE_RULES.checkFailLoss));
        moraleLog.push({ unitId: u.id, lossPercent, roll, needed, passed, morale });
      }
      if (
        strength > 0 &&
        meleeTaken.has(u.id) &&
        meleeTaken.get(u.id)! > (meleeDealt.get(u.id) ?? 0)
      ) {
        morale = Math.max(0, round2(morale - MORALE_RULES.meleeLoserLoss));
      }
      fate.set(u.id, {
        ...u,
        strength,
        morale,
        status: strength === 0 ? 'destroyed' : u.status,
      });
    }
    for (const m of moraleLog) emit.push({ type: 'combat.morale', payload: m });
    for (const s of shots) {
      // A target whose total casualties this tick round to 0 earned no fate entry: the
      // loss phase left it untouched, so the shot is reported against the unit as it
      // stands, with its strength and morale unchanged (#445).
      const after = fate.get(s.target.id) ?? s.target;
      emit.push({
        type: 'combat.fire',
        payload: {
          attacker: s.shooter.id,
          target: s.target.id,
          distance: round2(s.distance / 1000),
          cover: s.cover,
          aspect: s.aspect,
          melee: s.melee,
          die: s.die,
          casualties: s.casualties,
          factors: s.factors,
          targetStrength: after.strength,
          targetMorale: after.morale,
        },
      });
    }
    w = { ...w, units: w.units.map((u) => fate.get(u.id) ?? u) };
    // Fighting tires everyone in an exchange, and firing spends the shooters' ammunition.
    const engaged = new Set(shots.flatMap((s) => [s.shooter.id, s.target.id]));
    const fired = new Set(
      shots.filter((s) => !s.melee && s.shooter.ammo > 0).map((s) => s.shooter.id),
    );
    const worn: Array<[Unit, Unit]> = [];
    w = {
      ...w,
      units: w.units.map((u) => {
        if (!engaged.has(u.id)) return u;
        const w2: Unit = {
          ...u,
          fatigue: Math.min(100, round2(u.fatigue + FATIGUE_PER_FIGHT_TICK)),
          ammo: fired.has(u.id) ? Math.max(0, u.ammo - AMMO_PER_FIRE_TICK[u.kind]) : u.ammo,
        };
        worn.push([u, w2]);
        return w2;
      }),
    };
    for (const [before, after] of worn) w = noteWear(w, before, after, ev.time);
    // A unit that fired turns to face its target, so it shows its front to whom it fights.
    const faced = new Map(
      shots.map((s) => [s.shooter.id, bearingTo(s.shooter.center, s.target.center)]),
    );
    w = {
      ...w,
      units: w.units.map((u) => (faced.has(u.id) ? { ...u, facing: faced.get(u.id)! } : u)),
    };

    // The units in the fight send word to their own HQ: engaged, then heavy losses. These are
    // about the side's own units, so they carry nothing of the enemy's.
    // Once the battle is ruled, the fight is over for the record: no more field reports of it.
    for (const u of world.units) {
      if (world.battle) break;
      if (!engaged.has(u.id) || (u.status !== 'active' && u.status !== 'withdrawn')) continue;
      const now = w.units.find((x) => x.id === u.id)!;
      const reports = w.intel[u.side].reports;
      if (
        u.status === 'active' &&
        !reports.some(
          (r) =>
            r.kind === 'engaged' && r.from === u.name && r.observedAt > ev.time - ENGAGED_REPEAT_MS,
        )
      ) {
        w = fileReport(w, 'engaged', now, ev.time, FIELD_REPORT_DELAY_MS, standing(w, now));
      }
      const start = world.startStrength?.[u.id] ?? u.strength;
      const heavy = HEAVY_LOSS_FRACTION * start;
      // Once per unit, as its strength first falls under the line. That may be in the same tick it
      // breaks, or while it is being run down after: most of a beaten unit's men are lost in the
      // pursuit, and the commander still wants to hear of it.
      if (now.strength > 0 && u.strength >= heavy && now.strength < heavy) {
        w = fileReport(w, 'heavyLosses', now, ev.time, FIELD_REPORT_DELAY_MS, standing(w, now));
      }
    }
    for (const u of w.units) {
      if (!fate.has(u.id)) continue;
      if (u.status === 'destroyed') {
        emit.push({ type: 'unit.destroyed', payload: { unitId: u.id } });
        // The survivors' own side is told it has lost the unit.
        w = fileReport(w, 'unitLost', u, ev.time);
        w = {
          ...w,
          units: w.units.map((x) => {
            if (x.id !== u.id) return x;
            // The dead stop where they fell, not at the end of the road they were fleeing along.
            const fallen: Unit = {
              ...x,
              center: positionAt(w.map, x, ev.time),
              intent: { kind: 'idle' },
            };
            delete fallen.leg;
            return fallen;
          }),
        };
      } else if (u.status === 'active' && u.morale < unitTypeOf(u).breakMorale) {
        const broken: Unit = {
          ...u,
          status: 'withdrawn',
          intent: { kind: 'idle' },
          brokenAt: ev.time,
        };
        w = { ...w, units: w.units.map((x) => (x.id === u.id ? broken : x)) };
        const res = startMarch(w, broken, u.home, ev.time);
        w = res.world;
        next.push(...(res.schedule ?? []));
        next.push({
          time: ev.time + RALLY_RULES.firstTryMs,
          type: RALLY_EVENT,
          payload: { unitId: u.id },
        });
        emit.push({ type: 'unit.broken', payload: { unitId: u.id, morale: u.morale } });
        w = fileReport(w, 'broke', broken, ev.time, FIELD_REPORT_DELAY_MS);
        emit.push(...(res.emit ?? []));
        // Cavalry that is free to move rides down the unit that broke, if it is near.
        for (const rider of w.units) {
          if (rider.side === u.side || rider.status !== 'active' || rider.kind !== 'cavalry')
            continue;
          if (rider.intent.kind !== 'idle' && rider.intent.kind !== 'hold') continue;
          if (distanceMm(rider.center, u.center) > mm(PURSUIT_RANGE_M)) continue;
          next.push({
            time: ev.time,
            type: ATTACK_INTENT_EVENT,
            payload: { unitId: rider.id, target: u.id },
          });
        }
      }
    }
    // Anyone chasing a unit that is gone has nothing left to chase.
    w = {
      ...w,
      units: w.units.map((u) => {
        if (u.intent.kind !== 'attack') return u;
        const t = w.units.find((x) => x.id === (u.intent as { target: string }).target);
        return t && pursuable(t, ev.time) ? u : { ...u, intent: { kind: 'idle' } };
      }),
    };

    const held = trackHold(w, ev.time);
    w = held.world;
    next.push(...held.schedule);
    const declared = declareBattle(w, ev.time);
    if (declared) {
      w = declared.world;
      next.push(...declared.schedule);
      emit.push(...declared.emit);
    }
    const outcome = evaluateVictory(w, ev.time);
    if (outcome) {
      const end = conclude(w, outcome);
      return { world: end.world, emit: [...emit, ...(end.emit ?? [])] };
    }
    return { world: w, schedule: next, emit };
  });
}
