import { MapRenderer, DEFAULT_LAYERS } from '../../legacy/map-authoring/renderer.js';
import { PERIOD_MAP_STYLE, type MapStyle } from '../../legacy/map-authoring/map-style.js';
import type { PreviewAsset } from '../../legacy/map-authoring/asset.js';
import type { PreviewRaster } from '../../legacy/table/FixtureTableScene.js';

/**
 * The table's paper is the authoring preview's period staff map (D43, #498). The raster is exactly the
 * map sheet, so the neat line, which the preview draws round the sheet, is left off: it would be cut in
 * half at the edge of the paper, and the table's board frames the sheet instead.
 */
export const TABLE_MAP_STYLE: MapStyle = Object.freeze({ ...PERIOD_MAP_STYLE, neatLine: null });

/**
 * Whether the paper is drawn in the style's high-contrast palette: the app's own contrast choice
 * (`data-contrast` on <html>, #308), or else the OS `prefers-contrast: more`, as the CSS tokens read it.
 */
export function tableHighContrast(doc: Document = document): boolean {
  const choice = doc.documentElement.dataset['contrast'];
  if (choice === 'high' || choice === 'normal') return choice === 'high';
  try {
    return doc.defaultView?.matchMedia?.('(prefers-contrast: more)').matches ?? false;
  } catch {
    return false;
  }
}

/** Full bounds, one uniform scale, zero offset. Padding stays outside the registered UV rectangle. */
export function rasterLayout(widthM: number, heightM: number, limit: number) {
  if (
    ![widthM, heightM].every((v) => Number.isFinite(v) && v > 0) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 4096
  )
    throw new RangeError('Invalid map extent or local raster limit');
  const scale = limit / Math.max(widthM, heightM);
  // Pin the longest side exactly to the cap; multiplication roundoff must not
  // produce content a fraction beyond the integer allocation.
  const contentWidthPx = widthM >= heightM ? limit : (widthM / heightM) * limit;
  const contentHeightPx = heightM >= widthM ? limit : (heightM / widthM) * limit;
  if (![scale, contentWidthPx, contentHeightPx].every((v) => Number.isFinite(v) && v > 0))
    throw new RangeError('Map extent cannot be registered at this raster limit');
  const width = Math.ceil(contentWidthPx);
  const height = Math.ceil(contentHeightPx);
  return { width, height, scale, contentWidthPx, contentHeightPx };
}

/**
 * Rasterise the whole map once, for one map at one texture cap: the table zooms this texture and never
 * redraws it. The palette follows the app's contrast when the raster is made (`tableHighContrast`)
 * unless `options.highContrast` says otherwise.
 */
export function prepareRaster(
  asset: PreviewAsset,
  sourceKey: string,
  limit: number,
  options: { readonly highContrast?: boolean } = {},
): PreviewRaster {
  const widthM = asset.bounds.maxX - asset.bounds.minX;
  const heightM = asset.bounds.maxY - asset.bounds.minY;
  const layout = rasterLayout(widthM, heightM, limit);
  // Validate the device/local cap before allocating either the raster or renderer caches.
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  // CPU-backed canvases throughout (the paper and the renderer's helpers): the paper is drawn once and
  // uploaded once, and some hundred thousand hachure strokes stalled GPU-backed canvas raster for many
  // seconds in Chromium (#498).
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas2D is unavailable; try a browser with canvas support');
  const renderer = new MapRenderer(asset, TABLE_MAP_STYLE, { software: true });
  // One complete pass; the tiled, frame-budgeted path is for the interactive authoring preview.
  renderer.renderOnce(
    ctx,
    {
      width: layout.contentWidthPx,
      height: layout.contentHeightPx,
      scale: layout.scale,
      offset: [0, 0],
    },
    { ...DEFAULT_LAYERS, scale: false },
    options.highContrast ?? tableHighContrast(),
  );
  // The browser defers drawing until the pixels are needed. Read one pixel so the paper is finished
  // here, inside the measured raster time, not in the table's first frame.
  ctx.getImageData(0, 0, 1, 1);
  return Object.freeze({
    canvas,
    sourceKey,
    widthM,
    heightM,
    contentWidthPx: layout.contentWidthPx,
    contentHeightPx: layout.contentHeightPx,
  });
}
