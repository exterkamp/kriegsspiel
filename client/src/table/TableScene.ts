import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mapCanvas } from './mapTexture.js';
import { mapToWorld, pickFromRay, type PickResult } from './picking.js';
import { FACING_ANGLE, fitDistance } from './framing.js';
import type { GhostPiece, OwnPiece, SceneState } from './types.js';

const SIDE_COLOURS: Record<string, number> = { blue: 0x2f55a4, red: 0xa83232 };
const BLOCK_H = 0.5;
/** Labels sit beside the block (toward the near edge) so they never hide it or its facing nose. */
const TAG_OFFSET_Z = 0.8;

/** Sprite materials own their texture; the sprite geometry is shared by three, so it is not disposed. */
function labelSprite(text: string, ghost: boolean): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = ghost ? '#efe6c8' : '#f4eedb';
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = '#3b2f1c';
    ctx.strokeRect(1, 1, 254, 62);
    ctx.fillStyle = '#2a2014';
    ctx.font = 'bold 34px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 34, 240);
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c) }));
  sprite.scale.set(2.6, 0.65, 1);
  return sprite;
}

interface PieceObject {
  group: THREE.Group;
  key: string;
}

/** The map table: owns the Three.js scene. `apply` is idempotent for a given SceneState. */
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
  private raf = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    opts: { preserveDrawingBuffer?: boolean } = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      // Costly on mobile GPUs; only enable for screenshots/debugging.
      preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0x2a2118);
    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 300);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = true;
    this.controls.enableDamping = false;
    this.controls.minPolarAngle = 0;
    this.controls.maxPolarAngle = Math.PI * 0.42;
    this.scene.add(new THREE.AmbientLight(0xfff2d8, 0.7));
    const lamp = new THREE.DirectionalLight(0xffe2b0, 1.1);
    lamp.position.set(-12, 25, 10);
    this.scene.add(lamp);
    this.scene.add(this.piecesRoot);
    this.resize();
  }

  /** Reconcile the scene with `state`. Safe to call repeatedly with equal states. */
  apply(state: SceneState): void {
    this.state = state;
    const { map } = state;
    const key = `${map.width}x${map.height}:${map.tiles.join(',')}`;
    if (key !== this.mapKey) {
      this.mapKey = key;
      this.buildMap();
      this.setCameraLimits();
      this.snapTopDown();
    }
    const seen = new Set<string>();
    for (const o of state.own) this.syncPiece(`own:${o.id}`, o, seen);
    for (const g of state.ghosts) this.syncPiece(`ghost:${g.id}`, g, seen);
    for (const [k, p] of this.pieces) {
      if (!seen.has(k)) {
        this.piecesRoot.remove(p.group);
        disposeTree(p.group);
        this.pieces.delete(k);
      }
    }
  }

  private buildMap(): void {
    const map = this.state!.map;
    if (this.mapMesh) {
      this.scene.remove(this.mapMesh);
      disposeTree(this.mapMesh);
    }
    if (this.tableMesh) {
      this.scene.remove(this.tableMesh);
      disposeTree(this.tableMesh);
    }
    const tex = new THREE.CanvasTexture(mapCanvas(map));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.mapMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(map.width, map.height),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }),
    );
    this.mapMesh.rotation.x = -Math.PI / 2;
    this.mapMesh.position.y = 0.02;
    this.scene.add(this.mapMesh);
    this.tableMesh = new THREE.Mesh(
      new THREE.BoxGeometry(map.width + 8, 0.5, map.height + 8),
      new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.8 }),
    );
    this.tableMesh.position.y = -0.25;
    this.scene.add(this.tableMesh);
  }

  private setCameraLimits(): void {
    const { width, height } = this.state!.map;
    const span = Math.max(width, height);
    this.controls.minDistance = 4;
    this.controls.maxDistance = Math.max(span * 1.8, this.fitDistance() * 1.2);
    this.controls.target.set(0, 0, 0);
  }

  /** Distance at which the whole map fits the current fov and aspect. */
  private fitDistance(): number {
    const { width, height } = this.state?.map ?? { width: 40, height: 30 };
    return fitDistance(width, height, this.camera.fov, this.camera.aspect);
  }

  /** Camera straight above the map centre, for precise plotting. */
  snapTopDown(): void {
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, this.fitDistance(), 0.001);
    this.controls.update();
  }

  /** Angled view from the near edge of the table. */
  snapOblique(): void {
    const { width, height } = this.state?.map ?? { width: 40, height: 30 };
    const span = Math.max(width, height);
    this.controls.target.set(0, 0, 0);
    this.camera.position
      .set(0, span * 0.7, height * 0.75)
      .normalize()
      .multiplyScalar(this.fitDistance() * 0.85);
    this.controls.update();
  }

  /** Number of pieces currently in the scene (for tests and debugging). */
  get pieceCount(): number {
    return this.pieces.size;
  }

  private syncPiece(key: string, p: OwnPiece | GhostPiece, seen: Set<string>): void {
    seen.add(key);
    const map = this.state!.map;
    let obj = this.pieces.get(key);
    const sig = p.kind === 'own' ? `${p.side}|${p.label}` : `${p.ageTag}|${p.sizeEstimate ?? ''}`;
    if (obj && obj.group.userData.sig !== sig) {
      this.piecesRoot.remove(obj.group);
      disposeTree(obj.group);
      obj = undefined;
    }
    if (!obj) {
      obj = { group: p.kind === 'own' ? this.makeOwn(p) : this.makeGhost(p), key };
      obj.group.userData = { sig, pieceKind: p.kind, id: p.id };
      this.piecesRoot.add(obj.group);
      this.pieces.set(key, obj);
    }
    const w = mapToWorld(map, {
      x: Math.floor(p.position.x) + 0.5,
      y: Math.floor(p.position.y) + 0.5,
    });
    obj.group.position.copy(w);
    obj.group.rotation.y = p.kind === 'own' ? FACING_ANGLE[p.facing] : 0;
    obj.group.userData.facing = p.kind === 'own' ? p.facing : undefined;
  }

  private makeOwn(p: OwnPiece): THREE.Group {
    const g = new THREE.Group();
    const colour = SIDE_COLOURS[p.side] ?? 0x666666;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, BLOCK_H, 0.45),
      new THREE.MeshStandardMaterial({ color: colour, roughness: 0.6 }),
    );
    body.position.y = BLOCK_H / 2;
    body.name = 'pick';
    // A pale nose on the front (-Z, "north") face shows facing.
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, BLOCK_H * 0.5, 0.12),
      new THREE.MeshStandardMaterial({ color: 0xf1e7c6 }),
    );
    nose.position.set(0, BLOCK_H * 0.5, -0.27);
    g.add(body, nose);
    const tag = labelSprite(p.label, false);
    tag.position.set(0, BLOCK_H + 0.1, TAG_OFFSET_Z);
    g.add(tag);
    return g;
  }

  private makeGhost(p: GhostPiece): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, BLOCK_H, 0.45),
      new THREE.MeshStandardMaterial({
        color: 0xc9c2b0,
        transparent: true,
        opacity: 0.45,
        roughness: 1,
      }),
    );
    body.position.y = BLOCK_H / 2;
    body.name = 'pick';
    g.add(body);
    const tag = labelSprite(p.ageTag, true);
    tag.position.set(0, BLOCK_H + 0.1, TAG_OFFSET_Z);
    g.add(tag);
    return g;
  }

  /** Pick at a pointer position in client (CSS pixel) coordinates. Pieces first, then the map plane. */
  pickAt(clientX: number, clientY: number): PickResult {
    if (!this.state) return { type: 'none' };
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    return this.pickNdc(ndc);
  }

  pickNdc(ndc: THREE.Vector2): PickResult {
    if (!this.state) return { type: 'none' };
    this.camera.updateMatrixWorld();
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    const meshes: THREE.Object3D[] = [];
    this.piecesRoot.traverse((o) => {
      if (o.name === 'pick') meshes.push(o);
    });
    const hit = rc.intersectObjects(meshes, false)[0];
    if (hit?.object.parent) {
      const { pieceKind, id } = hit.object.parent.userData as {
        pieceKind: 'own' | 'ghost';
        id: string;
      };
      const pos = hit.object.parent.position;
      const tile = {
        x: Math.floor(pos.x + this.state.map.width / 2),
        y: Math.floor(pos.z + this.state.map.height / 2),
      };
      return { type: 'piece', pieceKind, id, tile };
    }
    return pickFromRay(this.state, rc.ray);
  }

  resize(): void {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start(): void {
    if (this.raf) return;
    const loop = (): void => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Stop rendering and release the renderer, controls and every scene resource. */
  dispose(): void {
    this.stop();
    this.controls.dispose();
    for (const p of this.pieces.values()) disposeTree(p.group);
    this.pieces.clear();
    if (this.mapMesh) disposeTree(this.mapMesh);
    if (this.tableMesh) disposeTree(this.tableMesh);
    this.renderer.dispose();
  }
}

function disposeTree(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      (x as THREE.MeshStandardMaterial).map?.dispose();
      x.dispose();
    }
  });
}
