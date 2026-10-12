import type { PreviewAsset } from '../../legacy/map-authoring/asset.js';
import type { ReplayParameters } from '../../legacy/map-authoring/generation/protocol.js';

export type MapRef = { readonly kind: 'premade' | 'generated'; readonly id: string };
export interface MapSummary {
  readonly ref: MapRef;
  readonly name: string;
  readonly widthM: number;
  readonly heightM: number;
}
export interface MapCatalog {
  list(signal: AbortSignal): Promise<MapSummary[]>;
  read(ref: MapRef, signal: AbortSignal): Promise<string>;
  save(canonicalJson: string, signal: AbortSignal): Promise<MapSummary>;
}
/** Runtime-only detached output of CURRENT complete certification and matching export.
 * Generation has no saved reference until catalog.save succeeds. Start requires one.
 * Identity is assetIdentity(asset, 'asset'), never geometry/recipe identity.
 */
export interface CertifiedBoard {
  readonly asset: PreviewAsset;
  readonly canonicalJson: string;
  readonly assetIdentity: string;
  readonly summary: Omit<MapSummary, 'ref'> & { readonly ref: MapRef | null };
  readonly bounds: {
    readonly minX: 0;
    readonly minY: 0;
    readonly maxX: number;
    readonly maxY: number;
  };
}
export interface BoardPreparation {
  load(json: string, summary: MapSummary, signal: AbortSignal): Promise<CertifiedBoard>;
  generate(recipe: ReplayParameters, signal: AbortSignal): Promise<CertifiedBoard>;
  dispose(): void;
}
export interface SetupProps {
  catalog: MapCatalog;
  preparation: BoardPreparation;
  initialRef?: MapRef;
  onStart(board: CertifiedBoard): Promise<void>;
  onCancel(): void;
}
