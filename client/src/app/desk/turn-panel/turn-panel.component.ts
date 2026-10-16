import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  RESOLVING_TEXT,
  deadlineText,
  howTurnsWork,
  lastTurnText,
  pursuitText,
  resolvedText,
  sidesSent,
  turnPhase,
} from '@legacy/desk/turn';
import { GameService } from '../../game/game.service';
import { DeskStore } from '../desk.store';

/** The turn just decided: its number and the game time it covered, to count the papers it brought. */
interface Decided {
  turn: number;
  from: number;
  to: number;
}

/**
 * Turn mode in the dock (D39, 11.10), where a real-time game has its pause panel: who has sent orders for
 * the open turn and a way to the send action, the umpire at work while the turn is decided, and word
 * that a turn has been decided with its papers waiting in the in-tray.
 */
@Component({
  selector: 'ks-turn-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './turn-panel.component.html',
  styleUrl: './turn-panel.component.css',
})
export class TurnPanelComponent {
  private readonly game = inject(GameService);
  private readonly desk = inject(DeskStore);

  private readonly now = signal(Date.now());
  protected readonly phase = computed(() => turnPhase(this.game.state()));
  protected readonly turn = computed(() => this.game.state().turn);
  protected readonly sides = computed(() => {
    const t = this.turn();
    return t ? sidesSent(t, this.game.state().view?.side, this.game.sides()) : [];
  });
  protected readonly heldCount = computed(() => this.turn()?.held.length ?? 0);
  protected readonly deadline = computed(() => deadlineText(this.turn()?.deadline, this.now()));
  protected readonly resolvingText = RESOLVING_TEXT;
  /** What a turn is, for a first-time player, and a word on the last turn when it is short (#439). */
  protected readonly howItWorks = computed(() => {
    // Over a desk view the dock stays short (the orders desk explains it itself); the table has room.
    if (this.desk.activeView() !== 'table') return undefined;
    const s = this.game.state();
    const t = this.turn();
    const minutes = s.turnMinutes ?? (t ? Math.round((t.endsAt - t.startsAt) / 60_000) : undefined);
    return minutes ? howTurnsWork(minutes, s.battleMinutes) : undefined;
  });
  protected readonly lastTurn = computed(() => {
    const t = this.turn();
    const s = this.game.state();
    return t && !t.pursuitUntil ? lastTurnText(t, s.turnMinutes, s.battleMinutes) : undefined;
  });
  /** After the umpire's ruling: the turn is the pursuit, and while writing, it may go with no orders (#438). */
  protected readonly pursuit = computed(() => pursuitText(this.turn(), this.phase() === 'writing'));

  /** The last turn decided while this desk was open, until the player reads its papers or dismisses it. */
  private readonly decided = signal<Decided | undefined>(undefined);
  protected readonly decidedText = computed(() => {
    const d = this.decided();
    if (!d) return undefined;
    // The staff's summary of the turn is one of its papers (#439).
    const fresh = this.desk
      .papers()
      .filter((x) => x.receivedAtGame > d.from && x.receivedAtGame <= d.to).length;
    return resolvedText(d.turn, fresh);
  });

  constructor() {
    const t = setInterval(() => this.now.set(Date.now()), 15_000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
    // A new turn opening means the one before it was decided. The turn found on arrival is not news.
    let last: { turn: number; startsAt: number } | undefined;
    effect(() => {
      const t = this.turn();
      if (!t) return;
      untracked(() => {
        if (last && t.turn > last.turn)
          this.decided.set({ turn: t.turn - 1, from: last.startsAt, to: t.startsAt });
        last = { turn: t.turn, startsAt: t.startsAt };
      });
    });
  }

  protected openOrders(): void {
    this.desk.activeView.set('orders');
  }

  protected readReports(): void {
    this.decided.set(undefined);
    this.desk.activeView.set('inTray');
  }

  protected dismiss(): void {
    this.decided.set(undefined);
  }
}
