import { dashPolyline } from './dash';
import { stackLabels } from './flatBoard';
import * as THREE from 'three';
import type { Coord, Mark } from '@kriegsspiel/protocol';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mapCanvas } from './mapTexture.js';
import { tableHighContrast } from './periodMap.js';
import {
  mapToWorld,
  pickFromRay,
  pickMinSize,
  rayToMap,
  worldToMap,
  type PickResult,
} from './picking.js';
import { facingToRotationY, fitDistance } from './framing.js';
import { formatAge } from './sceneState.js';
import { placeFightLabels, type LabelRect } from './fightLabels.js';
import { markAgeFactor } from './marks.js';
import {
  ALL_OVERLAYS,
  type GhostPiece,
  type Engagement,
  type OrderRoute,
  type SceneCourier,
  type OwnPiece,
  type Overlays,
  type SceneState,
} from './types.js';
import { deskPose, easeInOut, lerpPose, type CameraPose } from './transition.js';
import { NO_GLIDES, glidePoint, gliding, nextGlides, type GlideState } from './glide.js';

const SIDE_COLOURS: Record<string, number> = { blue: 0x2f55a4, red: 0xa83232 };

/** Sprite geometry is shared by three; disposeTree disposing it is harmless (it re-uploads on next use). */
function labelSprite(text: string, ghost: boolean, width: number): THREE.Sprite {
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
  sprite.scale.set(width, width / 4, 1);
  return sprite;
}

const invisible = (): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ visible: false });

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
  private mapRef: SceneState['map'] | undefined;
  /** Whether the paper was drawn in the high-contrast palette; a change redraws it in place. */
  private mapContrast = false;
  private mapMesh: THREE.Mesh | undefined;
  private tableMesh: THREE.Mesh | undefined;
  private pieces = new Map<string, PieceObject>();
  private piecesRoot = new THREE.Group();
  private marksRoot = new THREE.Group();
  private marksKey = '';
  private overlayRoot = new THREE.Group();
  private overlayKey = '';
  private overlays: Overlays = ALL_OVERLAYS;
  private raf = 0;
  private atDesk = false;
  /** Camera pose to return to when leaving the desk, so the table looks the same as it was left. */
  private tablePose: CameraPose | undefined;
  private dolly: { from: CameraPose; to: CameraPose; start: number; ms: number } | undefined;
  /** Pieces sliding to where a turn left them; `glideMs` 0 (real time) places them at once. */
  private glide: GlideState = NO_GLIDES;
  private glideMs = 0;

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
    this.camera = new THREE.PerspectiveCamera(45, 1, 10, 100_000);
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
    this.scene.add(this.marksRoot);
    this.scene.add(this.overlayRoot);
    this.resize();
  }

  /** Reconcile the scene with `state`. Safe to call repeatedly with equal states. */
  apply(state: SceneState): void {
    this.state = state;
    // Same reference means same map; only a new reference pays for the deep compare.
    const mapChanged = state.map !== this.mapRef;
    this.mapRef = state.map;
    const key = mapChanged ? JSON.stringify(state.map) : this.mapKey;
    const contrast = tableHighContrast();
    if (key !== this.mapKey) {
      this.mapKey = key;
      this.mapContrast = contrast;
      this.buildMap();
      this.setCameraLimits();
      this.snapTopDown();
    } else if (contrast !== this.mapContrast) {
      // The app's contrast changed: redraw the paper in the other palette, leaving the camera be.
      this.mapContrast = contrast;
      this.buildMap();
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
    this.separateTags();
    this.syncOverlays();
    const at = new Map([
      ...state.own.map((o) => [`own:${o.id}`, o.position] as const),
      ...state.ghosts.map((g) => [`ghost:${g.id}`, g.position] as const),
    ]);
    const now = performance.now();
    this.glide = nextGlides(this.glide, at, now, this.glideMs);
    this.stepGlides(now);
  }

  /**
   * How long a piece takes to slide to a new position on the next `apply`: a turn-mode game (D39) moves
   * by a whole turn at once, so its pieces glide there; 0 (the default) puts them in place at once.
   */
  setGlide(ms: number): void {
    this.glideMs = Math.max(0, ms);
  }

  /** Draw each gliding piece where it has got to at wall time `now`. */
  stepGlides(now: number): void {
    if (this.glide.glides.size === 0 || !this.state) return;
    for (const [key, g] of this.glide.glides) {
      this.pieces.get(key)?.group.position.copy(mapToWorld(this.state.map, glidePoint(g, now)));
    }
    if (!gliding(this.glide, now)) this.glide = { at: this.glide.at, glides: new Map() };
  }

  /**
   * Unit tags sit just below their pieces; two units standing together (the battalions at the bridge) would draw
   * one over the other, so each tag that would overlap an earlier one is moved down the table until it is clear (#343).
   */
  private separateTags(): void {
    const tags: Array<{ id: string; at: Coord; w: number; sprite: THREE.Sprite; baseZ: number }> =
      [];
    let h = 0;
    for (const [id, p] of this.pieces) {
      const sprite = p.group.children.find((c): c is THREE.Sprite => c instanceof THREE.Sprite);
      if (!sprite) continue;
      const baseZ = (sprite.userData.baseZ ??= sprite.position.z) as number;
      h = sprite.scale.y * 1.05;
      tags.push({
        id,
        sprite,
        baseZ,
        w: sprite.scale.x,
        at: { x: p.group.position.x, y: p.group.position.z + baseZ },
      });
    }
    const placed = stackLabels(tags, h);
    for (const t of tags) t.sprite.position.z = t.baseZ + (placed.get(t.id)!.y - t.at.y);
  }

  /** Show or hide the overlay layers; the shading follows the stale sightings already in the scene. */
  setOverlays(overlays: Overlays): void {
    this.overlays = overlays;
    this.syncOverlays();
  }

  private syncOverlays(): void {
    for (const p of this.pieces.values()) {
      const u = p.group.getObjectByName('uncertainty');
      if (u) u.visible = this.overlays.lastKnown;
    }
    const routes = (this.state?.orderRoutes ?? []).filter((r) =>
      r.kind === 'route' ? this.overlays.routes : this.overlays.orders,
    );
    const couriers = this.overlays.orders ? (this.state?.couriers ?? []) : [];
    const fights = this.state?.engagements ?? [];
    const labelW = this.span * 0.07;
    const labels = this.state
      ? placeFightLabels(
          fights,
          this.pieceLabelRects(),
          { w: labelW, h: labelW / 4 },
          this.span * 0.02,
        )
      : new Map<string, Coord>();
    const key = JSON.stringify([routes, couriers, fights, [...labels], this.mapKey]);
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    clearGroup(this.overlayRoot);
    for (const r of routes) this.overlayRoot.add(this.routeObject(r));
    for (const c of couriers) this.overlayRoot.add(this.courierObject(c));
    for (const f of fights) this.overlayRoot.add(this.engagementObject(f, labels.get(f.id)!));
  }

  /** Where every unit and sighting tag sits on the table, in metres, so a fight label can keep clear of them. */
  pieceLabelRects(): LabelRect[] {
    const map = this.state!.map;
    const out: LabelRect[] = [];
    for (const p of this.pieces.values()) {
      p.group.updateWorldMatrix(true, true);
      p.group.traverse((o) => {
        if (!(o instanceof THREE.Sprite)) return;
        const at = worldToMap(map, o.getWorldPosition(new THREE.Vector3()));
        out.push({ ...at, w: o.scale.x, h: o.scale.y });
      });
    }
    return out;
  }

  /** A small brass rider with "Courier, N min" over it: our own order on the road. */
  private courierObject(c: SceneCourier): THREE.Group {
    const map = this.state!.map;
    const g = new THREE.Group();
    const rider = new THREE.Mesh(
      new THREE.ConeGeometry(this.span * 0.007, this.span * 0.02, 12),
      new THREE.MeshBasicMaterial({ color: 0xb8892b }),
    );
    rider.position.copy(mapToWorld(map, c.position, this.span * 0.01));
    g.add(rider);
    const tag = labelSprite(
      c.etaMin > 0 ? `Courier, ${c.etaMin} min` : 'Courier',
      false,
      this.span * 0.08,
    );
    tag.position.copy(mapToWorld(map, c.position, this.span * 0.035));
    g.add(tag);
    g.name = `courier:${c.id}`;
    return g;
  }

  /**
   * A red ring and the word "Fighting" where a fight is going on, drawn above the pieces; fainter, with its times
   * ("Fought 00:12"), where the last turn's papers reported fighting (#439).
   */
  private engagementObject(f: Engagement, labelAt: Coord): THREE.Group {
    const map = this.state!.map;
    const g = new THREE.Group();
    const radius = this.span * 0.02;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.8, radius, 48),
      new THREE.MeshBasicMaterial({
        color: 0xc0392b,
        transparent: true,
        opacity: f.past ? 0.45 : 0.85,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(mapToWorld(map, f.position, this.span * 0.004));
    g.add(ring);
    const labelW = this.span * 0.07;
    const tag = labelSprite(f.past?.label ?? 'Fighting', false, labelW);
    // Placed clear of the unit tags and the other fight labels (placeFightLabels).
    tag.position.copy(mapToWorld(map, labelAt, this.span * 0.03));
    g.add(tag);
    g.name = `engagement:${f.id}`;
    return g;
  }

  private routeObject(r: OrderRoute): THREE.Group {
    const map = this.state!.map;
    const g = new THREE.Group();
    const colour = r.kind === 'order' ? 0x1f1a12 : r.kind === 'held' ? 0xb8892b : 0x8a3b12;
    const pts = r.points;
    if (r.kind === 'held') {
      // A turn's order waiting to ride: the courier's road from HQ to the unit, in the courier's brass (#439).
      for (const d of dashPolyline(pts, this.span / 90, this.span / 140)) {
        g.add(this.ribbon(d, this.span / 500, colour, 0.9, 0.0015));
      }
    } else if (r.kind === 'order') {
      g.add(this.ribbon(pts, this.span / 450, colour, 0.8, 0.0015));
    } else {
      // A planned route is dotted, so it reads apart from the order arrow drawn over the same ground (#343).
      for (const d of dashPolyline(pts, this.span / 120, this.span / 160)) {
        g.add(this.ribbon(d, this.span / 380, colour, 0.9, 0.0015));
      }
    }
    if (r.kind !== 'route' && pts.length >= 2) {
      const a = pts[pts.length - 2]!;
      const b = pts[pts.length - 1]!;
      g.add(this.arrowHead(map, a, b, colour, 0.8));
    }
    g.name = `overlay:${r.id}`;
    return g;
  }

  /**
   * The player's marks, drawn flat on the table above the map. `nowGame` ages them: older marks go
   * grey and fade. Safe to call every frame; it rebuilds only when a mark or a visible age step changes.
   */
  setMarks(marks: readonly Mark[], nowGame: number, selectedId?: string): void {
    if (!this.state) return;
    const aged = marks.map((m) => markAgeFactor(m.madeAtGame, nowGame));
    const key = JSON.stringify([marks, aged, selectedId, this.mapKey]);
    if (key === this.marksKey) return;
    this.marksKey = key;
    clearGroup(this.marksRoot);
    marks.forEach((m, i) => {
      const obj = this.markObject(
        m,
        aged[i]!,
        Math.max(0, nowGame - m.madeAtGame),
        m.id === selectedId,
      );
      obj.userData = { markId: m.id };
      this.marksRoot.add(obj);
    });
  }

  /** Number of marks drawn (for tests and debugging). */
  get markCount(): number {
    return this.marksRoot.children.length;
  }

  private markObject(m: Mark, age: number, ageMs: number, selected: boolean): THREE.Group {
    const map = this.state!.map;
    const span = this.span;
    const g = new THREE.Group();
    // Fresh ink is the side's colour; old ink greys and thins out.
    const fresh = new THREE.Color(SIDE_COLOURS[this.state!.side] ?? 0x333333);
    const ink = fresh.clone().lerp(new THREE.Color(0x8a8678), age).getHex();
    const opacity = 1 - 0.6 * age;
    const width = span / 450;
    const note = [m.label, formatAge(ageMs)].filter((x) => x).join(' · ');
    let labelAt: Coord;
    switch (m.kind) {
      case 'pin': {
        const h = span / 50;
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(h / 4, h, 12),
          new THREE.MeshBasicMaterial({ color: ink, transparent: true, opacity }),
        );
        cone.rotation.x = Math.PI;
        const w = mapToWorld(map, m.at, h / 2);
        cone.position.copy(w);
        g.add(cone);
        labelAt = m.at;
        break;
      }
      case 'line':
        g.add(this.ribbon(m.points, width, ink, opacity, 0.003));
        labelAt = m.points[m.points.length - 1]!;
        break;
      case 'arrow':
        g.add(this.ribbon([m.from, m.to], width, ink, opacity, 0.003));
        g.add(this.arrowHead(map, m.from, m.to, ink, opacity));
        labelAt = m.to;
        break;
      case 'ring': {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(Math.max(m.radius - width, 0), m.radius, 96),
          new THREE.MeshBasicMaterial({
            color: ink,
            transparent: true,
            opacity,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.copy(mapToWorld(map, m.at, span * 0.003));
        g.add(ring);
        labelAt = { x: m.at.x, y: m.at.y - m.radius };
        break;
      }
    }
    if (selected) g.add(this.selectionHalo(m));
    // The note sits just south of the mark (north of a ring), clear of the pin head and arrow tip.
    const labelW = span * 0.07;
    const clear = span * 0.02 + labelW / 8;
    const noteAt =
      m.kind === 'ring'
        ? { x: labelAt.x, y: labelAt.y - clear }
        : { x: labelAt.x, y: labelAt.y + clear };
    const tag = labelSprite(note, true, labelW);
    tag.position.copy(mapToWorld(map, noteAt, span * 0.004));
    g.add(tag);
    return g;
  }

  private selectionHalo(m: Mark): THREE.Object3D {
    const span = this.span;
    const pts: Coord[] =
      m.kind === 'pin' || m.kind === 'ring'
        ? [m.at]
        : m.kind === 'arrow'
          ? [m.from, m.to]
          : m.points;
    const halo = new THREE.Group();
    const r = m.kind === 'ring' ? span / 80 : span / 60;
    for (const p of m.kind === 'line' ? [pts[0]!, pts[pts.length - 1]!] : pts) {
      const c = new THREE.Mesh(
        new THREE.RingGeometry(r * 0.8, r, 32),
        new THREE.MeshBasicMaterial({ color: 0xe8b923, depthWrite: false, side: THREE.DoubleSide }),
      );
      c.rotation.x = -Math.PI / 2;
      c.position.copy(
        mapToWorld(
          this.state!.map,
          m.kind === 'ring' ? { x: m.at.x, y: m.at.y - m.radius } : p,
          span * 0.004,
        ),
      );
      halo.add(c);
    }
    return halo;
  }

  /** A flat strip of `width` metres along the points, just above the map. */
  private ribbon(
    points: readonly Coord[],
    width: number,
    colour: number,
    opacity: number,
    lift: number,
  ): THREE.Mesh {
    const map = this.state!.map;
    const y = this.span * lift;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 1; i < points.length; i++) {
      const a = mapToWorld(map, points[i - 1]!, y);
      const b = mapToWorld(map, points[i]!, y);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = (-dz / len) * (width / 2);
      const nz = (dx / len) * (width / 2);
      const base = pos.length / 3;
      pos.push(
        a.x + nx,
        y,
        a.z + nz,
        a.x - nx,
        y,
        a.z - nz,
        b.x - nx,
        y,
        b.z - nz,
        b.x + nx,
        y,
        b.z + nz,
      );
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    return new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: colour,
        transparent: true,
        opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
  }

  private arrowHead(
    map: SceneState['map'],
    from: Coord,
    to: Coord,
    colour: number,
    opacity: number,
  ): THREE.Mesh {
    const size = this.span / 100;
    const head = new THREE.Mesh(
      new THREE.ConeGeometry(size / 2, size, 12),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity }),
    );
    const dir = new THREE.Vector3(to.x - from.x, 0, to.y - from.y).normalize();
    if (dir.lengthSq() === 0) dir.set(0, 0, -1);
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    head.position.copy(mapToWorld(map, to, this.span * 0.003)).addScaledVector(dir, -size / 2);
    return head;
  }

  /** The larger side of the map in metres: every size in the scene is scaled from it. */
  private get span(): number {
    const { width, height } = this.state?.map ?? { width: 4000, height: 3000 };
    return Math.max(width, height);
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
    const span = this.span;
    const tex = new THREE.CanvasTexture(mapCanvas(map, this.mapContrast));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.mapMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(map.width, map.height),
      new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.95,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    this.mapMesh.rotation.x = -Math.PI / 2;
    this.scene.add(this.mapMesh);
    const margin = span * 0.05;
    const thickness = span * 0.012;
    this.tableMesh = new THREE.Mesh(
      new THREE.BoxGeometry(map.width + margin * 2, thickness, map.height + margin * 2),
      new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.8 }),
    );
    this.tableMesh.position.y = -thickness / 2 - span * 0.0005;
    this.scene.add(this.tableMesh);
  }

  private setCameraLimits(): void {
    const span = this.span;
    this.camera.near = span / 200;
    this.camera.far = span * 10;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = span / 50;
    this.controls.maxDistance = Math.max(span * 1.8, this.fitDistance() * 1.2);
    this.controls.target.set(0, 0, 0);
  }

  /** Distance at which the whole map fits the current fov and aspect. */
  private fitDistance(): number {
    const { width, height } = this.state?.map ?? { width: 4000, height: 3000 };
    return fitDistance(width, height, this.camera.fov, this.camera.aspect);
  }

  /** Camera straight above the map centre, for precise plotting. */
  snapTopDown(): void {
    if (this.atDesk) return;
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, this.fitDistance(), 0.001);
    this.controls.update();
  }

  /** Slide the camera so the map point (metres) is under the view target, keeping zoom and tilt. */
  panTo(coord: Coord): void {
    const map = this.state?.map;
    if (!map) return;
    const to = mapToWorld(map, {
      x: Math.min(map.width, Math.max(0, coord.x)),
      y: Math.min(map.height, Math.max(0, coord.y)),
    });
    if (this.atDesk && this.tablePose) {
      // The camera is at the desk: move the saved table pose, so the table is there when the player returns.
      const { position: p, target: t } = this.tablePose;
      const delta = to.sub(new THREE.Vector3(t.x, t.y, t.z)).setY(0);
      p.x += delta.x;
      p.z += delta.z;
      t.x += delta.x;
      t.z += delta.z;
      return;
    }
    const delta = to.sub(this.controls.target).setY(0);
    this.controls.target.add(delta);
    this.camera.position.add(delta);
    this.controls.update();
  }

  /** Angled view from the near edge of the table. */
  snapOblique(): void {
    if (this.atDesk) return;
    const { height } = this.state?.map ?? { height: 3000 };
    this.controls.target.set(0, 0, 0);
    this.camera.position
      .set(0, this.span * 0.7, height * 0.75)
      .normalize()
      .multiplyScalar(this.fitDistance() * 0.85);
    this.controls.update();
  }

  private currentPose(): CameraPose {
    const { position: p } = this.camera;
    const t = this.controls.target;
    return { position: { x: p.x, y: p.y, z: p.z }, target: { x: t.x, y: t.y, z: t.z } };
  }

  private setPose(pose: CameraPose): void {
    this.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    this.controls.target.set(pose.target.x, pose.target.y, pose.target.z);
    this.camera.lookAt(this.controls.target);
  }

  /** True while the camera is at, or moving to, the desk. */
  get deskActive(): boolean {
    return this.atDesk;
  }

  /**
   * Dolly the camera from the table to the desk, or back. The scene keeps rendering and keeps its pieces and
   * map throughout; only the camera moves. Orbit input is off while at the desk. `ms` of 0 jumps.
   */
  setDesk(on: boolean, ms = 600, now = performance.now()): void {
    if (on === this.atDesk) return;
    this.atDesk = on;
    this.controls.enabled = !on;
    const from = this.currentPose();
    let to: CameraPose;
    if (on) {
      // A dolly still running means the camera is mid-flight back to the table: keep the pose it is heading to.
      if (!this.dolly || !this.tablePose) this.tablePose = from;
      const { height } = this.state?.map ?? { height: 3000 };
      to = deskPose(this.tablePose, height, this.span);
    } else {
      to = this.tablePose ?? from;
    }
    this.dolly = { from, to, start: now, ms };
    this.stepDolly(now);
  }

  /** Advance a running dolly to wall time `now`. Returns true while still moving. */
  stepDolly(now: number): boolean {
    const d = this.dolly;
    if (!d) return false;
    const t = d.ms <= 0 ? 1 : (now - d.start) / d.ms;
    this.setPose(lerpPose(d.from, d.to, easeInOut(t)));
    if (t >= 1) this.dolly = undefined;
    return t < 1;
  }

  /** Number of pieces currently in the scene (for tests and debugging). */
  get pieceCount(): number {
    return this.pieces.size;
  }

  private syncPiece(key: string, p: OwnPiece | GhostPiece, seen: Set<string>): void {
    seen.add(key);
    const map = this.state!.map;
    let obj = this.pieces.get(key);
    const sig = JSON.stringify(
      p.kind === 'own'
        ? [p.side, p.label, p.footprint, p.shape]
        : [p.ageTag, p.sizeEstimate, p.uncertaintyRadius, p.footprint, p.shape],
    );
    if (obj && obj.group.userData.sig !== sig) {
      this.piecesRoot.remove(obj.group);
      disposeTree(obj.group);
      obj = undefined;
    }
    if (!obj) {
      obj = { group: this.makePiece(p), key };
      obj.group.userData = { sig, pieceKind: p.kind, id: p.id };
      this.piecesRoot.add(obj.group);
      this.pieces.set(key, obj);
    }
    obj.group.position.copy(mapToWorld(map, p.position));
    const body = obj.group.getObjectByName('body');
    if (body) body.rotation.y = facingToRotationY(p.facing);
  }

  /**
   * A piece drawn from its oriented footprint in metres. The group sits at the footprint
   * centre and is not rotated (so the label stays upright); the child `body` carries the
   * facing. Loose units draw a marker per sub-position inside a faint bound.
   */
  private makePiece(p: OwnPiece | GhostPiece): THREE.Group {
    const span = this.span;
    const minSize = pickMinSize(this.state!.map);
    const seeable = span / 300;
    const height = Math.max(span / 400, 3);
    const own = p.kind === 'own';
    const fp = p.footprint ?? { frontage: minSize, depth: minSize };
    const w = Math.max(fp.frontage, seeable);
    const d = Math.max(fp.depth, seeable);
    const material = own
      ? new THREE.MeshStandardMaterial({ color: SIDE_COLOURS[p.side] ?? 0x666666, roughness: 0.6 })
      : new THREE.MeshStandardMaterial({
          color: 0xc9c2b0,
          transparent: true,
          opacity: 0.55,
          roughness: 1,
        });
    const g = new THREE.Group();
    const body = new THREE.Group();
    body.name = 'body';
    g.add(body);
    let reach = Math.hypot(w, d) / 2;
    if (p.shape) {
      const bound = new THREE.Mesh(
        new THREE.BoxGeometry(w, height / 4, d),
        new THREE.MeshStandardMaterial({ color: material.color, transparent: true, opacity: 0.25 }),
      );
      bound.position.y = height / 8;
      body.add(bound);
      for (const s of p.shape) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(seeable, height, seeable), material);
        m.position.set(s.x, height / 2, -s.y);
        body.add(m);
        const pick = new THREE.Mesh(new THREE.BoxGeometry(minSize, height, minSize), invisible());
        pick.position.copy(m.position);
        pick.name = 'pick';
        body.add(pick);
        reach = Math.max(reach, Math.hypot(s.x, s.y) + minSize / 2);
      }
    } else {
      const block = new THREE.Mesh(new THREE.BoxGeometry(w, height, d), material);
      block.position.y = height / 2;
      body.add(block);
    }
    const pick = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(w, minSize), height, Math.max(d, minSize)),
      invisible(),
    );
    pick.position.y = height / 2;
    pick.name = 'pick';
    body.add(pick);
    if (own) {
      // A pale nose on the front (-Z, "north") edge shows facing.
      const nose = new THREE.Mesh(
        new THREE.BoxGeometry(Math.min(w, seeable * 2), height * 1.4, seeable / 2),
        new THREE.MeshStandardMaterial({ color: 0xf1e7c6 }),
      );
      nose.position.set(0, height * 0.7, -d / 2);
      body.add(nose);
    }
    if (p.kind === 'ghost' && p.uncertaintyRadius > 0) {
      g.add(this.uncertaintyCircle(p.uncertaintyRadius));
    }
    const text = own ? p.label : p.ageTag;
    if (text !== '') {
      const labelW = span * 0.07;
      const tag = labelSprite(text, !own, labelW);
      tag.position.set(0, height + labelW / 8, reach + labelW / 8);
      g.add(tag);
    }
    return g;
  }

  /** Where a stale contact may now be: a translucent disc with an outline, flat on the map. */
  private uncertaintyCircle(radius: number): THREE.Group {
    const c = new THREE.Group();
    const lift = this.span * 0.001;
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
      new THREE.RingGeometry(Math.max(radius - this.span * 0.0015, 0), radius, 64),
      new THREE.MeshBasicMaterial({
        color: 0xa83232,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
      }),
    );
    for (const m of [fill, edge]) {
      m.rotation.x = -Math.PI / 2;
      m.position.y = lift;
      c.add(m);
    }
    c.name = 'uncertainty';
    return c;
  }

  /** Pick at a pointer position in client (CSS pixel) coordinates. Pieces first, then the map plane. Coordinates are metres. */
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
    // Pieces may have moved since the last render.
    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    const meshes: THREE.Object3D[] = [];
    this.piecesRoot.traverse((o) => {
      if (o.name === 'pick') meshes.push(o);
    });
    const hit = rc.intersectObjects(meshes, false)[0];
    if (hit) {
      let o: THREE.Object3D | null = hit.object;
      while (o && o.userData.id === undefined) o = o.parent;
      if (o) {
        const { pieceKind, id } = o.userData as { pieceKind: 'own' | 'ghost'; id: string };
        // Which piece comes from the pick mesh; where is the ray's point on the map plane,
        // not the point on the mesh's top or side, which is shifted toward the camera.
        const coord = rayToMap(this.state.map, rc.ray) ?? worldToMap(this.state.map, hit.point);
        return { type: 'piece', pieceKind, id, coord };
      }
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
      this.stepGlides(performance.now());
      if (this.dolly) this.stepDolly(performance.now());
      else if (this.controls.enabled) this.controls.update();
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
    clearGroup(this.marksRoot);
    clearGroup(this.overlayRoot);
    if (this.mapMesh) disposeTree(this.mapMesh);
    if (this.tableMesh) disposeTree(this.tableMesh);
    this.renderer.dispose();
  }
}

function clearGroup(g: THREE.Group): void {
  for (const c of [...g.children]) {
    g.remove(c);
    disposeTree(c);
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
