/** Rotation about Y for a compass bearing in radians; the block's nose points at -Z ("north"). */
export function facingToRotationY(bearing: number): number {
  return -bearing;
}

/** Camera height above the centre of a `width` x `height` (metres) map so all of it fits, with a margin. */
export function fitDistance(width: number, height: number, fovDeg: number, aspect: number): number {
  const halfV = Math.tan((fovDeg * Math.PI) / 360);
  const forHeight = height / 2 / halfV;
  const forWidth = width / 2 / (halfV * aspect);
  return Math.max(forHeight, forWidth) * 1.1;
}
