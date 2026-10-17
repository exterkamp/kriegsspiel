import type { ConstraintPolygon } from '@kriegsspiel/settlemaker';
import type { Point, Polygon, Site } from '../contract.js';
import { decimal6 } from '../terrain/precision.js';
import { degreeUnit } from '../rotation.js';

export function settlementFrame(site: Pick<Site, 'anchor' | 'rotationDeg'>) {
  const rotation = site.rotationDeg,
    x = site.anchor[0],
    y = site.anchor[1];
  // Whole degrees (every generated site, #545) read the literal table; any
  // other recorded rotation keeps the snapped runtime value.
  const angle = (rotation * Math.PI) / 180;
  const snap = (n: number) =>
    Math.abs(n) < 1e-14 ? 0 : Math.abs(n - 1) < 1e-14 ? 1 : Math.abs(n + 1) < 1e-14 ? -1 : n;
  const [c, s] = degreeUnit(rotation) ?? [snap(Math.cos(angle)), snap(Math.sin(angle))];
  const world = (p: { x: number; y: number }): Point => [
    decimal6(x + c * p.x - s * p.y),
    decimal6(y + s * p.x + c * p.y),
  ];
  const local = (p: Point) => ({
    x: decimal6(c * (p[0] - x) + s * (p[1] - y)),
    y: decimal6(-s * (p[0] - x) + c * (p[1] - y)),
  });
  const worldPolygon = (p: ConstraintPolygon): Polygon => {
    const close = (r: { x: number; y: number }[]) => {
      const out = r.map(world);
      if (out.length && (out[0]![0] !== out.at(-1)![0] || out[0]![1] !== out.at(-1)![1]))
        out.push([...out[0]!] as Point);
      return out;
    };
    return { outer: close(p.outer), holes: p.holes.map(close) };
  };
  const localPolygon = (p: Polygon): ConstraintPolygon => ({
    outer: p.outer.map(local),
    holes: p.holes.map((r) => r.map(local)),
  });
  return {
    world,
    local,
    worldPolygon,
    localPolygon,
    localBearing: (bearing: number) => (bearing - rotation + 360) % 360,
    localGradient: (g: { dx: number; dy: number }) => ({
      dx: c * g.dx + s * g.dy,
      dy: -s * g.dx + c * g.dy,
    }),
  };
}
