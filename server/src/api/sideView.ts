/**
 * The only place master state becomes a wire `SideView`. It reads the engine's visibility
 * filter (`viewFor`) and nothing else from the world, so a client can never be sent hidden state.
 */
import {
  renderDocument,
  viewFor,
  viewForRole,
  type ChainOfCommand,
  type EngineRoleView,
  type EngineSideView,
  type EngineState,
  type GameState,
  type Seat,
  type SideId,
  type ViewDocument,
  type ViewReport,
} from '@kriegsspiel/engine';
import type {
  ClockState,
  DeputyAccount,
  DeputySettings,
  Dispatch,
  OwnUnit,
  SideView,
  StaffExchange,
} from '@kriegsspiel/protocol';
import { conferenceOfficers } from '../umpire/staff.js';

/** A side's deputy as the actor keeps it: its settings and what it has done. */
export interface DeputyState {
  settings: DeputySettings;
  account: readonly DeputyAccount[];
}

/** The conference officers of `side` as the page lists them, from the one source the answers are signed from (#342, #418). */
function officersOnWire(seed: number, side: SideId): NonNullable<SideView['staffOfficers']> {
  return Object.fromEntries(
    Object.entries(conferenceOfficers(seed, side)).map(([role, { name, traits }]) => [
      role,
      { name, traits },
    ]),
  ) as NonNullable<SideView['staffOfficers']>;
}

const CATEGORY: Record<ViewReport['kind'], Dispatch['category']> = {
  situation: 'staff',
  contact: 'scouts',
  unitLost: 'subordinates',
  courierLost: 'subordinates',
  orderDelivered: 'subordinates',
  lowAmmo: 'staff',
  exhausted: 'subordinates',
  destroyed: 'intelligence',
  engaged: 'subordinates',
  heavyLosses: 'subordinates',
  broke: 'subordinates',
  battle: 'staff',
};

export function toDispatch(r: ViewReport): Dispatch {
  return {
    id: r.id,
    from: r.from,
    writtenAtGame: r.observedAt,
    receivedAtGame: r.deliveredAt,
    category: CATEGORY[r.kind],
    kind: r.kind,
    location: r.location,
    ...(r.sizeEstimate === undefined ? {} : { sizeEstimate: r.sizeEstimate }),
    confidence: r.confidence,
    text: r.text,
  };
}

/** A captured enemy dispatch reaches the desk as an intelligence paper, in the enemy's own words. */
export function documentToDispatch(d: ViewDocument): Dispatch {
  return {
    id: d.id,
    from: 'Captured dispatch',
    writtenAtGame: d.issuedAt,
    receivedAtGame: d.deliveredAt,
    category: 'intelligence',
    location: d.location,
    text: renderDocument(d),
  };
}

/**
 * Narrated text by report id. An id mapped to a string shows that text in place of the template
 * text; one mapped to `null` was folded into another report's dispatch and is left out.
 */
export type Narration = ReadonlyMap<string, string | null>;

/** Who a staff exchange belongs to: a seat's role and, for a subordinate, the formations it commands. */
export function seatKey(seat: Seat): string {
  return seat.role === 'subordinate'
    ? `subordinate:${[...(seat.units ?? [])].sort().join(',')}`
    : seat.role;
}

/**
 * The conference exchanges a seat may see: only those it asked, since the answers are written from
 * the officer's view, not the reader's. Without a seat (shared-HQ play, the admin view) all of them.
 */
function staffFor(seat: Seat | undefined, staff: readonly StaffExchange[]): StaffExchange[] {
  return staff.filter((x) => seat === undefined || x.askedBy === seatKey(seat));
}

/** An officer's answer, once it is due, is a paper in the Staff pile. It is filed once, under the question's id. */
function staffDispatch(x: StaffExchange, now: number): Dispatch[] {
  if (x.text === undefined || now < x.answerAtGame) return [];
  return [
    {
      id: `staff-${x.questionId}`,
      from: x.officer.name,
      writtenAtGame: x.answerAtGame,
      receivedAtGame: x.answerAtGame,
      category: 'staff',
      text: x.text,
    },
  ];
}

/** The deputy's turn as one paper for the in-tray: what it signed in the player's name, what it was refused, and its report. */
export function deputyDispatch(a: DeputyAccount): Dispatch {
  const lines = [
    ...a.issued.map((o) => `Ordered ${o.unit}, in your name: "${o.text}"`),
    ...a.refused.map(
      (r) =>
        `Refused (beyond my ${a.discretion} discretion or your authority): "${r.text}" (${r.reasons.join('; ')})`,
    ),
    ...(a.report ? [a.report] : []),
  ];
  return {
    id: a.id,
    from: 'Your deputy',
    writtenAtGame: a.atGame,
    receivedAtGame: a.atGame,
    category: 'staff',
    text: lines.length > 0 ? lines.join(' ') : 'I found nothing to do.',
  };
}

/** The answer's words are withheld until the officer's time has passed. */
function staffExchangeAt(x: StaffExchange, now: number): StaffExchange {
  const early = { ...x };
  delete early.askedBy;
  if (now >= x.answerAtGame) return early;
  delete early.text;
  delete early.basedOnGame;
  return early;
}

/** A unit's condition on the wire; a role that may not know it (an outline) leaves the fields out. */
function condition(
  u: EngineRoleView['ownUnits'][number],
  reportedAt: number,
): Pick<OwnUnit, 'strength' | 'morale' | 'supply' | 'reportedAt'> {
  if (!('strength' in u)) return {};
  return {
    reportedAt,
    strength: u.strength,
    // The engine scores morale 0..100; the wire uses 0..1.
    morale: Math.min(1, Math.max(0, u.morale / 100)),
    // The wire's supply is the share of ammunition left (engine 0..100).
    supply: Math.min(1, Math.max(0, u.ammo / 100)),
  };
}

export function toSideView(
  view: EngineSideView | EngineRoleView,
  clock: ClockState,
  narration?: Narration,
  staff: readonly StaffExchange[] = [],
  seed?: number,
  overloaded?: string,
  deputy?: DeputyState,
): SideView {
  const reports = view.reports.flatMap((r) => {
    const text = narration?.get(r.id);
    if (text === null) return [];
    return [text === undefined ? toDispatch(r) : { ...toDispatch(r), text }];
  });
  return {
    side: view.side,
    ...(seed === undefined ? {} : { staffOfficers: officersOnWire(seed, view.side) }),
    ...('role' in view ? { role: view.role } : {}),
    atGame: view.time,
    ...(view.hq ? { hq: view.hq } : {}),
    ownUnits: view.ownUnits.map((u) => ({
      id: u.id,
      name: u.name,
      position: u.position,
      facing: u.facing,
      formation: u.formation,
      footprint: u.footprint,
      ...('shape' in u && u.shape ? { shape: u.shape } : {}),
      ...('commander' in u && u.commander !== undefined ? { commander: u.commander } : {}),
      ...('trait' in u && u.trait !== undefined ? { trait: u.trait } : {}),
      ...condition(u, view.time),
    })),
    ...(view.orderRoutes.length === 0
      ? {}
      : {
          orderRoutes: view.orderRoutes.map((o) => ({
            id: o.id,
            unitId: o.unitId,
            kind: o.kind,
            points: o.points,
          })),
        }),
    ...(view.couriers.length === 0
      ? {}
      : {
          couriers: view.couriers.map((c) => ({
            id: c.id,
            unitId: c.unitId,
            position: c.position,
            to: c.to,
            arriveAtGame: c.arriveAt,
          })),
        }),
    visibleEnemies: view.visibleEnemies.map((e) => ({
      id: e.id,
      position: e.position,
      facing: e.facing,
      formation: e.formation,
      footprint: e.footprint,
      ...(e.shape ? { shape: e.shape } : {}),
      sizeEstimate: e.sizeEstimate,
    })),
    lastKnownContacts: view.lastKnownContacts.map((c) => ({
      id: c.id,
      position: c.position,
      observedAtGame: c.seenAt,
      ageMs: c.ageMs,
      uncertaintyRadius: c.uncertaintyRadius,
      sizeEstimate: c.sizeEstimate,
    })),
    dispatches: [
      ...reports.filter((d) => d.kind !== 'battle'),
      ...view.documents.map(documentToDispatch),
      // The umpire's papers on the battle close the in-tray: a captured dispatch handed in at the
      // same turn's end comes before the ruling (#438).
      ...reports.filter((d) => d.kind === 'battle'),
      ...staff.flatMap((x) => staffDispatch(x, view.time)),
      ...(deputy?.account ?? []).map(deputyDispatch),
    ],
    ...(staff.length === 0
      ? {}
      : { staffHistory: staff.map((x) => staffExchangeAt(x, view.time)) }),
    ...(overloaded ? { staffOverloaded: overloaded } : {}),
    ...(deputy ? { deputy: { settings: deputy.settings, account: [...deputy.account] } } : {}),
    clock,
  };
}

/**
 * What `side` may know at the engine's current time, as a wire view. With a `seat` it is the view
 * cut down for that role (`viewForRole`), including the papers HQ `forwarded` to it; without one,
 * the whole side view of shared-HQ play.
 */
export function sideViewOf(
  state: EngineState<GameState>,
  side: SideId,
  clock: ClockState,
  seat?: Seat,
  forwarded: readonly string[] = [],
  narration?: Narration,
  staff: readonly StaffExchange[] = [],
  overloaded?: string,
  deputy?: DeputyState,
  chain?: ChainOfCommand,
): SideView {
  // The deputy writes to the player who runs HQ: the commander, the chief of staff, or the whole side in shared-HQ play.
  const hqDeputy =
    deputy && (!seat || seat.role === 'commander' || seat.role === 'chiefOfStaff')
      ? deputy
      : undefined;
  // `world.time` only moves when an event fires; the engine's own time is the real "now".
  if (seat) {
    return toSideView(
      viewForRole(state.world, side, seat, state.time, forwarded, chain),
      clock,
      narration,
      staffFor(seat, staff),
      state.world.seed,
      overloaded,
      hqDeputy,
    );
  }
  return toSideView(
    viewFor(state.world, side, state.time),
    clock,
    narration,
    staff,
    state.world.seed,
    overloaded,
    hqDeputy,
  );
}
