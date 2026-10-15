import type { BaseMap, FeatureKind } from './types.js';
import { paintOrder } from './paintOrder.js';

export { paintOrder } from './paintOrder.js';

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

/** Largest canvas side. Keeps the texture within what mobile GPUs accept. */
export const MAX_TEXTURE_PX = 2048;

/** Pixels per metre: the larger side of the map fills MAX_TEXTURE_PX. */
export function pxPerMetre(map: BaseMap): number {
  return MAX_TEXTURE_PX / Math.max(map.width, map.height, 1);
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
      ctx.lineCap = f.layer === undefined ? 'butt' : 'round';
      ctx.lineWidth = f.layer === undefined ? Math.max(g.width * s, 2) : g.width * s;
      ctx.stroke();
    } else {
      ctx.arc(
        g.at.x * s,
        g.at.y * s,
        f.layer === undefined ? Math.max(g.radius * s, 2) : g.radius * s,
        0,
        Math.PI * 2,
      );
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
