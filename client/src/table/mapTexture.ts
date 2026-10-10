import type { MapGrid, Terrain } from './types.js';

export const TERRAIN_COLOURS: Record<Terrain, string> = {
  open: '#d8cfa6',
  wood: '#5f7a4a',
  river: '#6f9bb5',
  bridge: '#8a6a43',
  road: '#b99f73',
};

const PX = 24;

/** Paint the grid with flat colours and simple hatching. Pure drawing: reads only the grid. */
export function drawMap(ctx: CanvasRenderingContext2D, map: MapGrid): void {
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = map.tiles[y * map.width + x] ?? 'open';
      ctx.fillStyle = TERRAIN_COLOURS[t];
      ctx.fillRect(x * PX, y * PX, PX, PX);
      ctx.strokeStyle = 'rgba(60,45,20,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (t === 'wood') {
        ctx.arc(x * PX + PX / 2, y * PX + PX / 2, PX / 3, 0, Math.PI * 2);
      } else if (t === 'river') {
        ctx.moveTo(x * PX + 3, y * PX + PX / 2);
        ctx.quadraticCurveTo(x * PX + PX / 2, y * PX + PX / 4, x * PX + PX - 3, y * PX + PX / 2);
      } else if (t === 'bridge') {
        ctx.moveTo(x * PX, y * PX + 4);
        ctx.lineTo(x * PX + PX, y * PX + 4);
        ctx.moveTo(x * PX, y * PX + PX - 4);
        ctx.lineTo(x * PX + PX, y * PX + PX - 4);
      } else if (t === 'road') {
        ctx.moveTo(x * PX + PX / 2, y * PX);
        ctx.lineTo(x * PX + PX / 2, y * PX + PX);
      } else {
        ctx.strokeStyle = 'rgba(60,45,20,0.12)';
        ctx.strokeRect(x * PX + 0.5, y * PX + 0.5, PX - 1, PX - 1);
      }
      ctx.stroke();
    }
  }
}

export function mapCanvas(map: MapGrid): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = map.width * PX;
  c.height = map.height * PX;
  const ctx = c.getContext('2d');
  if (ctx) drawMap(ctx, map);
  return c;
}
