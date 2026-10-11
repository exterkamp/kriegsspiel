import { terrainAt } from './terrain.js';
import type { FeatureKind, RoadClass, TerrainMap } from './types.js';

/**
 * A derived view of the vector terrain, sampled on a regular grid. The vector map stays the
 * truth (docs/decisions.md D15): no engine rule reads this grid. It exists to check an
 * annotation by eye and in tests, and to feed previews.
 */
export interface TerrainRaster {
  /** Cell size in mm. */
  cell: number;
  cols: number;
  rows: number;
  /** One string per row, north first, one glyph per cell (see `GLYPHS`). */
  rows_: string[];
}

/** Glyph per ground type; the top-layer feature at the cell centre decides. */
const GLYPHS: Record<FeatureKind, string> = {
  field: ':',
  wood: 'w',
  marsh: 'm',
  water: '~',
  road: '+',
  river: '~',
  stream: 's',
  bridge: '=',
  ford: 'f',
  building: 'b',
};
const ROAD_GLYPHS: Record<RoadClass, string> = { highway: 'H', road: '+', track: ',' };

/** Sample the map at the centre of each `cell`-mm square. Open ground is '.'. */
export function rasterise(map: TerrainMap, cell: number): TerrainRaster {
  if (!(cell > 0)) throw new Error('rasterise needs a positive cell size');
  const cols = Math.ceil(map.width / cell);
  const rows = Math.ceil(map.height / cell);
  const byId = new Map(map.features.map((f) => [f.id, f]));
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const at = {
        x: Math.min(map.width, Math.round((c + 0.5) * cell)),
        y: Math.min(map.height, Math.round((r + 0.5) * cell)),
      };
      const top = byId.get(terrainAt(map, at)?.featureIds[0] ?? '');
      line += !top ? '.' : top.roadClass ? ROAD_GLYPHS[top.roadClass] : GLYPHS[top.kind];
    }
    out.push(line);
  }
  return { cell, cols, rows, rows_: out };
}

/**
 * A tiny annotation (metres): a stream with a ford and a river with a narrow bridge, a
 * highway and a track, a wood, a village and a ridge. Used by the docs and tests.
 */
export const SAMPLE_TERRAIN = {
  width: 200,
  height: 100,
  features: [
    {
      id: 'ridge',
      kind: 'field',
      name: 'North ridge',
      height: 'high',
      moveCost: 2,
      polygon: [
        [0, 0],
        [60, 0],
        [60, 20],
        [0, 20],
      ],
    },
    {
      id: 'wood',
      kind: 'wood',
      height: 'rise',
      polygon: [
        [120, 40],
        [180, 40],
        [180, 90],
        [120, 90],
      ],
    },
    {
      id: 'village',
      kind: 'building',
      name: 'Hohenau',
      polygon: [
        [20, 60],
        [40, 60],
        [40, 80],
        [20, 80],
      ],
    },
    {
      id: 'river',
      kind: 'river',
      polyline: [
        [100, 0],
        [100, 100],
      ],
      width: 10,
    },
    { id: 'bridge', kind: 'bridge', at: { x: 100, y: 50 }, radius: 10, capacity: 6 },
    { id: 'ford', kind: 'ford', at: { x: 100, y: 10 }, radius: 10, risk: 0.3 },
    {
      id: 'highway',
      kind: 'road',
      roadClass: 'highway',
      polyline: [
        [0, 50],
        [200, 50],
      ],
      width: 10,
    },
    {
      id: 'track',
      kind: 'road',
      roadClass: 'track',
      polyline: [
        [0, 90],
        [90, 90],
      ],
      width: 10,
    },
  ],
};
