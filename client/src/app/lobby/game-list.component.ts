import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { debugGameUrl } from '@legacy/auth';
import type { GameSummary } from '@legacy/lobby/api';
import type { PlayedGame } from '@legacy/shell/continueList';
import { gameStatus } from '@legacy/shell/continueList';
import { SESSION_LABELS, rateLabel } from '@legacy/lobby/model';
import { SHELL_API } from '../shell/shell-api';

interface Row {
  id: string;
  title: string;
  state: string;
}

/** "Your games": every game the player holds a seat in or made, lobby and started. Each opens with `?game=<id>`. */
@Component({
  selector: 'ks-game-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2>Your games</h2>
    @if (error()) {
      <p role="alert" class="ks-status ks-error">{{ error() }}</p>
    } @else if (rows() === undefined) {
      <p role="status" class="ks-muted">Loading your games…</p>
    } @else {
      <ul id="game-list" class="ks-stack">
        @for (g of rows(); track g.id) {
          <li class="ks-row">
            <a [href]="'/?game=' + enc(g.id)">{{ g.title }}</a> — {{ g.state }}
            @if (admin()) {
              — <a class="debug" [href]="debugUrl(g.id)">Debug this game</a>
            }
          </li>
        } @empty {
          <li>No games yet.</li>
        }
      </ul>
    }
  `,
  styles: `
    :host {
      display: block;
      box-sizing: border-box;
    }
    h2 {
      margin: 0 0 var(--ks-space-2);
      border-bottom: 1px solid var(--ks-rule);
    }
  `,
})
export class GameListComponent implements OnInit {
  private readonly api = inject(SHELL_API);
  protected readonly rows = signal<Row[] | undefined>(undefined);
  protected readonly error = signal<string | undefined>(undefined);
  protected readonly enc = encodeURIComponent;
  protected readonly debugUrl = debugGameUrl;
  protected readonly admin = signal(false);

  ngOnInit(): void {
    this.api.adminMode().then(
      (m) => this.admin.set(m !== undefined),
      () => undefined,
    );
    Promise.all([this.api.fetchGames(), this.api.fetchScenarios().catch(() => [])]).then(
      ([games, scenarios]) =>
        this.rows.set(
          (games as Array<GameSummary | PlayedGame>).map((g) => ({
            id: g.id,
            title: `${scenarios.find((s) => s.id === g.scenario)?.name ?? g.scenario}, ${SESSION_LABELS[g.sessionType]}, ${rateLabel(g.rate)}`,
            state: gameStatus(g),
          })),
        ),
      (e: unknown) => this.error.set(e instanceof Error ? e.message : String(e)),
    );
  }
}
