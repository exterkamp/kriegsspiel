import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { answerAnnouncement, dispatchAnnouncement } from '@legacy/desk/announce';
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
import { TurnPanelComponent } from './turn-panel/turn-panel.component';
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
    TurnPanelComponent,
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
  /** A turn-mode game (D39) has no pause vote; the turn panel takes its place. */
  protected readonly turnMode = computed(() => this.game.state().turnMode === true);
  protected readonly unread = computed(() =>
    unreadCount(this.desk.papers(), this.desk.trayMarks()),
  );

  /** Spoken to screen readers: a dispatch arrived, a staff officer answered. */
  protected readonly announcement = signal('');
  private pending: string[] = [];
  private flip = false;

  /**
   * Queues a message for the live region. Messages raised in the same tick are joined so none overwrites another,
   * and the text alternates with a trailing no-break space so a repeat of the last message still changes the DOM.
   */
  private speak(message: string): void {
    this.pending.push(message);
    if (this.pending.length > 1) return;
    queueMicrotask(() => {
      this.flip = !this.flip;
      this.announcement.set(this.pending.join(' ') + (this.flip ? '\u00a0' : ''));
      this.pending = [];
    });
  }

  constructor() {
    // The first run only records what is already there; after that, new dispatches and answers are announced.
    // This assumes the game state is loaded when the desk first renders; nothing here guards against a late load.
    const seenDispatches = new Set<string>();
    let first = true;
    effect(() => {
      const list = this.desk.papers();
      untracked(() => {
        const say = first ? '' : dispatchAnnouncement(seenDispatches, list);
        for (const d of list) seenDispatches.add(d.id);
        if (say) this.speak(say);
      });
    });
    const seenAnswers = new Set<number>();
    effect(() => {
      const log = this.desk.conferenceLog();
      untracked(() => {
        const say = first ? '' : answerAnnouncement(seenAnswers, log);
        for (const e of log) if (e.answer !== undefined || e.failed) seenAnswers.add(e.id);
        if (say) this.speak(say);
      });
    });
    afterNextRender(() => (first = false), { injector: this.injector });
    // The game ending brings up the result whatever view was open.
    effect(() => {
      if (this.ended()) untracked(() => this.desk.activeView.set('table'));
    });
  }

  protected go(v: ViewId): void {
    this.desk.activeView.set(v);
  }

  /** The umpire's window is a table overlay: another desk view is read without it over it (#438). */
  protected readonly windowShown = computed(
    () =>
      this.desk.windowOpen() &&
      this.state().gameOver !== undefined &&
      this.desk.activeView() === 'table',
  );

  /** The desk bar's button: close the window, or open it at the table. */
  protected toggleWindow(): void {
    if (this.windowShown()) {
      this.desk.windowOpen.set(false);
      return;
    }
    this.desk.activeView.set('table');
    this.desk.windowOpen.set(true);
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
    this.goTo(
      `/?game=${encodeURIComponent(e.id)}${e.side ? `&side=${encodeURIComponent(e.side)}` : ''}`,
    );
  }
}
