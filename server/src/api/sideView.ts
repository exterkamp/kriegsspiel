/**
 * The only place master state becomes a wire `SideView`. It reads the engine's visibility
 * filter (`viewFor`) and nothing else from the world, so a client can never be sent hidden state.
 */
import {
  renderDocument,
  viewFor,
  viewForRole,
  type EngineRoleView,
  type EngineSideView,
  type EngineState,
  type GameState,
  type Seat,
  type SideId,
  type ViewDocument,
  type ViewReport,
} from '@kriegsspiel/engine';
import type { ClockState, Dispatch, OwnUnit, SideView, StaffExchange } from '@kriegsspiel/protocol';

const CATEGORY: Record<ViewReport['kind'], Dispatch['category']> = {
  situation: 'staff',
  contact: 'scouts',
  unitLost: 'subordinates',
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

/** The answer's words are withheld until the officer's time has passed. */
function staffExchangeAt(x: StaffExchange, now: number): StaffExchange {
  if (now >= x.answerAtGame) return x;
  const early = { ...x };
  delete early.text;
  delete early.basedOnGame;
  return early;
}

/** A unit's condition on the wire; a role that may not know it (an outline) leaves the fields out. */
function condition(
  u: EngineRoleView['ownUnits'][number],
): Pick<OwnUnit, 'strength' | 'morale' | 'supply'> {
  if (!('strength' in u)) return {};
  return {
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
): SideView {
  return {
    side: view.side,
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
      ...condition(u),
    })),
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
      ...view.reports.flatMap((r) => {
        const text = narration?.get(r.id);
        if (text === null) return [];
        return [text === undefined ? toDispatch(r) : { ...toDispatch(r), text }];
      }),
      ...view.documents.map(documentToDispatch),
      ...staff.flatMap((x) => staffDispatch(x, view.time)),
    ],
    ...(staff.length === 0
      ? {}
      : { staffHistory: staff.map((x) => staffExchangeAt(x, view.time)) }),
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
): SideView {
  // `world.time` only moves when an event fires; the engine's own time is the real "now".
  if (seat) {
    return toSideView(
      viewForRole(state.world, side, seat, state.time, forwarded),
      clock,
      narration,
      staff,
    );
  }
  return toSideView(viewFor(state.world, side, state.time), clock, narration, staff);
}
