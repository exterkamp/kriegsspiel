import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  output,
  signal,
  untracked,
} from '@angular/core';
import type { TurnOrder } from '@kriegsspiel/protocol';
import {
  deadlineText,
  heldLine,
  howTurnsWork,
  lastTurnText,
  sidesSent,
  timeOfDay,
  turnLine,
  turnPhase,
  turnRights,
  turnSenderText,
  turnsInBattle,
} from '@legacy/desk/turn';
import { orderProgress } from '@legacy/desk/orders';
import { unitStatuses } from '@legacy/desk/turnReport';
import { GameService } from '../game/game.service';
import { TURN_ACTIONS } from '../game/ports';
import { DeskStore } from './desk.store';

/**
 * Turn mode on the orders desk (D39, 11.10): the orders held for the open turn, who has sent, and the one
 * action that sends the side's orders. Held orders stay editable and withdrawable until the side sends;
 * sending is final, so it asks once before it goes.
 */
@Component({
  selector: 'ks-turn-orders',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './turn-orders.component.html',
  styleUrl: './turn-orders.component.css',
})
export class TurnOrdersComponent {
  private readonly game = inject(GameService);
  private readonly desk = inject(DeskStore);
  private readonly actions = inject(TURN_ACTIONS);
  /** The player asked to rewrite a held order: the desk puts it in the order box. */
  readonly edit = output<TurnOrder>();

  private readonly now = signal(Date.now());
  protected readonly turn = computed(() => this.game.state().turn);
  protected readonly phase = computed(() => turnPhase(this.game.state()));
  protected readonly heading = computed(() => {
    const t = this.turn();
    const s = this.game.state();
    return t ? turnLine(t, turnsInBattle(s.battleMinutes, s.turnMinutes)) : '';
  });
  /** A short last turn says why it is short (#439). */
  protected readonly lastTurn = computed(() => {
    const t = this.turn();
    const s = this.game.state();
    return t && !t.pursuitUntil ? lastTurnText(t, s.turnMinutes, s.battleMinutes) : undefined;
  });
  /** What a turn is, for a first-time player (#439). */
  protected readonly howItWorks = computed(() => {
    const s = this.game.state();
    const t = this.turn();
    const minutes = s.turnMinutes ?? (t ? Math.round((t.endsAt - t.startsAt) / 60_000) : undefined);
    return minutes ? howTurnsWork(minutes, s.battleMinutes) : undefined;
  });
  /** Each own unit at a glance, from the side's own view (#439). */
  protected readonly units = computed(() => {
    const s = this.game.state();
    if (!s.view) return [];
    return unitStatuses({
      view: s.view,
      held: this.held(),
      pending: s.pending,
      dispatches: s.dispatches,
      papers: this.desk.lastTurn()?.papers ?? [],
      sent: this.phase() !== 'writing',
    });
  });
  /**
   * Orders sent in earlier turns, newest first, each with where it stands: with the courier, delivered at a time,
   * acted on, or lost (#439).
   */
  protected readonly earlier = computed(() => {
    const s = this.game.state();
    const now = new Set(this.held().map((o) => o.orderId));
    return s.pending
      .filter((p) => !now.has(p.orderId))
      .map((p) => ({
        id: p.orderId,
        line: `To ${p.toName ?? 'a unit'}, sent at ${timeOfDay(p.sentAtGame)}`,
        words: p.words ?? p.text,
        state: orderProgress(p, s.dispatches, timeOfDay)?.label ?? 'With the courier; no word yet',
      }))
      .reverse();
  });
  protected readonly held = computed(() => this.turn()?.held ?? []);
  /** Only a seat that signs may send; intelligence may not hold or withdraw either (#428). */
  protected readonly rights = computed(() => turnRights(this.game.state().view?.role));
  protected readonly senderText = computed(() => turnSenderText(this.rights()));
  private readonly names = computed(
    () => new Map((this.game.state().view?.ownUnits ?? []).map((u) => [u.id, u.name])),
  );
  protected readonly sides = computed(() => {
    const t = this.turn();
    return t ? sidesSent(t, this.game.state().view?.side, this.game.sides()) : [];
  });
  /** Other sides still writing, by name, for the line under a sent turn. */
  protected readonly waitingOn = computed(() =>
    this.sides()
      .filter((s) => !s.you && !s.sent)
      .map((s) => s.name),
  );
  protected readonly deadline = computed(() => deadlineText(this.turn()?.deadline, this.now()));
  protected readonly editing = this.desk.editingTurnOrder;
  /** The player pressed Send once; the second press (or Cancel) settles it. */
  protected readonly confirming = signal(false);
  protected readonly problem = signal('');
  /** Words still in the order box that were never held: they would not go with the turn. */
  protected readonly unheldWords = computed(() => this.desk.orderDraft().text.trim() !== '');

  constructor() {
    const t = setInterval(() => this.now.set(Date.now()), 15_000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
    // The question belongs to one turn's writing: once the side has sent, the turn has closed or the next one has
    // opened, it is put away, so a single press can never send a later turn.
    const moved = computed(() => `${this.turn()?.turn}:${this.phase()}`);
    effect(() => {
      moved();
      untracked(() => this.confirming.set(false));
    });
  }

  protected line(o: TurnOrder): string {
    return heldLine(o, this.names());
  }

  private ok(sent: boolean): boolean {
    this.problem.set(sent ? '' : 'Not connected. Try again when the link is back.');
    return sent;
  }

  protected withdraw(o: TurnOrder): void {
    if (!this.ok(this.actions.withdraw(o.orderId))) return;
    if (this.editing() === o.orderId) this.editing.set(undefined);
  }

  protected send(): void {
    if (this.rights() !== 'send') return;
    if (!this.confirming()) {
      this.confirming.set(true);
      return;
    }
    if (!this.ok(this.actions.send())) return;
    // Pressing twice is not sending twice. The order being edited is let go by the desk once the `turnState` shows
    // the side has sent, so a refused send (a staff seat, say) leaves it as it was.
    this.confirming.set(false);
  }
}
