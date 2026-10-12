import {
  EventRegistry,
  MS_PER_MINUTE,
  advanceTo,
  createState,
  holdTheBridge,
  holdTheBridgeFarStart,
  issueAttack,
  issueFormation,
  issueHalt,
  issueMove,
  issueOrder,
  loadScenario,
  positionAt,
  registerCombat,
  registerMovement,
  registerOrders,
  registerPlacement,
  registerVisibility,
  startGame,
  startVisibility,
  type EmittedEvent,
  type EngineState,
  type Formation,
  type GameState,
  type Order,
  type OrderIntent,
  type Pace,
} from './index.js';

/* Shared by invariants.test.ts and its regression corpus: scripted commands, a full run and the checks. */

export const HOUR = 60 * MS_PER_MINUTE;

export const SCENARIOS = {
  'hold-the-bridge': holdTheBridge,
  'hold-the-bridge-far-start': holdTheBridgeFarStart,
} as const;
export type ScenarioName = keyof typeof SCENARIOS;

/** Every handler the engine has, as the server registers them. */
export function fullRegistry(): EventRegistry<GameState> {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerCombat(r);
  registerOrders(r);
  registerPlacement(r);
  registerVisibility(r);
  return r;
}

export function startState(name: ScenarioName): EngineState<GameState> {
  const world = loadScenario(SCENARIOS[name]);
  return startGame(startVisibility(createState(world.seed, world, 0)));
}

/** A point in metres; the commands carry metres so a saved counterexample stays readable. */
export type Metres = [number, number];

export type Cmd =
  | { kind: 'move'; at: number; unit: string; to: Metres; pace?: Pace }
  | { kind: 'halt'; at: number; unit: string }
  | { kind: 'formation'; at: number; unit: string; formation: Formation }
  | { kind: 'attack'; at: number; unit: string; target: string }
  | {
      kind: 'order';
      at: number;
      unit: string;
      side: 'blue' | 'red';
      intent: 'move' | 'hold' | 'withdraw';
      to: Metres;
      courier?: 'fast' | 'safe';
    };

const pt = (m: Metres) => ({ x: Math.round(m[0] * 1000), y: Math.round(m[1] * 1000) });

function intentOf(c: Extract<Cmd, { kind: 'order' }>): OrderIntent {
  if (c.intent === 'move') return { kind: 'move', to: pt(c.to) };
  if (c.intent === 'hold') return { kind: 'hold', at: pt(c.to) };
  return { kind: 'withdraw', toward: pt(c.to) };
}

/** Queue every command at its own time. Unknown units and bad targets are left to the engine to refuse. */
export function applyCmds(state: EngineState<GameState>, cmds: Cmd[]): EngineState<GameState> {
  let s = state;
  cmds.forEach((c, i) => {
    switch (c.kind) {
      case 'move':
        s = issueMove(s, c.unit, pt(c.to), c.at, c.pace);
        break;
      case 'halt':
        s = issueHalt(s, c.unit, c.at);
        break;
      case 'formation':
        s = issueFormation(s, c.unit, c.formation, c.at);
        break;
      case 'attack':
        s = issueAttack(s, c.unit, c.target, c.at);
        break;
      case 'order': {
        const order: Order = {
          id: `fuzz-${i}`,
          side: c.side,
          to: c.unit,
          issuedAt: c.at,
          text: `fuzz order ${i}`,
          intents: [intentOf(c)],
          ...(c.courier ? { courier: c.courier } : {}),
        };
        s = issueOrder(s, order, c.at);
        break;
      }
    }
  });
  return s;
}

export interface Run {
  state: EngineState<GameState>;
  emitted: EmittedEvent[];
}

/** Advance through `stops` in turn (each >= the last), collecting everything emitted. */
export function runThrough(start: EngineState<GameState>, stops: number[]): Run {
  const reg = fullRegistry();
  let state = start;
  const emitted: EmittedEvent[] = [];
  for (const t of stops) {
    const r = advanceTo(state, t, reg);
    state = r.state;
    emitted.push(...r.emitted);
  }
  return { state, emitted };
}

/**
 * The fastest any unit can move, in mm per game ms: a generous bound (eight times the courier's
 * pace, 3.2 km a minute), since the check only has to catch a jump, not a fast march.
 */
const MAX_MM_PER_MS = 1000 / (MS_PER_MINUTE / 400 / 8);

/** Violations of the rules that must hold at every instant of every game, as readable strings. */
export function violations(
  prev: GameState,
  cur: GameState,
  dt: number,
  startUnits: ReadonlySet<string>,
): string[] {
  const bad: string[] = [];
  if (cur.units.length !== startUnits.size) bad.push('unit count changed');
  const before = new Map(prev.units.map((u) => [u.id, u]));
  for (const u of cur.units) {
    const p = before.get(u.id);
    if (!p || !startUnits.has(u.id)) {
      bad.push(`${u.id}: appeared`);
      continue;
    }
    if (!(u.strength >= 0)) bad.push(`${u.id}: strength ${u.strength}`);
    if (u.strength > p.strength + 1e-9) {
      bad.push(`${u.id}: strength rose ${p.strength} -> ${u.strength}`);
    }
    if (u.status === 'destroyed' && u.strength !== 0) bad.push(`${u.id}: destroyed with men`);
    if (p.status === 'destroyed' && u.status !== 'destroyed') {
      bad.push(`${u.id}: back from the dead`);
    }
    if (u.side !== p.side) bad.push(`${u.id}: changed side`);
    for (const k of ['morale', 'fatigue', 'ammo'] as const) {
      if (!(u[k] >= 0 && u[k] <= 100)) bad.push(`${u.id}: ${k} ${u[k]}`);
    }
    if (!Number.isFinite(u.center.x) || !Number.isFinite(u.center.y)) {
      bad.push(`${u.id}: non-finite position`);
    } else if (
      u.center.x < 0 ||
      u.center.y < 0 ||
      u.center.x > cur.map.width ||
      u.center.y > cur.map.height
    ) {
      bad.push(`${u.id}: off the map at ${u.center.x},${u.center.y}`);
    }
    const a = positionAt(prev.map, p, prev.time);
    const b = positionAt(cur.map, u, cur.time);
    const moved = Math.hypot(b.x - a.x, b.y - a.y);
    if (moved > dt * MAX_MM_PER_MS + 2) {
      bad.push(`${u.id}: teleported ${Math.round(moved)}mm in ${dt}ms`);
    }
  }
  for (const side of ['blue', 'red'] as const) {
    const sum = (g: GameState) =>
      g.units.filter((u) => u.side === side).reduce((n, u) => n + u.strength, 0);
    if (sum(cur) > sum(prev) + 1e-6) bad.push(`${side}: total strength rose`);
  }
  if (prev.outcome && JSON.stringify(prev.outcome) !== JSON.stringify(cur.outcome)) {
    bad.push('outcome changed after being set');
  }
  return bad;
}

/** Advance through `stops`, checking the rules after each. Returns the final run and all violations. */
export function runChecked(start: EngineState<GameState>, stops: number[]) {
  const reg = fullRegistry();
  const ids = new Set(start.world.units.map((u) => u.id));
  let state = start;
  const emitted: EmittedEvent[] = [];
  const found: string[] = [];
  for (const t of stops) {
    const prev = state;
    const r = advanceTo(state, t, reg);
    state = r.state;
    emitted.push(...r.emitted);
    for (const v of violations(prev.world, state.world, t - prev.time, ids)) {
      found.push(`t=${t}: ${v}`);
    }
    for (let i = 1; i < state.queue.length; i++) {
      const a = state.queue[i - 1]!;
      const b = state.queue[i]!;
      if (a.time > b.time || (a.time === b.time && a.seq >= b.seq)) {
        found.push(`t=${t}: queue out of order`);
      }
    }
    if (state.queue.some((e) => e.time < state.time)) found.push(`t=${t}: event left in the past`);
  }
  return { state, emitted, found };
}
