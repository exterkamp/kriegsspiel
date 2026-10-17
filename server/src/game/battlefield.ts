import { createHash } from 'node:crypto';
import type { GameState, Point, TerrainMap } from '@kriegsspiel/engine';
import type {
  BattlefieldFeature,
  BattlefieldGeometry,
  BattlefieldPoint,
  ScenarioBattlefield,
} from '@kriegsspiel/protocol';

const pointMetres = (point: Point): BattlefieldPoint => ({
  x: point.x / 1000,
  y: point.y / 1000,
});

/** Stable across object-key order, but sensitive to every static engine terrain attribute. */
function contentHash(content: unknown): string {
  const json = JSON.stringify(content, (_key, value: unknown) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key]]),
    );
  });
  return createHash('sha256').update(json).digest('hex');
}

export function engineTerrainIdentity(map: TerrainMap): string {
  return `engine-terrain-v1:sha256:${contentHash(map)}`;
}

/** Only called for registered, authored scenarios. This is not a generated-map approval API. */
export function describeDefaultBattlefield(
  initialWorld: GameState,
  name: string,
): ScenarioBattlefield {
  if (initialWorld.time !== 0)
    throw new Error('Battlefield descriptors require an initial scenario');
  const { scenarioId, map } = initialWorld;
  const terrainIdentity = engineTerrainIdentity(map);
  const scenarioRevision = `engine-scenario-v1:sha256:${contentHash(initialWorld)}`;
  const preview: BattlefieldFeature[] = map.features.map((feature) => {
    const g = feature.geometry;
    const geometry: BattlefieldGeometry =
      g.shape === 'point'
        ? { shape: 'point', at: pointMetres(g.at), radiusM: g.radius / 1000 }
        : g.shape === 'polyline'
          ? { shape: 'polyline', points: g.points.map(pointMetres), widthM: g.width / 1000 }
          : { shape: 'polygon', points: g.points.map(pointMetres) };
    return {
      id: feature.id,
      kind: feature.kind,
      ...(feature.name === undefined ? {} : { name: feature.name }),
      layer: feature.layer,
      geometry,
    };
  });
  return {
    map: {
      id: `${scenarioId}:default`,
      name,
      source: 'scenario-default',
      terrainIdentity,
      widthM: map.width / 1000,
      heightM: map.height / 1000,
      preview,
    },
    pairing: {
      id: `${scenarioId}:default`,
      revision: scenarioRevision,
      scenarioId,
      scenarioRevision,
      terrainIdentity,
    },
    capabilities: { addMaps: false },
  };
}
