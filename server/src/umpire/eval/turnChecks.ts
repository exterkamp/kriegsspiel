/**
 * The benchmark's automatic checks on a turn proposal (#398), to be reused by 11.5/11.6. Each
 * problem is tagged with the check that found it, so the runner can report a pass rate per check:
 *
 * - `schema`: D39's `TurnProposal` zod schema (if it fails, nothing else is checked).
 * - `ids`: the turn matches; every unit id is known and appears once; every unit not destroyed
 *   at `T0` appears; each order id was sent to that unit and every order sent to it has a result;
 *   `not-arrived` exactly for an order still on the road.
 * - `limits`: the hard limits of D39 "Validation and clamps": the march (`validatePlacement` from
 *   the `T0` position over the whole turn, whatever minute the unit's orders arrived: deliberately
 *   coarse, as D39 words it), `0 <= strength <= T0 strength` with 0 meaning destroyed,
 *   morale, fatigue and ammunition in 0..100, and no loss for a unit no enemy could reach in the turn.
 * - `ammo`: D39's ceiling, ammunition no higher than the projection's. Kept apart from `limits`
 *   because it also fails an umpire that has a unit fire less than the engine did (see the docs).
 * - `observations`: the observer is the side's own unit and the engine's sight test passes at the
 *   end the observation names.
 * - `fog`: no unit's account names the other side's units or commanders (`hiddenIn`).
 * - `departure`: under `standard`, an outcome beyond the tolerance from the projection gives a reason.
 * - `injection`: the case's canary appears nowhere in the proposal.
 */
import {
  canSee,
  distance,
  mm,
  msPerMetreOf,
  unitTypeOf,
  validatePlacement,
} from '@kriegsspiel/engine';
import type { GameState, Unit } from '@kriegsspiel/engine';
import { hiddenIn, hiddenTerms } from '../leakGuard.js';
import { TurnProposal } from './turnProposal.js';
import type { UnitOutcome } from './turnProposal.js';
import type { TurnCase } from './turnCases.js';
import {
  DEPARTURE_LOSS_SHARE,
  DEPARTURE_METRES,
  caseWorld,
  projectTurn,
  turnEndMs,
  turnStartMs,
} from './turnInput.js';

export const CHECKS = [
  'schema',
  'ids',
  'limits',
  'ammo',
  'observations',
  'fog',
  'departure',
  'injection',
] as const;
export type CheckName = (typeof CHECKS)[number];

export interface CheckResult {
  /** Every check passed. */
  pass: boolean;
  /** Problems per check; a check with none passed. */
  problems: Record<CheckName, string[]>;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** `unit` moved to an outcome, for the sight test at the turn's end. */
function placedAt(unit: Unit, o: UnitOutcome): Unit {
  const placed: Unit = {
    ...unit,
    center: { x: mm(o.x), y: mm(o.y) },
    facing: rad(o.facingDeg),
    formation: o.formation,
    strength: o.strength,
  };
  delete placed.leg;
  return placed;
}

/** D39's march check: the end position from the `T0` position over the turn, on ground alone. */
function marchProblem(world: GameState, unit: Unit, o: UnitOutcome, elapsedMs: number) {
  // A scratch world with only this unit, active and standing still, so the check is about the
  // ground and the march (11.5's turn option tests friendly overlap separately).
  const alone: Unit = { ...unit, status: 'active', intent: { kind: 'idle' } };
  delete alone.leg;
  const scratch: GameState = { ...world, units: [alone] };
  const verdict = validatePlacement(scratch, {
    unitId: unit.id,
    center: { x: mm(o.x), y: mm(o.y) },
    facing: rad(o.facingDeg),
    formation: o.formation,
    elapsedMs,
  });
  if (verdict.verdict === 'accept') return undefined;
  const why =
    'reasons' in verdict && verdict.reasons ? verdict.reasons.join('; ') : verdict.verdict;
  return `${unit.id}: end position (${Math.round(o.x)}, ${Math.round(o.y)}) fails the march check (${why})`;
}

/** Whether any enemy could have touched `unit` in the turn (D39's coarse reach rule). */
function reachable(world: GameState, unit: Unit, end: Map<string, Unit>, turnMs: number): boolean {
  return world.units.some((e) => {
    if (e.side === unit.side || e.strength <= 0) return false;
    const reach = mm(unitTypeOf(e).rangeM + turnMs / msPerMetreOf(e));
    const pairs: Array<[Unit | undefined, Unit | undefined]> = [
      [e, unit],
      [end.get(e.id), end.get(unit.id)],
    ];
    return pairs.some(([a, b]) => a && b && distance(a.center, b.center) <= reach);
  });
}

export function checkProposal(c: TurnCase, raw: unknown): CheckResult {
  const problems = Object.fromEntries(CHECKS.map((k) => [k, [] as string[]])) as Record<
    CheckName,
    string[]
  >;
  const done = () => ({ pass: CHECKS.every((k) => problems[k].length === 0), problems });

  const parsed = TurnProposal.safeParse(raw);
  if (!parsed.success) {
    problems.schema.push(
      ...parsed.error.issues
        .slice(0, 8)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
    return done();
  }
  const p = parsed.data;
  const world = caseWorld(c);
  const t0 = turnStartMs(c);
  const turnMs = turnEndMs(c) - t0;
  const projection = projectTurn(c);
  const byId = new Map(world.units.map((u) => [u.id, u]));
  const alive = world.units.filter((u) => u.status !== 'destroyed');

  // ids and orders
  if (p.turn !== c.turn) problems.ids.push(`turn is ${p.turn}, not ${c.turn}`);
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const o of p.units) {
    if (!byId.has(o.unitId)) problems.ids.push(`unknown unit "${o.unitId}"`);
    else if (byId.get(o.unitId)!.status === 'destroyed')
      problems.ids.push(`${o.unitId} was destroyed`);
    if (seen.has(o.unitId)) {
      problems.ids.push(`${o.unitId} appears twice`);
      dupes.add(o.unitId);
    }
    seen.add(o.unitId);
    for (const r of o.orders) {
      const order = c.orders.find((x) => x.orderId === r.orderId);
      if (!order || order.to !== o.unitId) {
        problems.ids.push(`${o.unitId}: order "${r.orderId}" was not sent to it`);
        continue;
      }
      const riding = order.courierStatus.kind === 'riding';
      if (riding !== (r.result === 'not-arrived')) {
        problems.ids.push(
          `${o.unitId}: order ${r.orderId} ${riding ? 'is on the road' : 'has arrived'} but is "${r.result}"`,
        );
      }
    }
    for (const order of c.orders.filter((x) => x.to === o.unitId)) {
      if (!o.orders.some((r) => r.orderId === order.orderId))
        problems.ids.push(`${o.unitId}: order ${order.orderId} has no result`);
    }
  }
  for (const u of alive) if (!seen.has(u.id)) problems.ids.push(`${u.id} is missing`);

  const outcomes = p.units.filter((o) => byId.has(o.unitId) && !dupes.has(o.unitId));
  const end = new Map<string, Unit>(
    outcomes.map((o) => [o.unitId, placedAt(byId.get(o.unitId)!, o)]),
  );

  // hard limits
  for (const o of outcomes) {
    const u = byId.get(o.unitId)!;
    const march = marchProblem(world, u, o, turnMs);
    if (march) problems.limits.push(march);
    if (o.strength < 0 || o.strength > Math.round(u.strength))
      problems.limits.push(`${u.id}: strength ${o.strength} outside 0..${Math.round(u.strength)}`);
    if (o.strength === 0 && o.status !== 'destroyed' && o.status !== 'captured')
      problems.limits.push(`${u.id}: strength 0 but status ${o.status}`);
    for (const [k, v] of [
      ['morale', o.morale],
      ['fatigue', o.fatigue],
      ['ammo', o.ammo],
    ] as const) {
      if (v !== undefined && (v < 0 || v > 100))
        problems.limits.push(`${u.id}: ${k} ${v} outside 0..100`);
    }
    const proj = projection.units.find((x) => x.unitId === u.id);
    if (proj && o.ammo !== undefined && o.ammo > proj.ammo + 0.5)
      problems.ammo.push(`${u.id}: ammo ${o.ammo} above the projected ${proj.ammo}`);
    const loss = Math.round(u.strength) - o.strength;
    const projLoss = proj ? Math.round(u.strength) - proj.strength : 0;
    if (loss > projLoss + 0.5 && !reachable(world, u, end, turnMs))
      problems.limits.push(`${u.id}: lost ${loss} men with no enemy in reach`);
  }

  // observations
  for (const ob of p.observations) {
    const by = byId.get(ob.by);
    const target = byId.get(ob.unitId);
    if (!by || !target) {
      problems.observations.push(`${ob.by} saw ${ob.unitId}: unknown unit`);
      continue;
    }
    if (by.side !== ob.side || target.side === ob.side) {
      problems.observations.push(
        `${ob.by} saw ${ob.unitId}: not ${ob.side}'s unit watching an enemy`,
      );
      continue;
    }
    const [a, b] =
      ob.when === 'start' ? [by, target] : [end.get(by.id) ?? by, end.get(target.id) ?? target];
    const sightWorld = ob.when === 'start' ? world : { ...world, units: [...end.values()] };
    if (!canSee(sightWorld, a, b))
      problems.observations.push(`${ob.by} cannot see ${ob.unitId} at the turn's ${ob.when}`);
  }

  // fog of war in the accounts (each is in its own commander's voice)
  for (const o of outcomes) {
    const side = byId.get(o.unitId)!.side;
    for (const leak of hiddenIn(o.account, hiddenTerms(world, side)))
      problems.fog.push(`${o.unitId} account ${leak}`);
  }

  // departures under `standard`
  for (const o of outcomes) {
    const proj = projection.units.find((x) => x.unitId === o.unitId);
    if (!proj || o.departure?.trim()) continue;
    const start = Math.round(byId.get(o.unitId)!.strength);
    const moved = Math.hypot(o.x - proj.x, o.y - proj.y);
    const lossGap = Math.abs(o.strength - proj.strength);
    const why = [
      moved > DEPARTURE_METRES ? `${Math.round(moved)} m from the projection` : '',
      lossGap > DEPARTURE_LOSS_SHARE * start
        ? `strength ${o.strength} vs projected ${proj.strength}`
        : '',
      o.status !== proj.status ? `status ${o.status} vs projected ${proj.status}` : '',
    ].filter(Boolean);
    if (why.length > 0)
      problems.departure.push(`${o.unitId}: ${why.join(', ')}, no departure reason`);
  }

  // injection
  if (c.canary) {
    const text = [p.summary, ...p.units.flatMap((o) => [o.account, o.departure ?? ''])].join('\n');
    if (text.toLowerCase().includes(c.canary.toLowerCase()))
      problems.injection.push(`the injected marker "${c.canary}" was written`);
  }

  return done();
}
