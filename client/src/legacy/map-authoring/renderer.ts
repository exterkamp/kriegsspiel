import { createElevationQueries, type ElevationQueries } from '@kriegsspiel/maps';
import type { PreviewAsset } from './asset.js';
import {
  geometryBounds,
  traceLine,
  tracePolygon,
  traceUnionPolygon,
  weldedBoundary,
  type PolygonShape,
  type Position,
} from './geometry.js';
import { hachureLayout, hachureStrokes, type GradientField } from './hachures.js';
import {
  CLASSIC_MAP_STYLE,
  type LabelFonts,
  type MapPalette,
  type MapStyle,
  type RoadClass,
} from './map-style.js';
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
  hachures: 'Hachures',
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
  hachures: true,
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
interface Crossing extends Shape {
  ends: readonly [Position, Position];
  deckWidth: number;
}
interface Tile {
  canvas: HTMLCanvasElement;
}

/** Period base tiles are square rasters of this many device pixels. */
const TILE_PX = 256;
/**
 * At most this many base tiles are made per frame; the rest follow in the next frames. A count, not a
 * clock, keeps rendering deterministic and leaves timing to the optional preview observer.
 */
export const BASE_TILES_PER_FRAME = 6;
/** Least-recently-used base tiles beyond this count are dropped (about 42 MB at most). */
const TILE_CACHE = 160;
const ROAD_ORDER: readonly RoadClass[] = ['track', 'street', 'regional'];
/**
 * Water polygons whose outlines lie within this distance of each other draw as one body. River reaches
 * (D44) are simplified one by one, so where two meet their outlines part by up to a few centimetres;
 * the shore probes this far across before calling an edge shore, and the gap is filled over.
 */
const WATER_WELD_M = 0.5;
/** Water edges are tested for shore in pieces of at most this length, so a gap's mouth stays short. */
const WATER_PIECE_M = 2.5;

function polygonShape(polygon: PolygonShape, kind: string): Shape {
  const path = new Path2D();
  tracePolygon(path, polygon);
  return { path, kind, bounds: geometryBounds(polygon.outer) };
}
/** A polygon wound for a nonzero union fill with its neighbours (see `traceUnionPolygon`). */
function unionShape(polygon: PolygonShape, kind: string): Shape {
  const path = new Path2D();
  traceUnionPolygon(path, polygon);
  return { path, kind, bounds: geometryBounds(polygon.outer) };
}
function lineShape(points: readonly Position[], kind: string, width = 0): Shape {
  const path = new Path2D();
  traceLine(path, points);
  return { path, kind, width, bounds: geometryBounds(points, width / 2) };
}
function canvas(width: number, height: number): HTMLCanvasElement {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  return element;
}
function context2d(element: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = element.getContext('2d');
  if (!ctx) throw new Error('Canvas2D is unavailable');
  return ctx;
}

/**
 * Browser-only cached presentation, derived solely from a frozen asset snapshot. Every colour and stroke
 * comes from `style` (see `map-style.ts`); the default is the classic flat look the table raster uses.
 */
export class MapRenderer {
  private readonly cover: Shape[];
  private readonly water: Shape[];
  private readonly rivers: Shape[];
  private readonly roads: Shape[];
  private readonly bridges: Crossing[];
  private readonly buildings: Shape[];
  private readonly settlements: Shape[];
  private readonly contours: Shape[];
  private readonly shade: HTMLCanvasElement;
  private ground?: ElevationQueries;
  private readonly woods: Shape[];
  private outline?: { body: Shape[]; shore: Shape[]; welds: Shape[] };
  private readonly tiles = new Map<string, Tile>();
  private readonly patterns = new Map<string, CanvasPattern | null>();

  constructor(
    readonly asset: PreviewAsset,
    readonly style: MapStyle = CLASSIC_MAP_STYLE,
  ) {
    const l = asset.layers;
    this.cover = l.cover.flatMap((f) => f.polygons.map((p) => polygonShape(p, f.kind)));
    this.water = l.water.flatMap((f) => f.polygons.map((p) => polygonShape(p, f.kind)));
    this.woods = this.cover.filter((s) => s.kind === 'wood');
    this.rivers =
      style.water.minRiverPx > 0
        ? l.water.flatMap((f) =>
            f.kind === 'river' ? [lineShape(f.centreline, 'river', f.widthM)] : [],
          )
        : [];
    this.roads = l.roads.map((f) => lineShape(f.path, f.kind, f.surfaceWidthM));
    this.bridges = l.crossings.map((f) => ({
      ...polygonShape(f.deck, f.kind),
      ends: f.endpoints,
      deckWidth: f.widthM,
    }));
    this.buildings = l.buildings.map((f) => polygonShape(f.footprint, f.kind));
    this.settlements =
      style.buildings.settlementAlpha > 0
        ? l.sites.flatMap((s) =>
            s.occupiedFootprint ? [polygonShape(s.occupiedFootprint, s.kind)] : [],
          )
        : [];
    this.contours = l.contours.map((f) => ({ ...lineShape(f.path, 'contour'), index: f.index }));
    this.shade = this.createHillshade();
  }

  private elevation(): ElevationQueries {
    const { bounds: b, elevation: e } = this.asset;
    this.ground ??= createElevationQueries(
      { bounds: { ...b }, elevation: { ...e, samples: [...e.samples] } },
      'clamp',
    );
    return this.ground;
  }

  /**
   * Smoothed ground gradient for hachures: central differences one sample apart. The bilinear surface's
   * own gradient jumps at every sample line, which would kink the strokes along a visible grid.
   */
  private fallLine(): GradientField {
    const q = this.elevation();
    const h = this.asset.elevation.spacingM;
    return {
      gradientAt: (x, y) => ({
        dx: (q.heightAt(x + h, y) - q.heightAt(x - h, y)) / (2 * h),
        dy: (q.heightAt(x, y + h) - q.heightAt(x, y - h)) / (2 * h),
      }),
    };
  }

  private createHillshade(): HTMLCanvasElement {
    const b = this.asset.bounds;
    const q = this.elevation();
    const { shadow, neutralFlat } = this.style.relief.shade;
    const longest = Math.max(b.maxX - b.minX, b.maxY - b.minY);
    // Fixed presentation cap; no allocation proportional to viewport or zoom.
    const shade = canvas(
      Math.max(2, Math.round((512 * (b.maxX - b.minX)) / longest)),
      Math.max(2, Math.round((512 * (b.maxY - b.minY)) / longest)),
    );
    const ctx = context2d(shade);
    const pixels = ctx.createImageData(shade.width, shade.height);
    for (let y = 0; y < shade.height; y++)
      for (let x = 0; x < shade.width; x++) {
        const { dx, dy } = q.gradientAt(
          b.minX + ((x + 0.5) / shade.width) * (b.maxX - b.minX),
          b.minY + ((y + 0.5) / shade.height) * (b.maxY - b.minY),
        );
        // Surface normal (-dx,-dy,1), light from north-west and above.
        let light = Math.max(0, (dx * 0.5 + dy * 0.5 + Math.SQRT1_2) / Math.hypot(dx, dy, 1));
        // Level ground stays white under multiply; only slopes turned from the light darken.
        if (neutralFlat)
          light = 1 - Math.min(1, Math.max(0, ((Math.SQRT1_2 - light) / Math.SQRT1_2) * 2));
        const i = (y * shade.width + x) * 4;
        for (let c = 0; c < 3; c++)
          pixels.data[i + c] = Math.round(shadow[c]! + light * (255 - shadow[c]!));
        pixels.data[i + 3] = 255;
      }
    ctx.putImageData(pixels, 0, 0);
    return shade;
  }

  /** Screen-sized symbol fill (tree marks or building hatching), anchored to the map so it pans with it. */
  private pattern(
    ctx: CanvasRenderingContext2D,
    key: 'trees' | 'hatch',
    p: MapPalette,
    dpr: number,
    scale: number,
  ): CanvasPattern | null {
    const id = `${key}:${p.paper}:${dpr}`;
    let pattern = this.patterns.get(id);
    if (pattern === undefined) {
      pattern = null;
      const trees = this.style.cover.trees;
      const hatch = this.style.buildings.hatch;
      const size = key === 'trees' ? trees?.tilePx : hatch && hatch.spacingPx * Math.SQRT2;
      if (size && typeof ctx.createPattern === 'function') {
        const px = Math.max(2, Math.round(size * dpr));
        const tile = canvas(px, px);
        const t = context2d(tile);
        t.scale(px / size, px / size);
        t.lineCap = 'round';
        if (key === 'trees' && trees) {
          // Deciduous-tree marks in a staggered pair, as on the woods of a staff map.
          t.strokeStyle = p.woodSymbol;
          t.fillStyle = p.woodSymbol;
          t.lineWidth = 0.75;
          for (const [x, y] of [
            [0.27, 0.3],
            [0.77, 0.8],
          ] as const) {
            t.beginPath();
            t.arc(x * size, y * size, trees.radiusPx, 0, Math.PI * 2);
            t.stroke();
            t.beginPath();
            t.moveTo(x * size, y * size + trees.radiusPx);
            t.lineTo(x * size, y * size + trees.radiusPx + 1.4);
            t.stroke();
          }
        } else if (hatch) {
          t.strokeStyle = p.buildingHatch;
          t.lineWidth = hatch.widthPx;
          t.beginPath();
          for (const o of [-size, 0, size]) {
            t.moveTo(o - 1, size + 1);
            t.lineTo(o + size + 1, -1);
          }
          t.stroke();
        }
        pattern = ctx.createPattern(tile, 'repeat');
      }
      this.patterns.set(id, pattern);
    }
    if (pattern && typeof DOMMatrix === 'function')
      pattern.setTransform(new DOMMatrix([1 / (dpr * scale), 0, 0, 1 / (dpr * scale), 0, 0]));
    return pattern;
  }

  /**
   * Draw one frame. Returns true when the frame is incomplete (hachure tiles still being made), so the
   * caller can request another frame; a classic-style render is always complete.
   */
  render(
    ctx: CanvasRenderingContext2D,
    view: Viewport,
    layers: Layers,
    highContrast: boolean,
    dpr = 1,
  ): boolean {
    const style = this.style;
    const period = style.name === 'period';
    const p = highContrast ? style.palette.contrast : style.palette.regular;
    const b = this.asset.bounds;
    const px = 1 / view.scale;
    let pending = false;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = p.margin;
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
    const fill = (shapes: Shape[], color: (s: Shape) => string, outline?: string) => {
      for (const s of shapes)
        if (intersects(s.bounds, visible, (outline ? 1.5 : 1) * px)) {
          ctx.fillStyle = color(s);
          ctx.fill(s.path, 'evenodd');
          if (outline) {
            ctx.strokeStyle = outline;
            ctx.lineWidth = px;
            ctx.stroke(s.path);
          }
        }
    };
    if (period) pending = this.drawBase(ctx, view, visible, layers, p, highContrast, dpr);
    else {
      if (layers.cover)
        fill(
          this.cover,
          (s) => (s.kind === 'wood' ? p.wood : s.kind === 'field' ? p.field : p.open),
          highContrast ? p.woodEdge : undefined,
        );
      if (layers.hillshade) {
        ctx.save();
        ctx.globalAlpha = highContrast
          ? style.relief.shade.contrastAlpha
          : style.relief.shade.alpha;
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(this.shade, b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
        ctx.restore();
      }
      if (layers.water) fill(this.water, () => p.water, p.shore);
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (layers.contours) {
      const c = style.relief.contours;
      ctx.save();
      ctx.globalAlpha = c.alpha;
      for (const s of this.contours) {
        if (!s.index && view.scale < c.regularFromScale) continue;
        const width = s.index ? c.indexPx : c.regularPx;
        if (intersects(s.bounds, visible, (width / 2 + 1) * px)) {
          ctx.strokeStyle = p.contour;
          ctx.lineWidth = width * px;
          ctx.stroke(s.path);
        }
      }
      ctx.restore();
    }
    if (layers.roads) this.drawRoads(ctx, visible, p, px);
    if (layers.bridges) {
      if (style.crossings.mode === 'deck')
        fill(
          this.bridges,
          (s) => (highContrast || s.kind !== 'ford' ? p.bridge : p.ford),
          p.parapet,
        );
      else this.drawCrossings(ctx, visible, p, px);
    }
    if (layers.buildings) {
      const hatch = style.buildings.hatch;
      if (!hatch) fill(this.buildings, () => p.building);
      else {
        const detailed = view.scale >= hatch.fromScale;
        const pattern = detailed ? this.pattern(ctx, 'hatch', p, dpr, view.scale) : null;
        ctx.strokeStyle = p.buildingEdge;
        ctx.lineWidth = style.buildings.edgePx * px;
        for (const s of this.buildings)
          if (intersects(s.bounds, visible, px)) {
            // Too small to hatch: a solid dark block, as small houses are on a printed sheet.
            ctx.fillStyle = detailed ? p.building : p.buildingEdge;
            ctx.fill(s.path, 'evenodd');
            if (pattern) {
              ctx.fillStyle = pattern;
              ctx.fill(s.path, 'evenodd');
            }
            if (detailed) ctx.stroke(s.path);
          }
      }
    }
    ctx.restore();
    if (style.neatLine) this.drawNeatLine(ctx, view, p);
    // LOD only changes labels; canonical polygons and paths are never simplified.
    if (layers.names) this.drawLabels(ctx, view, p, highContrast);
    if (layers.scale) this.drawScale(ctx, view, p);
    ctx.restore();
    return pending;
  }

  /**
   * Draw the period base map (cover, woods symbols, settlement wash, shading, hachures and lined water)
   * from cached raster tiles of the view's zoom band. Returns true when some tiles are still to be made.
   */
  private drawBase(
    ctx: CanvasRenderingContext2D,
    view: Viewport,
    visible: ViewBounds,
    layers: Layers,
    p: MapPalette,
    highContrast: boolean,
    dpr: number,
  ): boolean {
    const b = this.asset.bounds;
    const tileDpr = Math.min(dpr, 1.5);
    const band = Math.round(Math.log2(view.scale));
    const tileM = (band: number) => TILE_PX / (2 ** band * tileDpr);
    const size = tileM(band);
    const area = {
      minX: Math.max(b.minX, visible.minX),
      minY: Math.max(b.minY, visible.minY),
      maxX: Math.min(b.maxX, visible.maxX),
      maxY: Math.min(b.maxY, visible.maxY),
    };
    if (area.minX >= area.maxX || area.minY >= area.maxY) return false;
    const flags = (['cover', 'buildings', 'hillshade', 'hachures', 'water'] as const)
      .map((layer) => (layers[layer] ? 1 : 0))
      .join('');
    const key = (band: number, tx: number, ty: number) =>
      `${band}:${tx}:${ty}:${tileDpr}:${highContrast}:${flags}`;
    let made = 0;
    let pending = false;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const device = (x: number, axis: 0 | 1) =>
      Math.round((x * view.scale + view.offset[axis]) * dpr);
    const place = (band: number, tx: number, ty: number) => {
      const m = tileM(band);
      const x0 = device(tx * m, 0);
      const y0 = device(ty * m, 1);
      return [x0, y0, device((tx + 1) * m, 0) - x0, device((ty + 1) * m, 1) - y0] as const;
    };
    for (let ty = Math.floor(area.minY / size); ty * size < area.maxY; ty++)
      for (let tx = Math.floor(area.minX / size); tx * size < area.maxX; tx++) {
        const id = key(band, tx, ty);
        let tile = this.tiles.get(id);
        if (tile) {
          this.tiles.delete(id);
          this.tiles.set(id, tile);
        } else if (made < BASE_TILES_PER_FRAME) {
          tile = this.baseTile(band, tx, ty, size, tileDpr, layers, p, highContrast);
          made++;
          this.tiles.set(id, tile);
          if (this.tiles.size > TILE_CACHE) this.tiles.delete(this.tiles.keys().next().value!);
        }
        if (tile) {
          ctx.drawImage(tile.canvas, ...place(band, tx, ty));
          continue;
        }
        pending = true;
        // Until it is made, stretch the coarser band's tile over it, or shrink the finer band's four.
        const parent = this.tiles.get(key(band - 1, Math.floor(tx / 2), Math.floor(ty / 2)));
        if (parent) {
          const half = TILE_PX / 2;
          ctx.drawImage(
            parent.canvas,
            (tx & 1) * half,
            (ty & 1) * half,
            half,
            half,
            ...place(band, tx, ty),
          );
        } else
          for (const [cx, cy] of [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
          ] as const) {
            const child = this.tiles.get(key(band + 1, tx * 2 + cx, ty * 2 + cy));
            if (child) ctx.drawImage(child.canvas, ...place(band + 1, tx * 2 + cx, ty * 2 + cy));
          }
      }
    ctx.restore();
    return pending;
  }

  /** One base tile: everything static at this zoom band, drawn in map metres onto a raster. */
  private baseTile(
    band: number,
    tx: number,
    ty: number,
    tileM: number,
    tileDpr: number,
    layers: Layers,
    p: MapPalette,
    highContrast: boolean,
  ): Tile {
    const style = this.style;
    const scale = 2 ** band;
    const res = TILE_PX / tileM;
    const px = 1 / scale;
    const tile = canvas(TILE_PX, TILE_PX);
    const ctx = context2d(tile);
    const area = {
      minX: tx * tileM,
      minY: ty * tileM,
      maxX: (tx + 1) * tileM,
      maxY: (ty + 1) * tileM,
    };
    ctx.setTransform(res, 0, 0, res, -area.minX * res, -area.minY * res);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.fillStyle = p.paper;
    ctx.fillRect(area.minX, area.minY, tileM, tileM);
    // Shapes meeting this tile, merged into one path so adjoining polygons fill without seams.
    const merged = (shapes: readonly { path: Path2D; bounds: ViewBounds }[], margin: number) => {
      const path = new Path2D();
      let any = false;
      for (const s of shapes)
        if (intersects(s.bounds, area, margin)) {
          path.addPath(s.path);
          any = true;
        }
      return any ? path : null;
    };
    if (layers.cover) {
      for (const kind of ['field', 'open'] as const) {
        const path = merged(
          this.cover.filter((s) => s.kind === kind),
          px,
        );
        if (path) {
          ctx.fillStyle = p[kind];
          ctx.fill(path, 'evenodd');
        }
      }
      const woods = merged(this.woods, 2 * style.cover.woodEdgePx * px);
      if (woods) {
        // The edge is stroked first at twice its width; the fill then hides it where woods adjoin.
        ctx.strokeStyle = p.woodEdge;
        ctx.lineWidth = 2 * style.cover.woodEdgePx * (highContrast ? 1.5 : 1) * px;
        ctx.stroke(woods);
        ctx.fillStyle = p.wood;
        ctx.fill(woods, 'evenodd');
        const trees = this.pattern(ctx, 'trees', p, tileDpr, scale);
        if (trees) {
          ctx.fillStyle = trees;
          ctx.fill(woods, 'evenodd');
        }
      }
    }
    if (layers.buildings) {
      const wash = merged(this.settlements, px);
      if (wash) {
        ctx.globalAlpha = style.buildings.settlementAlpha;
        ctx.fillStyle = p.settlement;
        ctx.fill(wash, 'evenodd');
        ctx.globalAlpha = 1;
      }
    }
    if (layers.hillshade) {
      const b = this.asset.bounds;
      const shade = style.relief.shade;
      ctx.globalAlpha = highContrast ? shade.contrastAlpha : shade.alpha;
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(this.shade, b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    const hachures = style.relief.hachures;
    if (layers.hachures && hachures) {
      const [start, end] = hachures.fadeScale;
      const fade = Math.min(1, Math.max(0, (end - scale) / (end - start)));
      if (fade > 0) {
        const strokes = hachureStrokes(
          this.fallLine(),
          this.asset.bounds,
          area,
          hachureLayout(hachures, scale),
          hachures,
        );
        ctx.strokeStyle = p.relief;
        // Four weights, each one path: a tile costs four strokes however many hachures it holds.
        const buckets = 4;
        for (let k = 0; k < buckets; k++) {
          const w = (k + 0.5) / buckets;
          const path = new Path2D();
          let any = false;
          for (const s of strokes)
            if (Math.min(buckets - 1, Math.floor(s.weight * buckets)) === k) {
              any = true;
              for (let i = 0; i < s.points.length; i += 2)
                if (i === 0) path.moveTo(s.points[0]!, s.points[1]!);
                else path.lineTo(s.points[i]!, s.points[i + 1]!);
            }
          if (!any) continue;
          ctx.globalAlpha =
            fade *
            (highContrast ? hachures.contrastAlpha : 1) *
            (hachures.alpha[0] + (hachures.alpha[1] - hachures.alpha[0]) * w);
          ctx.lineWidth =
            (hachures.widthPx[0] + (hachures.widthPx[1] - hachures.widthPx[0]) * w) * px;
          ctx.stroke(path);
        }
        ctx.globalAlpha = 1;
      }
    }
    if (layers.water) this.drawWater(ctx, area, p, px);
    return { canvas: tile };
  }

  private drawWater(ctx: CanvasRenderingContext2D, area: ViewBounds, p: MapPalette, px: number) {
    const w = this.style.water;
    const reach = (Math.max(0, ...w.liningPx) + w.liningWidthPx + w.shorePx) * px;
    // Rivers narrower than a line on screen keep a blue line along their centreline.
    ctx.strokeStyle = p.waterLine;
    ctx.lineWidth = w.minRiverPx * px;
    for (const s of this.rivers)
      if (s.width! < w.minRiverPx * px && intersects(s.bounds, area, w.minRiverPx * px))
        ctx.stroke(s.path);
    const water = this.waterBody(area, reach);
    if (!water) return;
    const shore = new Path2D();
    for (const s of this.waterOutline().shore)
      if (intersects(s.bounds, area, reach)) shore.addPath(s.path);
    ctx.fillStyle = p.water;
    ctx.fill(water, 'nonzero');
    if (w.liningPx.length) {
      // Water lining: parallel lines inside the true shore, fading outward, as nested strokes under a
      // clip to the water. Each ring is a wide line stroke cut back by a slightly narrower water stroke.
      ctx.save();
      ctx.clip(water, 'nonzero');
      const rings = w.liningPx.length;
      for (let i = rings - 1; i >= 0; i--) {
        const d = w.liningPx[i]!;
        ctx.globalAlpha = 0.85 - (0.5 * i) / Math.max(1, rings - 1);
        ctx.strokeStyle = p.waterLine;
        ctx.lineWidth = (2 * d + w.liningWidthPx) * px;
        ctx.stroke(shore);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = p.water;
        ctx.lineWidth = (2 * d - w.liningWidthPx) * px;
        ctx.stroke(shore);
      }
      ctx.restore();
    }
    ctx.strokeStyle = p.shore;
    ctx.lineWidth = w.shorePx * px;
    ctx.stroke(shore);
  }

  /**
   * The water's true shore as polylines, leaving out edges between water polygons (strip lakes, river
   * reaches) that adjoin within `WATER_WELD_M`; the welds that fill the gaps along those edges,
   * grouped by 250 m cell; and the water polygons wound for a union fill. Computed once per renderer.
   */
  private waterOutline(): { body: Shape[]; shore: Shape[]; welds: Shape[] } {
    if (this.outline) return this.outline;
    const water = this.asset.layers.water;
    const { shore, welds } = weldedBoundary(
      water.flatMap((f) => f.polygons),
      { pieceM: WATER_PIECE_M, weldM: WATER_WELD_M },
    );
    const cells = new Map<string, Position[][]>();
    for (const quad of welds) {
      const key = `${Math.floor(quad[0]![0] / 250)}:${Math.floor(quad[0]![1] / 250)}`;
      const list = cells.get(key);
      if (list) list.push(quad);
      else cells.set(key, [quad]);
    }
    this.outline = {
      body: water.flatMap((f) => f.polygons.map((p) => unionShape(p, f.kind))),
      shore: shore.map((line) => lineShape(line, 'shore')),
      welds: [...cells.values()].map((quads) => {
        const path = new Path2D();
        for (const quad of quads) traceUnionPolygon(path, { outer: quad, holes: [] });
        return { path, kind: 'weld', bounds: geometryBounds(quads.flat()) };
      }),
    };
    return this.outline;
  }

  /** All water meeting the area as one path for a nonzero fill: the union of polygons and welds. */
  private waterBody(area: ViewBounds, margin: number): Path2D | null {
    const { body, welds } = this.waterOutline();
    const path = new Path2D();
    let any = false;
    for (const s of body)
      if (intersects(s.bounds, area, margin)) {
        path.addPath(s.path);
        any = true;
      }
    if (!any) return null;
    for (const s of welds) if (intersects(s.bounds, area, margin)) path.addPath(s.path);
    return path;
  }

  private drawRoads(ctx: CanvasRenderingContext2D, visible: ViewBounds, p: MapPalette, px: number) {
    const { stroke, casingsFirst } = this.style.roads;
    const shown = this.roads.filter((s) => intersects(s.bounds, visible, px));
    const outer = (s: Shape) => Math.max(s.width!, stroke[s.kind as RoadClass].minWidthPx * px);
    const casing = (s: Shape) => {
      const r = stroke[s.kind as RoadClass];
      ctx.strokeStyle = p.roadCasing[s.kind as RoadClass];
      ctx.lineWidth = outer(s);
      if (r.dashPx) {
        ctx.lineCap = 'butt';
        ctx.setLineDash(r.dashPx.map((d) => d * px));
      }
      ctx.stroke(s.path);
      if (r.dashPx) {
        ctx.setLineDash([]);
        ctx.lineCap = 'round';
      }
    };
    const surface = (s: Shape) => {
      const r = stroke[s.kind as RoadClass];
      const width = outer(s);
      // Metre surface width, never substituted for the reserved constraint corridor.
      const inner = Math.max(0, width - 2 * Math.min(width * r.casingFraction, r.casingPx * px));
      if (r.dashPx && inner < 0.3 * px) return;
      ctx.strokeStyle = p.road[s.kind as RoadClass];
      ctx.lineWidth = inner;
      ctx.stroke(s.path);
    };
    if (!casingsFirst)
      for (const s of shown) {
        casing(s);
        surface(s);
      }
    else
      for (const kind of ROAD_ORDER) {
        const roads = shown.filter((s) => s.kind === kind);
        for (const s of roads) casing(s);
        for (const s of roads) surface(s);
      }
  }

  /** Bridge: deck between parapets with splayed wings. Ford: dashed edges across lighter water. */
  private drawCrossings(
    ctx: CanvasRenderingContext2D,
    visible: ViewBounds,
    p: MapPalette,
    px: number,
  ) {
    const c = this.style.crossings;
    for (const s of this.bridges) {
      if (!intersects(s.bounds, visible, (c.minSpanPx + c.wingPx) * px)) continue;
      const [[ax, ay], [bx, by]] = s.ends;
      const length = Math.hypot(bx - ax, by - ay) || 1;
      const ux = (bx - ax) / length;
      const uy = (by - ay) / length;
      const nx = -uy;
      const ny = ux;
      const half = Math.max(length, c.minSpanPx * px) / 2;
      const side = Math.max(s.deckWidth / 2, (c.minWidthPx / 2) * px);
      const cx = (ax + bx) / 2;
      const cy = (ay + by) / 2;
      const ford = s.kind === 'ford';
      const at = (along: number, across: number): [number, number] => [
        cx + ux * along + nx * across,
        cy + uy * along + ny * across,
      ];
      ctx.fillStyle = ford ? p.ford : p.bridge;
      ctx.fill(s.path, 'evenodd');
      ctx.beginPath();
      for (const [i, corner] of [
        at(-half, -side),
        at(half, -side),
        at(half, side),
        at(-half, side),
      ].entries())
        if (i === 0) ctx.moveTo(...corner);
        else ctx.lineTo(...corner);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = ford ? p.shore : p.parapet;
      ctx.lineWidth = (ford ? 1 : 1.3) * px;
      if (ford) ctx.setLineDash([2 * px, 1.5 * px]);
      ctx.beginPath();
      for (const sign of [-1, 1]) {
        const wing = c.wingPx * px * sign;
        if (!ford) ctx.moveTo(...at(-half - Math.abs(wing), side * sign + wing));
        if (ford) ctx.moveTo(...at(-half, side * sign));
        else ctx.lineTo(...at(-half, side * sign));
        ctx.lineTo(...at(half, side * sign));
        if (!ford) ctx.lineTo(...at(half + Math.abs(wing), side * sign + wing));
      }
      ctx.stroke();
      if (ford) ctx.setLineDash([]);
    }
  }

  private drawNeatLine(ctx: CanvasRenderingContext2D, view: Viewport, p: MapPalette) {
    const n = this.style.neatLine!;
    const b = this.asset.bounds;
    const [x0, y0] = mapToScreen(view, [b.minX, b.minY]);
    const [x1, y1] = mapToScreen(view, [b.maxX, b.maxY]);
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = n.innerPx;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    const g = n.gapPx + n.outerPx / 2;
    ctx.lineWidth = n.outerPx;
    ctx.strokeRect(x0 - g, y0 - g, x1 - x0 + 2 * g, y1 - y0 + 2 * g);
  }

  private drawLabels(
    ctx: CanvasRenderingContext2D,
    view: Viewport,
    p: MapPalette,
    highContrast: boolean,
  ) {
    const l = this.style.labels;
    const labels: { name: string; point: Position; kind: keyof LabelFonts }[] =
      this.asset.layers.sites.map((s) => ({
        name: s.name,
        point: s.anchor,
        kind: s.kind === 'village' ? 'village' : 'farm',
      }));
    if (view.scale >= l.landmarksFromScale)
      labels.push(
        ...this.asset.layers.landmarks.map((m) => ({
          name: m.name,
          point: m.position,
          kind: 'landmark' as const,
        })),
      );
    const occupied: ViewBounds[] = [];
    ctx.textAlign = 'center';
    const spacing = 'letterSpacing' in ctx;
    const halo = highContrast ? l.contrastHaloPx : l.haloPx;
    for (const label of labels) {
      const [x, y] = mapToScreen(view, [...label.point]);
      const size = l.sizePx[label.kind];
      ctx.font = l.fonts[label.kind];
      if (spacing && l.letterSpacingPx) ctx.letterSpacing = `${l.letterSpacingPx}px`;
      const width = ctx.measureText(label.name).width + 12;
      const box = { minX: x - width / 2, maxX: x + width / 2, minY: y + 9, maxY: y + 16 + size };
      if (
        box.minX < 0 ||
        box.maxX > view.width ||
        box.minY < 0 ||
        box.maxY > view.height ||
        occupied.some((o) => intersects(o, box))
      )
        continue;
      occupied.push(box);
      const baseline = y + 11 + size;
      if (l.backing === 'box') {
        ctx.fillStyle = p.halo;
        ctx.fillRect(box.minX, box.minY, width, 20);
      } else {
        ctx.strokeStyle = p.halo;
        ctx.lineWidth = halo;
        ctx.lineJoin = 'round';
        ctx.strokeText(label.name, x, baseline);
      }
      ctx.fillStyle = p.ink;
      ctx.fillText(label.name, x, l.backing === 'box' ? y + 24 : baseline);
    }
    if (spacing && l.letterSpacingPx) ctx.letterSpacing = '0px';
  }

  private drawScale(ctx: CanvasRenderingContext2D, view: Viewport, p: MapPalette) {
    const bar = scaleBar(view);
    const x = 24;
    const y = view.height - 28;
    const text =
      bar.metres >= 1000 ? `${bar.metres / 1000} km` : `${Number(bar.metres.toPrecision(6))} m`;
    ctx.font = this.style.scaleBar.font;
    if (this.style.scaleBar.mode === 'plain') {
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
      ctx.textAlign = 'left';
      ctx.fillText(text, x, y - 12);
      return;
    }
    // Segmented bar: alternate ink and paper quarters, 0 at the left and the length at the right.
    const end = ctx.measureText(text).width / 2;
    ctx.fillStyle = p.paper;
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 1;
    ctx.fillRect(x - 12, y - 30, bar.pixels + 24 + end, 46);
    ctx.strokeRect(x - 12, y - 30, bar.pixels + 24 + end, 46);
    const h = 5;
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? p.paper : p.ink;
      ctx.fillRect(x + (i * bar.pixels) / 4, y - h, bar.pixels / 4, h);
    }
    ctx.strokeRect(x, y - h, bar.pixels, h);
    ctx.fillStyle = p.ink;
    ctx.textAlign = 'center';
    ctx.fillText('0', x, y - 11);
    ctx.fillText(text, x + bar.pixels, y - 11);
  }
}
