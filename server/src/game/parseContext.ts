import { featureAnchor, type GameState, type SideId } from '@kriegsspiel/engine';
import type { ParseContext } from '../orders/index.js';
import { hiddenTerms } from '../umpire/leakGuard.js';

/** What the parser may read for an order `side` signs in `world`: named places and the units. */
export function parseContextOf(world: GameState, side: string): ParseContext {
  const { map, units } = world;
  return {
    side,
    map: {
      features: map.features.map((f) => ({
        id: f.id,
        kind: f.kind,
        ...(f.name === undefined ? {} : { name: f.name }),
        anchor: featureAnchor(f.geometry),
      })),
    },
    units: units.map((u) => ({
      id: u.id,
      side: u.side,
      name: u.name,
      center: u.center,
      ...(u.personality && u.side === side ? { personality: u.personality } : {}),
    })),
    hidden: hiddenTerms(world, side as SideId),
  };
}
