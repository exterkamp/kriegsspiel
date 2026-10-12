import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  untracked,
  inject,
  viewChild,
} from '@angular/core';
import { MapTableService } from './map-table.service';

@Component({
  selector: 'ks-map-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [MapTableService],
  templateUrl: './map-table.component.html',
  styleUrl: './map-table.component.css',
})
export class MapTableComponent {
  readonly table = inject(MapTableService);
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  constructor() {
    const destroy = inject(DestroyRef);
    let destroyed = false;
    // Keep both cleanup and the allocation guard in place before scheduling render work.
    destroy.onDestroy(() => {
      destroyed = true;
    });
    const render = afterRenderEffect((onCleanup) => {
      const canvas = this.canvas()?.nativeElement;
      if (destroyed || !canvas) return;
      // Register cleanup before allocation, including synchronous reentrant destruction.
      onCleanup(() => untracked(() => this.table.unmount(canvas)));
      // Only canvas identity participates in this effect, never loader/UI state.
      untracked(() => this.table.mount(canvas));
    });
    destroy.onDestroy(() => render.destroy());
  }

  selectFile(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (file) this.table.load(file);
  }
}
