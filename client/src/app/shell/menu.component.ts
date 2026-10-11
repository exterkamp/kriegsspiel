import { ChangeDetectionStrategy, Component, OnInit, input, output, signal } from '@angular/core';
import type { ContinueRow } from '@legacy/shell/continueList';
import { PAGE_CSS } from './page-styles';

/** The main menu: new game, the continue list, the account, and a word about the game. */
@Component({
  selector: 'ks-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <main>
        <h1>Kriegsspiel</h1>
        <p class="tag muted">An umpired war game, played in real time or slower.</p>

        <nav aria-label="Main menu">
          <button type="button" class="primary" (click)="newGame.emit()">New game</button>
        </nav>

        @if (games() === undefined && !loadError()) {
          <p role="status" class="muted">Looking for your games…</p>
        } @else if (loadError()) {
          <p role="alert" class="err">{{ loadError() }}</p>
        } @else if (games()!.length > 0) {
          <section aria-labelledby="continue-h">
            <h2 id="continue-h">Continue</h2>
            <ul>
              @for (g of games(); track g.id) {
                <li>
                  <button
                    type="button"
                    class="game"
                    [attr.aria-label]="'Continue: ' + g.label"
                    (click)="continueGame.emit(g.id)"
                  >
                    <b>{{ g.scenario }}</b>
                    <span>{{ g.side }}</span>
                    <span>{{ g.gameTime }}</span>
                    <span class="muted">played {{ g.lastPlayed }}</span>
                  </button>
                </li>
              }
            </ul>
          </section>
        }

        <section aria-labelledby="account-h">
          <h2 id="account-h">Account</h2>
          @if (guest()) {
            <p>Playing as a guest. Your games stay in this browser.</p>
            <button type="button" (click)="signIn.emit()">
              Sign in to keep your games on other devices
            </button>
          } @else {
            <p>
              Signed in as <b>{{ email() }}</b>
            </p>
            <button type="button" (click)="signOut.emit()">Sign out</button>
          }
        </section>

        <section aria-labelledby="about-h">
          <h2 id="about-h">About</h2>
          <p>
            You command one side of a battle from a desk. Orders are written in plain words and
            carried by couriers, reports arrive late and incomplete, and an umpire rules on what
            happens. The game keeps running on the server while you are away.
            <a href="https://github.com/exterkamp/kriegsspiel/blob/main/docs/gameplay.md"
              >Read how it plays</a
            >.
          </p>
        </section>
      </main>
    </div>
  `,
  styles: [
    PAGE_CSS,
    `
      h1 {
        margin: 0;
      }
      .game {
        width: 100%;
        display: flex;
        flex-wrap: wrap;
        gap: 4px 16px;
        text-align: left;
        font-size: inherit;
        padding: 8px 14px;
        background: #f6edd0;
        color: #2a2118;
      }
    `,
  ],
})
export class MenuComponent implements OnInit {
  readonly email = input('');
  readonly load = input.required<() => Promise<ContinueRow[]>>();
  /** A guest session: no sign-out (it would orphan the games), a way to sign in and keep them instead. */
  readonly guest = input(false);
  readonly newGame = output();
  readonly continueGame = output<string>();
  readonly signOut = output();
  readonly signIn = output();
  protected readonly games = signal<ContinueRow[] | undefined>(undefined);
  protected readonly loadError = signal<string | undefined>(undefined);

  ngOnInit(): void {
    this.load()().then(
      (g) => this.games.set(g),
      (e: unknown) => this.loadError.set(e instanceof Error ? e.message : String(e)),
    );
  }
}
