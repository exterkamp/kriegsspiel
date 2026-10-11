import { createElevationQueries } from '@kriegsspiel/maps';
import type { PreviewAsset } from './asset.js';
import {
  geometryBounds,
  traceLine,
  tracePolygon,
  type PolygonShape,
  type Position,
} from './geometry.js';
import {
  intersects,
  mapToScreen,
  scaleBar,
  visibleBounds,
  type Viewport,
  type ViewBounds,
} from './viewport.js';

export const LAYER_NAMES = {
  hillshade: 'Elevation hillshade',
  contours: 'Contours',
  cover: 'Land cover',
  water: 'Water',
  roads: 'Road surfaces',
  bridges: 'Bridges & fords',
  buildings: 'Building footprints',
  names: 'Place names',
  scale: 'Metric scale',
} as const;
export type Layer = keyof typeof LAYER_NAMES;
export type Layers = Record<Layer, boolean>;
export const DEFAULT_LAYERS: Layers = {
  hillshade: true,
  contours: true,
  cover: true,
  water: true,
  roads: true,
  bridges: true,
  buildings: true,
  names: true,
  scale: true,
};
interface Shape {
  path: Path2D;
  bounds: ViewBounds;
  kind: string;
  width?: number;
  index?: boolean;
}
const regular = {
  paper: '#efe9d9',
  wood: '#a4b58e',
  field: '#dbcc9c',
  open: '#e4ddc6',
  water: '#88b6c3',
  road: '#faf4e2',
  edge: '#77644b',
  bridge: '#c5aa7e',
  building: '#61584b',
  contour: '#8e8068',
  ink: '#302e26',
};
const contrast = {
  paper: '#ffffff',
  wood: '#c2c8bd',
  field: '#e8e8e8',
  open: '#ffffff',
  water: '#80bddc',
  road: '#ffffff',
  edge: '#000000',
  bridge: '#ffdd70',
  building: '#000000',
  contour: '#666666',
  ink: '#000000',
};

function polygonShape(polygon: PolygonShape, kind: string): Shape {
  const path = new Path2D();
  tracePolygon(path, polygon);
  return { path, kind, bounds: geometryBounds(polygon.outer) };
}
function lineShape(points: readonly Position[], kind: string, width = 0): Shape {
  const path = new Path2D();
  traceLine(path, points);
  return { path, kind, width, bounds: geometryBounds(points, width / 2) };
}

/** Browser-only cached presentation, derived solely from a frozen asset snapshot. */
export class MapRenderer {
  private readonly cover: Shape[];
  private readonly water: Shape[];
  private readonly roads: Shape[];
  private readonly bridges: Shape[];
  private readonly buildings: Shape[];
  private readonly contours: Shape[];
  private readonly shade: HTMLCanvasElement;

  constructor(readonly asset: PreviewAsset) {
    const l = asset.layers;
    this.cover = l.cover.flatMap((f) => f.polygons.map((p) => polygonShape(p, f.kind)));
    this.water = l.water.flatMap((f) => f.polygons.map((p) => polygonShape(p, f.kind)));
    this.roads = l.roads.map((f) => lineShape(f.path, f.kind, f.surfaceWidthM));
    this.bridges = l.crossings.map((f) => polygonShape(f.deck, f.kind));
    this.buildings = l.buildings.map((f) => polygonShape(f.footprint, f.kind));
    this.contours = l.contours.map((f) => ({ ...lineShape(f.path, 'contour'), index: f.index }));
    this.shade = this.createHillshade();
  }

  private createHillshade(): HTMLCanvasElement {
    const { bounds: b, elevation: e } = this.asset;
    const q = createElevationQueries({
      bounds: { ...b },
      elevation: { ...e, samples: [...e.samples] },
    });
    const canvas = document.createElement('canvas');
    const longest = Math.max(b.maxX - b.minX, b.maxY - b.minY);
    // Fixed presentation cap; no allocation proportional to viewport or zoom.
    canvas.width = Math.max(2, Math.round((512 * (b.maxX - b.minX)) / longest));
    canvas.height = Math.max(2, Math.round((512 * (b.maxY - b.minY)) / longest));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas2D is unavailable');
    const pixels = ctx.createImageData(canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y++)
      for (let x = 0; x < canvas.width; x++) {
        const { dx, dy } = q.gradientAt(
          b.minX + ((x + 0.5) / canvas.width) * (b.maxX - b.minX),
          b.minY + ((y + 0.5) / canvas.height) * (b.maxY - b.minY),
        );
        // Surface normal (-dx,-dy,1), light from north-west and above.
        const light = Math.max(0, (dx * 0.5 + dy * 0.5 + Math.SQRT1_2) / Math.hypot(dx, dy, 1));
        const value = Math.round(100 + light * 155);
        const i = (y * canvas.width + x) * 4;
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
        pixels.data[i + 3] = 255;
      }
    ctx.putImageData(pixels, 0, 0);
    return canvas;
  }

  render(
    ctx: CanvasRenderingContext2D,
    view: Viewport,
    layers: Layers,
    highContrast: boolean,
    dpr = 1,
  ): void {
    const p = highContrast ? contrast : regular;
    const b = this.asset.bounds;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = highContrast ? '#dedede' : '#d5d4cc';
    ctx.fillRect(0, 0, view.width, view.height);
    ctx.save();
    ctx.translate(...view.offset);
    ctx.scale(view.scale, view.scale);
    ctx.beginPath();
    ctx.rect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    ctx.clip();
    ctx.fillStyle = p.paper;
    ctx.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    const visible = visibleBounds(view);
    // Round joins bound outline extent; include half-stroke and a CSS pixel for AA.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const fill = (shapes: Shape[], color: (s: Shape) => string, outline = false) => {
      for (const s of shapes)
        if (intersects(s.bounds, visible, (outline ? 1.5 : 1) / view.scale)) {
          ctx.fillStyle = color(s);
          ctx.fill(s.path, 'evenodd');
          if (outline) {
            ctx.strokeStyle = p.edge;
            ctx.lineWidth = 1 / view.scale;
            ctx.stroke(s.path);
          }
        }
    };
    if (layers.cover)
      fill(
        this.cover,
        (s) => (s.kind === 'wood' ? p.wood : s.kind === 'field' ? p.field : p.open),
        highContrast,
      );
    if (layers.hillshade) {
      ctx.save();
      ctx.globalAlpha = highContrast ? 0.14 : 0.28;
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(this.shade, b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
      ctx.restore();
    }
    if (layers.water) fill(this.water, () => p.water, true);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (layers.contours)
      for (const s of this.contours)
        if (intersects(s.bounds, visible, ((s.index ? 1.4 : 0.6) / 2 + 1) / view.scale)) {
          ctx.strokeStyle = p.contour;
          ctx.lineWidth = (s.index ? 1.4 : 0.6) / view.scale;
          ctx.stroke(s.path);
        }
    if (layers.roads)
      for (const s of this.roads)
        if (intersects(s.bounds, visible, 1 / view.scale)) {
          // Metre surface width, never substituted for the reserved constraint corridor.
          ctx.strokeStyle = p.edge;
          ctx.lineWidth = s.width!;
          ctx.stroke(s.path);
          ctx.strokeStyle = p.road;
          ctx.lineWidth = Math.max(0, s.width! - Math.min(s.width! * 0.3, 1 / view.scale));
          ctx.stroke(s.path);
        }
    if (layers.bridges)
      fill(this.bridges, (s) => (highContrast || s.kind !== 'ford' ? p.bridge : p.water), true);
    if (layers.buildings) fill(this.buildings, () => p.building);
    ctx.restore();
    // LOD only changes labels; canonical polygons and paths are never simplified.
    if (layers.names) {
      const labels = this.asset.layers.sites.map((s) => ({ name: s.name, point: s.anchor }));
      if (view.scale >= 0.15)
        labels.push(
          ...this.asset.layers.landmarks.map((l) => ({ name: l.name, point: l.position })),
        );
      const occupied: ViewBounds[] = [];
      ctx.font = '600 13px system-ui';
      ctx.textAlign = 'center';
      for (const label of labels) {
        const [x, y] = mapToScreen(view, [...label.point]);
        const width = ctx.measureText(label.name).width + 12;
        const box = { minX: x - width / 2, maxX: x + width / 2, minY: y + 9, maxY: y + 29 };
        if (
          box.minX < 0 ||
          box.maxX > view.width ||
          box.minY < 0 ||
          box.maxY > view.height ||
          occupied.some((o) => intersects(o, box))
        )
          continue;
        occupied.push(box);
        ctx.fillStyle = p.paper;
        ctx.fillRect(box.minX, box.minY, width, 20);
        ctx.fillStyle = p.ink;
        ctx.fillText(label.name, x, y + 24);
      }
    }
    if (layers.scale) {
      const bar = scaleBar(view);
      const x = 24;
      const y = view.height - 28;
      ctx.fillStyle = p.paper;
      ctx.fillRect(x - 10, y - 30, bar.pixels + 20, 46);
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x, y);
      ctx.lineTo(x + bar.pixels, y);
      ctx.lineTo(x + bar.pixels, y - 5);
      ctx.stroke();
      ctx.fillStyle = p.ink;
      ctx.font = '12px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(
        bar.metres >= 1000 ? `${bar.metres / 1000} km` : `${Number(bar.metres.toPrecision(6))} m`,
        x,
        y - 12,
      );
    }
    ctx.restore();
  }
}
