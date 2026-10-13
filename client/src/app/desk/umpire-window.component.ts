import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import type { Critique, CritiqueKind, WindowTimeline } from '@kriegsspiel/protocol';
import { fetchCritique, fetchWindowAt, fetchWindowTimeline } from '@legacy/window/api';
import { stepMark, unitNotes, type BeliefChoice } from '@legacy/window/model';
import { formatGameTime } from '@legacy/net/state';
import { GameService } from '../game/game.service';
import { DeskStore } from './desk.store';

const BELIEFS: { id: BeliefChoice; label: string }[] = [
  { id: 'none', label: 'Truth only' },
  { id: 'blue', label: 'Blue believed' },
  { id: 'red', label: 'Red believed' },
];

const KIND_LABELS: Record<CritiqueKind, string> = {
  knowledge: 'What was known',
  decision: 'Decision',
  misreading: 'Misreading',
  pause: 'Pause',
  outcome: 'Result',
};

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
  /** Set on destroy so a timeline that lands late cannot start a frame load nobody will clear. */
  private destroyed = false;

  protected readonly timeline = signal<WindowTimeline | undefined>(undefined);
  protected readonly at = signal(0);
  protected readonly error = signal('');
  /** The umpire's critique; it loads after the timeline and may take a while the first time. */
  protected readonly critique = signal<Critique | undefined>(undefined);
  protected readonly critiqueError = signal('');
  protected readonly kindLabels = KIND_LABELS;
  protected readonly beliefs = BELIEFS;
  protected readonly Math = Math;
  protected readonly formatGameTime = formatGameTime;

  protected readonly notes = computed(() => {
    const frame = this.desk.windowFrame();
    const hover = this.desk.windowHover();
    return frame && hover ? unitNotes(frame, hover) : [];
  });
  /** Every ruling made up to the game time shown, with its time and wording. */
  protected readonly rulings = computed(() => this.desk.windowFrame()?.rulings ?? []);
  /** The latest ruling shown: the one that decided the game, so the window can say when it was declared and when the game ended (#343). */
  protected readonly lastRuling = computed(() => this.rulings().at(-1));
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
          if (this.destroyed) return;
          this.timeline.set(tl);
          void this.loadCritique(game);
          return this.load(tl.endMs);
        })
        .catch((e: unknown) => this.error.set(messageOf(e)));
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.ticket++;
      this.desk.windowFrame.set(undefined);
      this.desk.windowHover.set(undefined);
    });
  }

  private async loadCritique(game: string): Promise<void> {
    try {
      const c = await fetchCritique(game);
      if (!this.destroyed) this.critique.set(c);
    } catch (e) {
      if (!this.destroyed) this.critiqueError.set(messageOf(e));
    }
  }

  protected async load(ms: number): Promise<void> {
    const game = this.game.gameId();
    if (!game || this.destroyed) return;
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
