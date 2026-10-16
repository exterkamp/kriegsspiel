import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type GenerationResult, type Point } from '../src/contract.js';
import {
  generatePlanning,
  validatePlanning,
  reconcileLocalJoins,
  certifyBridge,
  certifyFootprint,
  certifyRoadSegment,
  type PlanningInput,
} from '../src/planning/index.js';
import { crossingCandidate } from '../src/geography/index.js';
function value<T>(r: GenerationResult<T>): T {
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.value;
}
function small(): PlanningInput {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.widthM = s.heightM = 200;
  s.settlements.villageCount = 1;
  s.settlements.farmCount = 0;
  s.settlements.villagePopulation = 1;
  s.settlements.minSpacingM = 25;
  s.settlements.villageSite = { minAreaM2: 100, maxAreaM2: 2000, minExtentM: 10, maxExtentM: 40 };
  s.roads.extraLinks = 0;
  return {
    settings: s,
    seed: 7,
    bounds: { minX: 0, minY: 0, maxX: 200, maxY: 200 },
    water: [],
    elevation: { columns: 9, rows: 9, spacingM: 25, samples: Array(81).fill(10) },
  };
}
it('rejects inward/backtracking actual approaches as named infeasibility; outward rotated tangent passes', () => {
  const a = small(),
    p = value(generatePlanning(a)),
    site = p.sites[0]!,
    e = site.entrances[0]!,
    join = {
      siteId: site.id,
      entranceId: e.id,
      endpoint: e.endpoint,
      bearingDeg: (e.bearingDeg + 180) % 360,
      widthM: e.widthM,
    };
  expect(reconcileLocalJoins(a, p, [join])).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'RECONCILIATION_OUTWARD' }],
  });
  join.bearingDeg = (e.bearingDeg + 30) % 360;
  expect(reconcileLocalJoins(a, p, [join])).toMatchObject({ ok: true });
});
it('enforces exclusions, ordered moves/names and stable IDs during independent validation', () => {
  const a = small(),
    p = value(generatePlanning(a)),
    site = p.sites[0]!;
  a.overrides = [{ kind: 'exclude-sites', id: 'exclude:all', polygon: site.placementArea }];
  expect(validatePlanning(a, p)).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'SITE_OVERRIDE' }],
  });
  a.overrides = [{ kind: 'move-site', siteId: site.id, anchor: [50, 50] }];
  expect(validatePlanning(a, p)).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'SITE_OVERRIDE' }],
  });
  a.overrides = [{ kind: 'rename', siteId: site.id, name: 'Actual' }];
  expect(validatePlanning(a, p)).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'SITE_OVERRIDE' }],
  });
  delete a.overrides;
  site.id = 'site:village:0015';
  expect(validatePlanning(a, p)).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'SITE_IDENTITY' }],
  });
});
it('checks reciprocal logical provenance and per-route emitted-edge connectivity', () => {
  const a = small(),
    p = value(generatePlanning(a));
  for (const alter of [
    (q: typeof p) => {
      q.routes[0]!.roadIds = [];
    },
    (q: typeof p) => {
      q.routes[0]!.from = 'missing';
    },
    (q: typeof p) => {
      q.routes[0]!.crossingIds = ['missing'];
    },
    (q: typeof p) => {
      q.roads[0]!.routeIds = ['missing'];
    },
  ]) {
    const q = structuredClone(p);
    alter(q);
    expect(validatePlanning(a, q)).toMatchObject({ ok: false });
  }
});
it('reserves every output coordinate and rejects unfulfilled singleton boundary requests', () => {
  const a = small();
  // The eight-neighbour route is shorter than the old staircase, so this
  // fixture now succeeds at 25 output coordinates; 20 must still fail.
  a.settings.limits.maxVertices = 20;
  expect(generatePlanning(a)).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'PLANNING_RESOURCE_LIMIT', constraint: 'output vertices' }],
  });
  a.settings.limits.maxVertices = 1000;
  a.limits = { maxOutputFeatures: 1 };
  expect(generatePlanning(a)).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'PLANNING_RESOURCE_LIMIT', constraint: 'output features' }],
  });
  delete a.limits;
  a.settings.settlements.villageCount = 0;
  expect(generatePlanning(a)).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'REGIONAL_TERMINALS' }],
  });
  a.boundarySides = [];
  const empty = value(generatePlanning(a));
  expect(empty.roadNodes).toEqual([]);
  delete a.boundarySides;
  expect(validatePlanning(a, empty)).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'BOUNDARY_EXIT_SET' }],
  });
});
it('preflights all separately supplied helper descriptors before invoking getters', () => {
  const a = small();
  a.settings.roads.maxReservedWidthM = 8;
  a.settings.hydrology.minRiverWidthM = 20;
  a.water = [
    {
      id: 'river:test',
      kind: 'river',
      widthM: 20,
      polygons: [
        {
          outer: [
            [90, 0],
            [110, 0],
            [110, 200],
            [90, 200],
            [90, 0],
          ],
          holes: [],
        },
      ],
      centreline: [
        [100, 0],
        [100, 200],
      ],
      surfacePolicy: 'standing-water-v1',
      surfaceProfileM: [5, 5],
    },
  ];
  const c = crossingCandidate(
    'bridge:test',
    'river:test',
    [
      [80, 100],
      [120, 100],
    ],
    a.settings,
  );
  let calls = 0;
  Object.defineProperty(c, 'endpoints', {
    enumerable: true,
    get: () => {
      calls++;
      return [
        [80, 100],
        [120, 100],
      ];
    },
  });
  expect(() => certifyBridge(a, c)).toThrow('accessor');
  expect(calls).toBe(0);
  const p = { outer: [], holes: [] };
  Object.defineProperty(p, 'outer', {
    enumerable: true,
    get: () => {
      calls++;
      return [
        [20, 20],
        [40, 20],
        [40, 40],
        [20, 40],
        [20, 20],
      ];
    },
  });
  expect(() => certifyFootprint(a, p)).toThrow('accessor');
  expect(calls).toBe(0);
  const point = [20, 20] as Point;
  Object.defineProperty(point, '0', {
    enumerable: true,
    get: () => {
      calls++;
      return 20;
    },
  });
  expect(() => certifyRoadSegment(a, point, [80, 20])).toThrow('accessor');
  expect(calls).toBe(0);
});
it('fails at one less than successful shared validation/candidate work without truncated success', () => {
  const a = small(),
    p = value(generatePlanning(a));
  for (const key of ['maxValidationWork', 'maxCandidateWork', 'maxHeapWork'] as const) {
    const count =
      key === 'maxValidationWork'
        ? p.evidence.validationWork
        : key === 'maxCandidateWork'
          ? p.evidence.candidateWork
          : p.evidence.heapWork;
    a.limits = { [key]: count };
    expect(generatePlanning(a)).toMatchObject({ ok: true });
    a.limits = { [key]: count - 1 };
    expect(generatePlanning(a)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'PLANNING_RESOURCE_LIMIT' }],
    });
  }
});

it('carries failed reconciliation work into the next pass and exhausts one aggregate cap', () => {
  const a = small(),
    p = value(generatePlanning(a)),
    site = p.sites[0]!,
    e = site.entrances[0]!,
    join = {
      siteId: site.id,
      entranceId: 'missing',
      endpoint: e.endpoint,
      bearingDeg: e.bearingDeg,
      widthM: e.widthM,
    };
  const first = reconcileLocalJoins(a, p, [join]);
  expect(first).toMatchObject({ ok: false, diagnostics: [{ code: 'RECONCILIATION_ID' }] });
  expect(first.work).toBeGreaterThan(0);
  a.settings.settlements.maxGlobalReconciliationWork = first.work * 2 - 1;
  const second = reconcileLocalJoins(a, p, [join], first.passes + 1, first.work);
  expect(second).toMatchObject({ ok: false, diagnostics: [{ code: 'PLANNING_RESOURCE_LIMIT' }] });
  expect(second.work).toBeGreaterThan(first.work);
  expect(second.work).toBeLessThanOrEqual(a.settings.settlements.maxGlobalReconciliationWork);
  expect(() => reconcileLocalJoins(a, p, [join], 2, 0)).toThrow('prior consumed work');
});
