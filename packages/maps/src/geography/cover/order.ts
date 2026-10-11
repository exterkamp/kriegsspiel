/** Iterative merge order with <=N*ceil(log2(N)) comparisons and bounded staging. */
export function ordered<T>(values: T[], compare: (a: T, b: T) => number): T[] {
  let source = values.slice(),
    target = new Array<T>(values.length);
  for (let width = 1; width < values.length; width *= 2) {
    for (let start = 0; start < values.length; start += 2 * width) {
      const middle = Math.min(values.length, start + width),
        end = Math.min(values.length, start + 2 * width);
      let left = start,
        right = middle;
      for (let out = start; out < end; out++) {
        if (left < middle && (right >= end || compare(source[left]!, source[right]!) <= 0))
          target[out] = source[left++]!;
        else target[out] = source[right++]!;
      }
    }
    [source, target] = [target, source];
  }
  return source;
}
