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
      <p role="alert" class="err">{{ error() }}</p>
    } @else if (rows() === undefined) {
      <p role="status">Loading your games…</p>
    } @else {
      <ul id="game-list">
        @for (g of rows(); track g.id) {
          <li>
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
      margin-top: 24px;
    }
    h2 {
      font-size: 1.1rem;
      margin: 0 0 8px;
      border-bottom: 1px solid #8a7a52;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 6px;
    }
    a {
      color: #6b1d12;
    }
    a:focus-visible {
      outline: 3px solid #1f5fbf;
      outline-offset: 2px;
    }
    .err {
      color: #8a1c10;
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
