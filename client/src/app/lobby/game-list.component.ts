import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import type { GameSummary } from '@legacy/lobby/api';
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
      margin-top: var(--ks-space-5);
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

  ngOnInit(): void {
    Promise.all([this.api.fetchGames(), this.api.fetchScenarios().catch(() => [])]).then(
      ([games, scenarios]) =>
        this.rows.set(
          (games as GameSummary[]).map((g) => ({
            id: g.id,
            title: `${scenarios.find((s) => s.id === g.scenario)?.name ?? g.scenario}, ${SESSION_LABELS[g.sessionType]}, ${rateLabel(g.rate)}`,
            state: `${g.status === 'lobby' ? 'in the lobby' : 'started'}${g.side ? `, you are ${g.side}` : ''}`,
          })),
        ),
      (e: unknown) => this.error.set(e instanceof Error ? e.message : String(e)),
    );
  }
}
