import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type { GameInfo } from '@legacy/lobby/api';
import { SESSION_LABELS, inviteLink, rateLabel, startBlocker } from '@legacy/lobby/model';
import { SHELL_API, SHELL_WINDOW } from '../shell/shell-api';
import { PageFrameComponent } from '../ui/page-frame.component';

/**
 * The room of a game that has not started: who sits where, who is ready, the invite link, and the start button for
 * the creator. Polls the game and emits `started` once it has begun.
 */
/** Consecutive failed polls before the room says it has lost the connection. */
const MISSES_BEFORE_WARNING = 3;

@Component({
  selector: 'ks-room',
  imports: [PageFrameComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ks-page-frame
      [heading]="'Lobby: ' + labels[info().sessionType] + ', ' + rate()"
      [back]="true"
      (backClick)="leave()"
    >
      <ul id="room-sides" class="ks-stack">
        @for (s of info().sides; track s.side) {
          <li class="ks-row">
            {{ s.side }}: {{ s.taken ? (s.ready ? 'ready' : 'seated') : 'open' }}
            {{ info().you === s.side ? '(you)' : '' }}
            @if (!s.taken && !info().you && !hot()) {
              <button type="button" (click)="take(s.side)">Take {{ s.side }}</button>
            }
          </li>
        }
      </ul>
      @if (!hot()) {
        <p>
          <label class="ks-field"
            >Invite link:
            <input id="invite" readonly size="40" [value]="invite()" />
          </label>
        </p>
      }
      @if (info().you && !info().creator) {
        <button id="room-ready" type="button" (click)="ready()">
          {{ info().ready ? 'Not ready' : 'Ready' }}
        </button>
      }
      @if (info().creator) {
        <button
          id="room-start"
          type="button"
          class="ks-primary"
          [disabled]="blocker() !== undefined"
          (click)="start()"
        >
          Start game
        </button>
      }
      <p id="lobby-msg" role="status" [class.ks-status]="message() !== ''">{{ message() }}</p>
    </ks-page-frame>
  `,
})
export class RoomComponent implements OnInit {
  /** The game as last read; the room keeps it fresh by polling. */
  readonly first = input.required<GameInfo>();
  readonly started = output();
  readonly left = output();
  private readonly api = inject(SHELL_API);
  private readonly win = inject(SHELL_WINDOW);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly labels = SESSION_LABELS;
  protected readonly info = signal<GameInfo>(undefined as unknown as GameInfo);
  protected readonly error = signal<string | undefined>(undefined);
  protected readonly hot = () => this.info().sessionType === 'hot_seat';
  protected readonly rate = () => rateLabel(this.info().rate);
  protected readonly invite = () => inviteLink(this.win.location.origin, this.info().id);
  protected readonly blocker = () => startBlocker(this.info());
  /** The status line: an error, else what stops the host starting, else the guest's wait. Empty shows no bar. */
  protected readonly message = (): string =>
    this.error() ??
    (this.info().creator ? (this.blocker() ?? '') : 'Waiting for the host to start.');

  private misses = 0;

  ngOnInit(): void {
    this.info.set(this.first());
    const timer = setInterval(() => this.poll(), 2000);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  /** Re-reads the game. Exposed to specs so they need no timers. */
  poll(): Promise<void> {
    return this.api
      .fetchGame(this.info().id)
      .then((g) => {
        this.misses = 0;
        if (this.lost()) this.error.set(undefined);
        if (g.status === 'started') this.started.emit();
        else if (JSON.stringify(g) !== JSON.stringify(this.info())) this.info.set(g);
      })
      .catch(() => {
        // One failed poll is noise; a run of them means the room is stale.
        if (++this.misses === MISSES_BEFORE_WARNING) {
          this.error.set('Connection lost, retrying…');
        }
      });
  }

  private lost(): boolean {
    return this.error() === 'Connection lost, retrying…';
  }

  private act(p: Promise<void>): void {
    this.error.set(undefined);
    p.then(
      () => this.poll(),
      (e: unknown) => this.error.set(e instanceof Error ? e.message : String(e)),
    );
  }

  protected leave(): void {
    this.left.emit();
  }

  protected take(side: string): void {
    this.act(this.api.joinSide(this.info().id, side));
  }
  protected ready(): void {
    this.act(this.api.setReady(this.info().id, !this.info().ready));
  }
  protected start(): void {
    this.act(this.api.startGame(this.info().id));
  }
}
