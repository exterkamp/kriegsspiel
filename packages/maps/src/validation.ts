import {
  HARD_LIMITS,
  SettingsSchema,
  type MapAsset,
  type MapSettings,
  type Point,
  type Polygon,
  type Road,
  type Crossing,
  type Building,
} from './contract.js';
import { fail, MapValidationError, TopologyBudget } from './errors.js';
import {
  bearingDegrees,
  capsuleContainedInPolygon,
  distance,
  interpolate,
  pointSegmentDistance,
  polygonArea,
  polygonContainsPolygon,
  polygonLocation,
  polygonsOverlap,
  projection,
  segmentCuts,
  segmentsIntersect,
  validatePath,
  validatePolygon,
} from './geometry.js';
import { preflightAsset } from './resources.js';
import { createElevationQueries, validateElevationShape } from './queries.js';
import { WaterPolygonIndex, boxesMeet, segmentBox, type Box } from './validation-water.js';

export function validateSettings(s: MapSettings): void {
  const columns = s.widthM / s.sampleSpacingM + 1,
    rows = s.heightM / s.sampleSpacingM + 1;
  if (!Number.isInteger(columns) || !Number.isInteger(rows))
    fail('$.settings.sampleSpacingM', 'Extent must be an integral number of sample intervals');
  if (!Number.isSafeInteger(columns * rows) || columns * rows > s.limits.maxSamples)
    fail(
      '$.settings.sampleSpacingM',
      'Elevation allocation exceeds sample budget',
      'RESOURCE_LIMIT',
    );
  const planningCells =
    (Math.ceil(s.widthM / s.roads.planningSpacingM) + 1) *
    (Math.ceil(s.heightM / s.roads.planningSpacingM) + 1);
  if (!Number.isSafeInteger(planningCells) || planningCells > s.roads.maxPlanningCells)
    fail(
      '$.settings.roads.planningSpacingM',
      'Planning lattice allocation exceeds maxPlanningCells',
      'RESOURCE_LIMIT',
    );
  if (s.roads.maxExpansionsPerRoute > s.roads.maxGlobalExpansions)
    fail('$.settings.roads.maxExpansionsPerRoute', 'Per-route budget exceeds global budget');
  if (
    s.contours.indexIntervalM < s.contours.minorIntervalM ||
    Math.abs(
      s.contours.indexIntervalM / s.contours.minorIntervalM -
        Math.round(s.contours.indexIntervalM / s.contours.minorIntervalM),
    ) > 1e-9
  )
    fail(
      '$.settings.contours.indexIntervalM',
      'Index interval must be an integral multiple of minor interval',
    );
  if (s.hydrology.minRiverWidthM > s.hydrology.maxRiverWidthM)
    fail('$.settings.hydrology.minRiverWidthM', 'Minimum width exceeds maximum');
  if (s.cover.woodFraction + s.cover.fieldFraction > 1)
    fail('$.settings.cover', 'Requested cover fractions exceed one');
  if (s.settlements.villageCount + s.settlements.farmCount > s.settlements.maxSites)
    fail('$.settings.settlements', 'Site count budget exceeded', 'RESOURCE_LIMIT');
  if (
    s.settlements.villageCount * s.settlements.villagePopulation +
      s.settlements.farmCount * s.settlements.farmPopulation >
    s.settlements.maxPopulation
  )
    fail(
      '$.settings.settlements.maxPopulation',
      'Requested population exceeds global budget',
      'RESOURCE_LIMIT',
    );
  for (const kind of ['villageSite', 'farmSite'] as const) {
    const area = s.settlements[kind];
    if (area.minAreaM2 > area.maxAreaM2 || area.minExtentM > area.maxExtentM)
      fail(`$.settings.settlements.${kind}`, 'Site size minimum exceeds maximum');
  }
}
export function parseSettings(input: unknown): MapSettings {
  preflightAsset(input, { ...HARD_LIMITS });
  const result = SettingsSchema.safeParse(input);
  if (!result.success)
    throw new MapValidationError(
      result.error.issues
        .slice(0, 32)
        .map((i) => ({ code: i.code, path: '$.settings.' + i.path.join('.'), message: i.message })),
    );
  validateSettings(result.data);
  return result.data;
}

function spanCovered(
  roads: Road[],
  crossing: Crossing,
  tolerance: number,
  budget: TopologyBudget,
  path: string,
): boolean {
  const [a, b] = crossing.endpoints,
    length = distance(a, b);
  const intervals: [number, number][] = [];
  for (const road of roads)
    for (let i = 1; i < road.path.length; i++) {
      budget.consume(path);
      const p = road.path[i - 1]!,
        q = road.path[i]!;
      const perpendicular = (r: Point) =>
        Math.abs((b[0] - a[0]) * (r[1] - a[1]) - (b[1] - a[1]) * (r[0] - a[0])) / length;
      if (perpendicular(p) > tolerance || perpendicular(q) > tolerance) continue;
      const t1 = projection(p, a, b),
        t2 = projection(q, a, b);
      const from = Math.max(0, Math.min(t1, t2)),
        to = Math.min(1, Math.max(t1, t2));
      if (to > from) intervals.push([from, to]);
    }
  budget.consume(path, intervals.length * Math.ceil(Math.log2(intervals.length + 1)));
  intervals.sort((x, y) => x[0] - y[0]);
  let end = 0;
  for (const interval of intervals) {
    if (interval[0] > end + tolerance / length) return false;
    end = Math.max(end, interval[1]);
  }
  return end >= 1 - tolerance / length;
}

export function validateAssetTopology(asset: MapAsset, maxChecks: number): void {
  const budget = new TopologyBudget(maxChecks),
    { layers, settings, bounds } = asset;
  // Reject count/population excess before any geometry traversal or indexes.
  if (
    layers.sites.length > settings.settlements.maxSites ||
    layers.sites.length !== settings.settlements.villageCount + settings.settlements.farmCount
  )
    fail(
      '$.layers.sites',
      'Site counts exceed or disagree with recorded budgets',
      'RESOURCE_LIMIT',
    );
  if (
    layers.sites.reduce((n, site) => n + site.population.requested, 0) >
    settings.settlements.maxPopulation
  )
    fail('$.layers.sites', 'Actual population exceeds recorded global budget', 'RESOURCE_LIMIT');
  budget.consume(
    '$.layers',
    Object.values(layers).reduce((n, features) => n + features.length, 0),
  );
  validateElevationShape(asset.elevation, bounds, settings.limits.maxSamples);
  if (
    bounds.maxX !== settings.widthM ||
    bounds.maxY !== settings.heightM ||
    asset.elevation.spacingM !== settings.sampleSpacingM
  )
    fail('$.bounds', 'Bounds/elevation must match recorded settings');
  const checkPoint = (p: Point, path: string) => {
    if (p[0] < 0 || p[1] < 0 || p[0] > bounds.maxX || p[1] > bounds.maxY)
      fail(path, 'Coordinate outside map bounds');
  };
  const polygon = (p: Polygon, path: string) => {
    validatePolygon(p, path, budget);
    [p.outer, ...p.holes].forEach((r, i) =>
      r.forEach((v, j) => checkPoint(v, `${path}.${i ? `holes[${i - 1}]` : 'outer'}[${j}]`)),
    );
  };
  const walk = (value: unknown, path: string): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    const obj = value as Record<string, unknown>;
    if ('outer' in obj && 'holes' in obj) {
      polygon(obj as Polygon, path);
      return;
    }
    for (const [key, child] of Object.entries(obj)) {
      const next = `${path}.${key}`;
      if (['position', 'anchor', 'endpoint', 'location'].includes(key) && child)
        checkPoint(child as Point, next);
      else if (key === 'endpoints')
        (child as Point[]).forEach((p, i) => checkPoint(p, `${next}[${i}]`));
      else if ((key === 'path' && Array.isArray(child)) || key === 'centreline') {
        const points = child as Point[];
        validatePath(points, next, budget, path.startsWith('$.layers.contours'));
        points.forEach((p, i) => checkPoint(p, `${next}[${i}]`));
      } else walk(child, next);
    }
    if (Array.isArray(obj.polygons)) {
      const parts = obj.polygons as Polygon[];
      for (let i = 0; i < parts.length; i++)
        for (let j = 0; j < i; j++)
          if (polygonsOverlap(parts[i]!, parts[j]!, budget, path))
            fail(
              `${path}.polygons[${i}]`,
              'Components within one feature must be disjoint/non-touching; independent features/layers may overlap',
            );
    }
  };
  walk(layers, '$.layers');
  walk(asset.overrides, '$.overrides');
  walk(asset.diagnostics, '$.diagnostics');
  const allIds = new Set<string>();
  for (const [layer, features] of Object.entries(layers))
    for (const [i, feature] of features.entries()) {
      const insert = (id: string, path: string) => {
        if (allIds.has(id)) fail(path, `Duplicate global ID ${id}`);
        allIds.add(id);
      };
      insert(feature.id, `$.layers.${layer}[${i}].id`);
      if (layer === 'sites')
        for (const [j, entrance] of layers.sites[i]!.entrances.entries())
          insert(entrance.id, `$.layers.sites[${i}].entrances[${j}].id`);
    }
  const unique = (values: string[], path: string) => {
    if (new Set(values).size !== values.length) fail(path, 'Duplicate references');
  };
  const nodes = new Map(layers.roadNodes.map((n) => [n.id, n]));
  const roads = new Map(layers.roads.map((r) => [r.id, r]));
  const water = new Map(layers.water.map((w) => [w.id, w]));
  const crossings = new Map(layers.crossings.map((c) => [c.id, c]));
  const sites = new Map(layers.sites.map((s) => [s.id, s]));
  const indexedWater = new Map<string, WaterPolygonIndex[]>();
  for (const body of layers.water) {
    budget.consume('$.layers.water', body.polygons.length);
    indexedWater.set(
      body.id,
      body.polygons.map((poly) => new WaterPolygonIndex(poly, budget, '$.layers.water')),
    );
  }
  const roadBounds = new Map<string, Box>();
  for (const road of layers.roads) {
    budget.consume('$.layers.roads', road.path.length);
    const box: Box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of road.path) {
      box[0] = Math.min(box[0], p[0]);
      box[1] = Math.min(box[1], p[1]);
      box[2] = Math.max(box[2], p[0]);
      box[3] = Math.max(box[3], p[1]);
    }
    roadBounds.set(road.id, [box[0] - 1e-9, box[1] - 1e-9, box[2] + 1e-9, box[3] + 1e-9]);
  }
  const roadCrossings = new Map<string, Set<string>>(),
    crossingRoads = new Map<string, Set<string>>(),
    roadRoutes = new Map<string, Set<string>>();
  for (const road of layers.roads) {
    budget.consume('$.layers.roads', road.crossingIds.length + road.routeIds.length);
    roadCrossings.set(road.id, new Set(road.crossingIds));
    roadRoutes.set(road.id, new Set(road.routeIds));
  }
  for (const crossing of layers.crossings) {
    budget.consume('$.layers.crossings', crossing.roadIds.length);
    crossingRoads.set(crossing.id, new Set(crossing.roadIds));
  }
  const buildingsBySite = new Map<string, Building[]>();
  budget.consume('$.layers.buildings', layers.buildings.length);
  for (const building of layers.buildings) {
    const list = buildingsBySite.get(building.siteId) ?? [];
    list.push(building);
    buildingsBySite.set(building.siteId, list);
  }
  const join = settings.geometry.joinToleranceM;
  const usedNodes = new Set<string>();
  for (const [i, road] of layers.roads.entries()) {
    const p = `$.layers.roads[${i}]`;
    const start = nodes.get(road.fromNodeId),
      end = nodes.get(road.toNodeId);
    if (!start || !end || start === end) fail(p, 'Road requires two distinct existing nodes');
    if (
      distance(start.position, road.path[0]!) > join ||
      distance(end.position, road.path.at(-1)!) > join
    )
      fail(`${p}.path`, 'Road endpoints do not meet their authoritative nodes');
    usedNodes.add(start.id);
    usedNodes.add(end.id);
    if (road.widthM > settings.roads.maxReservedWidthM || road.surfaceWidthM > road.widthM)
      fail(`${p}.widthM`, 'Surface/reserved width exceeds declared corridor limits');
    if (road.siteId && !sites.has(road.siteId)) fail(`${p}.siteId`, 'Unknown site');
    unique(road.routeIds, `${p}.routeIds`);
    unique(road.crossingIds, `${p}.crossingIds`);
    for (const id of road.crossingIds)
      if (!crossingRoads.get(id)?.has(road.id))
        fail(`${p}.crossingIds`, `Missing/non-reciprocal crossing ${id}`);
    // Only the terminal capsule at an explicit boundary exit is clipped by
    // its named map side. All other vertices/caps retain full containment.
    for (const [j, point] of road.path.entries()) {
      const node = j === 0 ? start : j === road.path.length - 1 ? end : undefined;
      const exit = node?.kind === 'boundary-exit' ? node : undefined;
      if (exit && distance(exit.position, point) !== 0)
        fail(`${p}.path[${j}]`, 'Boundary exit must equal its authoritative node exactly');
      const r = road.widthM / 2;
      if (
        (point[0] < r && exit?.side !== 'west') ||
        (point[1] < r && exit?.side !== 'north') ||
        (point[0] > bounds.maxX - r && exit?.side !== 'east') ||
        (point[1] > bounds.maxY - r && exit?.side !== 'south')
      )
        fail(
          `${p}.path[${j}]`,
          'Reserved corridor cap extends outside map bounds without a declared exit',
        );
    }
  }
  const exitDegrees = new Map<string, number>();
  for (const road of layers.roads)
    for (const id of [road.fromNodeId, road.toNodeId])
      if (nodes.get(id)?.kind === 'boundary-exit')
        exitDegrees.set(id, (exitDegrees.get(id) ?? 0) + 1);
  for (const [i, node] of layers.roadNodes.entries()) {
    const p = `$.layers.roadNodes[${i}]`;
    if (!usedNodes.has(node.id)) fail(p, 'Orphan road node');
    if (node.kind === 'boundary-exit') {
      const [x, y] = node.position;
      const onSide =
        node.side === 'west'
          ? x === 0
          : node.side === 'east'
            ? x === bounds.maxX
            : node.side === 'north'
              ? y === 0
              : y === bounds.maxY;
      if (!onSide || exitDegrees.get(node.id) !== 1)
        fail(p, 'Boundary exit must lie exactly on its declared side and have one incident edge');
    }
  }
  // Graph crossings must be explicit common endpoint nodes; overlapping edges
  // cannot be hidden behind a shared node elsewhere.
  for (let i = 0; i < layers.roads.length; i++)
    for (let j = 0; j < i; j++) {
      const a = layers.roads[i]!,
        b = layers.roads[j]!;
      budget.consume('$.layers.roads');
      if (!boxesMeet(roadBounds.get(a.id)!, roadBounds.get(b.id)!)) continue;
      const common = [a.fromNodeId, a.toNodeId]
        .filter((id) => id === b.fromNodeId || id === b.toNodeId)
        .map((id) => nodes.get(id)!.position);
      for (let ai = 1; ai < a.path.length; ai++)
        for (let bi = 1; bi < b.path.length; bi++) {
          budget.consume('$.layers.roads');
          const p = a.path[ai - 1]!,
            q = a.path[ai]!,
            r = b.path[bi - 1]!,
            s = b.path[bi]!;
          if (!boxesMeet(segmentBox(p, q), segmentBox(r, s))) continue;
          if (!segmentsIntersect(p, q, r, s)) continue;
          const allowed = common.some(
            (n) =>
              (distance(n, p) <= join || distance(n, q) <= join) &&
              (distance(n, r) <= join || distance(n, s) <= join),
          );
          const overlap =
            pointSegmentDistance(interpolate(p, q, 0.5), r, s) < 1e-9 ||
            pointSegmentDistance(interpolate(r, s, 0.5), p, q) < 1e-9;
          if (!allowed || overlap)
            fail(
              `$.layers.roads[${i}].path`,
              `Intersection with ${b.id} lacks a shared endpoint node, or overlaps an edge`,
            );
        }
    }
  for (const [i, crossing] of layers.crossings.entries()) {
    const p = `$.layers.crossings[${i}]`,
      body = water.get(crossing.waterId);
    if (!body) fail(`${p}.waterId`, 'Orphan crossing water identity');
    unique(crossing.roadIds, `${p}.roadIds`);
    const linked = crossing.roadIds.map((id) => {
      const road = roads.get(id);
      if (!road || !roadCrossings.get(id)?.has(crossing.id))
        fail(`${p}.roadIds`, `Missing/non-reciprocal road ${id}`);
      return road;
    });
    const [a, b] = crossing.endpoints;
    if (
      Math.abs(distance(a, b) - crossing.spanM) > join ||
      crossing.spanM > settings.roads.maxCrossingSpanM ||
      crossing.spanM <= join
    )
      fail(`${p}.spanM`, 'Span length disagrees with endpoints or exceeds limit');
    if (!spanCovered(linked, crossing, join, budget, p))
      fail(`${p}.endpoints`, 'Linked road paths do not cover complete crossing span');
    for (const road of linked) {
      budget.consume(p, road.path.length);
      if (
        road.widthM > crossing.widthM ||
        !road.path
          .slice(1)
          .some(
            (q, j) =>
              segmentCuts(a, b, [[road.path[j]!, q]], budget, p).length > 2 ||
              pointSegmentDistance(interpolate(a, b, 0.5), road.path[j]!, q) <= join,
          )
      )
        fail(
          `${p}.roadIds`,
          'Crossing is narrower than linked reserved corridor or a linked edge is displaced',
        );
    }
    if (crossing.kind === 'ford' && crossing.traversableWidthM < crossing.widthM)
      fail(
        `${p}.traversableWidthM`,
        'Ford traversable width cannot be narrower than reserved width',
      );
    if (!capsuleContainedInPolygon(a, b, crossing.widthM / 2, crossing.deck, budget, p))
      fail(`${p}.deck`, 'Deck must contain full round-capped reserved crossing corridor');
    const cached = indexedWater.get(body.id)!;
    const edges = cached.flatMap((poly) => poly.cutEdges(a, b, p)),
      cuts = segmentCuts(a, b, edges, budget, p);
    if (
      !cuts
        .slice(1)
        .some((t, j) =>
          cached.some(
            (poly) => poly.location(interpolate(a, b, (cuts[j]! + t) / 2), p) === 'inside',
          ),
        )
    )
      fail(`${p}.endpoints`, 'Span does not traverse its declared water body');
    for (const endpoint of [a, b])
      for (const poly of cached)
        if (
          poly.intersectsCapsule(
            endpoint,
            endpoint,
            crossing.widthM / 2 + settings.roads.minimumAbutmentM,
            p,
          )
        )
          fail(`${p}.endpoints`, 'Endpoint/complete dry abutment corridor is in water');
  }
  for (const [ri, road] of layers.roads.entries())
    for (const body of layers.water) {
      const p = `$.layers.roads[${ri}].crossingIds`;
      budget.consume(p, road.crossingIds.length + 1);
      const relevant = road.crossingIds
        .map((id) => crossings.get(id)!)
        .filter((c) => c.waterId === body.id);
      const cached = indexedWater.get(body.id)!;
      for (let i = 1; i < road.path.length; i++) {
        const a = road.path[i - 1]!,
          b = road.path[i]!;
        const box = segmentBox(a, b, road.widthM / 2 + 1e-9);
        const nearby = cached.filter((poly) => {
          budget.consume(p);
          return boxesMeet(box, poly.bounds);
        });
        if (!nearby.length) continue;
        const edges = nearby.flatMap((poly) => poly.cutEdges(a, b, p));
        budget.consume(p, relevant.length + edges.length);
        const spanEdges = relevant.map((c) => c.endpoints as [Point, Point]);
        const cuts = segmentCuts(a, b, [...edges, ...spanEdges], budget, p);
        for (let j = 1; j < cuts.length; j++) {
          if (cuts[j]! - cuts[j - 1]! < 1e-12) continue;
          const from = interpolate(a, b, cuts[j - 1]!),
            to = interpolate(a, b, cuts[j]!),
            mid = interpolate(from, to, 0.5);
          if (
            nearby.some((poly) => poly.intersectsCapsule(from, to, road.widthM / 2, p)) &&
            !relevant.some(
              (c) =>
                pointSegmentDistance(mid, c.endpoints[0], c.endpoints[1]) <= join &&
                Math.min(
                  projection(from, c.endpoints[0], c.endpoints[1]),
                  projection(to, c.endpoints[0], c.endpoints[1]),
                ) >=
                  -join / c.spanM &&
                Math.max(
                  projection(from, c.endpoints[0], c.endpoints[1]),
                  projection(to, c.endpoints[0], c.endpoints[1]),
                ) <=
                  1 + join / c.spanM,
            )
          )
            fail(
              p,
              `Reserved corridor through/along ${body.id} lacks complete linked crossing coverage`,
            );
        }
      }
    }
  let villages = 0,
    farms = 0,
    totalPopulation = 0;
  for (const [i, site] of layers.sites.entries()) {
    const p = `$.layers.sites[${i}]`,
      size = settings.settlements[site.kind === 'village' ? 'villageSite' : 'farmSite'];
    if (site.kind === 'village') villages++;
    else farms++;
    totalPopulation += site.population.requested;
    const area = polygonArea(site.placementArea),
      xs = site.placementArea.outer.map((v) => v[0]),
      ys = site.placementArea.outer.map((v) => v[1]);
    const width = Math.max(...xs) - Math.min(...xs),
      height = Math.max(...ys) - Math.min(...ys);
    if (
      area < size.minAreaM2 ||
      area > size.maxAreaM2 ||
      Math.min(width, height) < size.minExtentM ||
      Math.max(width, height) > size.maxExtentM
    )
      fail(
        `${p}.placementArea`,
        'Permissible site area/extents violate recorded site-size settings',
      );
    if (polygonLocation(site.anchor, site.placementArea, budget, p) === 'outside')
      fail(`${p}.anchor`, 'Anchor outside permissible site');
    if (
      site.occupiedFootprint &&
      !polygonContainsPolygon(site.placementArea, site.occupiedFootprint, budget, p)
    )
      fail(`${p}.occupiedFootprint`, 'Occupied footprint leaves permissible site');
    if (site.population.assigned + site.population.unassigned !== site.population.requested)
      fail(`${p}.population`, 'Assigned + unassigned must equal requested');
    if (
      site.population.requested !==
      settings.settlements[site.kind === 'village' ? 'villagePopulation' : 'farmPopulation']
    )
      fail(`${p}.population.requested`, 'Population differs from recorded demand');
    let residents = 0;
    for (const building of buildingsBySite.get(site.id) ?? []) {
      if (
        !site.occupiedFootprint ||
        !polygonContainsPolygon(site.occupiedFootprint, building.footprint, budget, p)
      )
        fail(p, `Building ${building.id} leaves occupied footprint`);
      residents += building.residents;
    }
    if (residents !== site.population.assigned)
      fail(`${p}.population.assigned`, 'Assigned residents differ from linked building allocation');
    for (const [j, entrance] of site.entrances.entries()) {
      const ep = `${p}.entrances[${j}]`,
        road = roads.get(entrance.roadId),
        node = nodes.get(entrance.nodeId);
      if (
        !road ||
        !node ||
        (road.fromNodeId !== node.id && road.toNodeId !== node.id) ||
        !roadRoutes.get(road.id)?.has(entrance.routeId)
      )
        fail(ep, 'Entrance requires authoritative road endpoint node and route provenance');
      if (
        distance(node.position, entrance.endpoint) > join ||
        Math.abs(road.widthM - entrance.widthM) > join
      )
        fail(ep, 'Entrance endpoint/reserved width disagrees with road');
      if (polygonLocation(entrance.endpoint, site.placementArea, budget, ep) !== 'boundary')
        fail(`${ep}.endpoint`, 'Entrance must lie on permissible site boundary');
      const other = road.fromNodeId === node.id ? road.path[1]! : road.path.at(-2)!;
      const bearing = bearingDegrees(entrance.endpoint, other),
        error = Math.abs(((bearing - entrance.bearingDeg + 540) % 360) - 180);
      if (error > 0.01)
        fail(`${ep}.bearingDeg`, 'Outward road tangent differs by more than 0.01 degrees');
      if (entrance.crossingId && !roadCrossings.get(road.id)?.has(entrance.crossingId))
        fail(`${ep}.crossingId`, 'Entrance crossing is not linked to its road');
    }
  }
  if (
    villages !== settings.settlements.villageCount ||
    farms !== settings.settlements.farmCount ||
    layers.sites.length > settings.settlements.maxSites ||
    totalPopulation > settings.settlements.maxPopulation
  )
    fail('$.layers.sites', 'Site counts/population do not satisfy recorded request/budgets');
  for (const [i, b] of layers.buildings.entries())
    if (!sites.has(b.siteId) || b.residents > b.capacity)
      fail(`$.layers.buildings[${i}]`, 'Orphan site or residents exceed capacity');
  for (const [i, landmark] of layers.landmarks.entries())
    if (landmark.featureId && !allIds.has(landmark.featureId))
      fail(`$.layers.landmarks[${i}].featureId`, 'Unknown landmark target');
  const exclusions = new Set<string>();
  for (const [i, override] of asset.overrides.entries()) {
    if (override.kind === 'exclude-sites') {
      if (allIds.has(override.id) || exclusions.has(override.id))
        fail(`$.overrides[${i}].id`, 'Exclusion IDs must be unique');
      exclusions.add(override.id);
    } else if (!sites.has(override.siteId))
      fail(`$.overrides[${i}].siteId`, 'Override references missing stable site ID');
  }
  budget.consume('$.elevation.samples', asset.elevation.samples.length);
  const queries = createElevationQueries(asset);
  for (const [i, body] of layers.water.entries())
    if (body.kind === 'river') {
      const p = `$.layers.water[${i}].surfaceProfileM`;
      if (body.surfaceProfileM.length !== body.centreline.length)
        fail(p, 'River profile must align with each downstream-ordered centreline vertex');
      for (let j = 0; j < body.surfaceProfileM.length; j++) {
        if (j && body.surfaceProfileM[j]! > body.surfaceProfileM[j - 1]! + 1e-6)
          fail(`${p}[${j}]`, 'River water surface rises downstream');
        const point = body.centreline[j]!,
          ground = queries.heightAt(...point);
        if (
          body.surfacePolicy === 'carved-ground-v1'
            ? Math.abs(ground - body.surfaceProfileM[j]!) > 1e-6
            : ground > body.surfaceProfileM[j]! + 1e-6
        )
          fail(`${p}[${j}]`, 'River profile conflicts with ground/surface policy at vertex');
      }
      for (let j = 1; j < body.centreline.length; j++) {
        const a = body.centreline[j - 1]!,
          b = body.centreline[j]!,
          cuts = [0, 1];
        // A straight path inside one bilinear cell is a quadratic. Partition at
        // every grid seam and inspect its exact polynomial, never just vertices.
        for (const axis of [0, 1] as const) {
          if (a[axis] === b[axis]) continue;
          const first = Math.floor(Math.min(a[axis], b[axis]) / asset.elevation.spacingM) + 1;
          const last = Math.ceil(Math.max(a[axis], b[axis]) / asset.elevation.spacingM) - 1;
          budget.consume(p, Math.max(0, last - first + 1));
          for (let k = first; k <= last; k++)
            cuts.push((k * asset.elevation.spacingM - a[axis]) / (b[axis] - a[axis]));
        }
        budget.consume(p, cuts.length * Math.ceil(Math.log2(cuts.length + 1)));
        const sorted = [...new Set(cuts)].sort((x, y) => x - y);
        for (let k = 1; k < sorted.length; k++) {
          budget.consume(p);
          const t0 = sorted[k - 1]!,
            t1 = sorted[k]!,
            tm = (t0 + t1) / 2;
          const h0 = queries.heightAt(...interpolate(a, b, t0)),
            h1 = queries.heightAt(...interpolate(a, b, t1)),
            hm = queries.heightAt(...interpolate(a, b, tm));
          const quadratic = 2 * (h1 + h0 - 2 * hm),
            linear = h1 - h0 - quadratic;
          if (body.surfacePolicy === 'carved-ground-v1') {
            if (Math.max(linear, 2 * quadratic + linear) > 1e-6)
              fail(`${p}[${j}]`, 'Carved river ground rises inside a bilinear cell');
          } else {
            const surface = (t: number) =>
              body.surfaceProfileM[j - 1]! * (1 - t) + body.surfaceProfileM[j]! * t;
            const c = h0 - surface(t0),
              l = linear - (surface(t1) - surface(t0));
            const stationary = quadratic ? -l / (2 * quadratic) : -1;
            const peak = Math.max(
              c,
              quadratic + l + c,
              stationary > 0 && stationary < 1
                ? quadratic * stationary * stationary + l * stationary + c
                : -Infinity,
            );
            if (peak > 1e-6)
              fail(
                `${p}[${j}]`,
                'Standing river surface falls below ground inside a bilinear cell',
              );
          }
        }
      }
    }
  validateDrainage(asset, water, budget);
}

function validateDrainage(
  asset: MapAsset,
  water: Map<string, MapAsset['layers']['water'][number]>,
  budget: TopologyBudget,
): void {
  const d = asset.drainage;
  if (!d) return;
  const n = asset.elevation.samples.length,
    columns = asset.elevation.columns;
  for (const key of ['filledSamples', 'downstream', 'accumulation'] as const)
    if (d[key].length !== n)
      fail(`$.drainage.${key}`, 'Drainage arrays must align with original row-major elevation');
  const terminal = new Set<number>();
  for (const i of d.outlets) {
    const x = i % columns,
      y = Math.floor(i / columns);
    if (
      i >= n ||
      terminal.has(i) ||
      (x !== 0 && x !== columns - 1 && y !== 0 && y !== asset.elevation.rows - 1)
    )
      fail('$.drainage.outlets', 'Outlets must be unique boundary sample indices');
    terminal.add(i);
  }
  for (const sink of d.sinks) {
    const lake = water.get(sink.waterId),
      point: Point = [
        (sink.sampleIndex % columns) * asset.elevation.spacingM,
        Math.floor(sink.sampleIndex / columns) * asset.elevation.spacingM,
      ];
    if (
      sink.sampleIndex >= n ||
      terminal.has(sink.sampleIndex) ||
      lake?.kind !== 'lake' ||
      !lake.polygons.some(
        (p) => polygonLocation(point, p, budget, '$.drainage.sinks') !== 'outside',
      )
    )
      fail('$.drainage.sinks', 'Sink must be a unique index inside a linked lake');
    terminal.add(sink.sampleIndex);
  }
  budget.consume('$.drainage', 3 * n);
  const incoming = new Uint32Array(n),
    expected = new Uint32Array(n).fill(1),
    queue = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const to = d.downstream[i]!;
    if (d.filledSamples[i]! < asset.elevation.samples[i]! - 1e-6)
      fail(`$.drainage.filledSamples[${i}]`, 'Filled surface cannot be below original ground');
    if (to === -1) {
      if (!terminal.has(i))
        fail(`$.drainage.downstream[${i}]`, 'Unexplained terminal; declare outlet/lake sink');
      continue;
    }
    if (
      terminal.has(i) ||
      to >= n ||
      to === i ||
      Math.abs((i % columns) - (to % columns)) > 1 ||
      Math.abs(Math.floor(i / columns) - Math.floor(to / columns)) > 1 ||
      d.filledSamples[to]! > d.filledSamples[i]! + 1e-6
    )
      fail(
        `$.drainage.downstream[${i}]`,
        'Flow must descend to a valid D8 neighbour; terminals have no downstream',
      );
    incoming[to] = incoming[to]! + 1;
  }
  let head = 0,
    tail = 0;
  for (let i = 0; i < n; i++) if (!incoming[i]) queue[tail++] = i;
  while (head < tail) {
    const i = queue[head++]!,
      to = d.downstream[i]!;
    if (d.accumulation[i] !== expected[i])
      fail(`$.drainage.accumulation[${i}]`, 'Accumulation must be one plus upstream sample counts');
    if (to >= 0) {
      expected[to] = expected[to]! + expected[i]!;
      incoming[to] = incoming[to]! - 1;
      if (!incoming[to]) queue[tail++] = to;
    }
  }
  if (head !== n) fail('$.drainage.downstream', 'Flow graph contains a cycle');
}
