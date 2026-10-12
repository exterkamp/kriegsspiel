import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
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
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  constructor() {
    const destroy = inject(DestroyRef);
    let destroyed = false;
    // Keep both cleanup and the allocation guard in place before scheduling render work.
    destroy.onDestroy(() => {
      destroyed = true;
    });
    const render = afterNextRender(() => {
      if (!destroyed) this.table.mount(this.canvas().nativeElement);
    });
    destroy.onDestroy(() => render.destroy());
  }

  selectFile(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (file) this.table.load(file);
  }
}
