import * as THREE from 'three';
import type { Coord } from '@kriegsspiel/protocol';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mapCanvas } from './mapTexture.js';
import { mapToWorld, pickFromRay, pickMinSize, rayToMap, type PickResult } from './picking.js';
import { facingToRotationY, fitDistance } from './framing.js';
import { createDressing, positionDressing } from './dressing.js';
import { ghostOpacity, tagLines } from './tagText.js';
import { createMarkGroup, markSignature, validateSceneMarks } from './fixtureMarks.js';
import type { BaseMap, GhostPiece, OwnPiece, SceneState } from './types.js';

const SIDE_COLOURS: Record<string, number> = { blue: 0x2f55a4, red: 0xa83232 };
export const MAX_ARTWORK_TEXTURE_PX = 4096;

function labelTexture(lines: readonly string[], ghost: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = ghost ? '#efe6c8' : '#f4eedb';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#3b2f1c';
    ctx.strokeRect(1, 1, c.width - 2, c.height - 2);
    ctx.fillStyle = '#2a2014';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((line, index) => {
      ctx.font = index === 0 ? 'bold 28px serif' : '24px serif';
      ctx.fillText(line, c.width / 2, 25 + index * 35, c.width - 24);
    });
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export type PreviewRaster = Readonly<{
  canvas: HTMLCanvasElement;
  sourceKey: string;
  widthM: number;
  heightM: number;
  contentWidthPx: number;
  contentHeightPx: number;
}>;

export type PreviewResourceCounts = Readonly<{
  textures: number;
  geometries: number;
}>;
export type PreviewSceneObservation = Readonly<{
  sourceKey: string;
  deviceMaxTextureSizePx: number | null;
  resources: PreviewResourceCounts | null;
}>;

export class PreviewApplyError extends Error {
  constructor(
    message: string,
    readonly display: 'retained' | 'unavailable',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PreviewApplyError';
  }
}

interface PieceObject {
  group: THREE.Group;
  geometrySignature: string;
  tagSignature: string;
}

interface MarkObject {
  group: THREE.Group;
  signature: string;
}

/** Owns a continuous metre scene. Replacements are prepared before the commit. */
export class TableScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  private state: SceneState | undefined;
  private mapKey = '';
  private mapMesh: THREE.Mesh | undefined;
  private tableMesh: THREE.Mesh | undefined;
  private pieces = new Map<string, PieceObject>();
  private piecesRoot = new THREE.Group();
  private marks = new Map<string, MarkObject>();
  private marksRoot = new THREE.Group();
  private dressing: THREE.Group | undefined;
  private artworkImage: HTMLImageElement | undefined;
  private raf = 0;
  private renderGeneration = 0;
  private disposed = false;
  private readonly mode: 'fixture' | 'public-map-preview';
  private applyingPreview = false;
  private previewAvailable = false;
  private previewRenderFailed = false;
  private onPreviewUnavailable: ((error: PreviewApplyError) => void) | undefined;
  // Record before dispatching Three's synchronous disposal event. Terminal
  // cleanup can re-enter while a replaced resource is still being released.
  private releasedResources = new WeakSet<{ dispose(): void }>();
  private releaseResource = (resource?: { dispose(): void } | null): void => {
    if (!resource || this.releasedResources.has(resource)) return;
    this.releasedResources.add(resource);
    try {
      resource.dispose();
    } catch (error) {
      // User disposal listeners must not interrupt preview cleanup or publication.
      if (this.mode !== 'public-map-preview') throw error;
    }
  };
  private releaseTree(object: THREE.Object3D): void {
    disposeTree(object, this.releaseResource);
  }

  constructor(
    readonly canvas: HTMLCanvasElement,
    opts: {
      preserveDrawingBuffer?: boolean;
      mode?: 'fixture' | 'public-map-preview';
      onPreviewUnavailable?: (error: PreviewApplyError) => void;
    } = {},
  ) {
    this.mode = opts.mode ?? 'fixture';
    if (!['fixture', 'public-map-preview'].includes(this.mode))
      throw new TypeError('Invalid table mode');
    this.onPreviewUnavailable =
      this.mode === 'public-map-preview' ? opts.onPreviewUnavailable : undefined;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
    });
    this.camera = new THREE.PerspectiveCamera(45, 1, 10, 100_000);
    let controls: OrbitControls | undefined;
    try {
      this.renderer.localClippingEnabled = true;
      this.scene.background = new THREE.Color(0x2a2118);
      controls = new OrbitControls(this.camera, canvas);
      this.controls = controls;
      controls.addEventListener('change', this.clipPaperLabels);
      controls.enablePan = true;
      controls.enableDamping = false;
      controls.minPolarAngle = 0;
      controls.maxPolarAngle = Math.PI * 0.42;
      this.scene.add(new THREE.AmbientLight(0xfff2d8, 0.7));
      const lamp = new THREE.DirectionalLight(0xffe2b0, 1.1);
      lamp.position.set(-12, 25, 10);
      this.marksRoot.name = 'marks-root';
      this.scene.add(lamp, this.piecesRoot, this.marksRoot);
      this.dressing = createDressing();
      this.scene.add(this.dressing);
      this.resize();
    } catch (error) {
      controls?.dispose();
      this.releaseTree(this.scene);
      this.scene.clear();
      this.renderer.dispose();
      throw error;
    }
  }

  /** The adapter loads/cancels images; this synchronous operation validates before mutation. */
  apply(state: SceneState, loadedImage?: HTMLImageElement): void {
    if (this.mode !== 'fixture') throw new TypeError('Preview tables reject fixture state');
    if (this.disposed) return;
    this.validateState(state);
    const marks = validateSceneMarks(state.marks === undefined ? [] : state.marks, state.map);
    if (loadedImage) this.validateArtwork(loadedImage, state.map);
    const mapKey = JSON.stringify(state.map);
    const dimensionsChanged =
      !this.state ||
      this.state.map.width !== state.map.width ||
      this.state.map.height !== state.map.height;
    const image = loadedImage ?? (dimensionsChanged ? undefined : this.artworkImage);
    // Public art supersedes fallback features. Equal extents/art do not reallocate the map.
    const rebuildMap = dimensionsChanged || (!image && mapKey !== this.mapKey);
    const nextPieces = new Map<string, PieceObject>();
    const nextMarks = new Map<string, MarkObject>();
    const created: THREE.Object3D[] = [];
    const tags = new Map<string, THREE.CanvasTexture>();
    let mapGroup: THREE.Group | undefined;
    let replacementTexture: THREE.Texture | undefined;
    const discard = () => {
      if (mapGroup) this.releaseTree(mapGroup);
      this.releaseResource(replacementTexture);
      created.forEach((object) => this.releaseTree(object));
      tags.forEach(this.releaseResource);
    };
    const terminated = () => {
      if (!this.disposed) return false;
      // Some staged objects/textures may already have joined the live scene.
      // The release ledger makes overlap with terminal cleanup harmless.
      discard();
      return true;
    };
    try {
      if (rebuildMap) mapGroup = this.makeMap(state.map, image);
      else if (image && image !== this.artworkImage) replacementTexture = this.artTexture(image);
      for (const p of [...state.own, ...state.ghosts]) {
        const key = `${p.kind}:${p.id}`;
        const geometrySignature = JSON.stringify([
          Math.max(state.map.width, state.map.height),
          p.footprint,
          p.shape,
          p.kind === 'ghost' ? p.uncertaintyRadius : null,
        ]);
        const tagSignature = JSON.stringify(tagLines(p));
        const old = this.pieces.get(key);
        if (!old || old.geometrySignature !== geometrySignature) {
          const group = this.makePiece(p, state.map);
          created.push(group);
          nextPieces.set(key, { group, geometrySignature, tagSignature });
        } else {
          nextPieces.set(key, { ...old, tagSignature });
          if (old.tagSignature !== tagSignature)
            tags.set(key, labelTexture(tagLines(p), p.kind === 'ghost'));
        }
      }
      for (const mark of marks) {
        const signature = markSignature(mark, state.map);
        const old = this.marks.get(mark.id);
        if (old?.signature === signature) nextMarks.set(mark.id, old);
        else {
          const group = createMarkGroup(mark, state.map);
          created.push(group);
          nextMarks.set(mark.id, { group, signature });
        }
      }
    } catch (error) {
      discard();
      throw error;
    }
    if (terminated()) return;

    // All candidate geometry, paper and artwork is now allocated and validated.
    if (mapGroup) {
      for (const old of [this.mapMesh, this.tableMesh]) {
        if (old) {
          this.scene.remove(old);
          this.releaseTree(old);
          if (terminated()) return;
        }
      }
      this.mapMesh = mapGroup.getObjectByName('map-artwork') as THREE.Mesh;
      this.tableMesh = mapGroup.getObjectByName('table-board') as THREE.Mesh;
      this.scene.add(this.mapMesh);
      if (terminated()) return;
      this.scene.add(this.tableMesh);
      if (terminated()) return;
    } else if (replacementTexture) {
      const material = this.mapMesh!.material as THREE.MeshStandardMaterial;
      const previous = material.map;
      material.map = replacementTexture;
      material.needsUpdate = true;
      this.releaseResource(previous);
      if (terminated()) return;
    }
    for (const [key, old] of this.pieces) {
      if (nextPieces.get(key)?.group !== old.group) {
        this.piecesRoot.remove(old.group);
        this.releaseTree(old.group);
        if (terminated()) return;
      }
    }
    const clippingPlanes = this.mapClipping(state.map);
    for (const p of [...state.own, ...state.ghosts]) {
      const key = `${p.kind}:${p.id}`;
      const obj = nextPieces.get(key)!;
      if (obj.group.parent !== this.piecesRoot) this.piecesRoot.add(obj.group);
      if (terminated()) return;
      const tag = obj.group.getObjectByName('paper-tag') as THREE.Sprite;
      const texture = tags.get(key);
      if (texture) {
        const previous = tag.material.map;
        tag.material.map = texture;
        tag.material.needsUpdate = true;
        tag.userData.lines = tagLines(p);
        this.releaseResource(previous);
        if (terminated()) return;
      }
      obj.group.position.copy(mapToWorld(state.map, p.position));
      // Keep the camera-facing quad inside the paper for any billboard orientation.
      // Only the decoration moves; the supplied piece position and pick meshes do not.
      const tagRadius = Math.hypot(tag.scale.x, tag.scale.y) / 2;
      const insetX = Math.min(tagRadius, state.map.width / 2);
      const insetZ = Math.min(tagRadius, state.map.height / 2);
      const tagOffset = tag.userData.offsetZ as number;
      tag.position.x =
        THREE.MathUtils.clamp(
          obj.group.position.x,
          -state.map.width / 2 + insetX,
          state.map.width / 2 - insetX,
        ) - obj.group.position.x;
      tag.position.z =
        THREE.MathUtils.clamp(
          obj.group.position.z + tagOffset,
          -state.map.height / 2 + insetZ,
          state.map.height / 2 - insetZ,
        ) - obj.group.position.z;
      // The installed Three sprite shader clips its expanded view-space vertices/fragments.
      tag.material.clippingPlanes = clippingPlanes;
      obj.group.getObjectByName('body')!.rotation.y = facingToRotationY(p.facing);
      obj.group.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!(
          mesh.material instanceof THREE.MeshStandardMaterial ||
          mesh.material instanceof THREE.MeshBasicMaterial
        ))
          return;
        if (p.kind === 'ghost' && mesh.userData.fadeRatio !== undefined)
          mesh.material.opacity = ghostOpacity(p.ageMs) * mesh.userData.fadeRatio;
        if (p.kind === 'own' && mesh.userData.sideColour)
          mesh.material.color.setHex(SIDE_COLOURS[p.side] ?? 0x666666);
        if (object.userData.clipToMap) mesh.material.clippingPlanes = clippingPlanes;
      });
      tag.material.opacity = p.kind === 'ghost' ? 0.65 + ghostOpacity(p.ageMs) * 0.5 : 1;
    }
    this.pieces = nextPieces;
    for (const [id, old] of this.marks) {
      if (nextMarks.get(id)?.group !== old.group) {
        this.marksRoot.remove(old.group);
        this.releaseTree(old.group);
        if (terminated()) return;
      }
    }
    for (const mark of nextMarks.values()) {
      if (mark.group.parent !== this.marksRoot) this.marksRoot.add(mark.group);
      if (terminated()) return;
    }
    this.marks = nextMarks;
    this.state = state;
    this.mapKey = mapKey;
    this.artworkImage = image;
    if (this.dressing) positionDressing(this.dressing, state.map.width, state.map.height);
    this.updateCameraLimits();
    if (dimensionsChanged) this.snapTopDown();
    this.clipPaperLabels();
  }

  private validateState(state: SceneState): void {
    const { map } = state;
    if (
      !Number.isFinite(map.width) ||
      !Number.isFinite(map.height) ||
      map.width <= 0 ||
      map.height <= 0 ||
      !Array.isArray(map.features)
    )
      throw new RangeError('Invalid continuous map dimensions');
    const ids = new Set<string>();
    for (const p of [...state.own, ...state.ghosts]) {
      const key = `${p.kind}:${p.id}`;
      if (
        ids.has(key) ||
        !Number.isFinite(p.position.x) ||
        !Number.isFinite(p.position.y) ||
        p.position.x < 0 ||
        p.position.x > map.width ||
        p.position.y < 0 ||
        p.position.y > map.height ||
        !Number.isFinite(p.facing) ||
        (p.footprint &&
          (!Number.isFinite(p.footprint.frontage) ||
            !Number.isFinite(p.footprint.depth) ||
            p.footprint.frontage <= 0 ||
            p.footprint.depth <= 0)) ||
        p.shape?.some((s) => !Number.isFinite(s.x) || !Number.isFinite(s.y)) ||
        (p.kind === 'ghost' && (!Number.isFinite(p.uncertaintyRadius) || p.uncertaintyRadius < 0))
      )
        throw new RangeError('Invalid continuous piece geometry');
      ids.add(key);
    }
  }

  private validateArtwork(image: HTMLImageElement, map: BaseMap): void {
    const source = new URL(image.currentSrc || image.src, window.location.href);
    const limit = Math.min(
      MAX_ARTWORK_TEXTURE_PX,
      this.renderer.capabilities?.maxTextureSize ?? MAX_ARTWORK_TEXTURE_PX,
    );
    if (
      source.origin !== window.location.origin ||
      source.pathname !== '/hq-preview.svg' ||
      source.search ||
      source.hash ||
      source.username ||
      source.password ||
      !['http:', 'https:'].includes(source.protocol) ||
      !image.complete ||
      image.naturalWidth !== 1200 ||
      image.naturalHeight !== 900 ||
      image.naturalWidth > limit ||
      image.naturalHeight > limit ||
      image.naturalWidth * map.height !== image.naturalHeight * map.width
    )
      throw new RangeError('Public fixture artwork is unavailable or outside preview limits');
  }

  private artTexture(image: HTMLImageElement): THREE.Texture {
    const texture = new THREE.Texture(image);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    return texture;
  }

  /** Standalone sampling utility; no network work or camera change. */
  setArtwork(image: HTMLImageElement): void {
    if (this.mode !== 'fixture') throw new TypeError('Preview tables reject external artwork');
    if (this.disposed || !this.state || !this.mapMesh) return;
    this.validateArtwork(image, this.state.map);
    if (this.artworkImage === image) return;
    const texture = this.artTexture(image);
    const material = this.mapMesh.material as THREE.MeshStandardMaterial;
    const previous = material.map;
    material.map = texture;
    material.needsUpdate = true;
    this.artworkImage = image;
    this.releaseResource(previous);
  }

  private requirePreview(): void {
    if (this.mode !== 'public-map-preview')
      throw new TypeError('Fixture tables reject preview rasters');
  }

  previewTextureLimit(): number {
    this.requirePreview();
    if (this.disposed) throw new PreviewApplyError('Table is disposed', 'unavailable');
    const limit = Math.min(MAX_ARTWORK_TEXTURE_PX, this.renderer.capabilities.maxTextureSize);
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new PreviewApplyError('Invalid device texture limit', 'unavailable');
    return limit;
  }

  /** Historical value snapshot; renderer-managed counts are not GPU byte totals. */
  previewObservation(): PreviewSceneObservation | null {
    this.requirePreview();
    const sourceKey = this.mapKey;
    const map = this.mapMesh;
    const current = () =>
      !this.disposed &&
      !this.applyingPreview &&
      this.previewAvailable &&
      !this.previewRenderFailed &&
      this.mapKey === sourceKey &&
      this.mapMesh === map;
    const available = () => {
      if (!current()) return false;
      try {
        // Read the existing context only; failures here have no display authority.
        return !this.contextLost() && current();
      } catch {
        return false;
      }
    };
    if (!available()) return null;
    let deviceMaxTextureSizePx: number | null = null;
    let resources: PreviewResourceCounts | null = null;
    try {
      const maximum = this.renderer.capabilities.maxTextureSize;
      if (Number.isSafeInteger(maximum) && maximum > 0) deviceMaxTextureSizePx = maximum;
    } catch {
      // Observations cannot change display authority or lifetime.
    }
    if (!current()) return null;
    try {
      const { textures, geometries } = this.renderer.info.memory;
      if ([textures, geometries].every((n) => Number.isSafeInteger(n) && n >= 0))
        resources = Object.freeze({ textures, geometries });
    } catch {
      // A missing counter remains explicitly unavailable.
    }
    if (!available()) return null;
    return Object.freeze({ sourceKey, deviceMaxTextureSizePx, resources });
  }

  private contextLost(): boolean {
    return this.renderer.getContext().isContextLost();
  }

  /** A synchronous rendered transaction. Old resources survive until the candidate frame succeeds. */
  applyPreviewRaster(raster: PreviewRaster): void {
    this.requirePreview();
    const display = () =>
      this.previewAvailable && !this.previewRenderFailed && !this.disposed && !this.contextLost()
        ? ('retained' as const)
        : ('unavailable' as const);
    if (this.applyingPreview)
      throw new PreviewApplyError('Nested preview replacement rejected', display());
    if (this.disposed) throw new PreviewApplyError('Table is disposed', 'unavailable');
    if (this.previewRenderFailed)
      throw new PreviewApplyError('Table rendering failed; reload the page', 'unavailable');
    this.applyingPreview = true;
    let candidate: THREE.Group | undefined;
    let candidateMap: THREE.Mesh | undefined;
    let candidateBoard: THREE.Mesh | undefined;
    const ensureAlive = () => {
      if (this.disposed) throw new Error('Table disposed during preview transaction');
    };
    const detachCandidate = () => {
      for (const object of [candidate, candidateMap, candidateBoard]) object?.removeFromParent();
    };
    const releaseCandidate = () => {
      for (const object of [candidate, candidateMap, candidateBoard])
        if (object) this.releaseTree(object);
      candidate?.clear();
    };
    let committed = false;
    const previous = {
      state: this.state,
      key: this.mapKey,
      map: this.mapMesh,
      board: this.tableMesh,
      position: this.camera.position.clone(),
      quaternion: this.camera.quaternion.clone(),
      target: this.controls.target.clone(),
      dressingPosition: this.dressing?.position.clone(),
      dressingScale: this.dressing?.scale.clone(),
    };
    try {
      const limit = this.previewTextureLimit();
      const { canvas, widthM, heightM, contentWidthPx: w, contentHeightPx: h } = raster;
      if (
        !(canvas instanceof HTMLCanvasElement) ||
        typeof raster.sourceKey !== 'string' ||
        !raster.sourceKey ||
        ![widthM, heightM, w, h].every((v) => Number.isFinite(v) && v > 0) ||
        ![canvas.width, canvas.height].every(
          (v) => Number.isSafeInteger(v) && v > 0 && v <= limit,
        ) ||
        canvas.width * canvas.height > limit * limit ||
        w > canvas.width ||
        h > canvas.height ||
        Math.abs(w / widthM - h / heightM) > Math.max(w / widthM, h / heightM) * 1e-10
      )
        throw new RangeError('Preview raster exceeds bounds or has nonuniform registration');
      const state: SceneState = {
        side: '',
        map: { width: widthM, height: heightM, features: [] },
        own: [],
        ghosts: [],
        marks: [],
      };
      candidate = this.makeMap(state.map, undefined, raster);
      const map = (candidateMap = candidate.getObjectByName('map-artwork') as THREE.Mesh);
      const board = (candidateBoard = candidate.getObjectByName('table-board') as THREE.Mesh);
      ensureAlive();
      for (const old of [previous.map, previous.board])
        if (old) {
          this.scene.remove(old);
          ensureAlive();
        }
      this.scene.add(candidate);
      ensureAlive();
      this.state = state;
      this.updateCameraLimits();
      if (previous.key !== raster.sourceKey) this.snapTopDown();
      if (this.dressing) positionDressing(this.dressing, widthM, heightM);
      if (this.disposed || this.contextLost()) throw new Error('WebGL display is unavailable');
      this.renderer.render(this.scene, this.camera);
      if (this.disposed || this.contextLost())
        throw new Error('Table became unavailable during render');
      // Three dispatches synchronous removed/added/childadded events for each object.
      // Terminal disposal in any one event must prevent the next attachment.
      candidate.remove(map);
      ensureAlive();
      candidate.remove(board);
      ensureAlive();
      this.scene.remove(candidate);
      ensureAlive();
      this.scene.add(map);
      ensureAlive();
      this.scene.add(board);
      ensureAlive();
      this.mapMesh = map;
      this.tableMesh = board;
      this.mapKey = raster.sourceKey;
      this.previewAvailable = true;
      committed = true;
      for (const old of [previous.map, previous.board]) if (old) this.releaseTree(old);
      if (this.disposed) throw new Error('Table disposed during replacement cleanup');
    } catch (error) {
      detachCandidate();
      if (committed || this.disposed) {
        releaseCandidate();
        for (const old of [previous.map, previous.board]) if (old) this.releaseTree(old);
        this.previewAvailable = false;
        if (this.disposed) {
          this.state = undefined;
          this.mapKey = '';
          this.mapMesh = this.tableMesh = undefined;
        }
        throw new PreviewApplyError('Table display is unavailable', 'unavailable', {
          cause: error,
        });
      }
      this.state = previous.state;
      this.mapKey = previous.key;
      this.mapMesh = previous.map;
      this.tableMesh = previous.board;
      for (const old of [previous.map, previous.board])
        if (old && !this.disposed) this.scene.add(old);
      if (this.disposed) {
        releaseCandidate();
        for (const old of [previous.map, previous.board]) if (old) this.releaseTree(old);
        this.previewAvailable = false;
        throw new PreviewApplyError('Table disposed during restoration', 'unavailable', {
          cause: error,
        });
      }
      this.camera.position.copy(previous.position);
      this.controls.target.copy(previous.target);
      this.camera.quaternion.copy(previous.quaternion);
      this.updateCameraLimits();
      if (this.dressing && previous.dressingPosition && previous.dressingScale) {
        this.dressing.position.copy(previous.dressingPosition);
        this.dressing.scale.copy(previous.dressingScale);
      }
      releaseCandidate();
      try {
        if (this.disposed || this.contextLost()) throw new Error('WebGL unavailable');
        this.renderer.render(this.scene, this.camera);
        if (this.disposed || this.contextLost()) throw new Error('WebGL unavailable');
      } catch {
        this.previewAvailable = false;
      }
      throw new PreviewApplyError(
        error instanceof Error ? error.message : 'Preview replacement failed',
        display(),
        { cause: error },
      );
    } finally {
      this.applyingPreview = false;
    }
  }

  fitPreview(): void {
    this.requirePreview();
    if (this.applyingPreview)
      throw new PreviewApplyError('Preview transaction is active', 'unavailable');
    if (!this.disposed && this.state) this.snapTopDown();
  }

  private makeMap(map: BaseMap, image?: HTMLImageElement, raster?: PreviewRaster): THREE.Group {
    const group = new THREE.Group();
    const allocated: { dispose(): void }[] = [];
    const own = <T extends { dispose(): void }>(resource: T): T => {
      allocated.push(resource);
      return resource;
    };
    try {
      const texture = own(
        raster
          ? new THREE.CanvasTexture(raster.canvas)
          : image
            ? this.artTexture(image)
            : new THREE.CanvasTexture(mapCanvas(map)),
      );
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = raster ? Math.min(8, this.renderer.capabilities.getMaxAnisotropy()) : 8;
      const geometry = own(new THREE.PlaneGeometry(map.width, map.height));
      if (raster) {
        const uv = geometry.getAttribute('uv');
        for (let i = 0; i < uv.count; i++)
          uv.setXY(
            i,
            (uv.getX(i) * raster.contentWidthPx) / raster.canvas.width,
            1 - ((1 - uv.getY(i)) * raster.contentHeightPx) / raster.canvas.height,
          );
        uv.needsUpdate = true;
      }
      const surface = new THREE.Mesh(
        geometry,
        own(
          new THREE.MeshStandardMaterial({
            map: texture,
            roughness: 0.95,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          }),
        ),
      );
      surface.name = 'map-artwork';
      surface.rotation.x = -Math.PI / 2;
      group.add(surface);
      const span = Math.max(map.width, map.height);
      const thickness = span * 0.012;
      // A tenth of the span contains the existing scaled ruler, dividers, inkwell and lamp.
      const margin = span * 0.1;
      const board = new THREE.Mesh(
        own(new THREE.BoxGeometry(map.width + 2 * margin, thickness, map.height + 2 * margin)),
        own(new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.8 })),
      );
      board.name = 'table-board';
      board.position.y = -thickness / 2 - span * 0.0005;
      group.add(board);
      return group;
    } catch (error) {
      this.releaseTree(group);
      allocated.forEach(this.releaseResource);
      throw error;
    }
  }

  private mapClipping(map: BaseMap): THREE.Plane[] {
    return [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), map.width / 2),
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), map.width / 2),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), map.height / 2),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), map.height / 2),
    ];
  }

  private clipPaperLabels = (): void => {
    if (this.disposed || !this.state) return;
    const { map } = this.state;
    const corners = [
      new THREE.Vector3(-map.width / 2, 0, -map.height / 2),
      new THREE.Vector3(map.width / 2, 0, -map.height / 2),
      new THREE.Vector3(map.width / 2, 0, map.height / 2),
      new THREE.Vector3(-map.width / 2, 0, map.height / 2),
    ];
    // Elevated billboards can project beyond the paper despite world-XZ clipping.
    // Planes through the camera and each paper edge bound the visible fragments too.
    const planes = this.mapClipping(map);
    for (let index = 0; index < corners.length; index++) {
      const plane = new THREE.Plane().setFromCoplanarPoints(
        this.camera.position,
        corners[index]!,
        corners[(index + 1) % corners.length]!,
      );
      if (plane.distanceToPoint(new THREE.Vector3()) < 0) plane.negate();
      planes.push(plane);
    }
    for (const { group } of this.pieces.values()) {
      const tag = group.getObjectByName('paper-tag') as THREE.Sprite;
      tag.material.clippingPlanes = planes;
    }
  };

  private makePiece(p: OwnPiece | GhostPiece, map: BaseMap): THREE.Group {
    const span = Math.max(map.width, map.height);
    const minSize = pickMinSize(map);
    const markerSize = span / 300;
    const height = Math.max(span / 400, 3);
    const own = p.kind === 'own';
    const fp = p.footprint ?? { frontage: minSize, depth: minSize };
    const w = fp.frontage;
    const d = fp.depth;
    const group = new THREE.Group();
    group.userData = { pieceKind: p.kind, id: p.id };
    const body = new THREE.Group();
    body.name = 'body';
    group.add(body);
    try {
      const material = new THREE.MeshStandardMaterial(
        own
          ? { color: SIDE_COLOURS[p.side] ?? 0x666666, roughness: 0.6 }
          : {
              color: 0xc9c2b0,
              transparent: true,
              opacity: ghostOpacity(p.ageMs),
              depthWrite: false,
              roughness: 1,
            },
      );
      const visible = (
        geometry: THREE.BufferGeometry,
        name: string,
        mat = material,
      ): THREE.Mesh => {
        const mesh = new THREE.Mesh(geometry, mat);
        mesh.name = name;
        mesh.userData.sideColour = own;
        mesh.userData.fadeRatio = mat === material ? 1 : 0.4;
        mesh.userData.clipToMap = !own && !p.footprint;
        body.add(mesh);
        return mesh;
      };
      let reach = Math.hypot(w, d) / 2;
      if (p.shape?.length) {
        const bound = visible(
          new THREE.BoxGeometry(w, height / 4, d),
          'bound',
          new THREE.MeshStandardMaterial({
            color: material.color,
            transparent: true,
            opacity: 0.25,
            depthWrite: false,
          }),
        );
        bound.position.y = height / 8;
        for (const s of p.shape) {
          const marker = visible(new THREE.BoxGeometry(markerSize, height, markerSize), 'marker');
          marker.position.set(s.x, height / 2, -s.y);
          const pick = new THREE.Mesh(
            new THREE.CylinderGeometry(minSize / 2, minSize / 2, height, 32),
            new THREE.MeshBasicMaterial({ visible: false }),
          );
          pick.name = 'pick';
          pick.position.copy(marker.position);
          body.add(pick);
          reach = Math.max(reach, Math.hypot(s.x, s.y) + minSize / 2);
        }
      } else {
        const block = visible(new THREE.BoxGeometry(w, height, d), 'block');
        block.position.y = height / 2;
      }
      const pick = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(w, minSize), height, Math.max(d, minSize)),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      pick.name = 'pick';
      pick.position.y = height / 2;
      body.add(pick);
      if (own) {
        const noseWidth = Math.min(w, markerSize * 2);
        const noseDepth = Math.min(d, markerSize / 2);
        const nose = new THREE.Mesh(
          new THREE.BoxGeometry(noseWidth, height * 0.5, noseDepth),
          new THREE.MeshStandardMaterial({ color: 0xf1e7c6 }),
        );
        nose.name = 'nose';
        nose.position.set(0, height, -d / 2 + noseDepth / 2);
        body.add(nose);
      }
      if (p.kind === 'ghost' && p.uncertaintyRadius > 0)
        group.add(this.uncertaintyCircle(p.uncertaintyRadius, span));
      const tag = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: labelTexture(tagLines(p), !own), depthWrite: false }),
      );
      tag.name = 'paper-tag';
      tag.userData.lines = tagLines(p);
      const scale = span / 40;
      tag.scale.set(3.4 * scale, 1.0625 * scale, 1);
      tag.position.set(0, height + 0.6 * scale, reach + 1.1 * scale);
      tag.userData.offsetZ = tag.position.z;
      group.add(tag);
      return group;
    } catch (error) {
      this.releaseTree(group);
      throw error;
    }
  }

  private uncertaintyCircle(radius: number, span: number): THREE.Group {
    const group = new THREE.Group();
    group.name = 'uncertainty';
    const fill = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 64),
      new THREE.MeshBasicMaterial({
        color: 0xa83232,
        transparent: true,
        opacity: 0.06,
        depthWrite: false,
      }),
    );
    const edge = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(radius - span * 0.0015, 0), radius, 64),
      new THREE.MeshBasicMaterial({
        color: 0xa83232,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
      }),
    );
    for (const mesh of [fill, edge]) {
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = span * 0.001;
      mesh.userData.clipToMap = true;
      group.add(mesh);
    }
    return group;
  }

  private get span(): number {
    return Math.max(this.state?.map.width ?? 4000, this.state?.map.height ?? 3000);
  }
  private fitDistance(): number {
    return fitDistance(
      this.state?.map.width ?? 4000,
      this.state?.map.height ?? 3000,
      this.camera.fov,
      this.camera.aspect,
    );
  }
  /** Slide the camera so the map point (metres) is under the view target, keeping zoom and tilt. */
  panTo(coord: Coord): void {
    const map = this.state?.map;
    if (!map) return;
    const to = mapToWorld(map, {
      x: Math.min(map.width, Math.max(0, coord.x)),
      y: Math.min(map.height, Math.max(0, coord.y)),
    });
    const delta = to.sub(this.controls.target).setY(0);
    this.controls.target.add(delta);
    this.camera.position.add(delta);
    this.controls.update();
  }

  /** Updates projection/limits only; never moves a settled target or camera. */
  private updateCameraLimits(): void {
    this.camera.near = this.span / 200;
    this.camera.far = this.span * 10;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = this.span / 50;
    this.controls.maxDistance = Math.max(this.span * 1.8, this.fitDistance() * 1.2);
  }
  snapTopDown(): void {
    if (this.disposed) return;
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, this.fitDistance(), 0.001);
    this.controls.update();
  }
  snapOblique(): void {
    if (this.disposed) return;
    this.controls.target.set(0, 0, 0);
    this.camera.position
      .set(0, this.span * 0.7, (this.state?.map.height ?? 3000) * 0.75)
      .normalize()
      .multiplyScalar(this.fitDistance() * 0.85);
    this.controls.update();
  }
  get pieceCount(): number {
    return this.pieces.size;
  }

  pickAt(clientX: number, clientY: number): PickResult {
    if (this.disposed || !this.state) return { type: 'none' };
    const rect = this.canvas.getBoundingClientRect();
    if (
      !Number.isFinite(clientX) ||
      !Number.isFinite(clientY) ||
      rect.width <= 0 ||
      rect.height <= 0 ||
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    )
      return { type: 'none' };
    return this.pickNdc(
      new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      ),
    );
  }
  pickNdc(ndc: THREE.Vector2): PickResult {
    if (
      this.disposed ||
      !this.state ||
      !Number.isFinite(ndc.x) ||
      !Number.isFinite(ndc.y) ||
      Math.abs(ndc.x) > 1 ||
      Math.abs(ndc.y) > 1
    )
      return { type: 'none' };
    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    const coord = rayToMap(this.state.map, rc.ray);
    if (!coord) return { type: 'none' };
    const meshes: THREE.Object3D[] = [];
    this.piecesRoot.traverse((object) => {
      if (object.name === 'pick') meshes.push(object);
    });
    const hit = rc.intersectObjects(meshes, false)[0];
    if (hit) {
      let object: THREE.Object3D | null = hit.object;
      while (object && object.userData.id === undefined) object = object.parent;
      if (object) {
        const { pieceKind, id } = object.userData as { pieceKind: 'own' | 'ghost'; id: string };
        return { type: 'piece', pieceKind, id, coord };
      }
    }
    return pickFromRay(this.state, rc.ray);
  }

  resize(widthCssPx?: number, heightCssPx?: number, dpr?: number): void {
    if (this.disposed) return;
    const width = widthCssPx ?? (this.canvas.clientWidth || 800);
    const height = heightCssPx ?? (this.canvas.clientHeight || 600);
    const ratio = dpr ?? window.devicePixelRatio;
    if (![width, height, ratio].every((value) => Number.isFinite(value) && value > 0))
      throw new RangeError('Invalid table viewport');
    this.renderer.setPixelRatio(Math.min(ratio, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.updateCameraLimits();
  }
  start(): void {
    if (this.disposed || this.raf || this.previewRenderFailed) return;
    const generation = ++this.renderGeneration;
    const active = () => !this.disposed && generation === this.renderGeneration;
    const loop = (): void => {
      if (!active()) return;
      try {
        this.controls.update();
        if (!active()) return;
        if (this.mode === 'public-map-preview' && this.contextLost())
          throw new Error('WebGL context is lost');
        this.renderer.render(this.scene, this.camera);
        if (!active()) return;
        if (this.mode === 'public-map-preview' && this.contextLost())
          throw new Error('WebGL context is lost');
      } catch (error) {
        // Fixture callers keep the existing exception behavior. Preview failure is
        // terminal for this render loop; only a fresh page promises another display.
        if (this.mode !== 'public-map-preview') throw error;
        if (!active()) return;
        this.previewRenderFailed = true;
        this.previewAvailable = false;
        this.stop();
        this.onPreviewUnavailable?.(
          new PreviewApplyError(
            error instanceof Error ? error.message : 'Table frame failed',
            'unavailable',
            { cause: error },
          ),
        );
        return;
      }
      if (active()) this.raf = requestAnimationFrame(loop);
    };
    loop();
  }
  stop(): void {
    this.renderGeneration++;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.onPreviewUnavailable = undefined;
    this.stop();
    this.controls.removeEventListener('change', this.clipPaperLabels);
    this.controls.dispose();
    this.releaseTree(this.scene);
    this.pieces.clear();
    this.marks.clear();
    this.scene.clear();
    this.piecesRoot.clear();
    this.marksRoot.clear();
    this.state = undefined;
    this.mapKey = '';
    this.mapMesh = this.tableMesh = undefined;
    this.dressing = undefined;
    this.artworkImage = undefined;
    this.renderer.dispose();
  }
}

function disposeTree(
  object: THREE.Object3D,
  release: (resource: { dispose(): void }) => void,
): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  object.traverse((child) => {
    const mesh = child as THREE.Mesh | THREE.Sprite;
    if (!(mesh instanceof THREE.Sprite) && mesh.geometry) geometries.add(mesh.geometry);
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    for (const item of Array.isArray(material) ? material : material ? [material] : []) {
      const texture = (item as THREE.MeshStandardMaterial).map;
      if (texture) textures.add(texture);
      materials.add(item);
    }
  });
  textures.forEach(release);
  materials.forEach(release);
  geometries.forEach(release);
}
