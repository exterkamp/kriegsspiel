/** Serialisable RNG state: a single 32-bit unsigned integer. */
export type RngState = number;

/** Derive an initial RNG state from an integer seed (splitmix-style scramble). */
export function seedRng(seed: number): RngState {
  let z = (Math.trunc(seed) + 0x9e3779b9) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}

/**
 * Seeded RNG (mulberry32). Its whole state is one number, so it can be saved
 * in a snapshot and restored with `new Rng(state)`. Never uses `Math.random`.
 */
export class Rng {
  private s: number;

  constructor(state: RngState) {
    this.s = state >>> 0;
  }

  /** Current state; pass to `new Rng` to resume the same sequence. */
  getState(): RngState {
    return this.s;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Roll one die with `sides` faces: 1..sides. */
  die(sides = 6): number {
    return this.int(1, sides);
  }
}
