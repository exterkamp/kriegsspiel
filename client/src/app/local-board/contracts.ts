import type { SceneMark } from '../../legacy/table/types.js';
import type { CertifiedBoard } from '../../shared/game-setup/contracts.js';

/** Local capability: never a live game or engine state. A new mount/replacement gets a fresh UUID. */
export interface LocalScope {
  readonly gameId: `local-${string}`;
  readonly sideId: 'blue';
  readonly playerId: 'local-general';
}
export type LocalSessionKey = LocalScope['gameId'];
export interface LocalBoardBinding {
  readonly assetIdentity: string;
  readonly revision: string;
  readonly mapId: `local-map:${string}`;
  readonly bounds: CertifiedBoard['bounds'];
  readonly registration: {
    readonly origin: 'north-west';
    readonly units: 'metres';
    readonly xAxis: 'east';
    readonly yAxis: 'south';
  };
}
export interface LocalPresentation {
  readonly binding: LocalBoardBinding;
  readonly marks: readonly SceneMark[];
  readonly gameMs: 0;
  readonly rate: 0;
  readonly pieces: readonly [];
  readonly roster: readonly [];
  readonly papers: readonly [];
}
export type LocalInitializationResult =
  | { readonly key: LocalSessionKey; readonly ok: true }
  | { readonly key: LocalSessionKey; readonly ok: false; readonly error: string };
