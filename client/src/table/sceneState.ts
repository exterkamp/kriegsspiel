import type { SideView } from '@kriegsspiel/protocol';
import type { BaseMap, GhostPiece, OwnPiece, SceneState } from './types.js';

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
    ageMs: c.ageMs,
    ageTag: formatAge(c.ageMs),
    uncertaintyRadius: c.uncertaintyRadius,
    ...(c.sizeEstimate !== undefined ? { sizeEstimate: c.sizeEstimate } : {}),
  }));
  return { side: view.side, map, own, ghosts: [...live, ...stale], orderRoutes: [] };
}
