import { describe, expect, it } from 'vitest';
import {
  assetIdentity,
  canonicalGeometry,
  canonicalRecipe,
  canonicalizeAsset,
  createReferenceAsset,
  DEFAULT_SETTINGS,
  importAsset,
  infeasible,
  MapValidationError,
  parseAsset,
  parseSettings,
  placeId,
  resolveOverrides,
  utf8Bytes,
  type MapAsset,
} from '../src/index.js';
import { rectangle } from '../src/fixtures/reference.js';

const altered = (edit: (a: MapAsset) => void) => {
  const a = createReferenceAsset();
  edit(a);
  return a;
};
const reject = (edit: (a: MapAsset) => void, path: RegExp) =>
  expect(() => parseAsset(altered(edit))).toThrow(path);

describe('local metre envelope and independent geometry', () => {
  it('round-trips a road through woods with a bridge, a building and a hole', () => {
    const a = parseAsset(createReferenceAsset()),
      b = importAsset(canonicalizeAsset(a));
    expect(canonicalizeAsset(b)).toBe(canonicalizeAsset(a));
    expect(b.elevation).toEqual(a.elevation);
    expect(b.layers.roads[0]!.path).toEqual(a.layers.roads[0]!.path);
    expect(b.coordinates).toMatchObject({
      xAxis: 'east',
      yAxis: 'south',
      zAxis: 'up',
      horizontalUnit: 'metre',
      reference: 'local-planar',
    });
    expect(b.layers.cover.find((c) => c.id === 'wood:0')!.polygons[0]!.holes).toHaveLength(1);
    expect(b.layers.roads[0]!.widthM).toBe(6);
    expect(b.layers.roads[0]!.surfaceWidthM).toBe(4);
    expect(b.layers.crossings[0]!.roadIds).toEqual(['road:0']);
    expect(b.layers.buildings[0]!.footprint).toEqual(rectangle(105, 65, 115, 75));
  });
  it('permits independent features/layers to overlap and an island component in a hole', () => {
    const a = altered((a) => {
      a.layers.cover.push({
        id: 'wood:overlap',
        kind: 'wood',
        polygons: [rectangle(90, 60, 130, 90)],
      });
      a.layers.cover[0]!.polygons.push(rectangle(82, 41, 88, 44));
    });
    expect(parseAsset(a).layers.cover).toHaveLength(3);
  });
  it('rejects unsupported units, versions, extra fields and non-finite values with paths', () => {
    const a = createReferenceAsset();
    expect(() => parseAsset({ ...a, schemaVersion: 2 })).toThrow(/schemaVersion.*Unsupported/);
    expect(() =>
      parseAsset({ ...a, coordinates: { ...a.coordinates, horizontalUnit: 'degrees' } }),
    ).toThrow(/coordinates.horizontalUnit/);
    expect(() => parseAsset({ ...a, generatedAt: 'today' })).toThrow(/Unrecognized/);
    reject((a) => {
      a.elevation.samples[3] = Infinity;
    }, /elevation.samples\[3\].*finite/);
    reject((a) => {
      a.layers.buildings[0]!.footprint.outer[0]![0] = NaN;
    }, /footprint.outer\[0\]\[0\].*finite/);
    reject((a) => {
      a.provenance.seed = 1.5;
    }, /provenance.seed/);
  });
  it.each([
    [
      'open ring',
      (a: MapAsset) => {
        a.layers.cover[0]!.polygons[0]!.outer.pop();
      },
    ],
    [
      'bowtie',
      (a: MapAsset) => {
        a.layers.cover[0]!.polygons = [
          {
            outer: [
              [20, 20],
              [80, 80],
              [20, 80],
              [80, 20],
              [20, 20],
            ],
            holes: [],
          },
        ];
      },
    ],
    [
      'zero edge',
      (a: MapAsset) => {
        a.layers.cover[0]!.polygons[0]!.outer.splice(1, 0, [20, 35]);
      },
    ],
    [
      'outside hole',
      (a: MapAsset) => {
        a.layers.cover[0]!.polygons[0]!.holes = [rectangle(130, 40, 140, 50).outer];
      },
    ],
    [
      'touching hole',
      (a: MapAsset) => {
        a.layers.cover[0]!.polygons[0]!.holes = [rectangle(20, 40, 30, 50).outer];
      },
    ],
    [
      'nested holes',
      (a: MapAsset) => {
        a.layers.cover[0]!.polygons[0]!.holes = [
          rectangle(30, 40, 60, 60).outer,
          rectangle(35, 45, 40, 50).outer,
        ];
      },
    ],
    [
      'crossing holes',
      (a: MapAsset) => {
        a.layers.cover[0]!.polygons[0]!.holes = [
          rectangle(30, 40, 60, 60).outer,
          rectangle(50, 50, 70, 70).outer,
        ];
      },
    ],
    [
      'overlapping components',
      (a: MapAsset) => {
        a.layers.cover[0]!.polygons.push(rectangle(30, 40, 60, 60));
      },
    ],
  ])('rejects %s independently of generation', (_, edit) => {
    expect(() => parseAsset(altered(edit))).toThrow(/layers.cover/);
  });
  it('rejects hidden concave escapes and holes covered by an occupied footprint', () => {
    reject((a) => {
      a.layers.sites[0]!.occupiedFootprint = rectangle(98, 60, 135, 95);
    }, /occupiedFootprint/);
    reject((a) => {
      a.layers.sites[0]!.placementArea.holes.push(rectangle(110, 80, 120, 85).outer);
    }, /occupiedFootprint/);
  });
});

describe('graph, complete reserved corridors and authoritative entrances', () => {
  it.each([
    [
      'wrong crossing kind',
      (a: MapAsset) => {
        Object.assign(a.layers.crossings[0]!, { kind: 'tunnel' });
      },
    ],
    [
      'orphan water',
      (a: MapAsset) => {
        a.layers.crossings[0]!.waterId = 'water:missing';
      },
    ],
    [
      'orphan road',
      (a: MapAsset) => {
        a.layers.crossings[0]!.roadIds = ['road:missing'];
      },
    ],
    [
      'non reciprocal',
      (a: MapAsset) => {
        a.layers.roads[0]!.crossingIds = [];
      },
    ],
    [
      'displaced span',
      (a: MapAsset) => {
        a.layers.crossings[0]!.endpoints = [
          [30, 52],
          [70, 52],
        ];
      },
    ],
    [
      'endpoint in water',
      (a: MapAsset) => {
        a.layers.crossings[0]!.endpoints[0] = [45, 50];
        a.layers.crossings[0]!.spanM = 25;
      },
    ],
    [
      'insufficient dry abutment',
      (a: MapAsset) => {
        a.layers.crossings[0]!.endpoints[0] = [36, 50];
        a.layers.crossings[0]!.spanM = 34;
      },
    ],
    [
      'partial water coverage',
      (a: MapAsset) => {
        a.layers.crossings[0]!.endpoints = [
          [20, 50],
          [39, 50],
        ];
        a.layers.crossings[0]!.spanM = 19;
      },
    ],
    [
      'undersized deck',
      (a: MapAsset) => {
        a.layers.crossings[0]!.deck = rectangle(29, 49, 71, 51);
      },
    ],
    [
      'narrow reserved crossing',
      (a: MapAsset) => {
        a.layers.crossings[0]!.widthM = 5;
      },
    ],
  ])('rejects %s', (_, edit) =>
    expect(() => parseAsset(altered(edit))).toThrow(/crossing|Crossing/),
  );
  it('detects a corridor intersecting water even when its centreline is dry', () => {
    const a = altered((a) => {
      a.layers.roads = [
        {
          id: 'road:bank',
          kind: 'track',
          fromNodeId: 'node:a',
          toNodeId: 'node:b',
          path: [
            [37, 20],
            [37, 120],
          ],
          widthM: 8,
          surfaceWidthM: 2,
          setbackM: 0,
          routeIds: [],
          crossingIds: [],
        },
      ];
      a.layers.roadNodes = [
        { id: 'node:a', kind: 'junction', position: [37, 20] },
        { id: 'node:b', kind: 'junction', position: [37, 120] },
      ];
      a.layers.crossings = [];
      a.layers.sites[0]!.entrances = [];
      a.layers.landmarks = [];
    });
    expect(() => parseAsset(a)).toThrow(/Reserved corridor.*complete linked crossing/);
  });
  it('accepts complete span split across two linked graph edges', () => {
    const a = altered((a) => {
      a.layers.roadNodes.push({ id: 'node:middle', kind: 'junction', position: [50, 50] });
      const road = a.layers.roads[0]!;
      a.layers.roads = [
        {
          ...road,
          toNodeId: 'node:middle',
          path: [
            [10, 50],
            [50, 50],
          ],
        },
        {
          ...road,
          id: 'road:1',
          fromNodeId: 'node:middle',
          path: [
            [50, 50],
            [100, 50],
          ],
        },
      ];
      a.layers.crossings[0]!.roadIds.push('road:1');
      a.layers.sites[0]!.entrances[0]!.roadId = 'road:1';
    });
    expect(parseAsset(a).layers.roads).toHaveLength(2);
  });
  it('rejects shifted nodes, entrances, bearings, missing routes and duplicate IDs', () => {
    reject((a) => {
      a.layers.roadNodes[0]!.position[0] += 1;
    }, /endpoints/);
    reject((a) => {
      a.layers.sites[0]!.entrances[0]!.endpoint[0] += 1;
    }, /Entrance endpoint/);
    reject((a) => {
      a.layers.sites[0]!.entrances[0]!.bearingDeg = 90;
    }, /bearingDeg/);
    reject((a) => {
      a.layers.sites[0]!.entrances[0]!.routeId = 'route:missing';
    }, /route provenance/);
    reject((a) => {
      a.layers.roads[0]!.id = 'wood:0';
    }, /Duplicate global ID/);
    reject((a) => {
      a.layers.buildings[0]!.siteId = 'site:missing';
    }, /Assigned residents|Orphan/);
  });
});

describe('bounded imports and settings', () => {
  it('checks byte caps including UTF-8 before JSON parsing', () => {
    expect(utf8Bytes('é🎲\ud800')).toBe(new TextEncoder().encode('é🎲\ud800').length);
    expect(() => importAsset('not JSON'.repeat(100), { maxBytes: 10 })).toThrow(/RESOURCE_LIMIT/);
    expect(() => importAsset('{oops')).toThrow(/INVALID_JSON/);
  });
  it('rejects aggregate feature/vertex/sample budgets before schema/topology cloning', () => {
    expect(() => parseAsset(createReferenceAsset(), { maxFeatures: 5 })).toThrow(/RESOURCE_LIMIT/);
    expect(() => parseAsset(createReferenceAsset(), { maxVertices: 10 })).toThrow(/RESOURCE_LIMIT/);
    expect(() => parseAsset(createReferenceAsset(), { maxSamples: 4 })).toThrow(/RESOURCE_LIMIT/);
    expect(() => parseAsset(createReferenceAsset(), { maxTopologyChecks: 1 })).toThrow(
      /Topology work/,
    );
    reject((a) => {
      a.settings.limits.maxFeatures = 1;
    }, /recipe cap/);
  });
  it('rejects oversized arrays before accessing their elements, accessors, cycles and sparse data', () => {
    const a = createReferenceAsset();
    let read = false;
    Object.defineProperty(a.elevation.samples, '0', {
      get() {
        read = true;
        throw new Error('must not execute');
      },
    });
    expect(() => parseAsset(a, { maxSamples: 4 })).toThrow(/Sample array cap/);
    expect(read).toBe(false);
    expect(() => parseAsset(a)).toThrow(/accessor arrays/);
    const b = createReferenceAsset();
    delete b.elevation.samples[1];
    expect(() => parseAsset(b)).toThrow(/Sparse/);
    const cyclic = { self: null as unknown };
    cyclic.self = cyclic;
    expect(() => parseAsset(cyclic)).toThrow(/Cyclic/);
  });
  it('rejects planning allocation and population/count/size budget violations', () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    s.roads.planningSpacingM = 0.001;
    expect(() => parseSettings(s)).toThrow(/planningSpacingM.*RESOURCE_LIMIT/);
    const max = structuredClone(DEFAULT_SETTINGS);
    max.widthM = max.heightM = 15_000;
    expect(parseSettings(max).widthM).toBe(15_000);
    const small = structuredClone(DEFAULT_SETTINGS);
    small.widthM = small.heightM = 5000;
    expect(parseSettings(small).widthM).toBe(5000);
    reject((a) => {
      a.settings.settlements.maxPopulation = 1;
    }, /population.*budget/);
    reject((a) => {
      a.settings.settlements.maxSites = 1;
      a.settings.settlements.farmCount = 1;
    }, /count budget/);
    reject((a) => {
      a.settings.roads.maxGlobalExpansions = 1;
    }, /Per-route budget/);
    reject((a) => {
      a.settings.settlements.villageSite.minAreaM2 = 9000;
    }, /site-size/);
  });
});

describe('canonical identity and recipe semantics', () => {
  it('sorts feature arrays/object keys but retains paths, rings, samples and override order', () => {
    const a = createReferenceAsset(),
      b = structuredClone(a);
    b.layers.cover.reverse();
    b.layers.roadNodes.reverse();
    expect(canonicalizeAsset(b)).toBe(canonicalizeAsset(a));
    const rotated = structuredClone(a),
      ring = rotated.layers.buildings[0]!.footprint.outer;
    ring.pop();
    ring.push(ring.shift()!);
    ring.push([...ring[0]!]);
    expect(canonicalGeometry(rotated)).not.toBe(canonicalGeometry(a));
  });
  it('keeps names out of geometry and regeneration recipe identity', async () => {
    const a = createReferenceAsset(),
      b = altered((a) => {
        a.name = 'Renamed map';
        a.layers.landmarks[0]!.name = 'Renamed crossing';
        a.overrides.push({ kind: 'rename', siteId: a.layers.sites[0]!.id, name: 'New village' });
        a.layers.sites[0]!.name = 'New village';
      });
    expect(await assetIdentity(b, 'geometry')).toBe(await assetIdentity(a, 'geometry'));
    expect(canonicalRecipe(b)).toBe(canonicalRecipe(a));
    expect(await assetIdentity(b, 'asset')).not.toBe(await assetIdentity(a, 'asset'));
  });
  it('version-binds precision, bounds quantization error and refuses topology collapse', () => {
    const a = createReferenceAsset(),
      b = altered((a) => {
        a.layers.buildings[0]!.footprint.outer[1]![0] += 0.00000049;
      });
    expect(canonicalGeometry(b)).toBe(canonicalGeometry(a));
    expect(() => parseAsset({ ...a, precisionPolicy: 'decimal-3-v2' })).toThrow(/precisionPolicy/);
    const thin = altered((a) => {
      a.layers.cover.push({
        id: 'thin:0',
        kind: 'open',
        polygons: [rectangle(10, 10, 10.0000004, 11)],
      });
    });
    expect(parseAsset(thin)).toBeTruthy();
    expect(() => canonicalizeAsset(thin)).toThrow(/Zero-length|zero area/);
  });
  it('resolves ordered overrides last-write-wins by kind and keeps stable place IDs', () => {
    const id = placeId('village', 0);
    expect(id).toBe('site:village:0000');
    const resolved = resolveOverrides(
      [
        { kind: 'rename', siteId: id, name: 'Old' },
        { kind: 'rename', siteId: id, name: 'New' },
        { kind: 'move-site', siteId: id, anchor: [110, 70] },
        { kind: 'move-site', siteId: id, anchor: [120, 75] },
      ],
      [id],
    );
    expect(resolved.names.get(id)).toBe('New');
    expect(resolved.anchors.get(id)).toEqual([120, 75]);
    expect(() =>
      resolveOverrides([{ kind: 'rename', siteId: 'site:missing', name: 'x' }], [id]),
    ).toThrow(/siteId/);
  });
  it('requires both source archive and consumed artifact checksums; reference-only claims no consumption', () => {
    const a = createReferenceAsset();
    expect(a.provenance.fork.usage).toBe('reference-only');
    expect(() =>
      parseAsset({
        ...a,
        provenance: { ...a.provenance, fork: { ...a.provenance.fork, usage: 'consumed' } },
      }),
    ).toThrow(/sourceArchive|package|sourceArchiveFormat/);
  });
  it('models expected infeasibility separately from programming errors', () => {
    expect(
      infeasible([
        {
          severity: 'error',
          stage: 'sites',
          code: 'NO_DRY_SITE',
          message: 'Requested site cannot fit.',
          remediation: 'Reduce site demand.',
        },
      ]),
    ).toMatchObject({ ok: false, kind: 'infeasible' });
    expect(() =>
      infeasible([{ severity: 'info', stage: 'sites', code: 'x', message: 'x' }]),
    ).toThrow(TypeError);
    expect(() => parseAsset({})).toThrow(MapValidationError);
  });
});
