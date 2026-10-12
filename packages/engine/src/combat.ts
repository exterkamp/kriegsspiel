import {
  ASPECT_FACTOR,
  ATTACK_INTENT_EVENT,
  COMBAT_CHECK_EVENT,
  COMBAT_TICK_EVENT,
  MELEE_FACTOR,
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
import { schedule } from './queue.js';
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
  type GameState,
  type Outcome,
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
export const MORALE_PER_LOSS_PERCENT = 2;
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
export const ROUT_FACTOR = 3;
/** A unit reports heavy losses when its strength falls below this share of its start. */
export const HEAVY_LOSS_FRACTION = 0.5;
/** A unit already reported engaged says so again only after this long without a report. */
export const ENGAGED_REPEAT_MS = 10 * MS_PER_MINUTE;
/** Cavalry that is idle or holding rides after a routed enemy this close (metres) to it. */
export const PURSUIT_RANGE_M = 1500;

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
  return {
    world: { ...world, heldSince: time },
    schedule: [{ time: time + takeMs, type: COMBAT_CHECK_EVENT }],
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
  // A side with nobody left ends the game at once; one whose force broke closes after the pursuit.
  if (battle) {
    // A declared battle plays out its pursuit, then closes.
    return time >= battle.declaredAt + BATTLE_CLOSE_MS
      ? { winner: battle.winner, reason: battle.reason, time }
      : null;
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
  const name = (id: SideId) => world.sides.find((s) => s.id === id)?.name ?? id;
  const where = describePlace(world.map, polygonCentroid(world.victory.objective));
  // `where` reads "at the bridge, on the High road": it carries its own preposition.
  const narrative = brokenA
    ? `${name(loser)}'s attack ${where} has been broken; ${name(winner)} holds the field.`
    : `${name(loser)}'s defence ${where} has been broken; ${name(winner)} holds the field.`;
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
  let w: GameState = {
    ...world,
    rulings: [...world.rulings, ruling],
    battle: { winner, reason, declaredAt: time },
  };
  const centre = polygonCentroid(world.victory.objective);
  for (const side of world.sides) {
    const report: Report = {
      id: `${side.id}-r${w.intel[side.id].reports.length + 1}`,
      kind: 'battle',
      observedAt: time,
      deliverAt: time,
      from: 'Dispatch from the field',
      location: { ...centre },
      place: where,
      uncertainty: 0,
      confidence: 'high',
      text: narrative,
    };
    w = {
      ...w,
      intel: {
        ...w.intel,
        [side.id]: { ...w.intel[side.id], reports: [...w.intel[side.id].reports, report] },
      },
    };
  }
  return {
    world: w,
    schedule: [{ time: time + BATTLE_CLOSE_MS, type: COMBAT_CHECK_EVENT }],
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

function finish(world: GameState, outcome: Outcome): HandlerResult<GameState> {
  // The game is over: every unit stops where it stands and takes no further orders.
  const units = world.units.map((u) => {
    const center = positionAt(world.map, u, outcome.time);
    const stopped: Unit = { ...u, center, intent: { kind: 'idle' } };
    delete stopped.leg;
    return stopped;
  });
  // The game is over: reports still on the road are handed in, so the closing dispatches are read.
  const intel = Object.fromEntries(
    Object.entries(world.intel).map(([side, i]) => [
      side,
      {
        ...i,
        reports: i.reports.map((r) =>
          r.deliverAt > outcome.time ? { ...r, deliverAt: outcome.time } : r,
        ),
      },
    ]),
  ) as GameState['intel'];
  return {
    world: { ...world, units, intel, time: outcome.time, combatActive: false, outcome },
    emit: [
      {
        type: 'game.end',
        payload: { winner: outcome.winner, reason: outcome.reason },
      },
    ],
  };
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
    if (world.outcome) return { world };
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
    if (world.outcome) return { world };
    const outcome = evaluateVictory(world, ev.time) ?? {
      winner: world.victory.defender,
      reason: 'objective-held' as const,
      time: ev.time,
    };
    return conclude(world, outcome);
  });

  registry.register(COMBAT_TICK_EVENT, (world, ev, rng) => {
    if (world.outcome) return { world };
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
      const casualties = round2(
        shooter.strength *
          unitTypeOf(shooter).fireRate *
          FORMATION_RULES[shooter.formation].fireFactor *
          (melee
            ? FORMATION_RULES[target.formation].meleeVulnerability
            : FORMATION_RULES[target.formation].fireVulnerability) *
          (die / 3.5) *
          moraleFactor *
          cover *
          reach *
          // A shooter with no cartridges left is nearly harmless; steel in melee is not fired.
          (!melee && shooter.ammo <= 0 ? OUT_OF_AMMO_FACTOR : 1) *
          ASPECT_FACTOR[aspect] *
          (target.status === 'withdrawn' ? ROUT_FACTOR : 1),
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
    for (const u of world.units) {
      const taken = Math.min(lost.get(u.id) ?? 0, u.strength);
      if (taken === 0) continue;
      const strength = round2(u.strength - taken) < 0.01 ? 0 : round2(u.strength - taken);
      const morale = Math.max(
        0,
        round2(u.morale - (taken / u.strength) * 100 * MORALE_PER_LOSS_PERCENT),
      );
      fate.set(u.id, {
        ...u,
        strength,
        morale,
        status: strength === 0 ? 'destroyed' : u.status,
      });
    }
    for (const s of shots) {
      const after = fate.get(s.target.id)!;
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
    for (const u of world.units) {
      if (!engaged.has(u.id) || u.status !== 'active') continue;
      const now = w.units.find((x) => x.id === u.id)!;
      const reports = w.intel[u.side].reports;
      if (
        !reports.some(
          (r) =>
            r.kind === 'engaged' && r.from === u.name && r.observedAt > ev.time - ENGAGED_REPEAT_MS,
        )
      ) {
        w = fileReport(w, 'engaged', now, ev.time, FIELD_REPORT_DELAY_MS);
      }
      const start = world.startStrength?.[u.id] ?? u.strength;
      const heavy = HEAVY_LOSS_FRACTION * start;
      const broke = now.status === 'active' && now.morale < unitTypeOf(now).breakMorale;
      if (now.strength > 0 && u.strength >= heavy && now.strength < heavy && !broke) {
        w = fileReport(w, 'heavyLosses', now, ev.time, FIELD_REPORT_DELAY_MS);
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
