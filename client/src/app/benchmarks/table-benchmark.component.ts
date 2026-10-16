import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  ViewEncapsulation,
  afterNextRender,
} from '@angular/core';
import { ToolHeaderComponent } from '../ui/tool-header.component';

/**
 * Hosts the dev-only table performance harness (`table/benchmark.ts`, query `?seconds=` and `?orbit=1`). That module
 * is a script: it finds `#table` and `#result` and starts on import, so it is imported after the first render. A
 * module runs once per page load, so reopening the route needs a reload (it is a diagnostic page, not an app screen).
 * The module publishes its scene as `window.__table`; leaving the route disposes it so the render loop and WebGL
 * context do not outlive the canvas (if the route is left before the artwork has decoded, there is nothing to dispose yet).
 * The canvas still fills the viewport, so the measurement is unchanged; the tool header and the result float over it
 * in the shared design system (`ks-theme`, #308).
 */
@Component({
  selector: 'ks-table-benchmark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { class: 'ks-theme' },
  imports: [ToolHeaderComponent],
  styles: `
    ks-table-benchmark {
      display: block;
      position: fixed;
      inset: 0;
      background: var(--ks-table);
    }
    ks-table-benchmark canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
    ks-table-benchmark ks-tool-header {
      position: fixed;
      top: var(--ks-space-2);
      left: var(--ks-space-2);
      max-width: calc(100% - 2 * var(--ks-space-2));
      z-index: 1;
      border-radius: var(--ks-radius);
      box-shadow: var(--ks-shadow-small);
      overflow: hidden;
    }
    ks-table-benchmark #result {
      position: fixed;
      left: var(--ks-space-2);
      bottom: var(--ks-space-2);
      max-width: calc(100% - 2 * var(--ks-space-2));
      max-height: 50%;
      overflow: auto;
      margin: 0;
      font-family: var(--ks-font-mono);
      font-size: var(--ks-text-xs);
    }
  `,
  template: `<canvas id="table" aria-label="Benchmark table scene"></canvas>
    <ks-tool-header heading="Table benchmark" />
    <pre id="result" class="ks-overlay">sampling…</pre>`,
})
export class TableBenchmarkComponent implements OnDestroy {
  constructor() {
    afterNextRender(() => {
      import('@legacy/table/benchmark').catch((error: unknown) => {
        // Without WebGL the harness cannot start; say so where the result would be instead of "sampling…".
        const result = document.getElementById('result');
        if (result)
          result.textContent = `Benchmark failed: ${error instanceof Error ? error.message : String(error)}`;
      });
    });
  }

  ngOnDestroy(): void {
    (window as unknown as { __table?: { dispose(): void } }).__table?.dispose();
  }
}
