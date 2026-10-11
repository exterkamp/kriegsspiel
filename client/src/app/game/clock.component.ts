import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { clockSummary, clockView } from '@legacy/desk/clock';
import { GameService } from './game.service';

const LINK_TEXT = {
  offline: 'no server (fixture)',
  connecting: 'connecting…',
  open: '',
  closed: 'reconnecting…',
} as const;

/** The desk clock (port of `desk/DeskClock.svelte`). Display logic stays in the pure `desk/clock.ts`. */
@Component({
  selector: 'ks-clock',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './clock.component.html',
  styleUrl: './clock.component.css',
})
export class ClockComponent implements OnDestroy {
  private readonly game = inject(GameService);
  private readonly now = signal(Date.now());
  private readonly timer = setInterval(() => this.now.set(Date.now()), 250);

  protected readonly v = computed(() => clockView(this.game.state(), this.now()));
  protected readonly summary = computed(() => clockSummary(this.v()));
  protected readonly linkText = computed(() => LINK_TEXT[this.game.state().link]);

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }
}
