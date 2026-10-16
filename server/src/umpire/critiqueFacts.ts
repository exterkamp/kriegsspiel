/**
 * The facts of a finished game, read from its input log (docs/gameplay.md, After the game).
 *
 * The critique stage writes only from this list, and its output is checked against it: a point
 * must cite fact ids that exist here, and its prose may use only the names, numbers and ids the
 * facts hold. `critiqueFacts` is pure and deterministic: it replays the log (no model call, no
 * wall clock), so the same log gives the same facts.
 *
 * Facts are master truth (true positions, both sides' reports), which is why the critique is
 * served only once the game is over, as the umpire's window is.
 */
import { MS_PER_MINUTE, positionAt } from '@kriegsspiel/engine';
import type { GameState, Report, SideId } from '@kriegsspiel/engine';
import type { ReplayInput } from '../admin/replayView.js';
import { replayLog } from '../game/replay.js';

export type FactKind =
  | 'outcome'
  | 'order'
  | 'delivery'
  | 'courier'
  | 'report'
  | 'misreading'
  | 'contact'
  | 'loss'
  | 'fire'
  | 'ruling'
  | 'pause';

export interface CritiqueFact {
  /** `fact-N`, in order of game time. */
  id: string;
  /** Game minute (whole) the fact is dated at. */
  minute: number;
  kind: FactKind;
  /** The side it concerns; absent for the whole game. */
  side?: string;
  text: string;
}

export interface CritiqueDigest {
  sides: string[];
  /** The result in words, also the first fact. */
  result: string;
  endMinute: number;
  facts: CritiqueFact[];
}

/** Longest order text quoted in a fact, in characters. */
const ORDER_TEXT_MAX = 120;
/** Most true-position replays a digest makes to test reports against the truth. */
const MISREAD_REPLAYS = 8;
const CAPS: Partial<Record<FactKind, number>> = {
  order: 24,
  delivery: 24,
  courier: 12,
  report: 36,
  misreading: 8,
  contact: 8,
  loss: 16,
  fire: 12,
  ruling: 16,
  pause: 16,
};
/** Casualties are summed over this many game minutes. */
const FIRE_BUCKET_MIN = 10;

const minuteOf = (ms: number) => Math.floor(ms / MS_PER_MINUTE);
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What a report is about, in words that follow "a report of". */
const REPORT_THING: Record<Report['kind'], string> = {
  situation: 'the situation',
  contact: 'an enemy contact',
  unitLost: 'a lost unit',
  courierLost: 'a lost courier',
  orderDelivered: 'an order delivered',
  lowAmmo: 'low ammunition',
  exhausted: 'exhaustion',
  destroyed: 'a destroyed enemy unit',
  engaged: 'an engagement',
  heavyLosses: 'heavy losses',
  broke: 'a unit breaking',
  battle: 'the battle',
  turn: "a unit's turn",
  notice: 'a turn resolved by the tables',
};

type Draft = Omit<CritiqueFact, 'id'> & { ms: number };

export function critiqueFacts(input: ReplayInput): CritiqueDigest {
  const run = (until?: number) =>
    replayLog(input.header, input.world, input.entries, input.registry, until, input.init);
  const { state, emitted } = run();
  const world: GameState = state.world;
  const outcome = world.outcome;
  if (!outcome) throw new Error('critique needs a finished game');

  const unitSide = new Map(world.units.map((u) => [u.id, u.side as string]));
  const label = (id: unknown): string => {
    const u = world.units.find((x) => x.id === id);
    return u ? `${u.name} (${u.id})` : String(id);
  };
  const sideOf = (id: unknown) => unitSide.get(String(id));

  const drafts: Draft[] = [];
  const add = (d: Draft) => drafts.push(d);

  // The result.
  const result =
    outcome.winner === null
      ? `The game ended at minute ${minuteOf(outcome.time)} with no winner (${outcome.reason}).`
      : `${cap(outcome.winner)} won at minute ${minuteOf(outcome.time)} (${outcome.reason}).`;
  add({ ms: outcome.time, minute: minuteOf(outcome.time), kind: 'outcome', text: result });

  // Orders the players sent, and what became of them on the road.
  for (const e of input.entries) {
    const c = e.command;
    if (e.error) continue;
    if (c.kind === 'order') {
      add({
        ms: e.gameMs,
        minute: minuteOf(e.gameMs),
        kind: 'order',
        side: c.side,
        text: `${cap(c.side)} sent the order "${clip(c.text.replace(/\s+/g, ' ').trim(), ORDER_TEXT_MAX)}".`,
      });
    } else if (c.kind === 'restart') {
      add({
        ms: e.gameMs,
        minute: minuteOf(e.gameMs),
        kind: 'pause',
        text: `The server restarted and the game stayed paused until the players confirmed.`,
      });
    }
    for (const step of e.pause ?? []) {
      const m = minuteOf(e.gameMs);
      const say = (text: string) => add({ ms: e.gameMs, minute: m, kind: 'pause', text });
      if (step.cause === 'proposed') {
        say(`A vote to ${step.to === 'resume_proposed' ? 'resume' : 'pause'} the game was called.`);
      } else if (step.to === 'paused' && step.from === 'resume_proposed') {
        say('A vote to resume the game failed.');
      } else if (step.to === 'running' && step.from === 'pause_proposed') {
        say('A vote to pause the game failed.');
      } else if (step.to === 'paused') {
        say(`The game was paused (${step.cause}).`);
      } else if (step.to === 'running' && step.from !== 'running') {
        say(`The game resumed (${step.cause}).`);
      }
    }
    for (const step of e.ratio ?? []) {
      if (step.outcome === 'passed') {
        add({
          ms: e.gameMs,
          minute: minuteOf(e.gameMs),
          kind: 'pause',
          text: `The players voted to change the clock ratio to ${step.rate}.`,
        });
      }
    }
  }

  const fire = new Map<string, { ms: number; side: string; men: number }>();
  for (const ev of emitted) {
    const p = ev.payload as Record<string, unknown>;
    const m = minuteOf(ev.time);
    switch (ev.type) {
      case 'order_delivered': {
        const lag = minuteOf(ev.time) - minuteOf(Number(p.issuedAt));
        add({
          ms: ev.time,
          minute: m,
          kind: 'delivery',
          side: sideOf(p.unitId),
          text: `The order to ${label(p.unitId)} was issued at minute ${minuteOf(Number(p.issuedAt))} and reached it at minute ${m}, ${lag} ${lag === 1 ? 'minute' : 'minutes'} later.`,
        });
        break;
      }
      case 'courier_intercepted':
        add({
          ms: ev.time,
          minute: m,
          kind: 'courier',
          side: sideOf(p.unitId),
          text: `The courier carrying the order to ${label(p.unitId)} was taken by ${label(p.by)}.`,
        });
        break;
      case 'order_garbled':
        add({
          ms: ev.time,
          minute: m,
          kind: 'courier',
          side: sideOf(p.unitId),
          text: `The order to ${label(p.unitId)} arrived garbled.`,
        });
        break;
      case 'order_failed':
        add({
          ms: ev.time,
          minute: m,
          kind: 'courier',
          side: sideOf(p.unitId),
          text: `The order to ${label(p.unitId)} could not be carried out: ${String(p.reason)}.`,
        });
        break;
      case 'contact.begin': {
        const pairs = (p.pairs as Array<[string, string]>).slice(0, 2);
        add({
          ms: ev.time,
          minute: m,
          kind: 'contact',
          text: `Fighting began: ${pairs.map(([a, b]) => `${label(a)} against ${label(b)}`).join('; ')}.`,
        });
        break;
      }
      case 'unit.broken':
      case 'unit.destroyed':
      case 'unit.rallied': {
        const verb =
          ev.type === 'unit.broken'
            ? 'broke'
            : ev.type === 'unit.destroyed'
              ? 'was destroyed'
              : 'rallied';
        add({
          ms: ev.time,
          minute: m,
          kind: 'loss',
          side: sideOf(p.unitId),
          text: `${label(p.unitId)} ${verb}.`,
        });
        break;
      }
      case 'combat.fire': {
        const men = Number(p.casualties) || 0;
        const side = sideOf(p.target);
        if (!side || men <= 0) break;
        const bucket = Math.floor(m / FIRE_BUCKET_MIN);
        const key = `${side}:${bucket}`;
        const cur = fire.get(key) ?? { ms: bucket * FIRE_BUCKET_MIN * MS_PER_MINUTE, side, men: 0 };
        cur.men += men;
        fire.set(key, cur);
        break;
      }
    }
  }
  for (const f of fire.values()) {
    const from = minuteOf(f.ms);
    add({
      ms: f.ms,
      minute: from,
      kind: 'fire',
      side: f.side,
      text: `${cap(f.side)} lost ${Math.round(f.men)} men to fire between minutes ${from} and ${from + FIRE_BUCKET_MIN}.`,
    });
  }

  // The umpire's rulings, as the window lists them.
  for (const r of world.rulings) {
    add({
      ms: r.time,
      minute: minuteOf(r.time),
      kind: 'ruling',
      text: `The umpire ruled: ${clip(r.narrative, 200)}`,
    });
  }

  // What each side was told and when, and how far a contact report was from the truth.
  const reports: Array<{ side: SideId; r: Report }> = [];
  for (const side of world.sides) {
    for (const r of world.intel[side.id as SideId].reports) {
      if (r.deliverAt <= state.time) reports.push({ side: side.id as SideId, r });
    }
  }
  reports.sort((a, b) => a.r.deliverAt - b.r.deliverAt);
  for (const { side, r } of reports) {
    const lag = minuteOf(r.deliverAt) - minuteOf(r.observedAt);
    const about = r.subject ? ` about ${label(r.subject)}` : '';
    const where = r.place ? ` ${r.place}` : '';
    add({
      ms: r.deliverAt,
      minute: minuteOf(r.deliverAt),
      kind: 'report',
      side,
      text: `${cap(side)} received a report of ${REPORT_THING[r.kind]} from ${label(r.from)}${about}${where}; it happened at minute ${minuteOf(r.observedAt)} and reached headquarters at minute ${minuteOf(r.deliverAt)} (${lag} ${lag === 1 ? 'minute' : 'minutes'} old).`,
    });
  }
  const contactReports = reports.filter(({ r }) => r.kind === 'contact' && r.subject);
  const times = [...new Set(contactReports.map(({ r }) => r.deliverAt))].slice(0, MISREAD_REPLAYS);
  const truth = new Map<number, GameState>();
  for (const t of times) truth.set(t, run(t).state.world);
  for (const { side, r } of contactReports) {
    const w = truth.get(r.deliverAt);
    const enemy = w?.units.find((u) => u.id === r.subject);
    if (!enemy) continue;
    const there = positionAt(w!.map, enemy, r.deliverAt);
    const off = Math.hypot(there.x - r.location.x, there.y - r.location.y);
    if (off <= r.uncertainty) continue;
    const metres = Math.round(off / 1000 / 10) * 10;
    if (metres <= 0) continue;
    add({
      ms: r.deliverAt,
      minute: minuteOf(r.deliverAt),
      kind: 'misreading',
      side,
      text: `${cap(side)}'s contact report on ${label(r.subject)} was out of date by the time it arrived at minute ${minuteOf(r.deliverAt)}: the unit stood about ${metres} metres from the reported spot.`,
    });
  }

  // Keep each kind within its cap (the earliest first), then date-order the lot.
  const kept = new Map<FactKind, number>();
  const facts = drafts
    .sort((a, b) => a.ms - b.ms)
    .filter((d) => {
      const n = (kept.get(d.kind) ?? 0) + 1;
      kept.set(d.kind, n);
      return n <= (CAPS[d.kind] ?? Infinity);
    })
    .map((d, i): CritiqueFact => ({
      id: `fact-${i + 1}`,
      minute: d.minute,
      kind: d.kind,
      ...(d.side === undefined ? {} : { side: d.side }),
      text: d.text,
    }));

  return {
    sides: world.sides.map((s) => s.id),
    result,
    endMinute: minuteOf(state.time),
    facts,
  };
}
