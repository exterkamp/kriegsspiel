import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewEncapsulation,
  afterNextRender,
  viewChild,
} from '@angular/core';
import { battlefieldPreset, CURRENT_GENERATOR, CONSUMED_FORK } from '@kriegsspiel/maps';
import { createAuthoringRuntime } from '@legacy/map-authoring/runtime/index';
import { mountAuthoringApp } from '@legacy/map-authoring/authoring-app';
import { isHighContrast } from '../ui/contrast';
import { ToolHeaderComponent } from '../ui/tool-header.component';

// Exact support identities come from the generator; settings edits never replace recorded versions.
function equal(left: unknown, right: unknown): boolean {
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object')
    return left === right;
  const a = left as Record<string, unknown>,
    b = right as Record<string, unknown>;
  const keys = Object.keys(a).sort();
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
  );
}

/**
 * With the app in high contrast (#308), switches the map preview's own high-contrast drawing on through its checkbox
 * (`#contrast`, whose change listener the authoring app owns). The checkbox still switches it back.
 */
export function matchAppContrast(doc: Document): void {
  const box = doc.getElementById('contrast');
  if (!(box instanceof HTMLInputElement) || box.checked || !isHighContrast(doc)) return;
  box.checked = true;
  box.dispatchEvent(new Event('change'));
}

/**
 * Hosts the existing imperative map authoring app (`mountAuthoringApp`) over the markup of `map-authoring.html`.
 * The app looks its elements up by id, so the template keeps those ids. Generation and validation run in workers.
 * The page wears the shared design system (`ks-theme`, #308); with the app in high contrast the map preview starts in
 * its high-contrast drawing too (the checkbox still switches it).
 */
@Component({
  selector: 'ks-map-authoring',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './map-authoring.component.css',
  host: { class: 'ks-theme' },
  imports: [ToolHeaderComponent],
  templateUrl: './map-authoring.component.html',
})
export class MapAuthoringComponent implements OnDestroy {
  private readonly root = viewChild.required<ElementRef<HTMLElement>>('root');
  private app: { dispose(): void } | undefined;

  constructor() {
    afterNextRender(() => {
      const runtime = createAuthoringRuntime({
        generationWorkerFactory: () =>
          new Worker(new URL('../../legacy/map-authoring/generate.worker.ts', import.meta.url), {
            type: 'module',
          }),
        validationWorkerFactory: () =>
          new Worker(new URL('../../legacy/map-authoring/validate.worker.ts', import.meta.url), {
            type: 'module',
          }),
      });
      try {
        this.app = mountAuthoringApp(this.root().nativeElement.ownerDocument, runtime, {
          presets: (['flat-countryside', 'wooded-hills', 'river-valley'] as const).map((name) => ({
            id: name,
            label: name.replaceAll('-', ' '),
            settings: battlefieldPreset(name).settings,
          })),
          checkReplaySupport: (provenance) =>
            equal(provenance.generator, CURRENT_GENERATOR) && equal(provenance.fork, CONSUMED_FORK)
              ? { supported: true }
              : {
                  supported: false,
                  reason:
                    'Recorded generator, stages or fork artifact are unsupported by this version',
                },
        });
        matchAppContrast(document);
      } catch (error) {
        runtime.dispose();
        const status = document.getElementById('asset-status');
        if (status) {
          status.textContent =
            error instanceof Error ? error.message : 'Authoring initialization failed';
          status.dataset['error'] = 'true';
        }
        throw error;
      }
    });
  }

  ngOnDestroy(): void {
    this.app?.dispose();
  }
}
