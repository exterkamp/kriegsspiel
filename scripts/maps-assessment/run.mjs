import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import {
  corridorPieces,
  multiPolygonArea,
  planeGrade,
  pointSegmentDistance,
  toWorld,
  toLocal,
} from './geometry.mjs';

const [entrypoint, reportPath] = process.argv.slice(2);
if (!entrypoint || !reportPath)
  throw new Error('Usage: node run.mjs <pristine-dist/index.js> <report.json>');
const entry = resolve(entrypoint);
const provenance = JSON.parse(readFileSync(join(dirname(entry), 'assessment-provenance.json')));
assert.equal(provenance.revision, 'd5cf3590cf59e1d382110d25a6910f12507299e2');
const sm = await import(pathToFileURL(entry));
const clipping = createRequire(entry)('polygon-clipping');
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonical = (geo) => {
  const copy = structuredClone(geo);
  delete copy.metadata.generated_at;
  return copy;
};
const water = [
  [45, -3000],
  [3000, -3000],
  [3000, 3000],
  [45, 3000],
];
const exclusion = [
  [-70, -30],
  [-20, -30],
  [-20, 60],
  [-70, 60],
];
const gradient = [0.12, 0.05]; // 13% exact everywhere, independent of footprint orientation.
const approaches = [
  { id: 'north', at: [137, -241] },
  { id: 'south-east', at: [211, 173] },
  { id: 'west', at: [-263, 41] },
].map((a) => ({ ...a, bearing: ((Math.atan2(a.at[0], -a.at[1]) * 180) / Math.PI + 360) % 360 }));
const base = {
  name: 'Architecture fixture',
  population: 300,
  biome: 'temperate',
  port: false,
  citadel: false,
  walls: false,
  plaza: true,
  temple: false,
  shanty: false,
  capital: false,
  roadBearings: approaches.map((a) => ({ bearing_deg: a.bearing, kind: 'main', route_id: a.id })),
};
const measured = {
  version: 1,
  status: 'measured',
  coordinateSpace: 'burg-local-metres',
  surveyRadiusM: 6000,
  geometryErrorM: 0,
  bodies: [
    { kind: 'lake', featureId: 'east-water', distanceM: 45, bearingDeg: 90, polygonIndices: [0] },
  ],
};
const candidates = ['physical-village', 'physical-city', 'legacy-village', 'legacy-city'];

function generate(candidate, input, seed) {
  if (candidate.startsWith('physical')) {
    const model = sm.createSettlementModel(input, {
      seed,
      development: { preset: candidate.slice(9) },
    });
    return { model, geojson: sm.exportSettlement(model), work: 'model + local export (no SVG)' };
  }
  if (candidate === 'legacy-village') {
    const model = sm.generateVillage({ ...input, engine: 'village' }, seed);
    return {
      model,
      geojson: sm.generateVillageGeoJson(model),
      work: 'model + local export (no SVG)',
    };
  }
  return {
    ...sm.generateFromBurg(
      { ...input, engine: 'city' },
      { seed, geojson: { generatedAt: '2000-01-01T00:00:00.000Z' } },
    ),
    work: 'public generateFromBurg including SVG + local export',
  };
}

function metricGeometry(geo) {
  const scale = geo.metadata.scale.meters_per_unit;
  const features = geo.features;
  return {
    buildings: features
      .filter((f) => f.properties.layer === 'building')
      .map((f) => ({
        id: f.id ?? f.properties.building_id,
        polygon: f.geometry.coordinates.map((r) => r.map((p) => p.map((v) => v * scale))),
      })),
    roads: features
      .filter((f) => f.properties.layer === 'street' && f.geometry.type === 'LineString')
      .map((f) => ({
        id: f.id ?? f.properties.street_id,
        routes: f.properties.route_ids ?? [],
        widthM: f.properties.width_m ?? (f.properties.width ?? 0) * scale,
        path: f.geometry.coordinates.map((p) => p.map((v) => v * scale)),
      })),
  };
}

function diagnostics(geo, constrained) {
  const { buildings, roads } = metricGeometry(geo);
  const overlap = (b, ring) => multiPolygonArea(clipping.intersection(b.polygon, [ring]));
  const waterHits = constrained ? buildings.filter((b) => overlap(b, water) > 1e-6) : [];
  const exclusionHits = constrained ? buildings.filter((b) => overlap(b, exclusion) > 1e-6) : [];
  const corridorHit = (r, region) =>
    corridorPieces(r.path, r.widthM).some(
      (piece) => multiPolygonArea(clipping.intersection(piece, [region])) > 1e-6,
    );
  const roadWaterHits = constrained ? roads.filter((r) => corridorHit(r, water)) : [];
  const roadExclusionHits = constrained ? roads.filter((r) => corridorHit(r, exclusion)) : [];
  const steep = [];
  let segments = 0,
    maxGrade = 0;
  for (const road of roads)
    for (let i = 1; i < road.path.length; i++) {
      const grade = planeGrade(road.path[i - 1], road.path[i], constrained ? gradient : [0, 0]);
      segments++;
      maxGrade = Math.max(maxGrade, grade);
      if (grade > 0.1 + 1e-10) steep.push(`${road.id}:${i - 1}`);
    }
  const routeJoins = approaches.map((a) => {
    // Only route-provenance matches count as an authoritative candidate join.
    const matched = roads.filter((r) => r.routes.includes(a.id));
    const paths = matched.flatMap((r) =>
      r.path.slice(1).map((p, i) => pointSegmentDistance(a.at, r.path[i], p)),
    );
    const ends = matched
      .flatMap((r) => [r.path[0], r.path.at(-1)])
      .map((p) => Math.hypot(p[0] - a.at[0], p[1] - a.at[1]));
    return {
      id: a.id,
      matchingStreets: matched.length,
      nearestPathM: paths.length ? Math.min(...paths) : null,
      nearestEndpointM: ends.length ? Math.min(...ends) : null,
    };
  });
  return {
    buildings: buildings.length,
    streets: roads.length,
    roadSegments: segments,
    buildingWaterOverlap: waterHits.length,
    buildingExclusionOverlap: exclusionHits.length,
    streetCorridorWaterOverlap: roadWaterHits.length,
    streetCorridorExclusionOverlap: roadExclusionHits.length,
    streetsWithUnknownWidth: roads.filter((r) => r.widthM <= 0).length,
    crossingFeatures: geo.features.filter((f) =>
      ['bridge', 'crossing'].includes(f.properties.layer),
    ).length,
    buildingsOutsideSiteBounds: buildings.filter((b) =>
      b.polygon.flat().some(([x, y]) => x < -500 || y < -500 || x > 500 || y > 500),
    ).length,
    streetsOutsideSiteBounds: roads.filter((r) =>
      r.path.some(([x, y]) => x < -500 || y < -500 || x > 500 || y > 500),
    ).length,
    streetCorridorsOutsideSiteBounds: roads.filter((r) =>
      corridorPieces(r.path, r.widthM).some((piece) =>
        piece.flat().some(([x, y]) => x < -500 || y < -500 || x > 500 || y > 500),
      ),
    ).length,
    buildingGradeFailures: constrained && Math.hypot(...gradient) > 0.08 ? buildings.length : 0,
    roadGradeFailures: steep.length,
    maxRoadGrade: maxGrade,
    firstWaterOverlapIds: waterHits.slice(0, 3).map((b) => b.id),
    firstExclusionOverlapIds: exclusionHits.slice(0, 3).map((b) => b.id),
    firstRoadGradeFailureIds: steep.slice(0, 3),
    routeJoins,
  };
}

function physicalParity(result) {
  const { model, geojson } = result;
  assert.equal(model.coordinateSystem, 'local_metres_y_down');
  assert.equal(geojson.metadata.scale.meters_per_unit, 1);
  const features = new Map(geojson.features.map((f) => [f.id, f]));
  for (const b of model.scene.layers.buildings) {
    assert.deepEqual(
      features.get(b.id).geometry.coordinates[0].slice(0, -1),
      b.ring.map((p) => [p.x, p.y]),
    );
  }
  const roads = geojson.features.filter((f) => f.properties.layer === 'street');
  assert.deepEqual(
    roads.map((f) => f.geometry.coordinates),
    model.scene.layers.roads.map((r) => r.path.map((p) => [p.x, p.y])),
  );
  // Every output coordinate round-trips, not just a symmetric origin point.
  const frame = { anchor: [3456, 1234], clockwiseRadians: Math.PI / 2 };
  const visit = (coordinates) => {
    if (typeof coordinates[0] === 'number') {
      const back = toLocal(toWorld(coordinates, frame), frame);
      assert.ok(Math.hypot(back[0] - coordinates[0], back[1] - coordinates[1]) < 1e-9);
    } else coordinates.forEach(visit);
  };
  geojson.features.forEach((f) => visit(f.geometry.coordinates));
}

const rows = [];
for (const seed of [2, 7])
  for (const candidate of candidates) {
    const flat = generate(candidate, base, seed);
    const flatScale = flat.geojson.metadata.scale.meters_per_unit;
    for (const fixture of ['flat', 'constrained']) {
      const constrained = fixture === 'constrained';
      const input = { ...base };
      if (constrained) {
        // Legacy city has no measured-water API: use its *flat* heuristic as a
        // diagnostic calibration, record any new heuristic drift, never endorse it.
        const waterScale = candidate === 'legacy-city' ? flatScale : 1;
        input.coastlineGeometry = [
          water.map(([x, y]) => ({ x: x / waterScale, y: y / waterScale })),
        ];
        if (candidate !== 'legacy-city') input.waterContext = measured;
      }
      const started = performance.now();
      const result = generate(candidate, input, seed);
      const elapsedMs = performance.now() - started;
      const replay = generate(candidate, input, seed);
      const digest = hash(canonical(result.geojson));
      assert.equal(hash(canonical(replay.geojson)), digest);
      if (candidate.startsWith('physical')) physicalParity(result);
      const scale = result.geojson.metadata.scale.meters_per_unit;
      const counts = diagnostics(result.geojson, constrained);
      assert.ok(counts.buildings > 0 && counts.streets > 0);
      if (constrained) assert.ok(counts.buildingGradeFailures > 0 && counts.roadGradeFailures > 0);
      if (candidate !== 'legacy-city') assert.equal(scale, 1);
      let contractCircleGaps = null;
      if (candidate === 'legacy-village') {
        const { roads } = metricGeometry(result.geojson);
        contractCircleGaps = approaches.map((a) => {
          const r = result.model.contractRadiusM,
            theta = (a.bearing * Math.PI) / 180;
          const p = [r * Math.sin(theta), -r * Math.cos(theta)];
          return {
            id: a.id,
            gapM: Math.min(
              ...roads
                .filter((road) => road.routes.includes(a.id))
                .flatMap((road) =>
                  road.path.slice(1).map((q, i) => pointSegmentDistance(p, road.path[i], q)),
                ),
            ),
          };
        });
        assert.ok(contractCircleGaps.every((g) => g.gapM < 1e-6));
      }
      rows.push({
        seed,
        candidate,
        fixture,
        elapsedMs,
        work: result.work,
        canonicalGeojsonSha256: digest,
        repeatEqual: true,
        metadata: result.geojson.metadata,
        scaleDriftFromFlat: scale / flatScale,
        diagnostics: result.model.diagnostics ?? result.degradedFlags ?? [],
        residents: result.model.residents ?? null,
        contractCircleGaps,
        assessment: counts,
      });
    }
  }

const checks = {};
// Adversarial controls: dry centre/centreline, but a wet complete footprint/corridor.
assert.ok(
  multiPolygonArea(
    clipping.intersection(
      [
        [
          [39, -5],
          [49, -5],
          [49, 5],
          [39, 5],
        ],
      ],
      [water],
    ),
  ) > 0,
);
assert.ok(
  corridorPieces(
    [
      [40, -10],
      [40, 10],
    ],
    12,
  ).some((piece) => multiPolygonArea(clipping.intersection(piece, [water])) > 0),
);
checks.edgeOnlyFootprintAndCorridorDetected = true;
for (const candidate of candidates) {
  const flat = generate(candidate, base, 2);
  const heightHint = generate(candidate, { ...base, elevation: 999 }, 2);
  checks[`${candidate}:scalarElevationIgnored`] =
    hash(canonical(flat.geojson)) === hash(canonical(heightHint.geojson));
  assert.ok(checks[`${candidate}:scalarElevationIgnored`]);
}
for (const preset of ['village', 'city']) {
  const model = sm.createSettlementModel(base, { seed: 2, development: { preset } });
  const before = hash(sm.exportSettlement(model));
  for (const width of [900, 1200]) {
    const svg = sm.renderSettlement(model, {
      width,
      bounds: { min_x: -137, min_y: -241, max_x: 211, max_y: 173 },
      palette: sm.PALETTES.blueprint,
    });
    assert.ok(svg.includes('data-px-per-metre="1"'));
    assert.ok(svg.includes('data-origin-x="0" data-origin-y="0"'));
  }
  assert.equal(hash(sm.exportSettlement(model)), before);
  checks[`${preset}:renderDoesNotMutateMetres`] = true;
}
try {
  generate(
    'legacy-city',
    { ...base, waterContext: measured, coastlineGeometry: [water.map(([x, y]) => ({ x, y }))] },
    2,
  );
  assert.fail('Legacy city must reject measured-water units');
} catch (error) {
  assert.match(error.message, /water-context-unsupported-engine/);
  checks.legacyCityMeasuredWaterRejected = true;
}
const report = {
  provenance,
  fixtures: {
    population: 300,
    seeds: [2, 7],
    base,
    approaches,
    water,
    measuredWater: measured,
    exclusion,
    constrainedPlane: { datumM: 120, gradient, slope: Math.hypot(...gradient) },
    thresholds: { roadGrade: 0.1, buildingGradient: 0.08 },
    siteBoundsM: [-500, -500, 500, 500],
  },
  checks,
  rows,
  limitations: [
    'Only water is supplied as a supported constraint. Plane and exclusions are independent diagnostics; no current API accepts numerical terrain or arbitrary excluded polygons.',
    'Constant-plane grades are exact along straight segments and over every footprint. Corridor overlaps use full segment rectangles and conservative 32-gon caps/joins (at most 0.484% radial excess). Physical width is exported surface width, not the missing reserved corridor. Water corridor hits include legitimate crossings and are diagnostic, not automatic rejections.',
    'Legacy city water was calibrated using flat-output heuristic scale; constrained-output scale drift and coast shift invalidate fixed metre alignment.',
    'Timings are single warm-process observations, exclude module import, and differ in included work. No whole-map benchmark or preview measurement.',
    'Dependencies were reused with six lock-entry checks; a network-fresh npm ci and remote source availability were not tested.',
    'Same-process repeat hashes remove only legacy generated_at. Run in fresh processes to check replay across process state.',
  ],
};
writeFileSync(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);
console.table(
  rows.map((r) => ({
    seed: r.seed,
    candidate: r.candidate,
    fixture: r.fixture,
    buildings: r.assessment.buildings,
    streets: r.assessment.streets,
    waterOverlap: r.assessment.buildingWaterOverlap,
    excluded: r.assessment.buildingExclusionOverlap,
    buildingGrade: r.assessment.buildingGradeFailures,
    roadGrade: r.assessment.roadGradeFailures,
    ms: Math.round(r.elapsedMs),
  })),
);
console.log(JSON.stringify({ checks, report: resolve(reportPath) }, null, 2));
