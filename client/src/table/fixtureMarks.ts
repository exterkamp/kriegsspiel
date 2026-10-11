import * as THREE from 'three';
import { z } from 'zod';
import type { Coord } from '@kriegsspiel/protocol';
import type { BaseMap, SceneMark } from './types.js';

type Extent = Pick<BaseMap, 'width' | 'height'>;
const point = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const geometry = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pin'), at: point }).strict(),
  z.object({ kind: z.literal('polyline'), points: z.array(point).min(2).max(256) }).strict(),
  z.object({ kind: z.literal('arrow'), points: z.array(point).min(2).max(256) }).strict(),
  z
    .object({ kind: z.literal('ring'), centre: point, radiusM: z.number().finite().positive() })
    .strict(),
  z
    .object({ kind: z.literal('symbol'), at: point, symbol: z.enum(['cross', 'dot', 'flag']) })
    .strict(),
]);
const marksSchema = z
  .array(
    z
      .object({
        id: z.string().min(1).max(128),
        label: z.string().max(256),
        geometry,
      })
      .strict(),
  )
  .max(200);

/** Strict render boundary: clone valid input, reject provenance/truth/unknown fields. */
export function validateSceneMarks(raw: unknown, map: Extent): readonly SceneMark[] {
  if (![map.width, map.height].every((n) => Number.isFinite(n) && n > 0))
    throw new RangeError('Invalid mark map extent');
  const parsed = marksSchema.safeParse(raw);
  if (!parsed.success) throw new RangeError('Invalid render-only marks');
  const ids = new Set<string>();
  for (const mark of parsed.data) {
    const g = mark.geometry;
    const points =
      g.kind === 'polyline' || g.kind === 'arrow'
        ? g.points
        : g.kind === 'ring'
          ? [g.centre]
          : [g.at];
    if (
      ids.has(mark.id) ||
      points.some((p) => p.x < 0 || p.x > map.width || p.y < 0 || p.y > map.height) ||
      (g.kind === 'ring' && g.radiusM > Math.hypot(map.width, map.height))
    )
      throw new RangeError('Mark geometry exceeds map or document limits');
    ids.add(mark.id);
  }
  return parsed.data;
}

export function markSignature(mark: SceneMark, map: Extent): string {
  return JSON.stringify([map.width, map.height, mark]);
}

/** Liang–Barsky clipping of each decorative segment; input coordinates stay untouched. */
function clippedSegment(a: Coord, b: Coord, map: Extent): readonly [Coord, Coord] | null {
  let start = 0;
  let end = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x],
    [dx, map.width - a.x],
    [-dy, a.y],
    [dy, map.height - a.y],
  ] as const) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) start = Math.max(start, t);
      else end = Math.min(end, t);
      if (start > end) return null;
    }
  }
  const at = (t: number): Coord => ({
    x: Math.max(0, Math.min(map.width, a.x + t * dx)),
    y: Math.max(0, Math.min(map.height, a.y + t * dy)),
  });
  return [at(start), at(end)];
}

/** Convex polygon clipping for filled dot glyphs. */
function clippedPolygon(points: readonly Coord[], map: Extent): Coord[] {
  let output = [...points];
  for (const [axis, boundary, greater] of [
    ['x', 0, true],
    ['x', map.width, false],
    ['y', 0, true],
    ['y', map.height, false],
  ] as const) {
    const input = output;
    output = [];
    if (!input.length) break;
    const inside = (p: Coord) => (greater ? p[axis] >= boundary : p[axis] <= boundary);
    let previous = input[input.length - 1]!;
    for (const current of input) {
      if (inside(previous) !== inside(current)) {
        const t = (boundary - previous[axis]) / (current[axis] - previous[axis]);
        output.push({
          x: axis === 'x' ? boundary : previous.x + t * (current.x - previous.x),
          y: axis === 'y' ? boundary : previous.y + t * (current.y - previous.y),
        });
      }
      if (inside(current)) output.push(current);
      previous = current;
    }
  }
  return output;
}

/** Owned mark resources are tracked immediately, even before attachment to the group. */
export function createMarkGroup(input: SceneMark, map: Extent): THREE.Group {
  const mark = validateSceneMarks([input], map)[0]!;
  const group = new THREE.Group();
  group.name = 'mark';
  group.userData.markId = mark.id;
  const owned = new Set<{ dispose(): void }>();
  const own = <T extends { dispose(): void }>(resource: T): T => {
    owned.add(resource);
    return resource;
  };
  try {
    const span = Math.max(map.width, map.height);
    const size = span * 0.005;
    const elevation = span * 0.0004;
    const vertices: number[] = [];
    const world = (p: Coord, height = elevation): number[] => [
      p.x - map.width / 2,
      height,
      p.y - map.height / 2,
    ];
    const segment = (a: Coord, b: Coord) => {
      const clipped = clippedSegment(a, b, map);
      if (clipped) vertices.push(...world(clipped[0]), ...world(clipped[1]));
    };
    const circle = (centre: Coord, radius: number, count: number): Coord[] =>
      Array.from({ length: count }, (_, i) => ({
        x: centre.x + radius * Math.cos((i * 2 * Math.PI) / count),
        y: centre.y + radius * Math.sin((i * 2 * Math.PI) / count),
      }));
    const loop = (points: readonly Coord[]) =>
      points.forEach((p, i) => segment(p, points[(i + 1) % points.length]!));
    const g = mark.geometry;
    let anchor: Coord;
    if (g.kind === 'polyline' || g.kind === 'arrow') {
      for (let i = 1; i < g.points.length; i++) segment(g.points[i - 1]!, g.points[i]!);
      anchor = g.kind === 'arrow' ? g.points[g.points.length - 1]! : g.points[0]!;
      if (g.kind === 'arrow') {
        // Last nonzero leg determines the head, including repeated terminal points.
        const previous = [...g.points].reverse().find((p) => p.x !== anchor.x || p.y !== anchor.y);
        if (previous) {
          const dx = anchor.x - previous.x;
          const dy = anchor.y - previous.y;
          const distance = Math.hypot(dx, dy);
          const length = Math.min(size * 1.5, distance / 2);
          const ux = dx / distance;
          const uy = dy / distance;
          for (const sign of [-1, 1])
            segment(anchor, {
              x: anchor.x - ux * length + sign * uy * length * 0.5,
              y: anchor.y - uy * length - sign * ux * length * 0.5,
            });
        }
      }
    } else if (g.kind === 'ring') {
      anchor = g.centre;
      loop(circle(anchor, g.radiusM, 128));
    } else {
      anchor = g.at;
      if (g.kind === 'pin')
        loop([
          { x: anchor.x, y: anchor.y - size },
          { x: anchor.x + size, y: anchor.y },
          { x: anchor.x, y: anchor.y + size },
          { x: anchor.x - size, y: anchor.y },
        ]);
      else if (g.symbol === 'cross') {
        segment(
          { x: anchor.x - size, y: anchor.y - size },
          { x: anchor.x + size, y: anchor.y + size },
        );
        segment(
          { x: anchor.x - size, y: anchor.y + size },
          { x: anchor.x + size, y: anchor.y - size },
        );
      } else if (g.symbol === 'flag') {
        segment({ x: anchor.x, y: anchor.y + size }, { x: anchor.x, y: anchor.y - size });
        const tip = { x: anchor.x + size, y: anchor.y - size / 2 };
        segment({ x: anchor.x, y: anchor.y - size }, tip);
        segment(tip, { x: anchor.x, y: anchor.y });
      } else {
        const polygon = clippedPolygon(circle(anchor, size * 0.5, 32), map);
        if (polygon.length >= 3) {
          const positions: number[] = [];
          for (let i = 1; i < polygon.length - 1; i++)
            positions.push(...world(polygon[0]!), ...world(polygon[i]!), ...world(polygon[i + 1]!));
          const geometry = own(new THREE.BufferGeometry());
          geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          const material = own(
            new THREE.MeshBasicMaterial({ color: 0x2d4055, side: THREE.DoubleSide }),
          );
          const dot = new THREE.Mesh(geometry, material);
          dot.name = 'mark-dot';
          group.add(dot);
        }
      }
    }
    if (vertices.length) {
      const geometry = own(new THREE.BufferGeometry());
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      const material = own(new THREE.LineBasicMaterial({ color: 0x2d4055 }));
      const ink = new THREE.LineSegments(geometry, material);
      ink.name = 'mark-ink';
      group.add(ink);
    }
    if (mark.label) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 96;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Mark label canvas is unavailable');
      context.fillStyle = '#f4eedb';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#2d4055';
      context.font = '32px serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(mark.label, canvas.width / 2, canvas.height / 2, canvas.width - 24);
      const texture = own(new THREE.CanvasTexture(canvas));
      texture.colorSpace = THREE.SRGBColorSpace;
      const width = Math.min(span * 0.06, map.width);
      const height = Math.min(span * 0.01125, map.height);
      // Move the decorative label inward at edges; neither its quad nor its text
      // can spill beyond the map. The stored geometry/anchor is never adjusted.
      const left = Math.max(0, Math.min(map.width - width, anchor.x - width / 2));
      const top = Math.max(0, Math.min(map.height - height, anchor.y + size * 1.5));
      const corners = [
        { x: left, y: top },
        { x: left, y: top + height },
        { x: left + width, y: top + height },
        { x: left + width, y: top },
      ];
      const geometry = own(new THREE.BufferGeometry());
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [0, 1, 2, 0, 2, 3].flatMap((i) => world(corners[i]!, elevation * 1.1)),
          3,
        ),
      );
      geometry.setAttribute(
        'uv',
        new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1], 2),
      );
      const material = own(
        new THREE.MeshBasicMaterial({
          map: texture,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      const label = new THREE.Mesh(geometry, material);
      label.name = 'mark-label';
      group.add(label);
    }
    return group;
  } catch (error) {
    owned.forEach((resource) => resource.dispose());
    group.clear();
    throw error;
  }
}
