// Small analytical diagnostics, not production terrain or layout validation.
export function toWorld([x, y], { anchor, clockwiseRadians = 0, metresPerUnit = 1 }) {
  const c = Math.cos(clockwiseRadians),
    s = Math.sin(clockwiseRadians);
  return [anchor[0] + metresPerUnit * (c * x - s * y), anchor[1] + metresPerUnit * (s * x + c * y)];
}

export function toLocal([x, y], { anchor, clockwiseRadians = 0, metresPerUnit = 1 }) {
  const c = Math.cos(clockwiseRadians),
    s = Math.sin(clockwiseRadians);
  const dx = x - anchor[0],
    dy = y - anchor[1];
  return [(c * dx + s * dy) / metresPerUnit, (-s * dx + c * dy) / metresPerUnit];
}

export function ringArea(ring) {
  return (
    Math.abs(
      ring.reduce((sum, p, i) => {
        const q = ring[(i + 1) % ring.length];
        return sum + p[0] * q[1] - p[1] * q[0];
      }, 0),
    ) / 2
  );
}

export function multiPolygonArea(polygons) {
  return polygons.reduce(
    (sum, polygon) =>
      sum + ringArea(polygon[0]) - polygon.slice(1).reduce((n, hole) => n + ringArea(hole), 0),
    0,
  );
}

export function pointSegmentDistance(p, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t = length2
    ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2))
    : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

export function planeGrade(a, b, gradient) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  return length ? Math.abs(gradient[0] * dx + gradient[1] * dy) / length : 0;
}

// Outer approximation of a round-buffered path: segment rectangles plus
// circumscribed 32-gons at every vertex. Covers caps/joins; <=0.484% radial excess.
export function corridorPieces(path, width) {
  const radius = width / 2;
  if (radius <= 0) return [];
  const n = 32,
    outerRadius = radius / Math.cos(Math.PI / n);
  const pieces = path.map(([x, y]) => [
    Array.from({ length: n }, (_, i) => {
      const angle = ((i + 0.5) * 2 * Math.PI) / n;
      return [x + outerRadius * Math.cos(angle), y + outerRadius * Math.sin(angle)];
    }),
  ]);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i];
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      length = Math.hypot(dx, dy);
    if (!length) continue;
    const nx = (-dy / length) * radius,
      ny = (dx / length) * radius;
    pieces.push([
      [
        [a[0] + nx, a[1] + ny],
        [b[0] + nx, b[1] + ny],
        [b[0] - nx, b[1] - ny],
        [a[0] - nx, a[1] - ny],
      ],
    ]);
  }
  return pieces;
}
