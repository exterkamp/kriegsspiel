import * as THREE from 'three';
import { TableScene } from '../../table/TableScene.js';
import type { BaseMap, SceneMark, SceneState } from '../../table/types.js';
import type {
  CameraBookmark,
  MapPresentation,
  MapSurface,
  PersonalMark,
  Operation,
  Pick,
  PointM,
  Result,
  Scope,
} from '../contracts/index.js';
import { failure, immutable, sameScope, success } from './common.js';
import { demoArtwork } from './fixture.js';
import { parsePresentation } from './presentation.js';

const publicMap: BaseMap = {
  width: demoArtwork.widthM,
  height: demoArtwork.heightM,
  features: [],
};
const finitePoint = (p: PointM) => Number.isFinite(p.x) && Number.isFinite(p.y);
export const inArtwork = (p: PointM): boolean =>
  finitePoint(p) && p.x >= 0 && p.y >= 0 && p.x <= demoArtwork.widthM && p.y <= demoArtwork.heightM;

/** Strip private provenance/scope after presentation validation; renderer receives geometry only. */
function renderMark(mark: PersonalMark): SceneMark {
  const common = { id: mark.id, label: mark.label };
  const geometry = mark.geometry;
  switch (geometry.kind) {
    case 'pin':
      return { ...common, geometry: { kind: 'pin', at: { ...geometry.at } } };
    case 'polyline':
      return {
        ...common,
        geometry: { kind: 'polyline', points: geometry.points.map((point) => ({ ...point })) },
      };
    case 'arrow':
      return {
        ...common,
        geometry: { kind: 'arrow', points: geometry.points.map((point) => ({ ...point })) },
      };
    case 'ring':
      return {
        ...common,
        geometry: { kind: 'ring', centre: { ...geometry.centre }, radiusM: geometry.radiusM },
      };
    case 'symbol':
      return {
        ...common,
        geometry: { kind: 'symbol', at: { ...geometry.at }, symbol: geometry.symbol },
      };
  }
}

/** Public-art fixture surface using the accepted continuous metre renderer. */
export class ContinuousSurface implements MapSurface {
  readonly coordinates = 'metres';
  readonly implementation = 'continuous';
  private table: TableScene | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private presentation: MapPresentation | null = null;
  private disposed = false;
  private active = false;
  private settled: 'desk' | 'table' = 'table';
  private tableCamera: {
    position: THREE.Vector3;
    target: THREE.Vector3;
  } | null = null;
  private applying = false;
  private transitionCancel: (() => void) | null = null;
  private imageCancel: (() => void) | null = null;
  readonly scope: Scope;
  constructor(scope: Scope) {
    this.scope = immutable({ ...scope });
  }
  private unavailable<T>(): Result<T> {
    return this.disposed
      ? failure('disposed', 'The table is closed.')
      : failure('not-ready', 'The table is not ready.');
  }
  async mount(canvas: HTMLCanvasElement, op: Operation): Promise<Result<void>> {
    if (this.disposed) return this.unavailable();
    if (op.signal.aborted) return failure('aborted', 'Table setup cancelled.');
    if (this.table) return failure('conflict', 'The table already owns a canvas.');
    try {
      this.table = new TableScene(canvas);
      this.canvas = canvas;
      return success(undefined);
    } catch {
      this.table?.dispose();
      this.table = null;
      return failure('unsupported', 'This browser could not open the 3D headquarters table.');
    }
  }
  async apply(p: MapPresentation, op: Operation): Promise<Result<void>> {
    if (this.disposed || !this.table) return this.unavailable();
    if (op.signal.aborted) return failure('aborted', 'Table update cancelled.');
    if (this.applying) return failure('conflict', 'Another table update is in progress.');
    const parsed = parsePresentation(p);
    if (!parsed) return failure('invalid-data', 'The table presentation failed validation.');
    p = parsed;
    if (
      !sameScope(this.scope, p.scope) ||
      (p.selection.kind !== 'none' && !sameScope(this.scope, p.selection.scope))
    )
      return failure('scope-mismatch', 'Table data belongs to a different headquarters.');
    if (
      p.mode !== 'fixture-knowledge-preview' ||
      JSON.stringify(p.artwork) !== JSON.stringify(demoArtwork) ||
      p.pieces.length > 1000 ||
      p.pieces.some((piece) => !inArtwork(piece.position)) ||
      !Number.isSafeInteger(p.snapshot.atGame) ||
      !Number.isSafeInteger(p.snapshot.ordinal)
    )
      return failure('invalid-data', 'Unsupported or malformed demonstration map.');
    const old = this.presentation;
    if (
      old &&
      (old.snapshot.epoch !== p.snapshot.epoch ||
        p.snapshot.ordinal < old.snapshot.ordinal ||
        p.snapshot.atGame < old.snapshot.atGame)
    )
      return failure('conflict', 'Obsolete table data was rejected.');
    if (
      old &&
      p.snapshot.ordinal === old.snapshot.ordinal &&
      (p.snapshot.atGame !== old.snapshot.atGame ||
        JSON.stringify(p.pieces) !== JSON.stringify(old.pieces))
    )
      return failure('conflict', 'The same observation contains conflicting table data.');
    if (old && p.revision === old.revision && JSON.stringify(p) !== JSON.stringify(old))
      return failure('conflict', 'The same table revision contains different data.');
    if (old && JSON.stringify(p) === JSON.stringify(old)) return success(undefined);
    const state: SceneState = {
      side: this.scope.sideId,
      map: publicMap,
      marks: p.marks.map(renderMark),
      own: p.pieces
        .filter((piece) => piece.relationship === 'own')
        .map((piece) => ({
          kind: 'own',
          id: piece.unitId,
          side: this.scope.sideId,
          label: piece.label,
          snapshotAtGame: p.snapshot.atGame,
          position: { x: piece.position.x, y: piece.position.y },
          facing: piece.appearance!.facingRad,
          formation: piece.appearance!.formation,
          footprint: {
            frontage: piece.appearance!.frontageM,
            depth: piece.appearance!.depthM,
          },
          ...(piece.appearance!.shape === null
            ? {}
            : {
                shape: piece.appearance!.shape.map((point) => ({ ...point })),
              }),
        })),
      ghosts: p.pieces
        .filter((piece) => piece.relationship === 'enemy')
        .map((piece) => ({
          kind: 'ghost',
          id: piece.unitId,
          position: { x: piece.position.x, y: piece.position.y },
          ageMs: piece.ageMs ?? 0,
          ageTag:
            piece.observedAtGame === null
              ? 'Snapshot'
              : `${Math.floor((piece.ageMs ?? 0) / 60000)}m old`,
          sizeEstimate: piece.label,
          facing: piece.appearance?.facingRad ?? 0,
          uncertaintyRadius: piece.uncertaintyRadiusM ?? 0,
          ...(piece.appearance === null
            ? {}
            : {
                formation: piece.appearance.formation,
                footprint: {
                  frontage: piece.appearance.frontageM,
                  depth: piece.appearance.depthM,
                },
                ...(piece.appearance.shape === null
                  ? {}
                  : {
                      shape: piece.appearance.shape.map((point) => ({
                        ...point,
                      })),
                    }),
              }),
          snapshotAtGame: p.snapshot.atGame,
          ...(piece.observedAtGame === null ? {} : { observedAtGame: piece.observedAtGame }),
        })),
    };
    this.applying = true;
    try {
      const image = old ? null : await this.loadImage(op.signal);
      if (this.disposed || op.signal.aborted) return failure('aborted', 'Table update cancelled.');
      this.table.apply(state, image ?? undefined);
      if (this.disposed) return failure('disposed', 'The table is closed.');
      this.presentation = immutable(structuredClone(p));
      if (this.settled === 'table' && !this.transitionCancel) this.setActive(true);
      return success(undefined);
    } catch {
      if (this.disposed) return failure('disposed', 'The table is closed.');
      return op.signal.aborted
        ? failure('aborted', 'Map loading cancelled.')
        : failure('invalid-data', 'Public map artwork could not be loaded.');
    } finally {
      this.applying = false;
    }
  }
  private loadImage(signal: AbortSignal): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const timer = setTimeout(() => finish(false), 10000);
      const abort = () => finish(false);
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        image.onload = image.onerror = null;
        this.imageCancel = null;
        if (ok) resolve(image);
        else {
          image.src = '';
          reject(new Error('Artwork unavailable'));
        }
      };
      this.imageCancel = abort;
      image.onload = () => finish(image.naturalWidth === 1200 && image.naturalHeight === 900);
      image.onerror = () => finish(false);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) finish(false);
      else image.src = demoArtwork.image.url;
    });
  }
  resize(width: number, height: number, dpr: number): Result<void> {
    if (this.disposed || !this.table) return this.unavailable();
    if (![width, height, dpr].every((n) => Number.isFinite(n) && n > 0))
      return failure('invalid-data', 'Invalid table viewport.');
    this.table.resize(width, height, dpr);
    return success(undefined);
  }
  setActive(active: boolean): Result<void> {
    if (this.disposed || !this.table || !this.presentation) return this.unavailable();
    this.active = active;
    this.table.controls.enabled = active && this.settled === 'table' && !this.transitionCancel;
    if (active) this.table.start();
    else this.table.stop();
    return success(undefined);
  }
  getCamera(): Result<CameraBookmark> {
    if (this.disposed || !this.table || !this.presentation) return this.unavailable();
    const camera = this.settled === 'desk' ? this.tableCamera : null;
    const target = camera?.target ?? this.table.controls.target;
    const delta = (camera?.position ?? this.table.camera.position).clone().sub(target);
    const at = {
      x: target.x + publicMap.width / 2,
      y: target.z + publicMap.height / 2,
    };
    if (!inArtwork(at))
      return failure('invalid-data', 'The camera is outside the demonstration map.');
    return success({
      mapId: demoArtwork.id,
      mapRevision: demoArtwork.revision,
      target: at,
      distanceM: delta.length(),
      azimuthRad: Math.atan2(delta.x, delta.z),
      tiltRad: Math.acos(Math.max(-1, Math.min(1, delta.y / delta.length()))),
    });
  }
  restoreCamera(c: CameraBookmark): Result<void> {
    if (this.disposed || !this.table || !this.presentation) return this.unavailable();
    if (this.transitionCancel)
      return failure('conflict', 'A table transition is still in progress.');
    if (
      c.mapId !== demoArtwork.id ||
      c.mapRevision !== demoArtwork.revision ||
      !inArtwork(c.target) ||
      !Number.isFinite(c.distanceM) ||
      c.distanceM < this.table.controls.minDistance ||
      c.distanceM > this.table.controls.maxDistance ||
      !Number.isFinite(c.azimuthRad) ||
      !Number.isFinite(c.tiltRad) ||
      c.tiltRad < 0 ||
      c.tiltRad > this.table.controls.maxPolarAngle ||
      c.tiltRad < this.table.controls.minPolarAngle
    )
      return failure('invalid-data', 'The camera bookmark does not match this map.');
    const target = new THREE.Vector3(
      c.target.x - publicMap.width / 2,
      0,
      c.target.y - publicMap.height / 2,
    );
    const offset = new THREE.Vector3().setFromSpherical(
      new THREE.Spherical(c.distanceM, c.tiltRad, c.azimuthRad),
    );
    if (this.settled === 'desk') {
      this.tableCamera = { target, position: target.clone().add(offset) };
      return success(undefined);
    }
    this.table.controls.target.copy(target);
    this.table.camera.position.copy(target.clone().add(offset));
    this.table.controls.update();
    return success(undefined);
  }
  async transitionTo(
    view: 'desk' | 'table',
    reducedMotion: boolean,
    op: Operation,
  ): Promise<Result<void>> {
    if (this.disposed || !this.table || !this.presentation) return this.unavailable();
    if (op.signal.aborted) return failure('aborted', 'Navigation cancelled.');
    if (this.transitionCancel)
      return failure('conflict', 'A table transition is still in progress.');
    if (view === this.settled) return success(undefined);
    const table = this.table;
    const before = {
      position: table.camera.position.clone(),
      target: table.controls.target.clone(),
      active: this.active,
      settled: this.settled,
      bookmark: this.tableCamera,
    };
    if (view === 'desk')
      this.tableCamera = {
        position: before.position.clone(),
        target: before.target.clone(),
      };
    const goal =
      view === 'table' && this.tableCamera
        ? this.tableCamera
        : {
            position: before.position
              .clone()
              .add(new THREE.Vector3(0, -publicMap.width * 0.15, publicMap.width * 0.3)),
            target: before.target.clone(),
          };
    table.controls.enabled = false;
    try {
      table.start();
    } catch {
      this.tableCamera = before.bookmark;
      table.controls.enabled = before.active && before.settled === 'table';
      return failure('internal', 'The table transition could not start.');
    }
    this.active = true;
    return new Promise((resolve) => {
      let frame = 0;
      let finished = false;
      const start = performance.now();
      const rollback = () => {
        table.camera.position.copy(before.position);
        table.controls.target.copy(before.target);
        this.settled = before.settled;
        this.tableCamera = before.bookmark;
        this.active = before.active;
        table.controls.enabled = before.active && before.settled === 'table';
        try {
          if (before.active) table.start();
          else table.stop();
          table.controls.update();
        } catch {
          // Keep the restored values even when the rendering port itself fails.
        }
      };
      const finish = (aborted: boolean, failed = false) => {
        if (finished) return;
        finished = true;
        cancelAnimationFrame(frame);
        op.signal.removeEventListener('abort', abort);
        this.transitionCancel = null;
        if (this.disposed) {
          resolve(failure('disposed', 'The table is closed.'));
          return;
        }
        if (aborted || failed) {
          rollback();
          resolve(
            failure(
              failed ? 'internal' : 'aborted',
              failed ? 'The table transition failed.' : 'Navigation cancelled.',
            ),
          );
          return;
        }
        try {
          table.camera.position.copy(goal.position);
          table.controls.target.copy(goal.target);
          table.controls.update();
          table.renderer.render(table.scene, table.camera);
          this.settled = view;
          this.setActive(view === 'table');
          resolve(success(undefined));
        } catch {
          rollback();
          resolve(failure('internal', 'The table transition failed.'));
        }
      };
      const abort = () => finish(true);
      this.transitionCancel = abort;
      op.signal.addEventListener('abort', abort, { once: true });
      const tick = (now: number) => {
        if (op.signal.aborted || this.disposed) {
          finish(true);
          return;
        }
        try {
          const t = reducedMotion ? 1 : Math.min(1, (now - start) / 240);
          const ease = t * t * (3 - 2 * t);
          table.camera.position.lerpVectors(before.position, goal.position, ease);
          table.controls.target.lerpVectors(before.target, goal.target, ease);
          table.controls.update();
          if (t === 1) finish(false);
          else frame = requestAnimationFrame(tick);
        } catch {
          finish(false, true);
        }
      };
      if (reducedMotion) tick(start);
      else frame = requestAnimationFrame(tick);
    });
  }
  snap(view: 'top-down' | 'oblique'): Result<void> {
    if (this.disposed || !this.table || !this.active) return this.unavailable();
    if (view === 'top-down') this.table.snapTopDown();
    else this.table.snapOblique();
    return success(undefined);
  }
  async focusAt(at: PointM, op: Operation): Promise<Result<void>> {
    if (this.disposed || !this.table || !this.active) return this.unavailable();
    if (op.signal.aborted) return failure('aborted', 'Focus cancelled.');
    if (!inArtwork(at)) return failure('invalid-data', 'This location is outside the map.');
    const table = this.table;
    const old = table.controls.target.clone();
    table.controls.target.set(at.x - publicMap.width / 2, 0, at.y - publicMap.height / 2);
    table.camera.position.add(table.controls.target.clone().sub(old));
    table.controls.update();
    return success(undefined);
  }
  pickAt(x: number, y: number): Result<Pick> {
    if (this.disposed || !this.table || !this.canvas || !this.active) return this.unavailable();
    const rect = this.canvas.getBoundingClientRect();
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < rect.left ||
      x > rect.right ||
      y < rect.top ||
      y > rect.bottom ||
      !rect.width ||
      !rect.height
    )
      return success({ kind: 'none' });
    const picked = this.table.pickAt(x, y);
    if (picked.type === 'piece') {
      const piece = this.presentation?.pieces.find(
        (p) =>
          p.unitId === picked.id && (p.relationship === 'own') === (picked.pieceKind === 'own'),
      );
      if (piece && inArtwork(picked.coord))
        return success({
          kind: 'piece',
          key: piece.key,
          unitId: piece.unitId,
          at: { ...picked.coord },
        });
    }
    return success(
      picked.type === 'point' && inArtwork(picked.coord)
        ? { kind: 'map', at: { ...picked.coord } }
        : { kind: 'none' },
    );
  }
  project(at: PointM): Result<{ clientXCssPx: number; clientYCssPx: number } | null> {
    if (this.disposed || !this.table || !this.canvas || !this.presentation)
      return this.unavailable();
    if (!inArtwork(at)) return failure('invalid-data', 'This location is outside the map.');
    this.table.camera.updateMatrixWorld();
    const v = new THREE.Vector3(at.x - publicMap.width / 2, 0, at.y - publicMap.height / 2).project(
      this.table.camera,
    );
    if (Math.abs(v.x) > 1 || Math.abs(v.y) > 1 || Math.abs(v.z) > 1) return success(null);
    const r = this.canvas.getBoundingClientRect();
    return success({
      clientXCssPx: r.left + ((v.x + 1) / 2) * r.width,
      clientYCssPx: r.top + ((1 - v.y) / 2) * r.height,
    });
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.transitionCancel?.();
    this.imageCancel?.();
    this.table?.dispose();
    this.table = null;
    this.canvas = null;
    this.presentation = null;
  }
}
