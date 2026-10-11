import type { MapLayers, Road, Point } from '../contract.js';
import { isLocalRoad } from './assemble.js';
import type { Meter } from './budget.js';

/** Merge only identical street-chain records. Retain every bend and all junctions. */
export function compactLocalStreets(layers: MapLayers, meter: Meter): void {
  meter.take(layers.roads.length * (Math.ceil(Math.log2(layers.roads.length + 1)) + 4));
  const incident = new Map<string, Road[]>();
  for (const r of layers.roads)
    for (const id of [r.fromNodeId, r.toNodeId]) {
      meter.take();
      const list = incident.get(id) ?? [];
      list.push(r);
      incident.set(id, list);
    }
  const compatible = (a: Road, b: Road) =>
    a.kind === 'street' &&
    b.kind === 'street' &&
    isLocalRoad(a) &&
    isLocalRoad(b) &&
    a.siteId === b.siteId &&
    a.widthM === b.widthM &&
    a.surfaceWidthM === b.surfaceWidthM &&
    a.setbackM === b.setbackM &&
    a.crossingIds.length === 0 &&
    b.crossingIds.length === 0 &&
    JSON.stringify(a.routeIds) === JSON.stringify(b.routeIds);
  const next = (road: Road, id: string) => {
    const rows = incident.get(id)!;
    return rows.length === 2 && compatible(rows[0]!, rows[1]!)
      ? rows.find((r) => r.id !== road.id)
      : undefined;
  };
  const seen = new Set<string>(),
    output: Road[] = [];
  for (const r of [...layers.roads].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (seen.has(r.id)) continue;
    const start = next(r, r.fromNodeId)
      ? next(r, r.toNodeId)
        ? undefined
        : r.toNodeId
      : r.fromNodeId;
    if (!isLocalRoad(r) || r.kind !== 'street' || start === undefined) {
      continue;
    }
    let road = r,
      node = start;
    const path: Point[] = [],
      chain: Road[] = [];
    while (!seen.has(road.id)) {
      meter.take(road.path.length + 1);
      seen.add(road.id);
      chain.push(road);
      const points = road.fromNodeId === node ? road.path : [...road.path].reverse();
      path.push(...(path.length ? points.slice(1) : points));
      node = road.fromNodeId === node ? road.toNodeId : road.fromNodeId;
      const following = next(road, node);
      if (!following) break;
      road = following;
    }
    if (start === node) {
      output.push(...chain);
      continue;
    }
    output.push({ ...r, fromNodeId: start, toNodeId: node, path });
  }
  for (const r of layers.roads) if (!seen.has(r.id)) output.push(r);
  const used = new Set(output.flatMap((r) => [r.fromNodeId, r.toNodeId]));
  layers.roads = output;
  layers.roadNodes = layers.roadNodes.filter((n) => used.has(n.id));
}
