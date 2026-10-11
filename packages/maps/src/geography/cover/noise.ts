function hash(seed: number, x: number, y: number): number {
  let value = (seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Independent, coordinate-hashed continuous value noise; no ambient/shared RNG. */
export function coherentNoise(seed: number, x: number, y: number, coherenceM: number): number {
  const nx = x / coherenceM,
    ny = y / coherenceM;
  const ix = Math.floor(nx),
    iy = Math.floor(ny),
    u = fade(nx - ix),
    v = fade(ny - iy);
  return lerp(
    lerp(hash(seed, ix, iy), hash(seed, ix + 1, iy), u),
    lerp(hash(seed, ix, iy + 1), hash(seed, ix + 1, iy + 1), u),
    v,
  );
}
