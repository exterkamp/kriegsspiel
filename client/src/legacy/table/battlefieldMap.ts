import { decodeApprovedBattlefield, type Coord } from '@kriegsspiel/protocol';
import { paintOrder } from './paintOrder.js';
import type { BaseFeature, BaseMap } from './types.js';

/** Public transport to detached render geometry, in north-west-origin metres. */
export function battlefieldMap(value: unknown, parentScenarioId: string): BaseMap {
  const { map } = decodeApprovedBattlefield(value, parentScenarioId);
  const features: BaseFeature[] = map.preview.map((feature) => {
    const g = feature.geometry;
    return {
      id: feature.id,
      kind: feature.kind,
      layer: feature.layer,
      geometry:
        g.shape === 'point'
          ? { shape: 'point', at: { x: g.at.x, y: g.at.y }, radius: g.radiusM }
          : g.shape === 'polyline'
            ? {
                shape: 'polyline',
                points: g.points.map((p) => ({ x: p.x, y: p.y })),
                width: g.widthM,
              }
            : { shape: 'polygon', points: g.points.map((p) => ({ x: p.x, y: p.y })) },
    };
  });
  return { width: map.widthM, height: map.heightM, features: paintOrder(features) };
}

/** Exact native coordinates for SVG terrain; deliberately does not use legacy label rounding. */
export function battlefieldPoints(points: readonly Coord[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}
