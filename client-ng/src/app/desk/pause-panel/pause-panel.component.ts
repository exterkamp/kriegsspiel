import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { pageTitle, pausePanel } from '@legacy/desk/pause';
import { GameService } from '../../game/game.service';
import { PAUSE_ACTIONS } from '../../game/ports';

/** Propose a pause or resume and vote on one (port of `desk/PausePanel.svelte`). The countdown runs on a timer signal. */
@Component({
  selector: 'ks-pause-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pause-panel.component.html',
  styleUrl: './pause-panel.component.css',
})
export class PausePanelComponent {
  private readonly game = inject(GameService);
  private readonly actions = inject(PAUSE_ACTIONS);

  private readonly now = signal(Date.now());
  protected readonly view = computed(() => pausePanel(this.game.state(), this.now()));
  protected readonly asking = signal(false);
  protected readonly reason = signal('');
  protected readonly problem = signal('');

  constructor() {
    const t = setInterval(() => this.now.set(Date.now()), 250);
    const baseTitle = typeof document === 'undefined' ? '' : document.title.replace(/^\(vote\) /, '');
    // Mark the page title while a vote waits for this player; restore it when the panel goes away.
    effect(() => {
      document.title = pageTitle(baseTitle, this.game.state());
    });
    inject(DestroyRef).onDestroy(() => {
      clearInterval(t);
      document.title = baseTitle;
    });
  }

  private sent(ok: boolean): boolean {
    this.problem.set(ok ? '' : 'Not connected. Try again when the link is back.');
    return ok;
  }

  protected propose(action: 'pause' | 'resume'): void {
    const ok =
      action === 'pause'
        ? this.actions.proposePause(this.reason().trim() || undefined)
        : this.actions.proposeResume();
    if (this.sent(ok)) {
      this.asking.set(false);
      this.reason.set('');
    }
  }

  protected submitPause(e: Event): void {
    e.preventDefault();
    this.propose('pause');
  }

  protected cast(id: string, yes: boolean): void {
    this.sent(this.actions.vote(id, yes));
  }
}
