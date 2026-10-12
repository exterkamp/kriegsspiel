import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { GameService } from './game.service';

/**
 * Shown in place of the map table when the browser cannot make a WebGL context (#259). It says what is wrong and how
 * to fix it, and lists the side's units and the enemy it can see so the player knows the situation; orders are still
 * written on the desk, which does not need WebGL.
 */
@Component({
  selector: 'ks-webgl-fallback',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ks-theme', role: 'region', 'aria-label': 'Map table unavailable' },
  template: `
    <div class="ks-paper ks-stack panel">
      <h2>The map table needs WebGL</h2>
      <p role="alert">
        This browser could not start 3D graphics, so the map table cannot be drawn. The desk still
        works: read the in-tray and write orders as usual.
      </p>
      <p class="ks-muted">
        To fix it, turn on hardware acceleration (in Chrome: Settings, System, "Use graphics
        acceleration when available"), then restart the browser and reload this page. On a virtual
        machine or remote desktop, enable 3D acceleration or a software renderer.
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
  `,
  styles: `
    :host {
      display: block;
      position: absolute;
      inset: 0;
      overflow: auto;
      padding: 4rem 1rem 6rem;
      background: var(--ks-table);
    }
    .panel {
      max-width: 40rem;
      margin: 0 auto;
      padding: 1rem 1.25rem;
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
