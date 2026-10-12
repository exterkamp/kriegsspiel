import type { SideView } from '@kriegsspiel/protocol';
import type { BaseMap, Engagement, GhostPiece, OwnPiece, SceneState } from './types.js';

/** The longest reach of any arm (artillery), in metres: closer than this and the two are in a fight. */
export const ENGAGE_RANGE_M = 400;

/** One marker per own unit that has a visible enemy within fire, midway between them. From the filtered view only. */
export function engagementsOf(view: SideView): Engagement[] {
  const out: Engagement[] = [];
  for (const u of view.ownUnits) {
    let best: { x: number; y: number; d: number } | undefined;
    for (const e of view.visibleEnemies) {
      const d = Math.hypot(e.position.x - u.position.x, e.position.y - u.position.y);
      if (d <= ENGAGE_RANGE_M && (!best || d < best.d)) best = { ...e.position, d };
    }
    if (best) {
      out.push({
        id: u.id,
        position: { x: (u.position.x + best.x) / 2, y: (u.position.y + best.y) / 2 },
      });
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
  return {
    side: view.side,
    map,
    own,
    ghosts: [...live, ...stale],
    orderRoutes: [],
    engagements: engagementsOf(view),
  };
}
