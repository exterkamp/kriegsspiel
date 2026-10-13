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
  viewChild,
} from '@angular/core';
import * as THREE from 'three';
import { buildSceneState } from '@legacy/table/sceneState';
import { GLIDE_MS } from '@legacy/table/glide';
import { fixtureMap } from '@legacy/table/fixture';
import { buildWindowScene } from '@legacy/window/model';
import { DeskStore } from '../desk/desk.store';
import { GameService } from './game.service';
import { MarksService } from './marks.service';
import { WebglFallbackComponent } from './webgl-fallback.component';
import { TABLE_SCENE_FACTORY, TableService } from './table.service';

/**
 * Hosts the framework-agnostic Three.js `TableScene` on one canvas. The scene is built once, after the first render,
 * and lives as long as this component (the game route, not a desk view); Angular never touches Three.js objects, it
 * only calls into the scene from effects and the canvas pointer handlers.
 */
@Component({
  selector: 'ks-table-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WebglFallbackComponent],
  template: `@if (tableService.unavailable()) {
      <ks-webgl-fallback />
    }
    <canvas
      #table
      [hidden]="tableService.unavailable()"
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
    '(window:resize)': 'tableService.scene()?.resize()',
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
  /** A turn-mode game (D39) moves by whole turns, so its pieces glide to their new places. */
  private readonly turnMode = computed(() => this.game.state().turnMode === true);

  constructor() {
    afterNextRender(() => {
      let built: ReturnType<typeof this.makeScene> | undefined;
      try {
        built = this.makeScene(this.canvas().nativeElement);
        built.start();
        this.tableService.scene.set(built);
      } catch (e) {
        built?.dispose();
        // No WebGL (GPU or hardware acceleration off): the desk still works, so say so and list the units.
        this.tableService.unavailable.set(e instanceof Error ? e.message : String(e));
      }
    });
    // The player's picture, or after the game the umpire's window at the scrubbed time.
    let shownFrame = false;
    effect(() => {
      const scene = this.tableService.scene();
      const frame = this.desk.windowFrame();
      const view = this.game.view();
      if (!scene) return;
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      // Only a turn glides: the window's frames, and the way back from them to the live picture, are set down at once.
      const glide = !frame && !shownFrame && this.turnMode() && !still;
      shownFrame = !!frame;
      scene.setGlide(glide ? GLIDE_MS : 0);
      if (frame) scene.apply(buildWindowScene(frame, this.desk.windowBelief(), fixtureMap));
      else if (view) scene.apply(buildSceneState(view, fixtureMap));
    });
    // Leaving the table dollies the camera to the desk and back.
    effect(() => {
      const scene = this.tableService.scene();
      const deskOpen = this.marks.deskOpen();
      scene?.setDesk(
        deskOpen,
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 600,
      );
    });
    effect(() => this.tableService.scene()?.setOverlays(this.marks.overlays()));
    // Drawing tools take the left button; the camera keeps the wheel and the other buttons.
    effect(() => {
      const scene = this.tableService.scene();
      const look = this.marks.tool() === 'view';
      if (!scene) return;
      scene.controls.mouseButtons.LEFT = look ? THREE.MOUSE.ROTATE : (null as never);
      scene.controls.touches.ONE = look ? THREE.TOUCH.ROTATE : (null as never);
    });
    effect(() =>
      this.tableService
        .scene()
        ?.setMarks(this.marks.shown(), this.marks.nowGame(), this.marks.selectedId()),
    );
    // The desk asks the table to show a place; the table pans there and clears the request.
    effect(() => {
      const at = this.desk.showOnTable();
      const scene = this.tableService.scene();
      if (!at || !scene) return;
      scene.panTo(at);
      this.desk.showOnTable.set(undefined);
    });
    // Marks fade with game time, so redraw them now and then.
    const timer = setInterval(() => this.marks.tick.update((n) => n + 1), 2000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected down(e: PointerEvent): void {
    const scene = this.tableService.scene();
    if (scene) this.marks.pointerDown(scene, this.canvas().nativeElement, e);
  }
  protected move(e: PointerEvent): void {
    const scene = this.tableService.scene();
    if (scene) this.marks.pointerMove(scene, e);
  }
  protected up(e: PointerEvent): void {
    const scene = this.tableService.scene();
    if (scene) this.marks.pointerUp(scene, e);
  }

  ngOnDestroy(): void {
    this.tableService.scene()?.dispose();
    this.tableService.scene.set(undefined);
  }
}
