import { expect, it } from 'vitest';
import { createReferenceAsset, parseAsset } from '../src/index.js';

function flowFixture() {
  const a = createReferenceAsset();
  a.drainage = {
    policy: 'filled-ground-d8-v1',
    filledSamples: [...a.elevation.samples],
    downstream: Array.from({ length: 49 }, (_, i) => (i < 42 ? i + 7 : -1)),
    accumulation: Array.from({ length: 49 }, (_, i) => Math.floor(i / 7) + 1),
    outlets: [42, 43, 44, 45, 46, 47, 48],
    sinks: [],
  };
  return a;
}
it('stores filled drainage independently and validates aligned D8 flow/accounting', () => {
  const a = flowFixture();
  a.drainage!.filledSamples = a.drainage!.filledSamples.map((x) => x + 1);
  const b = parseAsset(a);
  expect(b.elevation.samples[0]).toBe(100);
  expect(b.drainage!.filledSamples[0]).toBe(101);
});
it('rejects unexplained terminals, wrong references, filling below ground and incorrect accumulation', () => {
  const a = flowFixture();
  a.drainage!.outlets.pop();
  expect(() => parseAsset(a)).toThrow(/Unexplained terminal/);
  const b = flowFixture();
  b.drainage!.downstream[0] = 999;
  expect(() => parseAsset(b)).toThrow(/downstream\[0\]/);
  const c = flowFixture();
  c.drainage!.filledSamples[0] = -1;
  expect(() => parseAsset(c)).toThrow(/below original ground/);
  const d = flowFixture();
  d.drainage!.accumulation[8] = 99;
  expect(() => parseAsset(d)).toThrow(/accumulation\[8\]/);
});
it('rejects a cycle on a flat filled surface without interpreting it as a river', () => {
  const a = flowFixture();
  a.drainage!.filledSamples.fill(1000);
  a.drainage!.downstream[0] = 1;
  a.drainage!.downstream[1] = 0;
  for (let y = 1; y < 7; y++) for (const x of [0, 1]) a.drainage!.accumulation[y * 7 + x] = y;
  expect(() => parseAsset(a)).toThrow(/cycle/);
});
it('requires physically checkable river profiles instead of a policy label', () => {
  const a = createReferenceAsset();
  const river = a.layers.water[0]!;
  if (river.kind !== 'river') throw new Error('fixture');
  river.surfaceProfileM = [];
  expect(() => parseAsset(a)).toThrow(/surfaceProfileM/);
  const b = createReferenceAsset();
  const r = b.layers.water[0]!;
  if (r.kind !== 'river') throw new Error('fixture');
  r.surfaceProfileM.reverse();
  expect(() => parseAsset(b)).toThrow(/profile conflicts|rises downstream/);
});
