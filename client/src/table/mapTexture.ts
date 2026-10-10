import type { BaseFeature, BaseMap, FeatureKind } from './types.js';

export const FEATURE_COLOURS: Record<FeatureKind | 'ground', string> = {
  ground: '#d8cfa6',
  field: '#cfc58f',
  wood: '#5f7a4a',
  marsh: '#8a9a6a',
  water: '#6f9bb5',
  river: '#6f9bb5',
  stream: '#7fa8c0',
  road: '#b99f73',
  bridge: '#8a6a43',
  ford: '#a9bfa0',
  building: '#7a5a48',
};

/** Painting order: areas, then water lines, then roads, then crossings and buildings. */
const LAYER: Record<FeatureKind, number> = {
  field: 0,
  marsh: 1,
  wood: 1,
  water: 2,
  stream: 3,
  river: 3,
  road: 4,
  ford: 5,
  bridge: 6,
  building: 7,
};

/** Largest canvas side. Keeps the texture within what mobile GPUs accept. */
const MAX_TEXTURE_PX = 2048;

/** Pixels per metre: the larger side of the map fills MAX_TEXTURE_PX. */
export function pxPerMetre(map: BaseMap): number {
  return MAX_TEXTURE_PX / Math.max(map.width, map.height, 1);
}

/** Features in painting order (stable within a layer). */
export function paintOrder(features: readonly BaseFeature[]): BaseFeature[] {
  return features
    .map((f, i) => ({ f, i }))
    .sort((a, b) => LAYER[a.f.kind] - LAYER[b.f.kind] || a.i - b.i)
    .map(({ f }) => f);
}

/** Paint the base map in metres, scaled by `s` px per metre. Pure drawing: reads only the map. */
export function drawMap(ctx: CanvasRenderingContext2D, map: BaseMap, s = pxPerMetre(map)): void {
  ctx.fillStyle = FEATURE_COLOURS.ground;
  ctx.fillRect(0, 0, map.width * s, map.height * s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  for (const f of paintOrder(map.features)) {
    const g = f.geometry;
    ctx.fillStyle = FEATURE_COLOURS[f.kind];
    ctx.strokeStyle = FEATURE_COLOURS[f.kind];
    ctx.beginPath();
    if (g.shape === 'polygon') {
      g.points.forEach((p, i) =>
        i === 0 ? ctx.moveTo(p.x * s, p.y * s) : ctx.lineTo(p.x * s, p.y * s),
      );
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(60,45,20,0.45)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (g.shape === 'polyline') {
      g.points.forEach((p, i) =>
        i === 0 ? ctx.moveTo(p.x * s, p.y * s) : ctx.lineTo(p.x * s, p.y * s),
      );
      ctx.lineWidth = Math.max(g.width * s, 2);
      ctx.stroke();
    } else {
      ctx.arc(g.at.x * s, g.at.y * s, Math.max(g.radius * s, 2), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(60,45,20,0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

export function mapCanvas(map: BaseMap): HTMLCanvasElement {
  const s = pxPerMetre(map);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(map.width * s));
  c.height = Math.max(1, Math.round(map.height * s));
  const ctx = c.getContext('2d');
  if (ctx) drawMap(ctx, map, s);
  return c;
}
