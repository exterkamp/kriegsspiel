import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { fetchGame } from '@legacy/lobby/api';
import { fetchWindowAt } from '@legacy/window/api';
import { GameService } from '../../game/game.service';
import { DeskStore } from '../desk.store';
import {
  HEADLINE,
  lossesBetween,
  reasonText,
  replayRequest,
  resultFor,
  summaryLines,
} from './game-over';

/** The game over screen (behaviour of held PR #266): result, summary and the ways out. Shown over the table. */
@Component({
  selector: 'ks-game-over',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './game-over.component.html',
  styleUrl: './game-over.component.css',
})
export class GameOverComponent {
  private readonly game = inject(GameService);
  protected readonly desk = inject(DeskStore);
  readonly menu = output<void>();
  readonly newGame = output<void>();
  readonly playAgainAs = output<{ id: string; side: string | undefined }>();

  private readonly over = computed(() => this.game.state().gameOver);
  private readonly side = computed(() => this.game.state().view?.side);
  protected readonly result = computed(() => resultFor(this.over() ?? { winner: null }, this.side()));
  protected readonly headline = computed(() => HEADLINE[this.result()]);
  protected readonly reason = computed(() => {
    const o = this.over();
    return o ? reasonText(o) : '';
  });
  protected readonly losses = signal<{ own: number; enemy: number } | undefined>(undefined);
  protected readonly lines = computed(() => {
    const o = this.over();
    return o ? summaryLines(o, this.losses()) : [];
  });
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  private readonly first = viewChild<ElementRef<HTMLButtonElement>>('first');

  constructor() {
    let destroyed = false;
    inject(DestroyRef).onDestroy(() => (destroyed = true));
    // The reveal is the true first and last frames; if it cannot be read, the losses lines are left out.
    effect(() => {
      const game = this.game.gameId();
      const s = this.side();
      const end = this.over()?.atGame;
      if (!game || !s || end === undefined) return;
      Promise.all([fetchWindowAt(game, 0, s), fetchWindowAt(game, end, s)])
        .then(([a, b]) => {
          if (!destroyed) this.losses.set(lossesBetween(a, b, s));
        })
        .catch(() => {});
    });
    afterNextRender(() => this.first()?.nativeElement.focus());
  }

  protected async playAgain(): Promise<void> {
    const game = this.game.gameId();
    if (!game || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const info = await fetchGame(game);
      const side = this.side() ?? info.side ?? undefined;
      const res = await fetch('/games', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(replayRequest(info, side)),
      });
      if (!res.ok) throw new Error(`could not create a game (${res.status})`);
      this.playAgainAs.emit({ id: ((await res.json()) as { id: string }).id, side });
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
      this.busy.set(false);
    }
  }
}
