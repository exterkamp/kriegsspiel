/** Public, static geography only. Coordinates are metres, east/south from the north-west corner. */
export interface BattlefieldPoint {
  readonly x: number;
  readonly y: number;
}

export type BattlefieldGeometry =
  | { readonly shape: 'polygon'; readonly points: readonly BattlefieldPoint[] }
  | {
      readonly shape: 'polyline';
      readonly points: readonly BattlefieldPoint[];
      readonly widthM: number;
    }
  | { readonly shape: 'point'; readonly at: BattlefieldPoint; readonly radiusM: number };

export interface BattlefieldFeature {
  readonly id: string;
  readonly kind:
    | 'field'
    | 'wood'
    | 'marsh'
    | 'water'
    | 'road'
    | 'river'
    | 'stream'
    | 'bridge'
    | 'ford'
    | 'building';
  readonly name?: string;
  readonly layer: number;
  readonly geometry: BattlefieldGeometry;
}

/** A display descriptor is neither a canonical authoring asset nor a playable scenario. */
export interface BattlefieldMap {
  readonly id: string;
  readonly name: string;
  readonly source: 'scenario-default' | 'included' | 'owned';
  /** Versioned SHA-256 identity of the source terrain, including gameplay terrain attributes. */
  readonly terrainIdentity: string;
  readonly widthM: number;
  readonly heightM: number;
  readonly preview: readonly BattlefieldFeature[];
}

/** Server-issued approval of an exact terrain/scenario assembly, never inferred by a client. */
export interface BattlefieldPairing {
  readonly id: string;
  readonly revision: string;
  readonly scenarioId: string;
  readonly scenarioRevision: string;
  readonly terrainIdentity: string;
}

/** The current scenario's approved default; no library or alternative-map creation implied. */
export interface ScenarioBattlefield {
  readonly map: BattlefieldMap;
  readonly pairing: BattlefieldPairing;
  readonly capabilities: { readonly addMaps: boolean };
}
