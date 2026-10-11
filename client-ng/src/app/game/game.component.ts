import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  inject,
  signal,
  type OnInit,
} from '@angular/core';
import { fetchGame } from '@legacy/lobby/api';
import { parseSession } from '@legacy/session';
import { DeskComponent } from '../desk/desk.component';
import { DeskStore } from '../desk/desk.store';
import { HudComponent } from '../hud/hud.component';
import { MarksBarComponent } from '../hud/marks-bar.component';
import { SideSwitchComponent } from '../hud/side-switch.component';
import { GameService } from './game.service';
import { TableHostComponent } from './table-host.component';
import { TableService } from './table.service';

/**
 * The game page: the persistent table canvas with the HUD, marks bar and desk layered over it. Open `/?game=<id>` to
 * join a game; with none it shows the fixture board offline. The canvas lives here so switching desk views never
 * destroys it; leaving the route disposes it.
 */
@Component({
  selector: 'ks-game',
  imports: [
    TableHostComponent,
    HudComponent,
    MarksBarComponent,
    SideSwitchComponent,
    DeskComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ks-table-host />
    <ks-hud />
    <ks-marks-bar />
    @if (sides().length > 1) {
      <ks-side-switch [game]="game.gameId()!" [sides]="sides()" [current]="current()" />
    }
    <ks-desk />
  `,
  styles: `
    :host {
      display: block;
      position: fixed;
      inset: 0;
    }
  `,
})
export class GameComponent implements OnInit, OnDestroy {
  protected readonly game = inject(GameService);
  private readonly desk = inject(DeskStore);
  private readonly table = inject(TableService);
  private stops: Array<() => void> = [];
  protected readonly sides = signal<string[]>([]);
  protected readonly current = signal<string | undefined>(undefined);
  private destroyed = false;

  ngOnInit(): void {
    this.game.connect(window.location);
    const params = parseSession(window.location.search);
    const key = params.mode === 'join' ? params.game : 'fixture';
    this.stops = [
      this.desk.persistTray(key),
      this.desk.persistDraft(key),
      this.desk.persistJournal(key),
    ];
    if (params.mode !== 'join') return;
    // Hot-seat: the one account plays both sides, so offer the other side's desk.
    fetchGame(params.game)
      .then((info) => {
        if (this.destroyed || info.sessionType !== 'hot_seat') return;
        const sides = info.sides.map((s) => s.side);
        this.sides.set(sides);
        this.current.set(params.side ?? sides[0]);
      })
      .catch((e: unknown) => this.table.status.set(e instanceof Error ? e.message : String(e)));
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    for (const stop of this.stops) stop();
    this.game.disconnect();
  }
}
