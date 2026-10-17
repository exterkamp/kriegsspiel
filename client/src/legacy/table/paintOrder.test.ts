import { describe, expect, it } from 'vitest';
import { paintOrder } from './paintOrder.js';
import { paintOrder as texturePaintOrder } from './mapTexture.js';
import type { BaseFeature, FeatureKind } from './types.js';

function feature(id: string, kind: FeatureKind, layer?: number): BaseFeature {
  return {
    id,
    kind,
    ...(layer === undefined ? {} : { layer }),
    geometry: { shape: 'point', at: { x: 50, y: 50 }, radius: 10 },
  };
}

describe('shared terrain paint order', () => {
  it('honors explicit layers including zero and negatives instead of kind defaults', () => {
    const features = [
      feature('wood', 'wood', 12),
      feature('bridge', 'bridge', -3),
      feature('road', 'road', 0),
      feature('river', 'river', -8),
    ];
    expect(paintOrder(features).map((f) => f.id)).toEqual(['river', 'bridge', 'road', 'wood']);
  });

  it('paints smaller native IDs last on equal layers, independently of kind and input order', () => {
    const a = feature('a', 'wood', 7);
    const z = feature('z', 'bridge', 7);
    expect(paintOrder([a, z]).map((f) => f.id)).toEqual(['z', 'a']);
    expect(paintOrder([z, a]).map((f) => f.id)).toEqual(['z', 'a']);
    expect(
      paintOrder([
        feature('a-10', 'field', 7),
        feature('a-2', 'field', 7),
        feature('Z', 'field', 7),
      ]).map((f) => f.id),
    ).toEqual(['a-2', 'a-10', 'Z']);
  });

  it('preserves kind precedence and insertion ties for fully implicit legacy fixtures', () => {
    const features = [
      feature('bridge', 'bridge'),
      feature('river', 'river'),
      feature('a', 'wood'),
      feature('z', 'marsh'),
      feature('road', 'road'),
      feature('field', 'field'),
    ];
    const expected = ['field', 'a', 'z', 'road', 'river', 'bridge'];
    expect(paintOrder(features).map((f) => f.id)).toEqual(expected);
    // Existing callers keep their mapTexture import, with identical legacy behavior.
    expect(texturePaintOrder(features).map((f) => f.id)).toEqual(expected);
  });

  it('has a deterministic mixed tie without disrupting native ID precedence', () => {
    const a = feature('a', 'wood', 1);
    const z = feature('z', 'bridge', 1);
    const implicit = feature('legacy', 'marsh');
    for (const input of [
      [a, implicit, z],
      [z, a, implicit],
      [implicit, z, a],
    ])
      expect(paintOrder(input).map((f) => f.id)).toEqual(['legacy', 'z', 'a']);
  });

  it('does not mutate its input and returns the same native order when applied repeatedly', () => {
    const input = Object.freeze([feature('a', 'wood', 4), feature('z', 'bridge', 4)]);
    const ordered = paintOrder(input);
    expect(input.map((f) => f.id)).toEqual(['a', 'z']);
    expect(ordered).not.toBe(input);
    expect(ordered.map((f) => f.id)).toEqual(['z', 'a']);
    expect(paintOrder(ordered).map((f) => f.id)).toEqual(['z', 'a']);
  });
});
