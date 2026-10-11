import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;
export const PRECISION_POLICY = 'decimal-6-v1' as const;
export const COORDINATES = Object.freeze({
  reference: 'local-planar',
  horizontalUnit: 'metre',
  verticalUnit: 'metre',
  xAxis: 'east',
  yAxis: 'south',
  zAxis: 'up',
  origin: 'north-west',
  verticalDatum: 'local-zero',
} as const);

export const HARD_LIMITS = Object.freeze({
  maxBytes: 64 * 1024 * 1024,
  maxSamples: 400_000,
  maxSampleValues: 1_600_000,
  maxFeatures: 50_000,
  maxVertices: 1_000_000,
  maxRingVertices: 2048,
  maxTopologyChecks: 5_000_000,
  maxDepth: 32,
  maxNodes: 6_000_000,
} as const);
export type ImportLimits = { -readonly [K in keyof typeof HARD_LIMITS]: number };
const finite = z.number().finite();
const coordinate = finite.min(-100_000).max(100_000);
const positive = finite.positive();
const count = (max: number) => z.number().int().min(0).max(max);
const version = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._+-]+$/);
export const IdSchema = z.string().regex(/^[a-z][a-z0-9:_-]{0,95}$/);
export const PointSchema = z.tuple([coordinate, coordinate]);
export type Point = z.infer<typeof PointSchema>;
export const BoundsSchema = z.strictObject({
  minX: z.literal(0),
  minY: z.literal(0),
  maxX: positive.max(15_000),
  maxY: positive.max(15_000),
});
export type Bounds = z.infer<typeof BoundsSchema>;
export const RingSchema = z.array(PointSchema).min(4).max(HARD_LIMITS.maxRingVertices);
export const PolygonSchema = z.strictObject({
  outer: RingSchema,
  holes: z.array(RingSchema).max(64),
});
export type Polygon = z.infer<typeof PolygonSchema>;
export const MultiPolygonSchema = z.array(PolygonSchema).min(1).max(2048);
export const PathSchema = z.array(PointSchema).min(2).max(HARD_LIMITS.maxVertices);
export const ElevationSchema = z.strictObject({
  columns: z.number().int().min(2).max(HARD_LIMITS.maxSamples),
  rows: z.number().int().min(2).max(HARD_LIMITS.maxSamples),
  spacingM: positive.min(0.001).max(15_000),
  samples: z.array(coordinate).max(HARD_LIMITS.maxSamples),
});
export type Elevation = z.infer<typeof ElevationSchema>;
export const SettingsSchema = z.strictObject({
  widthM: positive.min(25).max(15_000),
  heightM: positive.min(25).max(15_000),
  sampleSpacingM: positive.min(0.001).max(15_000),
  geometry: z.strictObject({
    coordinateToleranceM: positive.min(0.000001).max(0.01),
    joinToleranceM: positive.min(0.000001).max(0.1),
    corridorPolicy: z.literal('round-caps-joins-clipped-exits-v1'),
  }),
  terrain: z.strictObject({
    baseHeightM: coordinate,
    reliefM: finite.min(0).max(10_000),
    roughness: finite.min(0).max(1),
    octaves: z.number().int().min(1).max(12),
    featureScaleM: positive.max(30_000),
    ridgeStrength: finite.min(0).max(1),
    valleyStrength: finite.min(0).max(1),
  }),
  contours: z.strictObject({
    minorIntervalM: positive.max(10_000),
    indexIntervalM: positive.max(50_000),
    verticalToleranceM: positive.max(1),
    saddlePolicy: z.literal('bilinear-asymptotic-v1'),
    exactLevelPolicy: z.literal('symbolic-positive-v1'),
    maxLevels: z.number().int().min(1).max(1024),
    maxCellLevelWork: z.number().int().min(1).max(100_000_000),
    maxRefinementWork: z.number().int().min(1).max(10_000_000),
    maxVertices: z.number().int().min(1).max(HARD_LIMITS.maxVertices),
  }),
  hydrology: z.strictObject({
    riverThresholdSamples: z.number().int().min(1).max(HARD_LIMITS.maxSamples),
    minRiverWidthM: positive.max(100),
    maxRiverWidthM: positive.max(1000),
    lakePolicy: z.literal('outlet-or-lake-v1'),
    requireRiver: z.boolean(),
  }),
  cover: z.strictObject({
    woodFraction: finite.min(0).max(1),
    fieldFraction: finite.min(0).max(1),
    coherenceM: positive.max(15_000),
  }),
  roads: z.strictObject({
    maxGrade: positive.max(1),
    maxReservedWidthM: positive.max(100),
    planningSpacingM: positive.max(1000),
    maxPlanningCells: z.number().int().min(4).max(400_000),
    maxExpansionsPerRoute: z.number().int().min(1).max(10_000_000),
    maxGlobalExpansions: z.number().int().min(1).max(100_000_000),
    extraLinks: count(256),
    maxCrossingSpanM: positive.max(1000),
    minimumAbutmentM: positive.max(100),
  }),
  settlements: z.strictObject({
    villageCount: count(32),
    farmCount: count(64),
    villagePopulation: z.number().int().min(1).max(10_000),
    farmPopulation: z.number().int().min(1).max(100),
    maxPopulation: z.number().int().min(1).max(400_000),
    maxSites: z.number().int().min(1).max(96),
    minSpacingM: positive.max(15_000),
    maxBuildingGradient: positive.max(1),
    maxAttemptsPerSite: z.number().int().min(1).max(32),
    maxGlobalPlacementAttempts: z.number().int().min(1).max(3072),
    maxReconciliationPasses: z.number().int().min(1).max(16),
    maxGlobalReconciliationWork: z.number().int().min(1).max(10_000_000),
    villageSite: z.strictObject({
      minAreaM2: positive.max(1_000_000),
      maxAreaM2: positive.max(1_000_000),
      minExtentM: positive.max(2000),
      maxExtentM: positive.max(2000),
    }),
    farmSite: z.strictObject({
      minAreaM2: positive.max(1_000_000),
      maxAreaM2: positive.max(1_000_000),
      minExtentM: positive.max(2000),
      maxExtentM: positive.max(2000),
    }),
  }),
  limits: z.strictObject({
    maxSamples: z.number().int().min(4).max(HARD_LIMITS.maxSamples),
    maxFeatures: z.number().int().min(1).max(HARD_LIMITS.maxFeatures),
    maxVertices: z.number().int().min(1).max(HARD_LIMITS.maxVertices),
    maxTopologyChecks: z.number().int().min(1).max(HARD_LIMITS.maxTopologyChecks),
  }),
});
export type MapSettings = z.infer<typeof SettingsSchema>;
function deepFreeze<T extends object>(value: T): T {
  for (const child of Object.values(value))
    if (child && typeof child === 'object') deepFreeze(child);
  return Object.freeze(value);
}
/** Contract parsing is not physical/composition certification (#136/#139). */
export const VALIDATION_SCOPE = 'contract-only-v1' as const;
export const DEFAULT_SETTINGS: MapSettings = deepFreeze({
  widthM: 10_000,
  heightM: 10_000,
  sampleSpacingM: 25,
  geometry: {
    coordinateToleranceM: 0.001,
    joinToleranceM: 0.01,
    corridorPolicy: 'round-caps-joins-clipped-exits-v1',
  },
  terrain: {
    baseHeightM: 100,
    reliefM: 100,
    roughness: 0.5,
    octaves: 4,
    featureScaleM: 2000,
    ridgeStrength: 0.3,
    valleyStrength: 0.3,
  },
  contours: {
    minorIntervalM: 10,
    indexIntervalM: 50,
    verticalToleranceM: 0.05,
    saddlePolicy: 'bilinear-asymptotic-v1',
    exactLevelPolicy: 'symbolic-positive-v1',
    maxLevels: 256,
    maxCellLevelWork: 10_000_000,
    maxRefinementWork: 200_000,
    maxVertices: 200_000,
  },
  hydrology: {
    riverThresholdSamples: 1000,
    minRiverWidthM: 4,
    maxRiverWidthM: 40,
    lakePolicy: 'outlet-or-lake-v1',
    requireRiver: false,
  },
  cover: { woodFraction: 0.3, fieldFraction: 0.4, coherenceM: 300 },
  roads: {
    maxGrade: 0.1,
    maxReservedWidthM: 12,
    planningSpacingM: 25,
    maxPlanningCells: 400_000,
    maxExpansionsPerRoute: 1_000_000,
    maxGlobalExpansions: 5_000_000,
    extraLinks: 4,
    maxCrossingSpanM: 100,
    minimumAbutmentM: 3,
  },
  settlements: {
    villageCount: 4,
    farmCount: 6,
    villagePopulation: 300,
    farmPopulation: 12,
    maxPopulation: 100_000,
    maxSites: 96,
    minSpacingM: 750,
    maxBuildingGradient: 0.08,
    maxAttemptsPerSite: 8,
    maxGlobalPlacementAttempts: 256,
    maxReconciliationPasses: 4,
    maxGlobalReconciliationWork: 500_000,
    villageSite: { minAreaM2: 10_000, maxAreaM2: 250_000, minExtentM: 100, maxExtentM: 800 },
    farmSite: { minAreaM2: 400, maxAreaM2: 10_000, minExtentM: 20, maxExtentM: 200 },
  },
  limits: {
    maxSamples: HARD_LIMITS.maxSamples,
    maxFeatures: HARD_LIMITS.maxFeatures,
    maxVertices: HARD_LIMITS.maxVertices,
    maxTopologyChecks: HARD_LIMITS.maxTopologyChecks,
  },
});
export const DiagnosticSchema = z.strictObject({
  severity: z.enum(['info', 'warning', 'error']),
  stage: z.enum([
    'import',
    'terrain',
    'contours',
    'hydrology',
    'cover',
    'sites',
    'roads',
    'settlements',
    'validation',
    'export',
  ]),
  code: z.string().min(1).max(96),
  message: z.string().min(1).max(512),
  featureId: IdSchema.optional(),
  location: PointSchema.optional(),
  constraint: z.string().max(96).optional(),
  remediation: z.string().max(512).optional(),
  path: z.string().max(512).optional(),
});
export type Diagnostic = z.infer<typeof DiagnosticSchema>;
const ids = z.array(IdSchema).max(HARD_LIMITS.maxFeatures);
const CoverSchema = z.strictObject({
  id: IdSchema,
  kind: z.enum(['wood', 'field', 'open']),
  polygons: MultiPolygonSchema,
});
const WaterSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    id: IdSchema,
    kind: z.literal('river'),
    polygons: MultiPolygonSchema,
    centreline: PathSchema,
    widthM: positive.max(1000),
    surfacePolicy: z.enum(['carved-ground-v1', 'standing-water-v1']),
    surfaceProfileM: z.array(coordinate).min(2).max(HARD_LIMITS.maxVertices),
  }),
  z.strictObject({
    id: IdSchema,
    kind: z.literal('lake'),
    polygons: MultiPolygonSchema,
    surfaceElevationM: coordinate,
  }),
]);
const RoadNodeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ id: IdSchema, kind: z.literal('junction'), position: PointSchema }),
  z.strictObject({
    id: IdSchema,
    kind: z.literal('boundary-exit'),
    side: z.enum(['north', 'east', 'south', 'west']),
    position: PointSchema,
  }),
]);
const RoadSchema = z.strictObject({
  id: IdSchema,
  kind: z.enum(['regional', 'street', 'track']),
  fromNodeId: IdSchema,
  toNodeId: IdSchema,
  path: PathSchema,
  widthM: positive.max(100),
  surfaceWidthM: positive.max(100),
  setbackM: finite.min(0).max(100),
  routeIds: ids,
  crossingIds: ids,
  siteId: IdSchema.optional(),
});
const CrossingBase = {
  id: IdSchema,
  waterId: IdSchema,
  roadIds: ids.min(1),
  endpoints: z.tuple([PointSchema, PointSchema]),
  spanM: positive.max(1000),
  widthM: positive.max(100),
  deck: PolygonSchema,
};
const CrossingSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...CrossingBase, kind: z.literal('bridge') }),
  z.strictObject({
    ...CrossingBase,
    kind: z.literal('ford'),
    depthM: finite.min(0).max(2),
    traversableWidthM: positive.max(100),
  }),
]);
const EntranceSchema = z.strictObject({
  id: IdSchema,
  routeId: IdSchema,
  roadId: IdSchema,
  nodeId: IdSchema,
  endpoint: PointSchema,
  widthM: positive.max(100),
  bearingDeg: finite.min(0).lt(360),
  crossingId: IdSchema.optional(),
});
export const SiteSchema = z.strictObject({
  id: IdSchema,
  kind: z.enum(['village', 'farm']),
  name: z.string().min(1).max(128),
  anchor: PointSchema,
  rotationDeg: finite.min(0).lt(360),
  placementArea: PolygonSchema,
  occupiedFootprint: PolygonSchema.nullable(),
  population: z.strictObject({
    requested: count(10_000),
    assigned: count(10_000),
    unassigned: count(10_000),
  }),
  entrances: z.array(EntranceSchema).max(32),
});
const BuildingSchema = z.strictObject({
  id: IdSchema,
  siteId: IdSchema,
  kind: z.enum(['residential', 'civic', 'agricultural']),
  footprint: PolygonSchema,
  capacity: count(10_000),
  residents: count(10_000),
});
const LandmarkSchema = z.strictObject({
  id: IdSchema,
  name: z.string().min(1).max(128),
  kind: z.enum(['hill', 'bridge', 'settlement', 'custom']),
  position: PointSchema,
  featureId: IdSchema.optional(),
});
const ContourSchema = z.strictObject({
  id: IdSchema,
  elevationM: coordinate,
  index: z.boolean(),
  path: PathSchema,
});
export const OverrideSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('rename'), siteId: IdSchema, name: z.string().min(1).max(128) }),
  z.strictObject({ kind: z.literal('move-site'), siteId: IdSchema, anchor: PointSchema }),
  z.strictObject({ kind: z.literal('exclude-sites'), id: IdSchema, polygon: PolygonSchema }),
]);
export type MapOverride = z.infer<typeof OverrideSchema>;
const ForkBase = {
  repository: z.string().url().max(256),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  tree: z.string().regex(/^[0-9a-f]{40}$/),
  license: z.literal('GPL-3.0-only'),
};
export const ForkProvenanceSchema = z.discriminatedUnion('usage', [
  z.strictObject({ ...ForkBase, usage: z.literal('reference-only') }),
  z.strictObject({
    ...ForkBase,
    usage: z.literal('consumed'),
    sourceArchiveFormat: z.enum(['tar', 'tar.gz']),
    sourceArchiveSha256: z.string().regex(/^[0-9a-f]{64}$/),
    packageSha256: z.string().regex(/^[0-9a-f]{64}$/),
    packageIntegrity: z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/),
  }),
]);
export const AssetSchema = z.strictObject({
  schema: z.literal('kriegsspiel/local-map'),
  schemaVersion: z.literal(SCHEMA_VERSION),
  precisionPolicy: z.literal(PRECISION_POLICY),
  coordinates: z.strictObject({
    reference: z.literal(COORDINATES.reference),
    horizontalUnit: z.literal(COORDINATES.horizontalUnit),
    verticalUnit: z.literal(COORDINATES.verticalUnit),
    xAxis: z.literal(COORDINATES.xAxis),
    yAxis: z.literal(COORDINATES.yAxis),
    zAxis: z.literal(COORDINATES.zAxis),
    origin: z.literal(COORDINATES.origin),
    verticalDatum: z.literal(COORDINATES.verticalDatum),
  }),
  name: z.string().min(1).max(128),
  provenance: z.strictObject({
    seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    generator: z.strictObject({
      id: z.literal('kriegsspiel/maps'),
      version,
      stages: z.strictObject({
        terrain: version,
        contours: version,
        hydrology: version,
        cover: version,
        roads: version,
        settlements: version,
      }),
      randomPolicy: z.literal('fnv1a-stage-v1'),
      runtimePolicy: z.literal('js-binary64-v1'),
    }),
    fork: ForkProvenanceSchema,
  }),
  settings: SettingsSchema,
  overrides: z.array(OverrideSchema).max(256),
  bounds: BoundsSchema,
  elevation: ElevationSchema,
  drainage: z
    .strictObject({
      policy: z.literal('filled-ground-d8-v1'),
      filledSamples: z.array(coordinate).max(HARD_LIMITS.maxSamples),
      downstream: z
        .array(
          z
            .number()
            .int()
            .min(-1)
            .max(HARD_LIMITS.maxSamples - 1),
        )
        .max(HARD_LIMITS.maxSamples),
      accumulation: z
        .array(z.number().int().min(1).max(HARD_LIMITS.maxSamples))
        .max(HARD_LIMITS.maxSamples),
      outlets: z
        .array(
          z
            .number()
            .int()
            .min(0)
            .max(HARD_LIMITS.maxSamples - 1),
        )
        .max(HARD_LIMITS.maxSamples),
      sinks: z
        .array(
          z.strictObject({
            sampleIndex: z
              .number()
              .int()
              .min(0)
              .max(HARD_LIMITS.maxSamples - 1),
            waterId: IdSchema,
          }),
        )
        .max(HARD_LIMITS.maxFeatures),
    })
    .optional(),
  layers: z.strictObject({
    cover: z.array(CoverSchema),
    water: z.array(WaterSchema),
    roadNodes: z.array(RoadNodeSchema),
    roads: z.array(RoadSchema),
    crossings: z.array(CrossingSchema),
    sites: z.array(SiteSchema),
    buildings: z.array(BuildingSchema),
    landmarks: z.array(LandmarkSchema),
    contours: z.array(ContourSchema),
  }),
  diagnostics: z.array(DiagnosticSchema).max(1024),
});
export type MapAsset = z.infer<typeof AssetSchema>;
export type Road = MapAsset['layers']['roads'][number];
export type Crossing = MapAsset['layers']['crossings'][number];
export type Site = MapAsset['layers']['sites'][number];
export type Entrance = Site['entrances'][number];
export type Water = MapAsset['layers']['water'][number];
export type MapLayers = MapAsset['layers'];
export type Cover = MapLayers['cover'][number];
export type RoadNode = MapLayers['roadNodes'][number];
export type Building = MapLayers['buildings'][number];
export type Landmark = MapLayers['landmarks'][number];
export type Contour = MapLayers['contours'][number];
export type Drainage = NonNullable<MapAsset['drainage']>;
export type TerrainOutput = { elevation: Elevation; contours: Contour[] };
export type HydrologyOutput = { elevation: Elevation; water: Water[]; drainage: Drainage };
export type PlanningOutput = Pick<MapLayers, 'roadNodes' | 'roads' | 'crossings' | 'sites'>;
export type GenerationResult<T> =
  | { ok: true; value: T; diagnostics: Diagnostic[] }
  | { ok: false; kind: 'infeasible'; diagnostics: Diagnostic[] };
export function infeasible(diagnostics: Diagnostic[]): GenerationResult<never> {
  const parsed = z.array(DiagnosticSchema).min(1).max(1024).parse(diagnostics);
  if (!parsed.some((d) => d.severity === 'error'))
    throw new TypeError('Infeasibility requires at least one error diagnostic');
  return { ok: false, kind: 'infeasible', diagnostics: parsed };
}
