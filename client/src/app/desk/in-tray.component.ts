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
import { formatGameTime } from '@legacy/net/state';
import { sortTray, type Pile } from '@legacy/desk/tray';
import { GameService } from '../game/game.service';
import { DeskStore } from './desk.store';

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

  /** The pile on view: the first with something unread when the tray opens, else Urgent. */
  protected readonly pile = signal<Pile>('urgent');
  protected readonly openId = signal<string | undefined>(undefined);
  protected readonly showFiled = signal(false);
  protected readonly read = computed(() => this.game.state().read);

  protected readonly sorted = computed(() =>
    sortTray(this.game.state().dispatches, this.desk.trayMarks()),
  );
  protected readonly current = computed(() =>
    this.sorted().piles.find((p) => p.id === this.pile())!,
  );
  protected readonly list = computed(() =>
    this.showFiled() ? this.sorted().filed : this.current().items,
  );
  protected readonly open = computed(() => this.list().find((d) => d.id === this.openId()));
  protected readonly listLabel = computed(() =>
    this.showFiled() ? 'Filed dispatches' : `${this.current().label} dispatches`,
  );

  protected readonly formatGameTime = formatGameTime;

  constructor() {
    const unread = this.sorted().piles.find((p) => p.unread > 0);
    if (unread) this.pile.set(unread.id);
    effect(() => {
      const open = this.open();
      untracked(() => this.desk.viewedDispatch.set(open));
    });
  }

  protected pick(id: Pile): void {
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
    this.game.markRead(id);
  }

  protected onFile(id: string, on: boolean): void {
    this.after(id);
    this.desk.setFiled(id, on);
  }

  protected onDiscard(id: string): void {
    this.after(id);
    this.desk.discard(id);
  }

  protected locate(): void {
    const at = this.open()?.location;
    if (!at) return;
    this.desk.showOnTable.set(at);
    this.desk.activeView.set('table');
  }

  /** Move the viewer on to the next paper in the pile once this one is gone. */
  private after(id: string): void {
    const list = this.list();
    const i = list.findIndex((d) => d.id === id);
    const next = list[i + 1]?.id ?? list[i - 1]?.id;
    this.openId.set(next);
    // A paper the viewer shows counts as read, however it came to be open.
    if (next) this.game.markRead(next);
    // The button that was clicked is about to go; keep keyboard focus on the desk.
    afterNextRender(() => this.viewer()?.nativeElement.focus(), { injector: this.injector });
  }
}
