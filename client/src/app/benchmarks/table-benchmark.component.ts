import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  ViewEncapsulation,
  afterNextRender,
} from '@angular/core';
import { MenuLinkComponent } from '../shell/menu-link.component';

/**
 * Hosts the dev-only table performance harness (`table/benchmark.ts`, query `?seconds=` and `?orbit=1`). That module
 * is a script: it finds `#table` and `#result` and starts on import, so it is imported after the first render. A
 * module runs once per page load, so reopening the route needs a reload (it is a diagnostic page, not an app screen).
 * The module publishes its scene as `window.__table`; leaving the route disposes it so the render loop and WebGL
 * context do not outlive the canvas (if the route is left before the artwork has decoded, there is nothing to dispose yet).
 */
@Component({
  selector: 'ks-table-benchmark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [MenuLinkComponent],
  styles: `
    ks-table-benchmark {
      display: block;
      position: fixed;
      inset: 0;
      background: #2a2118;
    }
    ks-table-benchmark canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
    ks-table-benchmark #result {
      position: fixed;
      left: 8px;
      bottom: 8px;
      margin: 0;
      padding: 4px 8px;
      font: 12px monospace;
      color: #f4eedb;
      background: rgb(0 0 0 / 60%);
    }
  `,
  template: `<canvas id="table"></canvas>
    <pre id="result">sampling…</pre>
    <ks-menu-link />`,
})
export class TableBenchmarkComponent implements OnDestroy {
  constructor() {
    afterNextRender(() => void import('@legacy/table/benchmark'));
  }

  ngOnDestroy(): void {
    (window as unknown as { __table?: { dispose(): void } }).__table?.dispose();
  }
}
