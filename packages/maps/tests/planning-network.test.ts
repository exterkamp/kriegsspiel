import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type GenerationResult, type MapSettings } from '../src/contract.js';
import {
  generatePlanning,
  validatePlanning,
  reconcileLocalJoins,
  type PlanningInput,
  type RegionalPlanningOutput,
} from '../src/planning/index.js';
import { generateElevation } from '../src/terrain/index.js';
import { decimal6 } from '../src/terrain/precision.js';
import { pointSegmentDistance } from '../src/geometry.js';
import { generateGeography, geographyPreset, crossingCandidate } from '../src/geography/index.js';
function value<T>(r: GenerationResult<T>): T {
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.value;
}
function input(s: MapSettings = structuredClone(DEFAULT_SETTINGS)): PlanningInput {
  s.widthM = s.heightM = 1000;
  s.terrain.reliefM = 0;
  s.settlements.villageCount = 2;
  s.settlements.farmCount = 1;
  s.settlements.minSpacingM = 200;
  s.roads.extraLinks = 0;
  return {
    settings: s,
    seed: 17,
    bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
    elevation: value(generateElevation(s, 17)),
    water: [],
  };
}
function walk(p: RegionalPlanningOutput): Set<string> {
  const by = new Map<string, string[]>();
  for (const e of p.roads)
    for (const [a, b] of [
      [e.fromNodeId, e.toNodeId],
      [e.toNodeId, e.fromNodeId],
    ])
      by.set(a!, [...(by.get(a!) ?? []), b!]);
  const seen = new Set<string>(),
    queue = [p.sites[0]!.entrances[0]!.nodeId];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(by.get(id) ?? []).filter((n) => !seen.has(n)));
  }
  return seen;
}
describe('actual emitted regional graph and reconciliation', () => {
  it('connects exact counts with permissible sizes, stable identities, boundary exit, provenance and immutable inputs', () => {
    const a = input(),
      before = structuredClone(a),
      p = value(generatePlanning(a));
    expect(a).toEqual(before);
    expect(p.sites).toHaveLength(3);
    expect(p.sizes.every((s) => s.areaM2 >= 400)).toBe(true);
    expect(p.sites.map((s) => s.id)).toEqual([
      'site:farm:0000',
      'site:village:0000',
      'site:village:0001',
    ]);
    expect(p.sites.every((s) => s.occupiedFootprint === null && s.population.assigned === 0)).toBe(
      true,
    );
    expect(p.roadNodes.filter((n) => n.kind === 'boundary-exit')).toHaveLength(1);
    expect(p.sites.every((s) => walk(p).has(s.entrances[0]!.nodeId))).toBe(true);
    expect(validatePlanning(a, p)).toMatchObject({ ok: true });
    a.overrides = [
      { kind: 'rename', siteId: 'site:village:0000', name: 'First' },
      { kind: 'rename', siteId: 'site:village:0000', name: 'Last' },
    ];
    const renamed = value(generatePlanning(a));
    for (const s of renamed.sites) s.name = p.sites.find((old) => old.id === s.id)!.name;
    expect(renamed).toEqual(p);
  });
  it('rejects dense impossible sites, hard moves in water, missing override IDs and resource exhaustion', () => {
    const a = input();
    a.settings.settlements.minSpacingM = 1500;
    expect(generatePlanning(a)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'SITE_COUNT_INFEASIBLE' }],
    });
    const b = input();
    b.overrides = [{ kind: 'move-site', siteId: 'site:unknown', anchor: [100, 100] }];
    expect(() => generatePlanning(b)).toThrow('Unknown stable place ID');
    const c = input();
    c.limits = { maxCandidateWork: 1 };
    expect(generatePlanning(c)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'PLANNING_RESOURCE_LIMIT' }],
    });
    const d = input();
    d.settings.roads.maxExpansionsPerRoute = 1;
    expect(generatePlanning(d)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'ROUTE_EXPANSION_LIMIT' }],
    });
  });
  it('rejects disconnected graph, orphan crossing and altered entrance bearings', () => {
    const a = input(),
      p = value(generatePlanning(a)),
      broken = structuredClone(p),
      entry = broken.sites[0]!.entrances[0]!;
    broken.roads = broken.roads.filter((r) => r.id !== entry.roadId);
    expect(validatePlanning(a, broken)).toMatchObject({ ok: false });
    const bearing = structuredClone(p);
    bearing.sites[0]!.entrances[0]!.bearingDeg =
      (bearing.sites[0]!.entrances[0]!.bearingDeg + 90) % 360;
    expect(validatePlanning(a, bearing)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'ENTRANCE_BEARING' }],
    });
  });
  it('independently rejects reduced hole area and falsified size evidence', () => {
    const a = input(),
      p = value(generatePlanning(a)),
      site = p.sites[0]!;
    site.placementArea.holes = [
      [
        [site.anchor[0] - 11, site.anchor[1] - 11],
        [site.anchor[0] + 11, site.anchor[1] - 11],
        [site.anchor[0] + 11, site.anchor[1] + 11],
        [site.anchor[0] - 11, site.anchor[1] + 11],
        [site.anchor[0] - 11, site.anchor[1] - 11],
      ],
    ];
    expect(validatePlanning(a, p)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'SITE_SIZE' }],
    });
  });
  it('reconciles an asymmetric displaced endpoint and actual outward bearing, rejecting wet/missing joins', () => {
    const a = input(),
      p = value(generatePlanning(a)),
      site = p.sites[0]!,
      entry = site.entrances[0]!,
      endpoint = [...entry.endpoint] as [number, number];
    // Two metres along the side the entrance lies on (a turned site's side is slanted, #545).
    const ring = site.placementArea.outer,
      k = ring.findIndex(
        (q, i) =>
          i > 0 &&
          pointSegmentDistance(entry.endpoint, ring[i - 1]!, q) <= 1e-9 &&
          Math.hypot(q[0] - endpoint[0], q[1] - endpoint[1]) > 2,
      ),
      [x, y] = ring[k]!,
      d = Math.hypot(x - endpoint[0], y - endpoint[1]);
    endpoint[0] += (2 * (x - endpoint[0])) / d;
    endpoint[1] += (2 * (y - endpoint[1])) / d;
    const joined = value(
      reconcileLocalJoins(a, p, [
        {
          siteId: site.id,
          entranceId: entry.id,
          endpoint,
          bearingDeg: entry.bearingDeg,
          widthM: entry.widthM,
        },
      ]),
    );
    expect(joined.joins[0]!.endpoint).toEqual(endpoint.map(decimal6));
    expect(validatePlanning(a, joined.plan)).toMatchObject({ ok: true });
    expect(p.sites[0]!.entrances[0]!.endpoint).not.toEqual(endpoint);
    expect(
      reconcileLocalJoins(a, p, [
        { siteId: site.id, entranceId: 'missing', endpoint, bearingDeg: 0, widthM: entry.widthM },
      ]),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'RECONCILIATION_ID' }] });
    expect(reconcileLocalJoins(a, p, [], 5)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'RECONCILIATION_PASS_LIMIT' }],
    });
    expect(
      reconcileLocalJoins(a, p, [
        {
          siteId: site.id,
          entranceId: entry.id,
          endpoint: [500, 500],
          bearingDeg: 45,
          widthM: entry.widthM,
        },
      ]),
    ).toMatchObject({ ok: false });
  });
  it('uses a linked bridge on the required route between explicitly opposite-bank sites', () => {
    const a = input();
    a.settings.settlements.farmCount = 0;
    a.settings.roads.maxReservedWidthM = 8;
    a.settings.hydrology.minRiverWidthM = 20;
    a.elevation.samples.fill(10);
    a.water = [
      {
        id: 'river:fixture',
        kind: 'river',
        polygons: [
          {
            outer: [
              [490, 0],
              [510, 0],
              [510, 1000],
              [490, 1000],
              [490, 0],
            ],
            holes: [],
          },
        ],
        centreline: [
          [500, 0],
          [500, 1000],
        ],
        widthM: 20,
        surfacePolicy: 'standing-water-v1',
        surfaceProfileM: [0, 0],
      },
    ];
    a.crossingCandidates = [
      crossingCandidate(
        'bridge:fixture',
        'river:fixture',
        [
          [480, 500],
          [520, 500],
        ],
        a.settings,
      ),
    ];
    a.overrides = [
      { kind: 'move-site', siteId: 'site:village:0000', anchor: [250, 500] },
      { kind: 'move-site', siteId: 'site:village:0001', anchor: [750, 500] },
    ];
    a.requireBridge = true;
    const p = value(generatePlanning(a));
    expect(p.crossings).toHaveLength(1);
    expect(p.routes.some((r) => r.crossingIds.includes('bridge:fixture') && r.from !== r.to)).toBe(
      true,
    );
    expect(
      p.crossings[0]!.roadIds.every((id) =>
        p.roads.find((r) => r.id === id)!.crossingIds.includes('bridge:fixture'),
      ),
    ).toBe(true);
    expect(p.sites.every((s) => walk(p).has(s.entrances[0]!.nodeId))).toBe(true);
    const orphan = structuredClone(p);
    orphan.crossings[0]!.roadIds = [];
    expect(() => validatePlanning(a, orphan)).toThrow();
  });
  it('connects all4 villages and6 farms on actual5km flat17/hills31/river97', () => {
    for (const [name, seed] of [
      ['flat-countryside', 17],
      ['wooded-hills', 31],
      ['river-valley', 97],
    ] as const) {
      const s = geographyPreset(name),
        b = { minX: 0 as const, minY: 0 as const, maxX: 5000, maxY: 5000 },
        g = value(generateGeography(value(generateElevation(s, seed)), b, s, seed)),
        a: PlanningInput = {
          settings: s,
          seed,
          bounds: b,
          elevation: g.elevation,
          water: g.water,
          cover: g.cover,
          crossingCandidates: g.crossingCandidates,
          requireBridge: name === 'river-valley',
        },
        p = value(generatePlanning(a));
      expect(p.sites.filter((s) => s.kind === 'village')).toHaveLength(4);
      expect(p.sites.filter((s) => s.kind === 'farm')).toHaveLength(6);
      expect(p.sites.every((s) => walk(p).has(s.entrances[0]!.nodeId))).toBe(true);
      if (name === 'river-valley') expect(p.crossings.length).toBeGreaterThan(0);
    }
  }, 20000);
});
