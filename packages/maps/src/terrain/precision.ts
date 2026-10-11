/** Frozen decimal-6-v1: certify geometry after, not merely before, rounding. */
export function decimal6(value: number): number {
  const rounded = Number.isInteger(value) ? value : Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
}
