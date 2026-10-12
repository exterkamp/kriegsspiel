import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FlatBoardComponent } from './flat-board.component';
import { GameService } from './game.service';

/**
 * Shown in place of the map table when the browser cannot make a WebGL context (#259): a flat board (#343) with a note
 * that says what is wrong and how to fix it, and lists the side's units and the enemy it can see. Orders are still
 * written on the desk, which does not need WebGL.
 */
@Component({
  selector: 'ks-webgl-fallback',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FlatBoardComponent],
  host: { class: 'ks-theme', role: 'region', 'aria-label': 'Flat map board' },
  template: `
    <ks-flat-board />
    <details class="ks-paper note" #note>
      <summary>The 3D map table needs WebGL: showing a flat board</summary>
      <div class="ks-stack">
        <p role="alert">
          This browser could not start 3D graphics, so the map table is drawn flat. The desk still
          works: read the in-tray and write orders as usual, and pick places on the board with the
          Tools.
        </p>
        <p class="ks-muted">
          To get the 3D table, turn on hardware acceleration (in Chrome: Settings, System, "Use
          graphics acceleration when available"), then restart the browser and reload this page. On
          a virtual machine or remote desktop, enable 3D acceleration or a software renderer.
        </p>
        @if (view(); as v) {
          <h3>Your units</h3>
          <ul>
            @for (u of v.ownUnits; track u.id) {
              <li>
                {{ u.name }}: strength {{ u.strength }}, {{ u.formation }}, at {{ at(u.position) }}
              </li>
            } @empty {
              <li class="ks-muted">None.</li>
            }
          </ul>
          <h3>Enemy in sight</h3>
          <ul>
            @for (e of v.visibleEnemies; track e.id) {
              <li>{{ e.id }} at {{ at(e.position) }}</li>
            } @empty {
              <li class="ks-muted">None.</li>
            }
          </ul>
        }
      </div>
    </details>
  `,
  styles: `
    :host {
      display: block;
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    ks-flat-board {
      pointer-events: auto;
    }
    .note {
      position: absolute;
      left: 0.5rem;
      bottom: 4.5rem;
      max-width: min(26rem, calc(100% - 1rem));
      max-height: 60%;
      overflow: auto;
      padding: 0.5rem 0.75rem;
      pointer-events: auto;
    }
    summary {
      cursor: pointer;
    }
    @media (max-width: 600px) {
      .note {
        bottom: 9rem;
      }
    }
  `,
})
export class WebglFallbackComponent {
  private readonly game = inject(GameService);
  protected readonly view = computed(() => this.game.view());
  protected at(p: { x: number; y: number }): string {
    return `${Math.round(p.x)} m east, ${Math.round(p.y)} m north`;
  }
}
