import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { gameNowMs, orderIdOf } from '@legacy/net/state';
import { buildOrderText } from '@legacy/hud/hud';
import {
  COURIERS,
  ORDER_EXAMPLES,
  annexLine,
  arrowMarks,
  estimateRideMs,
  formatEstimate,
  noticeText,
  sentLine,
  orderWithOption,
  splitOptions,
  withAnnex,
  type Courier,
  type OrderDraft,
} from '@legacy/desk/orders';
import { turnPhase, turnRights } from '@legacy/desk/turn';
import type { TurnOrder } from '@kriegsspiel/protocol';
import { GameService } from '../game/game.service';
import { ORDER_SENDER, TURN_ACTIONS } from '../game/ports';
import { DeskStore } from './desk.store';
import { DraftsPanelComponent } from './drafts-panel.component';
import { TurnOrdersComponent } from './turn-orders.component';

/** The longest order text the server accepts, once the addressee and annex are added. */
const MAX_ORDER_CHARS = 2000;

type Field = 'to' | 'text' | 'send';

/** The orders desk (port of `desk/OrdersDesk.svelte`): addressee, wording, annex, courier and signing. */
@Component({
  selector: 'ks-orders-desk',
  imports: [DraftsPanelComponent, TurnOrdersComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './orders-desk.component.html',
  styleUrl: './orders-desk.component.css',
})
export class OrdersDeskComponent {
  private readonly game = inject(GameService);
  private readonly desk = inject(DeskStore);
  private readonly sender = inject(ORDER_SENDER);
  private readonly turnActions = inject(TURN_ACTIONS);
  private stampTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly examples = ORDER_EXAMPLES.map((e) => `"${e}"`).join(' or ');
  protected readonly couriers = Object.entries(COURIERS).map(([id, c]) => ({
    id: id as Courier,
    ...c,
  }));
  protected readonly draft = this.desk.orderDraft;
  protected readonly view = computed(() => this.game.state().view);
  protected readonly units = computed(() => this.view()?.ownUnits ?? []);
  protected readonly addressee = computed(() => this.units().find((u) => u.id === this.draft().to));
  protected readonly arrows = computed(() => arrowMarks(this.game.state().marks));
  protected readonly over = computed(() => this.game.state().gameOver !== undefined);
  /** Turn mode (D39): orders are held for the turn and the side sends them together. */
  protected readonly turnMode = computed(() => this.game.state().turnMode === true);
  /** A game just joined whose mode is not yet known: the order can be written but not signed or held (#427). */
  protected readonly modePending = computed(
    () => !this.turnMode() && this.game.state().modePending === true,
  );
  /** In turn mode the order box only takes orders while the side is still writing its turn. */
  protected readonly closed = computed(
    () =>
      this.over() ||
      this.barred() ||
      (this.turnMode() && turnPhase(this.game.state()) !== 'writing'),
  );
  /** The intelligence officer may not hold a turn's orders, so the box has no Hold for them (#428). */
  protected readonly barred = computed(
    () => this.turnMode() && turnRights(this.game.state().view?.role) === 'none',
  );
  protected readonly editing = this.desk.editingTurnOrder;
  /**
   * Word from the staff about the last order it could not carry out, such as a clarification or a refusal.
   * Only the latest is shown, so the hint it carries appears once; a clarification offers its options.
   */
  protected readonly notice = computed(() => {
    const s = this.game.state();
    const n = s.notices.at(-1);
    if (!n || n === this.dismissed()) return undefined;
    const id = orderIdOf(n.message);
    const o = id === undefined ? undefined : s.outcomes[id];
    const split = o?.code === 'order_clarification' ? splitOptions(o.reason) : undefined;
    return {
      text: noticeText(n, s.outcomes),
      question: split?.question ?? '',
      words: o?.text ?? '',
      options: split?.options ?? [],
    };
  });
  /** The staff estimate for each courier to the chosen addressee, or undefined when it cannot be made. */
  protected readonly estimates = computed(() => {
    const to = this.addressee();
    const hq = this.view()?.hq;
    const est = (c: Courier): string =>
      to && hq ? formatEstimate(estimateRideMs(hq, to.position, c)) : NO_ESTIMATE;
    return { fast: est('fast'), safe: est('safe') } as Record<Courier, string>;
  });

  /** Which control the message belongs to, so it sits beside it and is tied to it for assistive technology. */
  protected readonly error = signal<{ field: Field; message: string } | undefined>(undefined);
  protected readonly stamping = signal(false);
  /** Word that the last order went, with its courier and expected arrival; it stays until the next action. */
  protected readonly confirmation = signal('');

  /** The notice that was showing when the player signed again, so an old refusal does not sit beside a new order. */
  private readonly dismissed = signal<unknown>(undefined);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  /** The last order signed: its words and annex, to put back if the staff refuse it. */
  private lastSent: { words: string; annex: string[] } | undefined;
  /**
   * Turn mode: the last order held, to put back if the server refuses it. Held orders are not pending, so a refusal
   * is known only by the order id that prefixes the notice; `after` is the notice that was last before it went.
   */
  private lastHeld:
    | {
        orderId: string;
        text: string;
        draft: OrderDraft;
        replaced: boolean;
        turn?: number;
        after: unknown;
      }
    | undefined;
  private readonly seenOutcomes = new Set<string>();

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.stampTimer));
    // A refused order was not sent after all: take back the stamp, and give the player their words back.
    effect(() => {
      const outcomes = this.game.state().outcomes;
      untracked(() => {
        for (const [id, o] of Object.entries(outcomes)) {
          if (this.seenOutcomes.has(id)) continue;
          this.seenOutcomes.add(id);
          this.refuse(o.text);
        }
      });
    });
    // A hold the server refused (too many orders, too many commands, the turn closing) did not go: give it back.
    effect(() => {
      const { notices, turn } = this.game.state();
      untracked(() => {
        const held = this.lastHeld;
        if (!held) return;
        // Once the turn lists it as written, it went.
        if (turn?.held.some((o) => o.orderId === held.orderId && o.text === held.text)) {
          this.lastHeld = undefined;
          return;
        }
        const from = notices.indexOf(held.after as never) + 1;
        if (!notices.slice(from).some((n) => orderIdOf(n.message) === held.orderId)) return;
        this.lastHeld = undefined;
        this.unhold(held);
      });
    });
    // Bring the staff's word into view; the panel scrolls and it would sit below the fold.
    effect(() => {
      if (!this.notice()) return;
      afterNextRender(
        () =>
          this.host.nativeElement.querySelector('.notices')?.scrollIntoView?.({ block: 'nearest' }),
        { injector: this.injector },
      );
    });
  }

  private refuse(words: string): void {
    clearTimeout(this.stampTimer);
    this.stamping.set(false);
    this.confirmation.set('');
    const sent = this.lastSent;
    if (!sent || sent.words !== words.trim()) return;
    this.lastSent = undefined;
    // Never over words the player has already begun again.
    if (this.draft().text.trim() === '') this.patch({ text: sent.words, annex: sent.annex });
  }

  private unhold(held: NonNullable<OrdersDeskComponent['lastHeld']>): void {
    this.confirmation.set('');
    // Never over words the player has already begun again.
    if (this.draft().text.trim() !== '') return;
    this.desk.orderDraft.set(held.draft);
    // A change to a held order that is still held this turn is still a change to it.
    const s = this.game.state();
    const still =
      s.turn?.turn === held.turn &&
      turnPhase(s) === 'writing' &&
      !!s.turn?.held.some((o) => o.orderId === held.orderId);
    if (held.replaced && still) this.desk.editingTurnOrder.set(held.orderId);
  }

  /** Resend the refused order with the chosen option filled in. */
  protected choose(option: string): void {
    const n = this.notice();
    if (!n || n.words === '') return;
    const resolved = orderWithOption(n.words, n.question, option);
    const typed = this.draft().text.trim();
    this.patch({ text: resolved });
    // Words the player has started on since are theirs: leave the resolved order in the draft to sign.
    if (typed === '' || typed === n.words.trim()) this.sign();
  }

  protected errorFor(field: Field): string {
    const e = this.error();
    return e?.field === field ? e.message : '';
  }

  protected patch(p: Partial<OrderDraft>): void {
    if ('to' in p || 'text' in p || 'courier' in p) this.confirmation.set('');
    // Editing the control an error names settles it.
    const e = this.error();
    if (e && (('to' in p && e.field === 'to') || ('text' in p && e.field === 'text')))
      this.error.set(undefined);
    this.desk.orderDraft.update((d) => ({ ...d, ...p }));
  }

  protected toggleArrow(id: string, on: boolean): void {
    this.desk.orderDraft.update((d) => ({
      ...d,
      annex: on ? [...new Set([...d.annex, id])] : d.annex.filter((x) => x !== id),
    }));
  }

  protected onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) this.sign();
  }

  /** Put a held order back in the order box; holding it again replaces it (same id). */
  protected editTurn(o: TurnOrder): void {
    this.error.set(undefined);
    this.desk.editingTurnOrder.set(o.orderId);
    this.patch({ to: o.to, text: o.text, courier: o.courier ?? 'safe', annex: [] });
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>('#desk-order-text')?.focus(),
      { injector: this.injector },
    );
  }

  protected cancelEdit(): void {
    this.desk.editingTurnOrder.set(undefined);
    this.patch({ text: '', annex: [] });
  }

  /** Turn mode: hold the order for the turn. The server's `turnState` lists it once held. */
  private hold(): void {
    const d = this.draft();
    const state = this.game.state();
    const addressee = this.addressee();
    if (this.closed()) return;
    if (!addressee) {
      this.error.set({ field: 'to', message: 'Address the order to one of your commanders.' });
      return;
    }
    if (d.text.trim() === '') {
      this.error.set({ field: 'text', message: 'Write the order first.' });
      return;
    }
    // The addressee travels as `to`, so the words are not prefixed with the unit's name.
    const text = withAnnex(d.text.trim(), state.marks, d.annex);
    if (text.length > MAX_ORDER_CHARS) {
      this.error.set({
        field: 'text',
        message: `With the annex the order runs to ${text.length} characters; the most a courier can carry is ${MAX_ORDER_CHARS}. Shorten it or drop an arrow.`,
      });
      return;
    }
    const orderId = this.editing() ?? this.turnActions.newId();
    const ok = this.turnActions.hold({ orderId, to: addressee.id, text, courier: d.courier });
    if (!ok) {
      this.error.set({ field: 'send', message: 'Not connected. Try again when the link is back.' });
      return;
    }
    this.dismissed.set(state.notices.at(-1));
    const replaced = this.editing() !== undefined;
    this.lastHeld = {
      orderId,
      text,
      draft: d,
      replaced,
      ...(state.turn ? { turn: state.turn.turn } : {}),
      after: state.notices.at(-1),
    };
    this.desk.editingTurnOrder.set(undefined);
    this.patch({ text: '', annex: [] });
    this.confirmation.set(
      `${replaced ? 'Changed order held' : 'Held'} for this turn: to ${addressee.name}. Send the turn's orders when they are all written.`,
    );
  }

  protected sign(): void {
    // The words wait in the box until the desk knows whether to send or hold them (#427).
    if (this.modePending()) return;
    if (this.turnMode()) {
      this.error.set(undefined);
      this.confirmation.set('');
      this.hold();
      return;
    }
    const d = this.draft();
    const state = this.game.state();
    const view = state.view;
    const addressee = this.addressee();
    this.error.set(undefined);
    this.confirmation.set('');
    if (this.over()) return;
    if (!addressee) {
      this.error.set({ field: 'to', message: 'Address the order to one of your commanders.' });
      return;
    }
    if (d.text.trim() === '') {
      this.error.set({ field: 'text', message: 'Write the order first.' });
      return;
    }
    // `withAnnex` leaves out annex arrows that are no longer on the table.
    const text = withAnnex(buildOrderText(view, addressee.id, d.text.trim()), state.marks, d.annex);
    if (text.length > MAX_ORDER_CHARS) {
      this.error.set({
        field: 'text',
        message: `With the annex the order runs to ${text.length} characters; the most a courier can carry is ${MAX_ORDER_CHARS}. Shorten it or drop an arrow.`,
      });
      return;
    }
    const ride = view?.hq ? estimateRideMs(view.hq, addressee.position, d.courier) : undefined;
    const sentAt = state.clock ? gameNowMs(state.clock, Date.now()) : (view?.atGame ?? 0);
    const err = this.sender.send({
      text,
      words: d.text.trim(),
      toName: addressee.name,
      courier: d.courier,
      eta: ride === undefined ? undefined : sentAt + ride,
    });
    if (err) {
      this.error.set({ field: 'send', message: err });
      return;
    }
    this.dismissed.set(state.notices.at(-1));
    this.lastSent = { words: d.text.trim(), annex: d.annex };
    this.stamping.set(true);
    clearTimeout(this.stampTimer);
    this.stampTimer = setTimeout(() => this.stamping.set(false), 1400);
    // The addressee and courier stay for the next order; the words and annex are cleared.
    this.patch({ text: '', annex: [] });
    this.confirmation.set(
      sentLine(addressee.name, d.courier, ride === undefined ? undefined : sentAt + ride),
    );
  }

  protected readonly annexLine = annexLine;
  protected readonly noEstimate = NO_ESTIMATE;
}

const NO_ESTIMATE = 'choose a commander for an estimate';
