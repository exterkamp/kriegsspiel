export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CameraPose {
  position: Vec3;
  target: Vec3;
}

/** Smooth start and stop. `t` is clamped to 0..1. */
export function easeInOut(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

export function lerpPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
  const v = (p: Vec3, q: Vec3): Vec3 => ({
    x: mix(p.x, q.x, t),
    y: mix(p.y, q.y, t),
    z: mix(p.z, q.z, t),
  });
  return { position: v(a.position, b.position), target: v(a.target, b.target) };
}

/**
 * Where the camera goes when the player turns from the map table to the desk: it dollies toward the near
 * edge of the table and tilts down onto the desk blotter in front of it. `span` is the map's larger side.
 */
export function deskPose(from: CameraPose, mapHeight: number, span: number): CameraPose {
  const target = { x: from.target.x, y: 0, z: mapHeight / 2 + span * 0.12 };
  return {
    target,
    position: { x: from.target.x, y: span * 0.1, z: target.z + span * 0.3 },
  };
}
