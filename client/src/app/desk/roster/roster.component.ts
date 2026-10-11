import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { formatGameTime, gameNowMs } from '@legacy/net/state';
import { formatAge, rosterRows, type RosterRow } from '@legacy/desk/roster';
import { GameService } from '../../game/game.service';
import { DeskStore } from '../desk.store';

/** The order of battle (port of `desk/Roster.svelte`). Row logic stays in the pure `desk/roster.ts`. */
@Component({
  selector: 'ks-roster',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './roster.component.html',
  styleUrl: './roster.component.css',
})
export class RosterComponent {
  private readonly game = inject(GameService);
  private readonly desk = inject(DeskStore);

  // Aging is read against game time, so the roster re-reads it now and then.
  private readonly wall = signal(Date.now());
  protected readonly rows = computed(() => {
    const s = this.game.state();
    const nowGame = s.clock ? gameNowMs(s.clock, this.wall()) : (s.view?.atGame ?? 0);
    return rosterRows(s.view, nowGame);
  });
  protected readonly formatAge = formatAge;
  protected readonly formatGameTime = formatGameTime;

  constructor() {
    const t = setInterval(() => this.wall.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  protected focus(r: RosterRow): void {
    this.desk.showOnTable.set(r.position);
    this.desk.activeView.set('table');
  }
}
