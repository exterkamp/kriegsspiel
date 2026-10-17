import type { SideView, TurnOrder } from '@kriegsspiel/protocol';
import type { TurnFight } from '../desk/turnReport.js';
import type { BaseMap, Engagement, GhostPiece, OwnPiece, SceneState } from './types.js';

/**
 * The longest reach of any arm (artillery), in metres: closer than this and the two are in a fight.
 * Copied by hand from `rangeM` of artillery in packages/engine/src/unitTypes.ts: keep the two in step.
 */
export const ENGAGE_RANGE_M = 400;

/** One marker per own unit that has a visible enemy within fire, midway between them. From the filtered view only. */
export function engagementsOf(view: SideView): Engagement[] {
  const out: Engagement[] = [];
  for (const u of view.ownUnits) {
    if (u.strength !== undefined && u.strength <= 0) continue; // the dead are not fighting
    let best: { x: number; y: number; d: number } | undefined;
    for (const e of view.visibleEnemies) {
      const d = Math.hypot(e.position.x - u.position.x, e.position.y - u.position.y);
      if (d <= ENGAGE_RANGE_M && (!best || d < best.d)) best = { ...e.position, d };
    }
    // One marker per fight: units fighting side by side share the one already placed there.
    const mid = best && { x: (u.position.x + best.x) / 2, y: (u.position.y + best.y) / 2 };
    if (mid && !out.some((e) => Math.hypot(e.position.x - mid.x, e.position.y - mid.y) < 150)) {
      out.push({ id: u.id, position: mid });
    }
  }
  return out;
}

export function formatAge(ageMs: number): string {
  const totalMin = Math.max(0, Math.floor(ageMs / 60_000));
  if (totalMin < 1) return 'just now';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m old`;
  return m === 0 ? `${h}h old` : `${h}h ${m}m old`;
}

/**
 * Pure function from a SideView to scene state. No clock, no randomness, no hidden state:
 * the same input always yields the same output, so applying it twice is a no-op.
 * Positions stay in the wire's metres. The view's live `visibleEnemies` are shown as ghosts
 * with age 0 and no uncertainty; `lastKnownContacts` carry their growing uncertainty radius.
 */
export function buildSceneState(view: SideView, map: BaseMap): SceneState {
  const own: OwnPiece[] = view.ownUnits.map((u) => ({
    kind: 'own',
    id: u.id,
    label: u.name,
    side: view.side,
    snapshotAtGame: view.atGame,
    strength: u.strength,
    position: u.position,
    facing: u.facing,
    formation: u.formation,
    footprint: u.footprint,
    ...(u.shape ? { shape: u.shape } : {}),
  }));
  const live: GhostPiece[] = view.visibleEnemies.map((e) => ({
    kind: 'ghost',
    id: e.id,
    position: e.position,
    facing: e.facing,
    snapshotAtGame: view.atGame,
    ageMs: 0,
    ageTag: formatAge(0),
    uncertaintyRadius: 0,
    formation: e.formation,
    footprint: e.footprint,
    ...(e.shape ? { shape: e.shape } : {}),
    ...(e.sizeEstimate !== undefined ? { sizeEstimate: e.sizeEstimate } : {}),
  }));
  const stale: GhostPiece[] = view.lastKnownContacts.map((c) => ({
    kind: 'ghost',
    id: c.id,
    position: c.position,
    facing: 0,
    snapshotAtGame: view.atGame,
    observedAtGame: c.observedAtGame,
    ageMs: c.ageMs,
    ageTag: formatAge(c.ageMs),
    uncertaintyRadius: c.uncertaintyRadius,
    ...(c.sizeEstimate !== undefined ? { sizeEstimate: c.sizeEstimate } : {}),
  }));
  const engagements = engagementsOf(view);
  // An enemy in sight and in a fight is already named by that fight's marker: its own "just now" tag only piles onto it (#323).
  for (const g of live) {
    if (
      engagements.some(
        (f) =>
          Math.hypot(f.position.x - g.position.x, f.position.y - g.position.y) <=
          ENGAGE_RANGE_M / 2,
      )
    ) {
      g.ageTag = '';
    }
  }
  return {
    side: view.side,
    map,
    own,
    ghosts: [...live, ...stale],
    orderRoutes: (view.orderRoutes ?? []).map((o) => ({
      id: o.id,
      kind: o.kind,
      points: o.points,
    })),
    couriers: (view.couriers ?? []).map((c) => ({
      id: c.id,
      position: c.position,
      to: c.to,
      etaMin: Math.max(0, Math.ceil((c.arriveAtGame - view.atGame) / 60_000)),
    })),
    engagements,
  };
}

/**
 * Turn mode on the table (#439): each order held or sent for the open turn as its courier's ride from HQ to the
 * unit (the order arrows and planned routes then come from the server once the turn has them), and a marker
 * where the last turn's papers reported fighting, unless a live fight is already marked there.
 */
export function withTurnOverlays(
  scene: SceneState,
  view: Pick<SideView, 'hq' | 'ownUnits'>,
  a: { held: readonly TurnOrder[]; fights: readonly TurnFight[] },
): SceneState {
  const hq = view.hq;
  const held = hq
    ? a.held.flatMap((o) => {
        const u = view.ownUnits.find((x) => x.id === o.to);
        return u
          ? [{ id: `held-${o.orderId}`, kind: 'held' as const, points: [hq, u.position] }]
          : [];
      })
    : [];
  const live = scene.engagements ?? [];
  const past = a.fights
    .filter(
      (f) =>
        !live.some(
          (e) => Math.hypot(e.position.x - f.position.x, e.position.y - f.position.y) < 150,
        ),
    )
    .map((f) => ({ id: f.id, position: f.position, past: { label: f.label } }));
  if (held.length === 0 && past.length === 0) return scene;
  return {
    ...scene,
    orderRoutes: [...(scene.orderRoutes ?? []), ...held],
    engagements: [...live, ...past],
  };
}
