/**
 * The only place master state becomes a wire `SideView`. It reads the engine's visibility
 * filter (`viewFor`) and nothing else from the world, so a client can never be sent hidden state.
 */
import {
  renderDocument,
  viewFor,
  type EngineSideView,
  type EngineState,
  type GameState,
  type SideId,
  type ViewDocument,
  type ViewReport,
} from '@kriegsspiel/engine';
import type { ClockState, Dispatch, SideView } from '@kriegsspiel/protocol';

const CATEGORY: Record<ViewReport['kind'], Dispatch['category']> = {
  contact: 'scouts',
  unitLost: 'subordinates',
  orderDelivered: 'subordinates',
  lowAmmo: 'staff',
  exhausted: 'subordinates',
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

export function toSideView(
  view: EngineSideView,
  clock: ClockState,
  narration?: Narration,
): SideView {
  return {
    side: view.side,
    atGame: view.time,
    ...(view.hq ? { hq: view.hq } : {}),
    ownUnits: view.ownUnits.map((u) => ({
      id: u.id,
      name: u.name,
      position: u.position,
      facing: u.facing,
      formation: u.formation,
      footprint: u.footprint,
      ...(u.shape ? { shape: u.shape } : {}),
      strength: u.strength,
      // The engine scores morale 0..100; the wire uses 0..1.
      morale: Math.min(1, Math.max(0, u.morale / 100)),
      // The wire's supply is the share of ammunition left (engine 0..100).
      supply: Math.min(1, Math.max(0, u.ammo / 100)),
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
    ],
    clock,
  };
}

/** What `side` may know at the engine's current time, as a wire view. */
export function sideViewOf(
  state: EngineState<GameState>,
  side: SideId,
  clock: ClockState,
  narration?: Narration,
): SideView {
  // `world.time` only moves when an event fires; the engine's own time is the real "now".
  return toSideView(viewFor(state.world, side, state.time), clock, narration);
}
