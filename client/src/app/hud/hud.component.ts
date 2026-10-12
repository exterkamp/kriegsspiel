import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { gameOverText } from '@legacy/hud/hud';
import { GameService } from '../game/game.service';
import { TableService } from '../game/table.service';

/**
 * The HUD (port of the visible part of `hud/hud.ts`): the camera snaps, the line showing the last pick, and the
 * game-over status line. The plain orders panel stays out: the Svelte build hid it (`#orders { display: none }`)
 * behind the orders desk, so it is not ported.
 */
@Component({
  selector: 'ks-hud',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div id="hud">
      <button id="top" type="button" (click)="table.scene()?.snapTopDown()">Top-down</button>
      <button id="obl" type="button" (click)="table.scene()?.snapOblique()">Oblique</button>
      <span id="pick">{{ table.status() }}</span>
    </div>
    <section id="gameover" aria-label="Game over" role="status" [hidden]="over() === undefined">
      {{ over() }}
    </section>
  `,
  styles: `
    #hud {
      position: fixed;
      top: 8px;
      left: 8px;
      display: flex;
      gap: 8px;
      align-items: center;
      color: var(--ks-on-overlay);
      font-size: var(--ks-text-sm);
      flex-wrap: wrap;
      max-width: calc(100% - 16px);
    }
    /* The Menu button sits at the right on a phone; the HUD wraps in the room that is left (#344).
       128px is the Menu button's width plus gutters; the umpire window offsets in
       umpire-window.component.css assume the HUD wraps to two rows here. Change them together. */
    @media (max-width: 600px) {
      #hud {
        max-width: calc(100% - 128px);
      }
    }
    #gameover {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
  `,
})
export class HudComponent {
  protected readonly table = inject(TableService);
  private readonly game = inject(GameService);
  protected readonly over = computed(() => gameOverText(this.game.state()));
}
