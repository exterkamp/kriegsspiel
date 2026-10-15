import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnDestroy,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import * as THREE from 'three';
import { buildSceneState } from '@legacy/table/sceneState';
import { GLIDE_MS } from '@legacy/table/glide';
import type { BaseMap, SceneState } from '@legacy/table/types';
import type { TableScene } from '@legacy/table/TableScene';
import { buildWindowScene } from '@legacy/window/model';
import { DeskStore } from '../desk/desk.store';
import { GameService } from './game.service';
import { MarksService } from './marks.service';
import { WebglFallbackComponent } from './webgl-fallback.component';
import { TABLE_SCENE_FACTORY, TableService } from './table.service';

/**
 * Hosts one `TableScene` per checked map lifetime, after rendering the canvas. Ordinary view/desk updates keep it;
 * absent or replaced terrain disposes its resources. Angular never touches Three.js objects, it
 * only calls into the scene from effects and the canvas pointer handlers.
 */
@Component({
  selector: 'ks-table-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WebglFallbackComponent],
  template: `@if (map() && tableService.unavailable()) {
      <ks-webgl-fallback />
    }
    <canvas
      #table
      [hidden]="!currentScene() || tableService.unavailable()"
      (pointerdown)="down($event)"
      (pointermove)="move($event)"
      (pointerup)="up($event)"
      (pointercancel)="marks.pointerCancel()"
    ></canvas>`,
  styles: `
    :host,
    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
  `,
  host: {
    '(window:resize)': 'currentScene()?.resize()',
    '(window:keydown)': 'marks.onKey($event)',
  },
})
export class TableHostComponent implements OnDestroy {
  private readonly game = inject(GameService);
  private readonly desk = inject(DeskStore);
  protected readonly marks = inject(MarksService);
  protected readonly tableService = inject(TableService);
  private readonly makeScene = inject(TABLE_SCENE_FACTORY);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('table');
  protected readonly map = this.game.map;
  private readonly rendered = signal(false);
  private readonly sceneMap = signal<BaseMap | undefined>(undefined);
  private ownedScene: TableScene | undefined;
  protected readonly currentScene = computed(() =>
    this.map() && this.map() === this.sceneMap() ? this.tableService.scene() : undefined,
  );
  /** A turn-mode game (D39) moves by whole turns, so its pieces glide to their new places. */
  private readonly turnMode = computed(() => this.game.state().turnMode === true);

  constructor() {
    afterNextRender(() => this.rendered.set(true));
    effect(() => {
      const rendered = this.rendered();
      const map = this.map();
      if (!rendered) return;
      untracked(() => {
        if (map === this.sceneMap()) return;
        this.disposeScene();
        this.desk.showOnTable.set(undefined);
        this.sceneMap.set(map);
        this.tableService.unavailable.set(undefined);
        if (!map) return;
        let built: TableScene | undefined;
        try {
          built = this.makeScene(this.canvas().nativeElement);
          // apply supplies dimensions/texture and camera limits; start must never draw a fixture or old map.
          built.setGlide(0);
          built.apply(this.picture(map));
          built.setDesk(this.marks.deskOpen(), 0);
          built.setOverlays(this.marks.overlays());
          built.setMarks(this.marks.shown(), this.marks.nowGame(), this.marks.selectedId());
          built.start();
          this.ownedScene = built;
          this.tableService.scene.set(built);
        } catch (e) {
          built?.dispose();
          this.tableService.unavailable.set(e instanceof Error ? e.message : String(e));
        }
      });
    });
    // The player's picture, or after the game the umpire's window at the scrubbed time.
    let shownFrame = false;
    let previousScene: TableScene | undefined;
    effect(() => {
      const scene = this.currentScene();
      const frame = this.desk.windowFrame();
      const turns = this.turnMode();
      if (!scene) {
        shownFrame = false;
        previousScene = undefined;
        return;
      }
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      // Only a turn glides: the window's frames, and the way back from them to the live picture, are set down at once.
      const glide = scene === previousScene && !frame && !shownFrame && turns && !still;
      shownFrame = !!frame;
      previousScene = scene;
      scene.setGlide(glide ? GLIDE_MS : 0);
      scene.apply(this.picture(this.map()!));
    });
    // Leaving the table dollies the camera to the desk and back.
    effect(() => {
      const scene = this.currentScene();
      const deskOpen = this.marks.deskOpen();
      scene?.setDesk(
        deskOpen,
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 600,
      );
    });
    effect(() => this.currentScene()?.setOverlays(this.marks.overlays()));
    // Drawing tools take the left button; the camera keeps the wheel and the other buttons.
    effect(() => {
      const scene = this.currentScene();
      const look = this.marks.tool() === 'view';
      if (!scene) return;
      scene.controls.mouseButtons.LEFT = look ? THREE.MOUSE.ROTATE : (null as never);
      scene.controls.touches.ONE = look ? THREE.TOUCH.ROTATE : (null as never);
    });
    effect(() =>
      this.currentScene()?.setMarks(
        this.marks.shown(),
        this.marks.nowGame(),
        this.marks.selectedId(),
      ),
    );
    // The desk asks the table to show a place; the table pans there and clears the request.
    effect(() => {
      const at = this.desk.showOnTable();
      const scene = this.currentScene();
      if (!at) return;
      if (!scene) {
        this.desk.showOnTable.set(undefined);
        return;
      }
      scene.panTo(at);
      this.desk.showOnTable.set(undefined);
    });
    // Marks fade with game time, so redraw them now and then.
    const timer = setInterval(() => this.marks.tick.update((n) => n + 1), 2000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected down(e: PointerEvent): void {
    const scene = this.currentScene();
    if (scene) this.marks.pointerDown(scene, this.canvas().nativeElement, e);
  }
  protected move(e: PointerEvent): void {
    const scene = this.currentScene();
    if (scene) this.marks.pointerMove(scene, e);
  }
  protected up(e: PointerEvent): void {
    const scene = this.currentScene();
    if (scene) this.marks.pointerUp(scene, e);
  }

  ngOnDestroy(): void {
    this.marks.pointerCancel();
    this.disposeScene();
  }

  private picture(map: BaseMap): SceneState {
    const frame = this.desk.windowFrame();
    if (frame) return buildWindowScene(frame, this.desk.windowBelief(), map);
    const view = this.game.view();
    return view ? buildSceneState(view, map) : { side: '', map, own: [], ghosts: [] };
  }

  private disposeScene(): void {
    const scene = this.ownedScene;
    this.ownedScene = undefined;
    if (this.tableService.scene() === scene) this.tableService.scene.set(undefined);
    scene?.dispose();
  }
}
