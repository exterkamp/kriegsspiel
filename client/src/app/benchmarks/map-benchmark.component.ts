import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  viewChild,
} from '@angular/core';
import { mountBenchmark } from '@legacy/map-authoring/benchmark';
import { MenuLinkComponent } from '../shell/menu-link.component';

/** Hosts the existing local map performance benchmark (`mountBenchmark`); the runner builds its own DOM. The template has no `#benchmark` id on purpose: the legacy module mounts itself on that id when imported. */
@Component({
  selector: 'ks-map-benchmark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MenuLinkComponent],
  template: `<main #root></main>
    <ks-menu-link />`,
})
export class MapBenchmarkComponent implements OnDestroy {
  private readonly root = viewChild.required<ElementRef<HTMLElement>>('root');
  private app: { dispose(): void } | undefined;

  constructor() {
    afterNextRender(() => {
      this.app = mountBenchmark(this.root().nativeElement);
    });
  }

  ngOnDestroy(): void {
    this.app?.dispose();
  }
}
