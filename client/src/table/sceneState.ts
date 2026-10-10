import type { SideView } from '@kriegsspiel/protocol';
import type { Facing, GhostPiece, MapGrid, OwnPiece, SceneState } from './types.js';

/**
 * Facing is not on the wire yet, so the client takes it as a side input
 * (units not listed face north).
 */
export type FacingById = Readonly<Record<string, Facing>>;

/**
 * Stopgap: the wire speaks metres on a continuous plane, but the table still draws a tile
 * display map, so metres are divided by this to get tile units. Goes away when the table
 * is redrawn from the vector map (follow-up to decision D15).
 */
export const METRES_PER_TILE = 100;

const tiles = (m: number) => m / METRES_PER_TILE;

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
 * Visible enemies are drawn as fresh contacts only through `lastKnownContacts`; the view's
 * live `visibleEnemies` are shown as ghosts with age 0.
 */
export function buildSceneState(
  view: SideView,
  map: MapGrid,
  facings: FacingById = {},
): SceneState {
  const own: OwnPiece[] = view.ownUnits.map((u) => ({
    kind: 'own',
    id: u.id,
    label: u.name,
    side: view.side,
    position: { x: tiles(u.position.x), y: tiles(u.position.y) },
    facing: facings[u.id] ?? 'N',
  }));
  const live: GhostPiece[] = view.visibleEnemies.map((e) => ({
    kind: 'ghost',
    id: e.id,
    position: { x: tiles(e.position.x), y: tiles(e.position.y) },
    ageMs: 0,
    ageTag: formatAge(0),
    ...(e.sizeEstimate !== undefined ? { sizeEstimate: e.sizeEstimate } : {}),
  }));
  const stale: GhostPiece[] = view.lastKnownContacts.map((c) => ({
    kind: 'ghost',
    id: c.id,
    position: { x: tiles(c.position.x), y: tiles(c.position.y) },
    ageMs: c.ageMs,
    ageTag: formatAge(c.ageMs),
    ...(c.sizeEstimate !== undefined ? { sizeEstimate: c.sizeEstimate } : {}),
  }));
  return { side: view.side, map, own, ghosts: [...live, ...stale] };
}
