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
  orderWithOption,
  splitOptions,
  withAnnex,
  type Courier,
  type OrderDraft,
} from '@legacy/desk/orders';
import { GameService } from '../game/game.service';
import { ORDER_SENDER } from '../game/ports';
import { DeskStore } from './desk.store';

/** The longest order text the server accepts, once the addressee and annex are added. */
const MAX_ORDER_CHARS = 2000;

type Field = 'to' | 'text' | 'send';

/** The orders desk (port of `desk/OrdersDesk.svelte`): addressee, wording, annex, courier and signing. */
@Component({
  selector: 'ks-orders-desk',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './orders-desk.component.html',
  styleUrl: './orders-desk.component.css',
})
export class OrdersDeskComponent {
  private readonly game = inject(GameService);
  private readonly desk = inject(DeskStore);
  private readonly sender = inject(ORDER_SENDER);
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

  /** The notice that was showing when the player signed again, so an old refusal does not sit beside a new order. */
  private readonly dismissed = signal<unknown>(undefined);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  /** The last order signed: its words and annex, to put back if the staff refuse it. */
  private lastSent: { words: string; annex: string[] } | undefined;
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
    const sent = this.lastSent;
    if (!sent || sent.words !== words.trim()) return;
    this.lastSent = undefined;
    // Never over words the player has already begun again.
    if (this.draft().text.trim() === '') this.patch({ text: sent.words, annex: sent.annex });
  }

  /** Resend the refused order with the chosen option filled in. */
  protected choose(option: string): void {
    const n = this.notice();
    if (!n || n.words === '') return;
    this.patch({ text: orderWithOption(n.words, n.question, option) });
    this.sign();
  }

  protected errorFor(field: Field): string {
    const e = this.error();
    return e?.field === field ? e.message : '';
  }

  protected patch(p: Partial<OrderDraft>): void {
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

  protected sign(): void {
    const d = this.draft();
    const state = this.game.state();
    const view = state.view;
    const addressee = this.addressee();
    this.error.set(undefined);
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
  }

  protected readonly annexLine = annexLine;
  protected readonly noEstimate = NO_ESTIMATE;
}

const NO_ESTIMATE = 'choose a commander for an estimate';
