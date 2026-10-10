// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createMarkGroup, markSignature, validateSceneMarks } from './marks.js';
import type { SceneMark, SceneMarkGeometry } from './types.js';

const map = { width: 4000, height: 3000 };
const mark = (geometry: SceneMarkGeometry, label = ''): SceneMark => ({
  id: 'local',
  label,
  geometry,
});
const shapes: SceneMarkGeometry[] = [
  { kind: 'pin', at: { x: 350.125, y: 250.875 } },
  {
    kind: 'polyline',
    points: [
      { x: 0, y: 0 },
      { x: 3100.125, y: 1200.875 },
      { x: 4000, y: 3000 },
    ],
  },
  {
    kind: 'arrow',
    points: [
      { x: 350.125, y: 250.875 },
      { x: 3100.125, y: 1200.875 },
    ],
  },
  { kind: 'ring', centre: { x: 2000, y: 1500 }, radiusM: 5000 },
  ...(['cross', 'dot', 'flag'] as const).map((symbol): SceneMarkGeometry => ({
    kind: 'symbol',
    symbol,
    at: { x: 4000, y: 3000 },
  })),
];
const groups: THREE.Group[] = [];
const make = (geometry: SceneMarkGeometry, label = '') => {
  const group = createMarkGroup(mark(geometry, label), map);
  groups.push(group);
  return group;
};
function vertices(group: THREE.Object3D): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  group.traverse((child) => {
    const attribute = (child as THREE.Mesh).geometry?.getAttribute('position');
    if (!attribute) return;
    for (let i = 0; i < attribute.count; i++)
      points.push({
        x: attribute.getX(i) + map.width / 2,
        y: attribute.getZ(i) + map.height / 2,
      });
  });
  return points;
}
function dispose(group: THREE.Group) {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as THREE.MeshBasicMaterial | undefined;
    material?.map?.dispose();
    material?.dispose();
  });
}
let fillText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fillText = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect: vi.fn(),
    fillText,
  } as unknown as CanvasRenderingContext2D);
});
afterEach(() => {
  groups.splice(0).forEach(dispose);
  vi.restoreAllMocks();
});

describe('strict render-only mark boundary', () => {
  it('accepts all five closed shapes, symbols, inclusive corners and exact metre decimals', () => {
    const input = shapes.map((geometry, i) => ({ ...mark(geometry), id: `mark-${i}` }));
    const parsed = validateSceneMarks(input, map);
    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(parsed[0]!.geometry).not.toBe(input[0]!.geometry);
    expect(markSignature(parsed[0]!, map)).not.toBe(
      markSignature(parsed[0]!, { ...map, width: 5000 }),
    );
    expect(
      validateSceneMarks(
        Array.from({ length: 200 }, (_, i) => ({
          ...mark(shapes[0]!, 'x'.repeat(256)),
          id: `mark-${i}`,
        })),
        map,
      ),
    ).toHaveLength(200);
  });

  const invalid: unknown[] = [
    null,
    [{ ...mark(shapes[0]!), scope: {} }],
    [{ ...mark(shapes[0]!), source: { kind: 'manual' } }],
    [{ ...mark(shapes[0]!), auth: true }],
    [mark(shapes[0]!), mark(shapes[1]!)],
    [{ ...mark(shapes[0]!), id: '' }],
    [{ ...mark(shapes[0]!), id: 'x'.repeat(129) }],
    [mark(shapes[0]!, 'x'.repeat(257))],
    [mark({ kind: 'pin', at: { x: -1e-6, y: 0 } })],
    [mark({ kind: 'pin', at: { x: 4000.000001, y: 0 } })],
    [mark({ kind: 'pin', at: { x: 0, y: 3000.000001 } })],
    [mark({ kind: 'pin', at: { x: NaN, y: 0 } })],
    [mark({ kind: 'pin', at: { x: 0, y: Infinity } })],
    [{ ...mark(shapes[0]!), geometry: { kind: 'pin', at: { x: 0, y: 0, hidden: true } } }],
    [{ ...mark(shapes[0]!), geometry: { kind: 'pin', at: { x: 0, y: 0 }, radiusM: 2 } }],
    [mark({ kind: 'polyline', points: [{ x: 0, y: 0 }] })],
    [mark({ kind: 'arrow', points: Array.from({ length: 257 }, () => ({ x: 0, y: 0 })) })],
    [mark({ kind: 'ring', centre: { x: 0, y: 0 }, radiusM: 0 })],
    [mark({ kind: 'ring', centre: { x: 0, y: 0 }, radiusM: 5000.000001 })],
    [{ ...mark(shapes[0]!), geometry: { kind: 'symbol', at: { x: 0, y: 0 }, symbol: 'enemy' } }],
    [{ ...mark(shapes[0]!), geometry: { kind: 'polygon', points: [] } }],
    Array.from({ length: 201 }, (_, i) => ({ ...mark(shapes[0]!), id: `mark-${i}` })),
  ];
  it.each(invalid.map((candidate, i) => [i, candidate]))(
    'rejects malformed/over-limit candidate %i',
    (_, candidate) => {
      expect(() => validateSceneMarks(candidate, map)).toThrow(RangeError);
    },
  );
  it('rejects invalid extents and accepts maximum polyline/arrow point counts', () => {
    for (const width of [0, -1, NaN, Infinity])
      expect(() => validateSceneMarks([], { ...map, width })).toThrow(RangeError);
    for (const kind of ['polyline', 'arrow'] as const)
      expect(
        validateSceneMarks(
          [mark({ kind, points: Array.from({ length: 256 }, () => ({ x: 0, y: 0 })) })],
          map,
        ),
      ).toHaveLength(1);
  });
});

describe('clipped metre ink and plain labels', () => {
  it('renders the exact continuous polyline points without a grid conversion', () => {
    const group = make(shapes[1]!);
    expect(vertices(group)).toEqual([
      { x: 0, y: 0 },
      { x: 3100.125, y: 1200.875 },
      { x: 3100.125, y: 1200.875 },
      { x: 4000, y: 3000 },
    ]);
  });
  it.each([
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 0, y: 3000 },
    { x: 4000, y: 3000 },
  ])('clips edge rings, heads, pin and every symbol at $x,$y including label quads', (at) => {
    const geometries: SceneMarkGeometry[] = [
      { kind: 'pin', at },
      { kind: 'ring', centre: at, radiusM: 100 },
      { kind: 'arrow', points: [{ x: 2000, y: at.y }, at] },
      ...(['cross', 'dot', 'flag'] as const).map((symbol): SceneMarkGeometry => ({
        kind: 'symbol',
        at,
        symbol,
      })),
    ];
    for (const geometry of geometries) {
      const original = structuredClone(geometry);
      const group = make(geometry, 'Edge label');
      const points = vertices(group);
      expect(points.length).toBeGreaterThan(0);
      for (const point of points) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(4000);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(3000);
      }
      expect(geometry).toEqual(original);
    }
  });
  it('clips crossing ring arcs as independent segments without a border shortcut', () => {
    const points = vertices(make({ kind: 'ring', centre: { x: 0, y: 0 }, radiusM: 100 }));
    expect(points.length).toBeGreaterThan(40);
    for (const point of points) expect(Math.hypot(point.x, point.y)).toBeCloseTo(100, 2);
    expect(Math.max(...points.map((p) => p.x))).toBe(100);
    expect(Math.max(...points.map((p) => p.y))).toBe(100);
  });
  it.each([
    [
      { x: 0, y: 1500 },
      { x: 4000, y: 1500 },
    ],
    [
      { x: 2000, y: 0 },
      { x: 2000, y: 3000 },
    ],
    [
      { x: 4000, y: 3000 },
      { x: 0, y: 0 },
    ],
  ])('points the clipped head along the last nonzero arrow leg', (...points) => {
    const start = points[0]!;
    const end = points[1]!;
    const output = vertices(make({ kind: 'arrow', points: [start, end, end] }));
    const heads = output.slice(-4);
    for (const index of [0, 2]) {
      expect(heads[index]).toEqual(end);
      const wing = heads[index + 1]!;
      expect(
        (end.x - wing.x) * (end.x - start.x) + (end.y - wing.y) * (end.y - start.y),
      ).toBeGreaterThan(0);
    }
  });
  it('handles degenerate arrows without a fabricated direction or nonfinite geometry', () => {
    const at = { x: 3100.125, y: 1200.875 };
    expect(vertices(make({ kind: 'arrow', points: [at, at] }))).toEqual([at, at]);
  });
  it('draws markup as literal canvas text and leaves the document untouched', () => {
    const label = '<img src=x onerror=alert(1)> & <b>local</b>';
    const before = document.body.innerHTML;
    const group = make(shapes[0]!, label);
    expect(fillText).toHaveBeenCalledWith(label, 256, 48, 488);
    expect(document.body.innerHTML).toBe(before);
    const mesh = group.getObjectByName('mark-label') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >;
    expect(mesh.material.map).toBeInstanceOf(THREE.CanvasTexture);
    expect(mesh.geometry.getAttribute('uv').count).toBe(6);
    expect(group.getObjectByName('pick')).toBeUndefined();
    expect(group.userData).toEqual({ markId: 'local' });
  });
  it('bounds labels even on a narrow non-square map', () => {
    const extent = { width: 10, height: 3000 };
    const group = createMarkGroup(mark({ kind: 'pin', at: { x: 10, y: 3000 } }, 'Narrow'), extent);
    groups.push(group);
    const bounds = new THREE.Box3().setFromObject(group);
    expect(bounds.min.x).toBeGreaterThanOrEqual(-5);
    expect(bounds.max.x).toBeLessThanOrEqual(5);
    expect(bounds.min.z).toBeGreaterThanOrEqual(-1500);
    expect(bounds.max.z).toBeLessThanOrEqual(1500);
  });
  it('cleans attached ink after a label canvas failure', () => {
    const geometry = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const material = vi.spyOn(THREE.Material.prototype, 'dispose');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(() => createMarkGroup(mark(shapes[0]!, 'Needs canvas'), map)).toThrow('canvas');
    expect(geometry).toHaveBeenCalledTimes(1);
    expect(material).toHaveBeenCalledTimes(1);
  });
  it('cleans texture and detached geometry if label attribute allocation fails', () => {
    const geometries = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const materials = vi.spyOn(THREE.Material.prototype, 'dispose');
    const textures = vi.spyOn(THREE.Texture.prototype, 'dispose');
    const setAttribute = THREE.BufferGeometry.prototype.setAttribute;
    vi.spyOn(THREE.BufferGeometry.prototype, 'setAttribute').mockImplementation(function (
      this: THREE.BufferGeometry,
      name,
      value,
    ) {
      if (name === 'uv') throw new Error('Attribute allocation failed');
      return setAttribute.call(this, name, value);
    });
    expect(() => createMarkGroup(mark(shapes[0]!, 'Allocated texture'), map)).toThrow(
      'Attribute allocation failed',
    );
    expect(geometries).toHaveBeenCalledTimes(2);
    expect(materials).toHaveBeenCalledTimes(1);
    expect(textures).toHaveBeenCalledTimes(1);
    expect(new Set(geometries.mock.instances).size).toBe(2);
  });
});
