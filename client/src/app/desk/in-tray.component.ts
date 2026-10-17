import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { Dispatch } from '@kriegsspiel/protocol';
import { formatGameTime } from '@legacy/net/state';
import { byTurn, sortTray, type Pile, type TrayRow } from '@legacy/desk/tray';
import { timeOfDay, turnLine } from '@legacy/desk/turn';
import { isSummary } from '@legacy/desk/turnReport';
import { GameService } from '../game/game.service';
import { DeskStore } from './desk.store';

/** Every pile at once: the turn desk's first pile, its papers under their turns (#439). */
type PileChoice = Pile | 'all';

/** The in-tray (port of `desk/InTray.svelte`). Sorting and marks stay in the pure `desk/tray.ts`. */
@Component({
  selector: 'ks-in-tray',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './in-tray.component.html',
  styleUrl: './in-tray.component.css',
})
export class InTrayComponent {
  private readonly game = inject(GameService);
  private readonly desk = inject(DeskStore);
  private readonly injector = inject(Injector);
  private readonly viewer = viewChild<ElementRef<HTMLElement>>('viewer');

  /** A turn-mode game (D39) reads its papers by turn, in the order they were written, with clock times (#439). */
  protected readonly turnMs = this.desk.turnMs;
  /** The pile on view: the first with something unread when the tray opens, else Urgent; in turn mode, All. */
  protected readonly pile = signal<PileChoice>('urgent');
  protected readonly openId = signal<string | undefined>(undefined);
  protected readonly showFiled = signal(false);
  /** The in-fiction notice while the staff are over their cap (the server sends no figures). */
  protected readonly overloaded = computed(() => this.game.state().view?.staffOverloaded);
  protected readonly read = computed(() => this.game.state().read);

  protected readonly sorted = computed(() => sortTray(this.desk.papers(), this.desk.trayMarks()));
  /** The All pile: every unfiled paper, and how many are unread. */
  protected readonly all = computed(() => {
    const piles = this.sorted().piles;
    return {
      items: piles.flatMap((p) => p.items),
      unread: piles.reduce((n, p) => n + p.unread, 0),
    };
  });
  protected readonly current = computed(() => {
    const id = this.pile();
    if (id === 'all') return { id, label: 'All', ...this.all() };
    return this.sorted().piles.find((p) => p.id === id)!;
  });
  protected readonly list = computed(() =>
    this.showFiled() ? this.sorted().filed : this.current().items,
  );
  /** Turn mode: the list under turn headings, each with its rows (merged sightings are one row). */
  protected readonly groups = computed(() => {
    const ms = this.turnMs();
    if (!ms) return undefined;
    const over = this.game.state().gameOver?.atGame;
    return byTurn(this.list(), ms).map((g) => {
      const startsAt = (g.turn - 1) * ms;
      const endsAt = over !== undefined && over < g.turn * ms ? over : g.turn * ms;
      return { ...g, heading: turnLine({ turn: g.turn, startsAt, endsAt }) };
    });
  });
  /** The rows on view: one per paper in real time, merged sightings as one in turn mode. */
  private readonly rows = computed<TrayRow[]>(
    () => this.groups()?.flatMap((g) => g.rows) ?? this.list().map((d) => ({ d, papers: [d] })),
  );
  private readonly openRow = computed(() => {
    const id = this.openId();
    return id === undefined
      ? undefined
      : this.rows().find((r) => r.papers.some((d) => d.id === id));
  });
  protected readonly open = computed(() => this.openRow()?.d);
  /** The other papers of a merged sighting the viewer shows, oldest first. */
  protected readonly alsoSeen = computed(() => {
    const r = this.openRow();
    return r ? r.papers.filter((d) => d !== r.d) : [];
  });
  protected readonly listLabel = computed(() =>
    this.showFiled() ? 'Filed dispatches' : `${this.current().label} dispatches`,
  );

  protected readonly formatGameTime = formatGameTime;
  protected readonly timeOfDay = timeOfDay;
  protected readonly isSummary = isSummary;

  constructor() {
    if (this.turnMs()) this.pile.set('all');
    else {
      const unread = this.sorted().piles.find((p) => p.unread > 0);
      if (unread) this.pile.set(unread.id);
    }
    effect(() => {
      const open = this.open();
      untracked(() => this.desk.viewedDispatch.set(open));
    });
  }

  /** A row is unread while any of its papers is. */
  protected unread(r: TrayRow): boolean {
    const read = this.read();
    return r.papers.some((d) => !read.has(d.id));
  }

  /** What a row says beside its sender in turn mode: a merged sighting counts its papers. */
  protected rowNote(r: TrayRow): string {
    if (isSummary(r.d)) return 'Summary of the turn';
    const at = timeOfDay(r.papers[0]!.writtenAtGame);
    if (r.papers.length === 1) return `written ${at}`;
    return `seen ${r.papers.length} times, ${at} to ${timeOfDay(r.d.writtenAtGame)}`;
  }

  protected pick(id: PileChoice): void {
    this.pile.set(id);
    this.showFiled.set(false);
    this.openId.set(undefined);
  }

  protected pickFiled(): void {
    this.showFiled.set(true);
    this.openId.set(undefined);
  }

  protected openDispatch(id: string): void {
    this.openId.set(id);
    this.markRow(id);
  }

  protected onFile(id: string, on: boolean): void {
    const ids = this.rowIds(id);
    this.after(id);
    for (const x of ids) this.desk.setFiled(x, on);
  }

  protected onDiscard(id: string): void {
    const ids = this.rowIds(id);
    this.after(id);
    for (const x of ids) this.desk.discard(x);
  }

  protected locate(): void {
    const at = this.open()?.location;
    if (!at) return;
    this.desk.showOnTable.set(at);
    this.desk.activeView.set('table');
  }

  /** The papers that go together with `id`: all of a merged sighting, else the paper alone. */
  private rowIds(id: string): string[] {
    return (this.rows().find((r) => r.papers.some((d) => d.id === id))?.papers ?? [{ id }]).map(
      (d: Pick<Dispatch, 'id'>) => d.id,
    );
  }

  /** Opening a row reads every paper in it. */
  private markRow(id: string): void {
    for (const x of this.rowIds(id)) this.game.markRead(x);
  }

  /** Move the viewer on to the next paper in the pile once this one is gone. */
  private after(id: string): void {
    const rows = this.rows();
    const i = rows.findIndex((r) => r.papers.some((d) => d.id === id));
    const next = rows[i + 1]?.d.id ?? rows[i - 1]?.d.id;
    this.openId.set(next);
    // A paper the viewer shows counts as read, however it came to be open.
    if (next) this.markRow(next);
    // The button that was clicked is about to go; keep keyboard focus on the desk.
    afterNextRender(() => this.viewer()?.nativeElement.focus(), { injector: this.injector });
  }
}
