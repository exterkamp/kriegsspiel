import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewEncapsulation,
  afterNextRender,
  viewChild,
} from '@angular/core';
import { mountBenchmark } from '@legacy/map-authoring/benchmark';
import { ToolHeaderComponent } from '../ui/tool-header.component';

/**
 * Hosts the existing local map performance benchmark (`mountBenchmark`); the runner builds its own DOM. The template
 * has no `#benchmark` id on purpose: the legacy module mounts itself on that id when imported. The page wears the
 * shared design system (`ks-theme`, #308); its styles are unencapsulated (scoped under the host) because the runner's
 * DOM is not Angular's. The benchmark canvas keeps its fixed 1440 × 900 CSS size and scrolls inside its frame.
 */
@Component({
  selector: 'ks-map-benchmark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { class: 'ks-theme' },
  imports: [ToolHeaderComponent],
  template: `<ks-tool-header heading="Map preview benchmark" />
    <main #root></main>`,
  styles: `
    ks-map-benchmark {
      display: block;
      box-sizing: border-box;
      min-height: 100vh;
      min-height: 100dvh;
      background: var(--ks-page-bg);
      color: var(--ks-text);

      main {
        box-sizing: border-box;
        padding: var(--ks-space-4) var(--ks-space-5) var(--ks-space-6);
      }
      main > p {
        max-width: 72ch;
        margin: 0 0 var(--ks-space-4);
      }
      .benchmark-form {
        display: flex;
        flex-wrap: wrap;
        gap: var(--ks-space-3) var(--ks-space-4);
        align-items: end;
        margin: 0 0 var(--ks-space-3);
        padding: var(--ks-space-3) var(--ks-space-4);
        background: var(--ks-surface);
        border: 1px solid var(--ks-rule);
        border-radius: var(--ks-radius);
      }
      .benchmark-form .ks-field {
        margin: 0;
        font-size: var(--ks-text-sm);
      }
      .benchmark-form .ks-choice {
        align-self: center;
        font-size: var(--ks-text-sm);
      }
      .benchmark-form input[type='number'] {
        width: 9em;
      }
      #benchmark-machine {
        width: 22em;
      }
      .benchmark-result {
        margin: 0 0 var(--ks-space-3);
        font-size: var(--ks-text-sm);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .benchmark-result:empty {
        display: none;
      }
      .benchmark-canvas {
        overflow: auto;
        max-width: 100%;
        border: 1px solid var(--ks-rule);
        border-radius: var(--ks-radius);
        background: var(--ks-paper-sunk);
      }
      @media (max-width: 760px) {
        main {
          padding: var(--ks-space-3) var(--ks-space-4) var(--ks-space-5);
        }
        .benchmark-form .ks-field,
        .benchmark-form input[type='number'],
        #benchmark-machine,
        .benchmark-actions {
          width: 100%;
        }
      }
    }
  `,
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
