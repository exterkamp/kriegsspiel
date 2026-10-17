import type { BaseMap } from './types.js';
import { drawPeriodMap, tableHighContrast } from './periodMap.js';

export { paintOrder } from './paintOrder.js';

/** Largest canvas side. Keeps the texture within what mobile GPUs accept. */
export const MAX_TEXTURE_PX = 2048;

/** Pixels per metre: the larger side of the map fills MAX_TEXTURE_PX. */
export function pxPerMetre(map: BaseMap): number {
  return MAX_TEXTURE_PX / Math.max(map.width, map.height, 1);
}

/**
 * The table's map paper: the whole map drawn once in the period staff-map style (`drawPeriodMap`, D43,
 * #498), in the style's high-contrast palette when the app is in high contrast. The canvas is CPU-backed
 * and one pixel is read back, so the drawing is finished here rather than in the table's first frame.
 */
export function mapCanvas(map: BaseMap, highContrast = tableHighContrast()): HTMLCanvasElement {
  const s = pxPerMetre(map);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(map.width * s));
  c.height = Math.max(1, Math.round(map.height * s));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (ctx) {
    drawPeriodMap(ctx, map, s, highContrast);
    ctx.getImageData(0, 0, 1, 1);
  }
  return c;
}
