import type { Facing } from './types.js';

/** Rotation about Y for each facing; the block's nose points at -Z ("north"). */
export const FACING_ANGLE: Record<Facing, number> = {
  N: 0,
  NE: -Math.PI / 4,
  E: -Math.PI / 2,
  SE: (-3 * Math.PI) / 4,
  S: Math.PI,
  SW: (3 * Math.PI) / 4,
  W: Math.PI / 2,
  NW: Math.PI / 4,
};

/** Camera height above the centre of a `width` x `height` map so all of it fits, with a margin. */
export function fitDistance(width: number, height: number, fovDeg: number, aspect: number): number {
  const halfV = Math.tan((fovDeg * Math.PI) / 360);
  const forHeight = height / 2 / halfV;
  const forWidth = width / 2 / (halfV * aspect);
  return Math.max(forHeight, forWidth) * 1.1;
}
