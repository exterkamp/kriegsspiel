import { ChangeDetectionStrategy, Component, OnDestroy, inject } from '@angular/core';
import { ClockComponent } from './clock.component';
import { GameService } from './game.service';
import { TableHostComponent } from './table-host.component';

/** The game page: the persistent table canvas with the desk layered over it. Open `/?game=<id>` to join a game. */
@Component({
  selector: 'ks-game',
  imports: [TableHostComponent, ClockComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ks-table-host />
    <ks-clock class="clock" />
  `,
  styles: `
    :host {
      display: block;
      position: fixed;
      inset: 0;
    }
    .clock {
      position: fixed;
      top: 8px;
      left: 8px;
    }
  `,
})
export class GameComponent implements OnDestroy {
  private readonly game = inject(GameService);

  constructor() {
    this.game.connect(window.location);
  }

  ngOnDestroy(): void {
    this.game.disconnect();
  }
}
