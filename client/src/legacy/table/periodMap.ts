import type { Coord } from '@kriegsspiel/protocol';
import {
  DEFAULT_LAYERS,
  MapRenderer,
  type Layers,
  type RenderableAsset,
} from '../map-authoring/renderer.js';
import {
  TABLE_MAP_STYLE,
  type MapPalette,
  type MapStyle,
  type RoadClass,
} from '../map-authoring/map-style.js';
import { paintOrder } from './paintOrder.js';
import type { BaseFeature, BaseMap } from './types.js';

/**
 * The live game's map paper in the period staff-map style (D43, #498).
 *
 * A game's map is a `BaseMap` (vector features in metres with a paint order, #467), not a `MapAsset`, so
 * a small adapter turns its features into the layers `MapRenderer` draws, and `renderOnce` draws them with
 * `TABLE_MAP_STYLE`: the same style object, palettes and symbols as the editor and the saved-map table.
 *
 * `MapRenderer` paints by layer (cover, water, roads, crossings, buildings), while a `BaseMap` paints in
 * `paintOrder`: explicit native layers, then ID. To keep that order the features are split into passes:
 * each pass is a run of consecutive features that the renderer would itself paint in that order, and each
 * later pass is drawn over the earlier ones on clear paper. A legacy fixture such as Hold the Bridge takes
 * two passes (woods and road; then river and bridge, so the river cuts the road and the bridge carries it).
 *
 * Native features (an explicit `layer`) are drawn at their exact metre widths. Legacy features keep the
 * style's legibility minimums, as the flat painter kept its 2 px floor for them.
 */

type Position = [number, number];
type Ring = Position[];
type Polygon = { outer: Ring; holes: Ring[] };
type MutableLayers = {
  -readonly [K in keyof RenderableAsset['layers']]: RenderableAsset['layers'][K][number][];
};

/** One draw over the paper: renderer passes go through `MapRenderer`, marsh through `drawMarsh`. */
export interface PeriodPass {
  readonly painter: 'renderer' | 'marsh';
  /** Native features (explicit layer): exact metre widths, no legibility minimums. */
  readonly exact: boolean;
  readonly features: readonly BaseFeature[];
}

/** No relief, contours, names or scale bar: a `BaseMap` carries none, and the table frames the sheet. */
export const PERIOD_LAYERS: Layers = Object.freeze({
  ...DEFAULT_LAYERS,
  hillshade: false,
  hachures: false,
  contours: false,
  names: false,
  scale: false,
});

/** Sides of the polygon standing for a round feature (a point's radius, a line's joint). */
const DISC_SIDES = 24;
const CLEAR = 'rgba(0, 0, 0, 0)';
const ROAD_RANK: Record<RoadClass, number> = { track: 3, street: 4, regional: 5 };

/**
 * Road class from the surface width, since a `BaseMap` road carries none: a high road is cased and
 * ochre, a lane plain, a cart track broken (D43).
 */
export function roadClass(widthM: number): RoadClass {
  return widthM >= 8 ? 'regional' : widthM >= 4 ? 'street' : 'track';
}

/** A road's drawn width: its own, 1 m along an area's outline, or a place's diameter. */
function roadWidth(f: BaseFeature): number {
  const g = f.geometry;
  return g.shape === 'polyline' ? g.width : g.shape === 'polygon' ? 1 : 2 * g.radius;
}

/** Where `MapRenderer.render` paints a feature within one pass: lower first. Marsh is drawn apart. */
function rank(f: BaseFeature): number {
  switch (f.kind) {
    case 'field':
      return 0;
    case 'wood':
      return 1;
    case 'water':
    case 'river':
    case 'stream':
      return 2;
    case 'road':
      return ROAD_RANK[roadClass(roadWidth(f))];
    case 'bridge':
    case 'ford':
      return 6;
    case 'building':
      return 7;
    case 'marsh':
      return -1;
  }
}

/**
 * Split the map's features, in `paintOrder`, into passes the renderer can draw without reordering: a
 * pass ends where the next feature would be painted under an earlier one of the same pass, where marsh
 * starts or stops, or where native and legacy features meet.
 */
export function periodPasses(map: BaseMap): PeriodPass[] {
  const passes: { painter: PeriodPass['painter']; exact: boolean; features: BaseFeature[] }[] = [];
  let last = -Infinity;
  for (const f of paintOrder(map.features)) {
    const painter = f.kind === 'marsh' ? 'marsh' : 'renderer';
    const exact = f.layer !== undefined;
    const r = rank(f);
    const pass = passes.at(-1);
    if (pass && pass.painter === painter && pass.exact === exact && r >= last)
      pass.features.push(f);
    else passes.push({ painter, exact, features: [f] });
    last = r;
  }
  return passes;
}

const point = (p: Coord): Position => [p.x, p.y];
function closed(points: readonly Coord[]): Ring {
  const ring = points.map(point);
  const [a, b] = [ring[0], ring.at(-1)];
  if (a && b && (a[0] !== b[0] || a[1] !== b[1])) ring.push([a[0], a[1]]);
  return ring;
}
function disc(at: Coord, r: number): Polygon {
  const outer: Ring = [];
  for (let i = 0; i <= DISC_SIDES; i++) {
    const a = ((i % DISC_SIDES) / DISC_SIDES) * Math.PI * 2;
    outer.push([at.x + r * Math.cos(a), at.y + r * Math.sin(a)]);
  }
  return { outer, holes: [] };
}
function quad(a: Coord, b: Coord, width: number): Polygon | undefined {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!length) return undefined;
  const nx = (-(b.y - a.y) / length) * (width / 2);
  const ny = ((b.x - a.x) / length) * (width / 2);
  return {
    outer: [
      [a.x + nx, a.y + ny],
      [b.x + nx, b.y + ny],
      [b.x - nx, b.y - ny],
      [a.x - nx, a.y - ny],
      [a.x + nx, a.y + ny],
    ],
    holes: [],
  };
}
/** A line `width` wide as polygons: one per segment, a disc at each bend so the joints stay round. */
function strip(points: readonly Coord[], width: number): Polygon[] {
  const out: Polygon[] = [];
  for (let i = 1; i < points.length; i++) {
    const q = quad(points[i - 1]!, points[i]!, width);
    if (!q) continue;
    out.push(q);
    if (i < points.length - 1) out.push(disc(points[i]!, width / 2));
  }
  if (!out.length && points[0] && width > 0) out.push(disc(points[0], width / 2));
  return out;
}
/** Any feature as areas: its polygon, a line's strip or a point's disc. */
function areas(f: BaseFeature): Polygon[] {
  const g = f.geometry;
  if (g.shape === 'polygon')
    return g.points.length >= 3 ? [{ outer: closed(g.points), holes: [] }] : [];
  if (g.shape === 'polyline') return strip(g.points, g.width);
  return g.radius > 0 ? [disc(g.at, g.radius)] : [];
}
function rectangle(c: Coord, u: Position, length: number, width: number): Polygon {
  const [ux, uy] = u;
  const [nx, ny] = [-uy * (width / 2), ux * (width / 2)];
  const [ax, ay] = [ux * (length / 2), uy * (length / 2)];
  return {
    outer: [
      [c.x - ax + nx, c.y - ay + ny],
      [c.x + ax + nx, c.y + ay + ny],
      [c.x + ax - nx, c.y + ay - ny],
      [c.x - ax - nx, c.y - ay - ny],
      [c.x - ax + nx, c.y - ay + ny],
    ],
    holes: [],
  };
}
function nearestSegment(
  p: Coord,
  points: readonly Coord[],
): { d: number; u: Position } | undefined {
  let best: { d: number; u: Position } | undefined;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!length) continue;
    const u: Position = [(b.x - a.x) / length, (b.y - a.y) / length];
    const t = Math.max(0, Math.min(length, (p.x - a.x) * u[0] + (p.y - a.y) * u[1]));
    const d = Math.hypot(a.x + u[0] * t - p.x, a.y + u[1] * t - p.y);
    if (!best || d < best.d) best = { d, u };
  }
  return best;
}

/**
 * A bridge or ford as the renderer's crossing: a deck between two ends. A point crossing (a place and a
 * radius) runs along the road through it, as wide as that road, spanning its diameter; with no road
 * through it, straight across the river or stream it sits on; otherwise north to south.
 */
function crossing(f: BaseFeature, all: readonly BaseFeature[]) {
  const g = f.geometry;
  let centre: Coord;
  let u: Position = [0, 1];
  let span: number;
  let width: number;
  if (g.shape === 'point') {
    centre = g.at;
    span = 2 * g.radius;
    width = g.radius;
    let road: { d: number; u: Position; width: number } | undefined;
    let water: { d: number; u: Position } | undefined;
    for (const other of all) {
      const og = other.geometry;
      if (og.shape !== 'polyline') continue;
      const near = nearestSegment(g.at, og.points);
      if (!near) continue;
      if (other.kind === 'road' && near.d <= g.radius && (!road || near.d < road.d))
        road = { ...near, width: og.width };
      else if (
        (other.kind === 'river' || other.kind === 'stream') &&
        near.d <= g.radius + og.width / 2 &&
        (!water || near.d < water.d)
      )
        water = near;
    }
    if (road) {
      u = road.u;
      width = Math.min(road.width, span);
    } else if (water) u = [-water.u[1], water.u[0]];
  } else {
    const pts = g.points;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const [minX, maxX, minY, maxY] = [
      Math.min(...xs),
      Math.max(...xs),
      Math.min(...ys),
      Math.max(...ys),
    ];
    if (g.shape === 'polyline') {
      const [a, b] = [pts[0]!, pts.at(-1)!];
      span = Math.hypot(b.x - a.x, b.y - a.y);
      if (span) u = [(b.x - a.x) / span, (b.y - a.y) / span];
      centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      width = g.width;
    } else {
      centre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
      const wide = maxX - minX >= maxY - minY;
      u = wide ? [1, 0] : [0, 1];
      span = wide ? maxX - minX : maxY - minY;
      width = wide ? maxY - minY : maxX - minX;
    }
  }
  const half = span / 2;
  const ends: [Position, Position] = [
    [centre.x - u[0] * half, centre.y - u[1] * half],
    [centre.x + u[0] * half, centre.y + u[1] * half],
  ];
  const deck =
    g.shape === 'polygon'
      ? { outer: closed(g.points), holes: [] }
      : rectangle(centre, u, span, width);
  return { ends, span, width, deck };
}

/**
 * The renderer's layers for one pass. Only what `MapRenderer` reads is meaningful; identities the
 * renderer never draws (road nodes, sites, the ground) are placeholders. `all` is the whole map, which
 * places a point crossing on its road.
 */
export function periodAsset(
  map: BaseMap,
  features: readonly BaseFeature[],
  all: readonly BaseFeature[],
): RenderableAsset {
  const layers: MutableLayers = {
    cover: [],
    water: [],
    roadNodes: [],
    roads: [],
    crossings: [],
    sites: [],
    buildings: [],
    landmarks: [],
    contours: [],
  };
  for (const f of features) {
    const g = f.geometry;
    switch (f.kind) {
      case 'field':
      case 'wood': {
        const polygons = areas(f);
        if (polygons.length) layers.cover.push({ id: f.id, kind: f.kind, polygons });
        break;
      }
      case 'water':
      case 'river':
      case 'stream': {
        const polygons = areas(f);
        if (!polygons.length) break;
        if (f.kind !== 'water' && g.shape === 'polyline')
          layers.water.push({
            id: f.id,
            kind: 'river',
            polygons,
            centreline: g.points.map(point),
            widthM: g.width,
            surfacePolicy: 'standing-water-v1',
            surfaceProfileM: [0, 0],
          });
        else layers.water.push({ id: f.id, kind: 'lake', polygons, surfaceElevationM: 0 });
        break;
      }
      case 'road': {
        // A road given as an area or a place is drawn along its outline, or as a dot as wide as it.
        const width = roadWidth(f);
        const path =
          g.shape === 'polyline'
            ? g.points.map(point)
            : g.shape === 'polygon'
              ? closed(g.points)
              : [point(g.at), point(g.at)];
        layers.roads.push({
          id: f.id,
          kind: roadClass(width),
          fromNodeId: 'table',
          toNodeId: 'table',
          path,
          widthM: width,
          surfaceWidthM: width,
          setbackM: 0,
          routeIds: [],
          crossingIds: [],
        });
        break;
      }
      case 'bridge':
      case 'ford': {
        const c = crossing(f, all);
        const base = {
          id: f.id,
          waterId: 'table',
          roadIds: ['table'],
          endpoints: c.ends,
          spanM: c.span,
          widthM: c.width,
          deck: c.deck,
        };
        layers.crossings.push(
          f.kind === 'bridge'
            ? { ...base, kind: 'bridge' }
            : { ...base, kind: 'ford', depthM: 0, traversableWidthM: c.width },
        );
        break;
      }
      case 'building':
        for (const [i, footprint] of (g.shape === 'point'
          ? [rectangle(g.at, [1, 0], 2 * g.radius, 2 * g.radius)]
          : areas(f)
        ).entries())
          layers.buildings.push({
            id: i ? `${f.id}:${i}` : f.id,
            siteId: 'table',
            kind: 'residential',
            footprint,
            capacity: 0,
            residents: 0,
          });
        break;
      case 'marsh':
        break;
    }
  }
  const side = Math.max(map.width, map.height);
  return {
    bounds: { minX: 0, minY: 0, maxX: map.width, maxY: map.height },
    // Never read: the relief layers are off (`PERIOD_LAYERS`), and the renderer makes its shading lazily.
    elevation: { columns: 2, rows: 2, spacingM: side, samples: [0, 0, 0, 0] },
    layers,
  };
}

function variant(style: MapStyle, overlay: boolean, exact: boolean): MapStyle {
  const clear = (p: MapPalette): MapPalette => ({ ...p, margin: CLEAR, paper: CLEAR });
  return Object.freeze({
    ...style,
    palette: overlay
      ? { regular: clear(style.palette.regular), contrast: clear(style.palette.contrast) }
      : style.palette,
    ...(exact
      ? {
          water: { ...style.water, minRiverPx: 0 },
          roads: {
            ...style.roads,
            stroke: Object.fromEntries(
              Object.entries(style.roads.stroke).map(([k, v]) => [k, { ...v, minWidthPx: 0 }]),
            ) as MapStyle['roads']['stroke'],
          },
          crossings: { ...style.crossings, minSpanPx: 0, minWidthPx: 0 },
        }
      : {}),
  });
}
/** The table style for a pass: the first lays the paper, later ones draw on clear paper. */
const STYLES = {
  paper: variant(TABLE_MAP_STYLE, false, false),
  paperExact: variant(TABLE_MAP_STYLE, false, true),
  overlay: variant(TABLE_MAP_STYLE, true, false),
  overlayExact: variant(TABLE_MAP_STYLE, true, true),
};
export function passStyle(first: boolean, exact: boolean): MapStyle {
  return first
    ? exact
      ? STYLES.paperExact
      : STYLES.paper
    : exact
      ? STYLES.overlayExact
      : STYLES.overlay;
}

/**
 * Marsh has no symbol in the period style: it is drawn as a wash of the style's water colour inside a
 * broken water line, so wet ground reads as wet but not as open water.
 */
function drawMarsh(
  ctx: CanvasRenderingContext2D,
  features: readonly BaseFeature[],
  s: number,
  p: MapPalette,
): void {
  ctx.save();
  ctx.scale(s, s);
  ctx.beginPath();
  for (const polygon of features.flatMap(areas))
    for (const ring of [polygon.outer, ...polygon.holes]) {
      ring.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
    }
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = p.water;
  ctx.fill('evenodd');
  ctx.globalAlpha = 1;
  ctx.strokeStyle = p.waterLine;
  ctx.lineWidth = 0.8 / s;
  ctx.setLineDash([3 / s, 2 / s]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * Paint the map at `s` px per metre in the table's period style, in `paintOrder`. The context is expected
 * untransformed, its top-left the map's north-west corner.
 */
export function drawPeriodMap(
  ctx: CanvasRenderingContext2D,
  map: BaseMap,
  s: number,
  highContrast: boolean,
): void {
  const passes = periodPasses(map);
  // The first pass lays the paper; a map that starts with marsh (or has no features) gets a bare one.
  if (passes[0]?.painter !== 'renderer')
    passes.unshift({ painter: 'renderer', exact: false, features: [] });
  const view = {
    width: map.width * s,
    height: map.height * s,
    scale: s,
    offset: [0, 0] as [number, number],
  };
  const palette = highContrast ? TABLE_MAP_STYLE.palette.contrast : TABLE_MAP_STYLE.palette.regular;
  passes.forEach((pass, i) => {
    if (pass.painter === 'marsh') drawMarsh(ctx, pass.features, s, palette);
    else
      new MapRenderer(
        periodAsset(map, pass.features, map.features),
        passStyle(i === 0, pass.exact),
        {
          software: true,
        },
      ).renderOnce(ctx, view, PERIOD_LAYERS, highContrast);
  });
}

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
