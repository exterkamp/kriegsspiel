import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import type { TurnOrder } from '@kriegsspiel/protocol';
import { deadlineText, heldLine, sidesSent, turnLine, turnPhase } from '@legacy/desk/turn';
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
    return t ? turnLine(t) : '';
  });
  protected readonly held = computed(() => this.turn()?.held ?? []);
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
    if (!this.confirming()) {
      this.confirming.set(true);
      return;
    }
    if (!this.ok(this.actions.send())) return;
    this.confirming.set(false);
    this.editing.set(undefined);
  }
}
