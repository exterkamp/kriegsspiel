import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import type { WindowTimeline } from '@kriegsspiel/protocol';
import { fetchWindowAt, fetchWindowTimeline } from '@legacy/window/api';
import { stepMark, unitNotes, type BeliefChoice } from '@legacy/window/model';
import { formatGameTime } from '@legacy/net/state';
import { GameService } from '../game/game.service';
import { DeskStore } from './desk.store';

const BELIEFS: { id: BeliefChoice; label: string }[] = [
  { id: 'none', label: 'Truth only' },
  { id: 'blue', label: 'Blue believed' },
  { id: 'red', label: 'Red believed' },
];

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The umpire's window (port of `desk/UmpireWindow.svelte`): the post-game scrubber that drives `windowFrame`. */
@Component({
  selector: 'ks-umpire-window',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './umpire-window.component.html',
  styleUrl: './umpire-window.component.css',
})
export class UmpireWindowComponent {
  private readonly game = inject(GameService);
  protected readonly desk = inject(DeskStore);
  /** Only the newest request may set the frame; an older one that lands late is dropped. */
  private ticket = 0;

  protected readonly timeline = signal<WindowTimeline | undefined>(undefined);
  protected readonly at = signal(0);
  protected readonly error = signal('');
  protected readonly beliefs = BELIEFS;
  protected readonly Math = Math;
  protected readonly formatGameTime = formatGameTime;

  protected readonly notes = computed(() => {
    const frame = this.desk.windowFrame();
    const hover = this.desk.windowHover();
    return frame && hover ? unitNotes(frame, hover) : [];
  });
  protected readonly hovered = computed(() =>
    this.desk.windowFrame()?.units.find((u) => u.id === this.desk.windowHover()),
  );
  protected readonly errorText = computed(() =>
    this.error() === 'game_not_over' ? 'Available once the game has ended.' : this.error(),
  );

  constructor() {
    const game = this.game.gameId();
    if (game)
      fetchWindowTimeline(game)
        .then((tl) => {
          this.timeline.set(tl);
          return this.load(tl.endMs);
        })
        .catch((e: unknown) => this.error.set(messageOf(e)));
    inject(DestroyRef).onDestroy(() => {
      this.ticket++;
      this.desk.windowFrame.set(undefined);
      this.desk.windowHover.set(undefined);
    });
  }

  protected async load(ms: number): Promise<void> {
    const game = this.game.gameId();
    if (!game) return;
    const mine = ++this.ticket;
    try {
      const frame = await fetchWindowAt(game, ms);
      if (mine !== this.ticket) return;
      this.at.set(frame.gameMs);
      this.error.set('');
      this.desk.windowFrame.set(frame);
    } catch (e) {
      if (mine === this.ticket) this.error.set(messageOf(e));
    }
  }

  protected step(dir: 1 | -1): void {
    const tl = this.timeline();
    if (!tl) return;
    const i = stepMark(tl.marks, this.at(), dir);
    void this.load(i >= 0 ? tl.marks[i]!.ms : dir > 0 ? tl.endMs : 0);
  }
}
