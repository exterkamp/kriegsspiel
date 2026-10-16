// Browser entry bundled by render.mjs: draws saved assets side by side with the
// authoring preview's own MapRenderer (all default layers) and publishes a JPEG.
import { MapRenderer, DEFAULT_LAYERS } from '../../client/src/legacy/map-authoring/renderer.js';
import { fitViewport } from '../../client/src/legacy/map-authoring/viewport.js';
import { loadPreviewAsset } from '../../client/src/legacy/map-authoring/asset.js';

declare const ASSETS: unknown[];
declare const CAPTIONS: string[];
declare const SIZE: number;
/** Optional close-up per asset: [x, y, sizeM] in local metres, or null for the whole map. */
declare const FOCUS: ([number, number, number] | null)[];
const canvas = document.createElement('canvas');
canvas.width = SIZE * ASSETS.length;
canvas.height = SIZE;
const ctx = canvas.getContext('2d')!;
ASSETS.forEach((raw, i) => {
  const loaded = loadPreviewAsset(raw);
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues));
  // MapRenderer resets the transform, so each map draws on its own canvas first.
  const panel = document.createElement('canvas');
  panel.width = panel.height = SIZE;
  const focus = typeof FOCUS === 'undefined' ? null : FOCUS[i];
  const view = fitViewport(
    focus
      ? {
          minX: focus[0] - focus[2] / 2,
          minY: focus[1] - focus[2] / 2,
          maxX: focus[0] + focus[2] / 2,
          maxY: focus[1] + focus[2] / 2,
        }
      : loaded.asset.bounds,
    SIZE,
    SIZE,
  );
  new MapRenderer(loaded.asset).render(panel.getContext('2d')!, view, { ...DEFAULT_LAYERS }, false);
  ctx.drawImage(panel, i * SIZE, 0);
  ctx.save();
  ctx.translate(i * SIZE, 0);
  const caption = CAPTIONS[i];
  if (caption) {
    ctx.font = '600 22px system-ui';
    ctx.fillStyle = '#efe9d9';
    ctx.fillRect(SIZE / 2 - 160, 10, 320, 34);
    ctx.fillStyle = '#302e26';
    ctx.textAlign = 'center';
    ctx.fillText(caption, SIZE / 2, 35);
  }
  ctx.restore();
});
const out = document.createElement('pre');
out.id = 'image';
out.textContent = canvas.toDataURL('image/jpeg', 0.85);
document.body.appendChild(out);
