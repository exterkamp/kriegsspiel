import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { formatGameTime, gameNowMs } from '@legacy/net/state';
import { deliveryStatus, orderProgress } from '@legacy/desk/orders';
import {
  JOURNAL_KINDS,
  TURN_KIND,
  chronological,
  exportText,
  filterEntries,
  type JournalKind,
} from '@legacy/desk/journal';
import { GameService } from '../../game/game.service';
import { DeskStore } from '../desk.store';

/** The war diary (port of `desk/Journal.svelte`): search, kind filters, notes and a plain-text export. */
@Component({
  selector: 'ks-journal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './journal.component.html',
  styleUrl: './journal.component.css',
})
export class JournalComponent {
  private readonly game = inject(GameService);
  protected readonly desk = inject(DeskStore);

  /** Turn headings are a filter of their own only in a turn-mode game (D39). */
  protected readonly kindList = computed(() =>
    this.game.state().turnMode ? [...JOURNAL_KINDS, TURN_KIND] : JOURNAL_KINDS,
  );
  protected readonly query = signal('');
  protected readonly kinds = signal<ReadonlySet<JournalKind>>(new Set());
  protected readonly note = signal('');
  protected readonly formatGameTime = formatGameTime;

  // Delivery status is read against game time, so the journal re-reads it now and then.
  private readonly wall = signal(Date.now());
  private readonly nowGame = computed(() => {
    const c = this.game.state().clock;
    return c ? gameNowMs(c, this.wall()) : 0;
  });

  /**
   * Entries to show, each order with where it stands: its delivery progress while riding, then what word came
   * back (delivered, acted on, lost), in place of "awaiting word" once it has (#439).
   */
  protected readonly shown = computed(() => {
    const { pending, dispatches } = this.game.state();
    const nowGame = this.nowGame();
    return chronological(
      filterEntries(this.desk.journal(), { query: this.query(), kinds: this.kinds() }),
    ).map((j) => {
      const p = j.kind === 'order' ? pending.find((o) => `order:${o.orderId}` === j.id) : undefined;
      if (!p) return { j, ride: undefined };
      const word = orderProgress(p, dispatches);
      if (word) return { j, ride: { progress: undefined, label: word.label } };
      const s = deliveryStatus(p, nowGame);
      return {
        j,
        ride: { progress: p.etaGame === undefined ? undefined : s.fraction, label: s.label },
      };
    });
  });

  constructor() {
    const t = setInterval(() => this.wall.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  protected toggle(k: JournalKind): void {
    this.kinds.update((s) => {
      const next = new Set(s);
      if (!next.delete(k)) next.add(k);
      return next;
    });
  }

  protected addNote(e: Event): void {
    e.preventDefault();
    this.desk.addNote(this.note());
    this.note.set('');
  }

  protected download(): void {
    const blob = new Blob([exportText(this.desk.journal())], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'war-diary.txt';
    a.click();
    URL.revokeObjectURL(url);
  }
}
