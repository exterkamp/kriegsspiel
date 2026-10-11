import {
  COORDINATES,
  DEFAULT_SETTINGS,
  PRECISION_POLICY,
  type MapAsset,
  type Polygon,
} from '../contract.js';

export function rectangle(minX: number, minY: number, maxX: number, maxY: number): Polygon {
  return {
    outer: [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
      [minX, minY],
    ],
    holes: [],
  };
}
/** Hand-authored integration oracle, not a terrain/settlement generator. */
export function createReferenceAsset(): MapAsset {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.widthM = settings.heightM = 150;
  settings.settlements.villageCount = 1;
  settings.settlements.farmCount = 0;
  settings.settlements.villagePopulation = 4;
  settings.settlements.villageSite = {
    minAreaM2: 100,
    maxAreaM2: 10_000,
    minExtentM: 10,
    maxExtentM: 200,
  };
  const samples = Array.from(
    { length: 49 },
    (_, i) => 100 + 0.03 * (i % 7) * 25 - 0.07 * Math.floor(i / 7) * 25,
  );
  const wood = rectangle(20, 35, 120, 85);
  wood.holes.push(rectangle(80, 40, 90, 45).outer);
  return {
    schema: 'kriegsspiel/local-map',
    schemaVersion: 1,
    precisionPolicy: PRECISION_POLICY,
    coordinates: { ...COORDINATES },
    name: 'Reference valley',
    provenance: {
      seed: 7,
      generator: {
        id: 'kriegsspiel/maps',
        version: 'reference-fixture-v1',
        stages: {
          terrain: 'fixture-v1',
          contours: 'fixture-v1',
          hydrology: 'fixture-v1',
          cover: 'fixture-v1',
          roads: 'fixture-v1',
          settlements: 'fixture-v1',
        },
        randomPolicy: 'fnv1a-stage-v1',
        runtimePolicy: 'js-binary64-v1',
      },
      fork: {
        usage: 'reference-only',
        repository: 'https://github.com/dfezzie/settlemaker',
        commit: 'd5cf3590cf59e1d382110d25a6910f12507299e2',
        tree: 'ee7db196403a98c5a2ab2378fcaed7c757080250',
        license: 'GPL-3.0-only',
      },
    },
    settings,
    overrides: [],
    bounds: { minX: 0, minY: 0, maxX: 150, maxY: 150 },
    elevation: { columns: 7, rows: 7, spacingM: 25, samples },
    layers: {
      cover: [
        { id: 'wood:0', kind: 'wood', polygons: [wood] },
        { id: 'field:0', kind: 'field', polygons: [rectangle(110, 90, 145, 140)] },
      ],
      water: [
        {
          id: 'river:0',
          kind: 'river',
          polygons: [rectangle(40, 10, 60, 140)],
          centreline: [
            [50, 10],
            [50, 140],
          ],
          widthM: 20,
          surfacePolicy: 'carved-ground-v1',
          surfaceProfileM: [100.8, 91.7],
        },
      ],
      roadNodes: [
        { id: 'node:west', kind: 'junction', position: [10, 50] },
        { id: 'node:entrance', kind: 'junction', position: [100, 50] },
      ],
      roads: [
        {
          id: 'road:0',
          kind: 'regional',
          fromNodeId: 'node:west',
          toNodeId: 'node:entrance',
          path: [
            [10, 50],
            [100, 50],
          ],
          widthM: 6,
          surfaceWidthM: 4,
          setbackM: 2,
          routeIds: ['route:west'],
          crossingIds: ['bridge:0'],
        },
      ],
      crossings: [
        {
          id: 'bridge:0',
          kind: 'bridge',
          waterId: 'river:0',
          roadIds: ['road:0'],
          endpoints: [
            [30, 50],
            [70, 50],
          ],
          spanM: 40,
          widthM: 8,
          deck: rectangle(25, 45, 75, 55),
        },
      ],
      sites: [
        {
          id: 'site:village:0000',
          kind: 'village',
          name: 'Westbank',
          anchor: [120, 75],
          rotationDeg: 0,
          placementArea: rectangle(100, 40, 140, 100),
          occupiedFootprint: rectangle(102, 60, 135, 95),
          population: { requested: 4, assigned: 4, unassigned: 0 },
          entrances: [
            {
              id: 'entrance:west',
              routeId: 'route:west',
              roadId: 'road:0',
              nodeId: 'node:entrance',
              endpoint: [100, 50],
              widthM: 6,
              bearingDeg: 270,
            },
          ],
        },
      ],
      buildings: [
        {
          id: 'building:0',
          siteId: 'site:village:0000',
          kind: 'residential',
          footprint: rectangle(105, 65, 115, 75),
          capacity: 4,
          residents: 4,
        },
      ],
      landmarks: [
        {
          id: 'landmark:bridge',
          name: 'West crossing',
          kind: 'bridge',
          position: [50, 50],
          featureId: 'bridge:0',
        },
      ],
      contours: [],
    },
    diagnostics: [
      {
        severity: 'info',
        stage: 'validation',
        code: 'REFERENCE_FIXTURE',
        message: 'Hand-authored geometry; fork is referenced but not consumed.',
      },
    ],
  };
}
