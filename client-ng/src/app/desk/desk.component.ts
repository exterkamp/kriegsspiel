import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { unreadCount } from '@legacy/desk/tray';
import { VIEWS, isDeskView, isTypingTarget, viewForKey, type ViewId } from '@legacy/desk/views';
import { ClockComponent } from '../game/clock.component';
import { GameService } from '../game/game.service';
import { ConferenceComponent } from './conference/conference.component';
import { DeskStore } from './desk.store';
import { GameOverComponent } from './game-over/game-over.component';
import { InTrayComponent } from './in-tray.component';
import { JournalComponent } from './journal/journal.component';
import { OrdersDeskComponent } from './orders-desk.component';
import { PausePanelComponent } from './pause-panel/pause-panel.component';
import { RosterComponent } from './roster/roster.component';
import { UmpireWindowComponent } from './umpire-window.component';

/** What to focus when a view opens, so keyboard users land inside it. */
const FOCUS: Partial<Record<ViewId, string>> = {
  inTray: '#tray',
  orders: '#desk-order-text',
  roster: '#view-roster',
  journal: '#view-journal',
  conference: '#view-conference',
};

/**
 * The desk shell (port of `desk/Desk.svelte`, with the game over screen of #266): one button per view, the hotkeys
 * T/I/O/R/J/C and Escape, focus handling, and the paper for the open view over the table. The table canvas lives in
 * the game route, so switching views never destroys it; `TableHostComponent` dollies the camera on `activeView`.
 */
@Component({
  selector: 'ks-desk',
  imports: [
    ClockComponent,
    PausePanelComponent,
    InTrayComponent,
    OrdersDeskComponent,
    RosterComponent,
    JournalComponent,
    ConferenceComponent,
    UmpireWindowComponent,
    GameOverComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './desk.component.html',
  styleUrl: './desk.component.css',
  host: { '(window:keydown)': 'onKey($event)' },
})
export class DeskComponent {
  private readonly game = inject(GameService);
  private readonly injector = inject(Injector);
  protected readonly desk = inject(DeskStore);
  protected readonly views = VIEWS;
  protected readonly isDeskView = isDeskView;

  protected readonly state = this.game.state;
  protected readonly gameId = this.game.gameId;
  private readonly ended = computed(() => this.game.state().gameOver !== undefined);
  protected readonly unread = computed(() =>
    unreadCount(this.game.state().dispatches, this.desk.trayMarks()),
  );

  constructor() {
    // The game ending brings up the result whatever view was open.
    effect(() => {
      if (this.ended()) untracked(() => this.desk.activeView.set('table'));
    });
  }

  protected go(v: ViewId): void {
    this.desk.activeView.set(v);
  }

  protected onKey(e: KeyboardEvent): void {
    if (isTypingTarget(e.target) && e.key !== 'Escape') return;
    const v = viewForKey(e);
    if (v === undefined) return;
    e.preventDefault();
    this.go(v);
    const sel = FOCUS[v];
    if (sel)
      afterNextRender(() => document.querySelector<HTMLElement>(sel)?.focus(), {
        injector: this.injector,
      });
  }

  protected goTo(url: string): void {
    this.game.disconnect();
    window.location.assign(url);
  }

  protected playAgain(e: { id: string; side: string | undefined }): void {
    this.goTo(`/?game=${encodeURIComponent(e.id)}${e.side ? `&side=${encodeURIComponent(e.side)}` : ''}`);
  }
}
