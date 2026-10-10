import {
  ATTACK_INTENT_EVENT,
  COMBAT_CHECK_EVENT,
  COMBAT_TICK_EVENT,
  VICTORY_DEADLINE_EVENT,
  canReach,
  distanceSq,
} from './contact.js';
import type { EngineState, EventRegistry, HandlerResult, Json, NewEvent } from './events.js';
import { rejectOrder, startMarch } from './movement.js';
import { schedule } from './queue.js';
import {
  MS_PER_MINUTE,
  tileAt,
  type GameState,
  type Outcome,
  type SideId,
  type Terrain,
  type Unit,
  type UnitKind,
} from './types.js';

/** Game time between combat ticks while units are in contact. */
export const COMBAT_TICK_MS = 2 * MS_PER_MINUTE;

/**
 * Placeholder numbers; the rules tables arrive with Epic #2. A unit's casualties
 * per tick are `strength * FIRE_RATE * (die / 3.5) * moraleFactor * cover`, so a
 * 600-man battalion on a fair roll costs a target about 18 men every 2 minutes.
 */
export const FIRE_RATE: Record<UnitKind, number> = {
  infantry: 0.03,
  cavalry: 0.06,
  artillery: 0.04,
};

/** Multiplier on casualties taken, by the terrain the target stands on. */
export const COVER: Record<Terrain, number> = {
  open: 1,
  road: 1,
  bridge: 1,
  river: 1,
  wood: 0.6,
};

/** Morale lost per percent of strength lost in one tick. */
export const MORALE_PER_LOSS_PERCENT = 2;
/** A unit whose morale falls below this breaks and withdraws. */
export const BREAK_MORALE = 25;

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

/** The result of the game as of `time`, or null if it goes on. Exported for tests only. */
export function evaluateVictory(world: GameState, time: number): Outcome | null {
  const { attacker, objective } = world.victory;
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
  const onObjective = activeUnits(world).filter(
    (u) => u.position.x === objective.x && u.position.y === objective.y,
  );
  if (onObjective.length > 0 && onObjective.every((u) => u.side === attacker)) {
    return { winner: attacker, reason: 'objective-taken', time };
  }
  return null;
}

function finish(world: GameState, outcome: Outcome): HandlerResult<GameState> {
  return {
    world: { ...world, time: outcome.time, combatActive: false, outcome },
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
      distanceSq(shooter.position, e.position) < distanceSq(shooter.position, best.position) ||
      (distanceSq(shooter.position, e.position) === distanceSq(shooter.position, best.position) &&
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
 * active units within reach of each other (`RANGE_TILES`). The first contact starts a
 * chain of `combat.tick` events every 2 game minutes; the chain stops at the first
 * tick that finds no contact. A tick lets every active unit fire once at its
 * target, all hits being worked out from the strengths at the start of the tick
 * (so fire is simultaneous), then applies casualties and morale, breaks units
 * and checks for victory. Dice come only from the seeded game RNG, rolled in unit order.
 */
export function registerCombat(registry: EventRegistry<GameState>): void {
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
                    to: { ...u.position },
                    startedAt: ev.time,
                  },
                }
              : u,
          ),
        },
        schedule: [check],
      };
    }
    const res = startMarch(world, unit, target.position, ev.time, targetId);
    return { ...res, schedule: [...(res.schedule ?? []), check] };
  });

  registry.register(COMBAT_CHECK_EVENT, (world, ev) => {
    if (world.outcome) return { world };
    const outcome = evaluateVictory(world, ev.time);
    if (outcome) return finish(world, outcome);
    // An attacker that stopped in reach (its `to` is where it stands) and whose target
    // has since moved out of reach gives chase again.
    const chase: NewEvent[] = [];
    for (const u of activeUnits(world)) {
      if (u.intent.kind !== 'attack') continue;
      if (u.intent.to.x !== u.position.x || u.intent.to.y !== u.position.y) continue;
      const foe = world.units.find((x) => x.id === (u.intent as { target: string }).target);
      if (foe && foe.status === 'active' && !canReach(u, foe)) {
        chase.push({
          time: ev.time,
          type: ATTACK_INTENT_EVENT,
          payload: { unitId: u.id, target: foe.id },
        });
      }
    }
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
      const cover = COVER[tileAt(world.map, target.position) ?? 'open'];
      const moraleFactor = 0.5 + shooter.morale / 200;
      const casualties = round2(
        shooter.strength * FIRE_RATE[shooter.kind] * (die / 3.5) * moraleFactor * cover,
      );
      shots.push({
        shooter,
        target,
        distance: Math.sqrt(distanceSq(shooter.position, target.position)),
        cover,
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
          distance: round2(s.distance),
          cover: s.cover,
          die: s.die,
          casualties: s.casualties,
          targetStrength: after.strength,
          targetMorale: after.morale,
        },
      });
    }
    w = { ...w, units: w.units.map((u) => fate.get(u.id) ?? u) };

    for (const u of w.units) {
      if (!fate.has(u.id)) continue;
      if (u.status === 'destroyed') {
        emit.push({ type: 'unit.destroyed', payload: { unitId: u.id } });
        w = {
          ...w,
          units: w.units.map((x) => (x.id === u.id ? { ...x, intent: { kind: 'idle' } } : x)),
        };
      } else if (u.status === 'active' && u.morale < BREAK_MORALE) {
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

    const outcome = evaluateVictory(w, ev.time);
    if (outcome) {
      const end = finish(w, outcome);
      return { world: end.world, emit: [...emit, ...(end.emit ?? [])] };
    }
    return { world: w, schedule: next, emit };
  });
}
