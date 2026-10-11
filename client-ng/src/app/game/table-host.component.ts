import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { TableScene } from '@legacy/table/TableScene';
import { buildSceneState } from '@legacy/table/sceneState';
import { fixtureMap } from '@legacy/table/fixture';
import { GameService } from './game.service';

/**
 * Hosts the framework-agnostic Three.js `TableScene` on one canvas. The scene is built once, after the first render,
 * and lives as long as this component; Angular never touches Three.js objects, it only calls `apply` with new state.
 */
@Component({
  selector: 'ks-table-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #table></canvas>`,
  styles: `
    :host,
    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
  `,
  host: { '(window:resize)': 'scene()?.resize()' },
})
export class TableHostComponent implements OnDestroy {
  private readonly game = inject(GameService);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('table');
  protected readonly scene = signal<TableScene | undefined>(undefined);

  constructor() {
    afterNextRender(() => {
      const scene = new TableScene(this.canvas().nativeElement);
      scene.start();
      this.scene.set(scene);
    });
    effect(() => {
      const view = this.game.view();
      const scene = this.scene();
      if (view && scene) scene.apply(buildSceneState(view, fixtureMap));
    });
  }

  ngOnDestroy(): void {
    this.scene()?.dispose();
  }
}
