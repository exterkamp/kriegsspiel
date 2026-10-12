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
  distanceMm,
  inMelee,
  onObjective,
  rangeFactor,
  type Aspect,
} from './contact.js';
import type { EngineState, EventRegistry, HandlerResult, Json, NewEvent } from './events.js';
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
  type GameState,
  type Outcome,
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
function contactPairs(world: GameState): Array<[Unit, Unit]> {
  const active = activeUnits(world);
  const pairs: Array<[Unit, Unit]> = [];
  for (const a of active) {
    for (const b of active) {
      if (a.side !== b.side && a.id < b.id && (canReach(a, b) || canReach(b, a)))
        pairs.push([a, b]);
    }
  }
  return pairs;
}

function sideOut(world: GameState, side: SideId): 'eliminated' | 'withdrawn' | null {
  const mine = world.units.filter((u) => u.side === side);
  if (mine.some((u) => u.status === 'active')) return null;
  return mine.every((u) => u.status === 'destroyed') ? 'eliminated' : 'withdrawn';
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

function finish(world: GameState, outcome: Outcome): HandlerResult<GameState> {
  // The game is over: every unit stops where it stands and takes no further orders.
  const units = world.units.map((u) => {
    const center = positionAt(world.map, u, outcome.time);
    const stopped: Unit = { ...u, center, intent: { kind: 'idle' } };
    delete stopped.leg;
    return stopped;
  });
  return {
    world: { ...world, units, time: outcome.time, combatActive: false, outcome },
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
  const reachable = enemies.filter((e) => canReach(shooter, e));
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
    if (target.status !== 'active') return rejectOrder(world, unitId, 'target not active');
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
    if (outcome) return finish(world, outcome);
    // An attacker that stopped in reach (its `to` is where it stands) and whose target
    // has since moved out of reach gives chase again.
    const chase: NewEvent[] = [];
    for (const u of activeUnits(world)) {
      if (u.intent.kind !== 'attack') continue;
      if (u.intent.to.x !== u.center.x || u.intent.to.y !== u.center.y) continue;
      const foe = world.units.find((x) => x.id === (u.intent as { target: string }).target);
      if (foe && foe.status === 'active' && !canReach(u, foe)) {
        chase.push({
          time: ev.time,
          type: ATTACK_INTENT_EVENT,
          payload: { unitId: u.id, target: foe.id },
        });
      }
    }
    chase.push(...held.schedule);
    if (world.combatActive) return { world, schedule: chase };
    const pairs = contactPairs(world);
    if (pairs.length === 0) return { world, schedule: chase };
    return {
      world: { ...world, time: ev.time, combatActive: true },
      schedule: [{ time: ev.time + COMBAT_TICK_MS, type: COMBAT_TICK_EVENT }, ...chase],
      emit: [
        {
          type: 'contact.begin',
          payload: { pairs: pairs.map(([a, b]) => [a.id, b.id]) },
        },
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
    return finish(world, outcome);
  });

  registry.register(COMBAT_TICK_EVENT, (world, ev, rng) => {
    if (world.outcome) return { world };
    const active = activeUnits(world);
    const shots: Shot[] = [];
    for (const shooter of active) {
      const target = chooseTarget(
        shooter,
        active.filter((u) => u.side !== shooter.side),
      );
      if (!target) continue;
      const die = rng.die(6);
      const cover = coverFactor(terrainAt(world.map, target.center)?.attrs.cover ?? 0);
      const moraleFactor = 0.5 + shooter.morale / 200;
      const aspect = aspectOf(shooter, target);
      const melee = inMelee(shooter, target);
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
          ASPECT_FACTOR[aspect],
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

    for (const u of w.units) {
      if (!fate.has(u.id)) continue;
      if (u.status === 'destroyed') {
        emit.push({ type: 'unit.destroyed', payload: { unitId: u.id } });
        w = {
          ...w,
          units: w.units.map((x) => (x.id === u.id ? { ...x, intent: { kind: 'idle' } } : x)),
        };
      } else if (u.status === 'active' && u.morale < unitTypeOf(u).breakMorale) {
        const broken: Unit = { ...u, status: 'withdrawn', intent: { kind: 'idle' } };
        w = { ...w, units: w.units.map((x) => (x.id === u.id ? broken : x)) };
        const res = startMarch(w, broken, u.home, ev.time);
        w = res.world;
        next.push(...(res.schedule ?? []));
        emit.push({ type: 'unit.broken', payload: { unitId: u.id, morale: u.morale } });
        emit.push(...(res.emit ?? []));
      }
    }
    // Anyone chasing a unit that is gone has nothing left to chase.
    w = {
      ...w,
      units: w.units.map((u) => {
        if (u.intent.kind !== 'attack') return u;
        const t = w.units.find((x) => x.id === (u.intent as { target: string }).target);
        return t && t.status === 'active' ? u : { ...u, intent: { kind: 'idle' } };
      }),
    };

    const held = trackHold(w, ev.time);
    w = held.world;
    next.push(...held.schedule);
    const outcome = evaluateVictory(w, ev.time);
    if (outcome) {
      const end = finish(w, outcome);
      return { world: end.world, emit: [...emit, ...(end.emit ?? [])] };
    }
    return { world: w, schedule: next, emit };
  });
}
