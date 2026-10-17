import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  OnInit,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { decodeApprovedBattlefield } from '@kriegsspiel/protocol';
import { BattlefieldPreviewComponent } from './battlefield-map/battlefield-preview.component';
import type { GameInfo, KickTarget } from '@legacy/lobby/api';
import { SESSION_LABELS, inviteLink, paceLabel, startBlocker } from '@legacy/lobby/model';
import { SHELL_API, SHELL_WINDOW } from '../shell/shell-api';
import { ModalComponent } from '../ui/modal.component';
import { PageFrameComponent } from '../ui/page-frame.component';

/**
 * The room of a game that has not started: who sits where, who is ready, the invite link, and the start button for
 * the creator. Polls the game and emits `started` once it has begun.
 */
/** Consecutive failed polls before the room says it has lost the connection. */
const MISSES_BEFORE_WARNING = 3;

@Component({
  selector: 'ks-room',
  imports: [PageFrameComponent, ModalComponent, BattlefieldPreviewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ks-page-frame
      [heading]="'Lobby: ' + labels[info().sessionType] + ', ' + rate()"
      [back]="true"
      (backClick)="leave()"
    >
      <section class="ks-panel ks-stack" aria-label="Battlefield map">
        <h2>Battlefield map</h2>
        @if (battlefield(); as selected) {
          <p>
            <strong>{{ selected.map.name }}</strong> · {{ selected.map.widthM / 1000 }} ×
            {{ selected.map.heightM / 1000 }} km
          </p>
          <p>
            The scenario and this battlefield are fixed for this game. Its scenario supplies the
            armies and objectives.
          </p>
          <details>
            <summary>View map</summary>
            <ks-battlefield-preview [map]="selected.map" [interactive]="true" />
          </details>
        } @else if (mapProblem()) {
          <p role="alert" class="ks-error">
            The battlefield details could not be checked. Reload them before starting.
          </p>
          <button type="button" (click)="poll()">Retry map details</button>
        } @else {
          <p>Battlefield details are not available on this server.</p>
        }
      </section>
      <ul id="room-sides" class="ks-stack">
        @for (s of info().sides; track s.side) {
          <li class="ks-row">
            {{ s.side }}: {{ s.taken ? (s.ready ? 'ready' : 'seated') : 'open' }}
            {{ info().you === s.side ? '(you)' : '' }}
            @if (!s.taken && !info().you && !hot() && !info().removed) {
              <button type="button" (click)="take(s.side)">Take {{ s.side }}</button>
            }
            @if (info().creator && s.taken && info().you !== s.side && !hot()) {
              <button type="button" class="ks-danger" (click)="ask({ side: s.side })">
                Remove {{ s.side }} player
              </button>
            }
            @for (r of s.roles ?? []; track $index) {
              <span class="role">
                {{ r.role }}{{ r.you ? ' (you)' : '' }}
                @if (info().creator) {
                  <button
                    type="button"
                    class="ks-danger"
                    (click)="ask({ side: s.side, role: r.role, unit: r.units?.[0] })"
                  >
                    Remove {{ r.role }}
                  </button>
                }
              </span>
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
      @if (info().you && !info().creator && !hot()) {
        <button id="room-leave" type="button" (click)="leaveSeat()">Leave seat</button>
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
      @if (pending(); as who) {
        <ks-modal heading="Remove player?" labelId="room-kick-h">
          <p>
            Remove the {{ who.role ?? 'commander' }} on {{ who.side }} from this game? They are told
            and cannot rejoin.
          </p>
          <button type="button" class="ks-danger" (click)="confirmKick(who)">Remove player</button>
          <button type="button" (click)="pending.set(undefined)">Cancel</button>
        </ks-modal>
      }
    </ks-page-frame>
  `,
  styles: `
    summary {
      min-height: 44px;
      padding: var(--ks-space-2);
      cursor: pointer;
    }
    details {
      min-width: 0;
    }
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
  protected readonly rate = () => paceLabel(this.info());
  protected readonly invite = () => inviteLink(this.win.location.origin, this.info().id);
  protected readonly battlefield = computed(() => {
    const info = this.info();
    if (!info || !Object.hasOwn(info, 'battlefield')) return undefined;
    try {
      return decodeApprovedBattlefield(info.battlefield, info.scenario);
    } catch {
      return undefined;
    }
  });
  protected readonly mapProblem = computed(
    () => !!this.info() && Object.hasOwn(this.info(), 'battlefield') && !this.battlefield(),
  );
  protected readonly blocker = () =>
    this.mapProblem()
      ? 'Reload the battlefield details before starting.'
      : startBlocker(this.info());
  /** The status line: an error, else what stops the host starting, else the guest's wait. Empty shows no bar. */
  protected readonly message = (): string =>
    this.error() ??
    (this.info().removed
      ? 'The host removed you from this game.'
      : this.info().creator
        ? (this.blocker() ?? '')
        : 'Waiting for the host to start.');

  /** The player the host has asked to remove and not yet confirmed. */
  protected readonly pending = signal<KickTarget | undefined>(undefined);

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

  protected leaveSeat(): void {
    this.api.leaveGame(this.info().id).then(
      () => this.left.emit(),
      (e: unknown) => this.error.set(e instanceof Error ? e.message : String(e)),
    );
  }
  protected ask(who: KickTarget): void {
    this.pending.set(who);
  }
  protected confirmKick(who: KickTarget): void {
    this.pending.set(undefined);
    this.act(this.api.kickPlayer(this.info().id, who));
  }

  protected take(side: string): void {
    this.act(this.api.joinSide(this.info().id, side));
  }
  protected ready(): void {
    this.act(this.api.setReady(this.info().id, !this.info().ready));
  }
  protected start(): void {
    if (this.mapProblem()) return;
    this.act(this.api.startGame(this.info().id));
  }
}
