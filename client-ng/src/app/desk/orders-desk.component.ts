import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { gameNowMs } from '@legacy/net/state';
import { buildOrderText } from '@legacy/hud/hud';
import {
  COURIERS,
  ORDER_EXAMPLES,
  annexLine,
  arrowMarks,
  estimateRideMs,
  formatEstimate,
  noticeText,
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
  /** Word from the staff about orders it could not carry out, such as a clarification or a refusal. */
  protected readonly notices = computed(() => {
    const s = this.game.state();
    return s.notices.slice(-3).map((n) => noticeText(n, s.outcomes));
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

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.stampTimer));
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
    // Annex arrows made since the draft was saved may be gone; only the ones still on the table go.
    const arrows = this.arrows();
    const chosen = d.annex.filter((id) => arrows.some((a) => a.id === id));
    const text = withAnnex(buildOrderText(view, addressee.id, d.text.trim()), state.marks, chosen);
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
      toName: addressee.name,
      courier: d.courier,
      eta: ride === undefined ? undefined : sentAt + ride,
    });
    if (err) {
      this.error.set({ field: 'send', message: err });
      return;
    }
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
