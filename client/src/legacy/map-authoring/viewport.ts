import type { Bounds, Point } from '@kriegsspiel/maps';

/** CSS pixels per metre, with x east and y south throughout. DPR is render-only. */
// Asset bounds require a zero origin; viewport/detail rectangles may be translated.
export type ViewBounds = { [K in keyof Bounds]: number };
export interface Viewport {
  width: number;
  height: number;
  scale: number;
  offset: Point;
}

function positive(value: number): void {
  if (!Number.isFinite(value) || value <= 0)
    throw new RangeError('Expected a finite positive size');
}
function finitePoint(point: Point): void {
  if (!point.every(Number.isFinite)) throw new RangeError('Expected finite coordinates');
}

export function fitViewport(bounds: ViewBounds, width: number, height: number): Viewport {
  positive(width);
  positive(height);
  finitePoint([bounds.minX, bounds.minY]);
  finitePoint([bounds.maxX, bounds.maxY]);
  positive(bounds.maxX - bounds.minX);
  positive(bounds.maxY - bounds.minY);
  const scale =
    Math.min(width / (bounds.maxX - bounds.minX), height / (bounds.maxY - bounds.minY)) * 0.88;
  return {
    width,
    height,
    scale,
    offset: [
      width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
      height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale,
    ],
  };
}
export function mapToScreen(view: Viewport, point: Point): Point {
  return [point[0] * view.scale + view.offset[0], point[1] * view.scale + view.offset[1]];
}
export function screenToMap(view: Viewport, point: Point): Point {
  return [(point[0] - view.offset[0]) / view.scale, (point[1] - view.offset[1]) / view.scale];
}
export function panViewport(view: Viewport, delta: Point): Viewport {
  finitePoint(delta);
  return { ...view, offset: [view.offset[0] + delta[0], view.offset[1] + delta[1]] };
}
export function zoomViewport(
  view: Viewport,
  anchor: Point,
  factor: number,
  bounds: ViewBounds,
): Viewport {
  positive(factor);
  finitePoint(anchor);
  const fitted = fitViewport(bounds, view.width, view.height).scale;
  const scale = Math.max(fitted / 8, Math.min(Math.max(80, fitted * 64), view.scale * factor));
  const point = screenToMap(view, anchor);
  return { ...view, scale, offset: [anchor[0] - point[0] * scale, anchor[1] - point[1] * scale] };
}
export function resizeViewport(view: Viewport, width: number, height: number): Viewport {
  positive(width);
  positive(height);
  return {
    ...view,
    width,
    height,
    offset: [
      view.offset[0] + (width - view.width) / 2,
      view.offset[1] + (height - view.height) / 2,
    ],
  };
}
export function visibleBounds(view: Viewport): ViewBounds {
  const min = screenToMap(view, [0, 0]);
  const max = screenToMap(view, [view.width, view.height]);
  return { minX: min[0], minY: min[1], maxX: max[0], maxY: max[1] };
}
export function intersects(a: ViewBounds, b: ViewBounds, paddingM = 0): boolean {
  return (
    a.minX - paddingM <= b.maxX &&
    a.maxX + paddingM >= b.minX &&
    a.minY - paddingM <= b.maxY &&
    a.maxY + paddingM >= b.minY
  );
}
export function scaleBar(view: Viewport): { metres: number; pixels: number } {
  const target = Math.min(140, view.width * 0.3) / view.scale;
  const power = 10 ** Math.floor(Math.log10(target));
  const metres = (target / power >= 5 ? 5 : target / power >= 2 ? 2 : 1) * power;
  return { metres, pixels: metres * view.scale };
}
