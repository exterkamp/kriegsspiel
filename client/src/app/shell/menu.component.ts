import { ChangeDetectionStrategy, Component, OnInit, input, output, signal } from '@angular/core';
import type { ContinueRow } from '@legacy/shell/continueList';
import { isHighContrast, setHighContrast } from '../ui/contrast';
import { PageFrameComponent } from '../ui/page-frame.component';

const DEV_TOOLS = [
  {
    href: '/map-authoring',
    name: 'Map editor',
    about: 'Generate, preview and export a battlefield.',
  },
  {
    href: '/map-benchmark',
    name: 'Map benchmark',
    about: 'Time map generation and rendering on this device.',
  },
  {
    href: '/table-benchmark',
    name: 'Table benchmark',
    about: 'Time the 3D table scene on this device.',
  },
  {
    href: '/style-guide',
    name: 'Style guide',
    about: 'Tokens and every shared control in each state.',
  },
  { href: '/admin/', name: 'Admin view', about: 'Operator console; asks for the admin token.' },
];

/** The main menu: new game, the continue list, the account, and a word about the game. */
@Component({
  selector: 'ks-menu',
  imports: [PageFrameComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ks-page-frame heading="Kriegsspiel">
      <p class="ks-muted tag">An umpired war game, played in real time or slower.</p>

      <nav aria-label="Main menu">
        <button type="button" class="ks-primary" (click)="newGame.emit()">New game</button>
      </nav>

      @if (games() === undefined && !loadError()) {
        <p role="status" class="ks-muted">Looking for your games…</p>
      } @else if (loadError()) {
        <p role="alert" class="ks-status ks-error">{{ loadError() }}</p>
      } @else if (games()!.length > 0) {
        <section aria-labelledby="continue-h">
          <h2 id="continue-h">Continue</h2>
          <ul class="ks-stack">
            @for (g of games(); track g.id) {
              <li>
                <button
                  type="button"
                  class="ks-row ks-link game"
                  [attr.aria-label]="'Continue: ' + g.label"
                  (click)="continueGame.emit(g.id)"
                >
                  <b>{{ g.scenario }}</b>
                  <span>{{ g.side }}</span>
                  <span>{{ g.gameTime }}</span>
                  <span class="ks-muted">played {{ g.lastPlayed }}</span>
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
        } @else {
          <p>
            Signed in as <b>{{ email() }}</b>
          </p>
        }
        <div class="ks-cluster">
          @if (guest()) {
            <button type="button" (click)="signIn.emit()">
              Sign in to keep your games on other devices
            </button>
          } @else {
            <button type="button" (click)="signOut.emit()">Sign out</button>
          }
          <button type="button" [attr.aria-pressed]="contrast()" (click)="toggleContrast()">
            High contrast
          </button>
        </div>
      </section>

      @if (devTools()) {
        <section class="dev" aria-labelledby="dev-h">
          <h2 id="dev-h">Developer tools</h2>
          <p class="ks-muted">For development; not part of the game.</p>
          <ul class="ks-stack">
            @for (t of tools; track t.href) {
              <li>
                <a [href]="t.href" class="ks-row ks-link">
                  <b>{{ t.name }}</b>
                  <span class="ks-muted">{{ t.about }}</span>
                </a>
              </li>
            }
          </ul>
        </section>
      }

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
    </ks-page-frame>
  `,
  styles: `
    section {
      margin-top: var(--ks-space-5);
    }
    h2 {
      border-bottom: 1px solid var(--ks-rule);
      margin: 0 0 var(--ks-space-2);
    }
    .tag {
      margin-top: 0;
    }
  `,
})
export class MenuComponent implements OnInit {
  readonly email = input('');
  readonly load = input.required<() => Promise<ContinueRow[]>>();
  /** A guest session: no sign-out (it would orphan the games), a way to sign in and keep them instead. */
  readonly guest = input(false);
  /** Show the Developer tools section (server `DEV_TOOLS`). */
  readonly devTools = input(false);
  readonly newGame = output();
  readonly continueGame = output<string>();
  readonly signOut = output();
  readonly signIn = output();
  protected readonly tools = DEV_TOOLS;
  protected readonly games = signal<ContinueRow[] | undefined>(undefined);
  protected readonly loadError = signal<string | undefined>(undefined);
  protected readonly contrast = signal(isHighContrast());

  protected toggleContrast(): void {
    setHighContrast(!this.contrast());
    this.contrast.set(isHighContrast());
  }

  ngOnInit(): void {
    this.load()().then(
      (g) => this.games.set(g),
      (e: unknown) => this.loadError.set(e instanceof Error ? e.message : String(e)),
    );
  }
}
