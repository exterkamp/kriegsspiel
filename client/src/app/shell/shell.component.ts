import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import type { Me } from '@legacy/auth';
import type { GameInfo } from '@legacy/lobby/api';
import { continueRows, type ContinueRow } from '@legacy/shell/continueList';
import {
  initialShell,
  isLiveScreen,
  needsReload,
  reduce,
  urlFor,
  type Screen,
  type ShellState,
} from '@legacy/shell/screens';
import { GameComponent } from '../game/game.component';
import { GameService } from '../game/game.service';
import { GameListComponent } from '../lobby/game-list.component';
import { RoomComponent } from '../lobby/room.component';
import { AccountBarComponent } from './account-bar.component';
import { GameMenuComponent } from './game-menu.component';
import { MenuComponent } from './menu.component';
import { NewGameComponent } from './new-game.component';
import { SHELL_API, SHELL_NOW, SHELL_WINDOW } from './shell-api';
import { SignInComponent } from './sign-in.component';

/** What the live screen is waiting for before the table can open. */
type Prep =
  | { step: 'working' }
  | { step: 'room'; info: GameInfo }
  | { step: 'failed'; message: string }
  | { step: 'ready' };

/**
 * The entry page at `/`. The query string decides the first screen (`?game`, `?new`, `?lobby`, none
 * for the menu), through the same pure rules as the Svelte shell (`@legacy/shell/screens`). Moving between the shell's
 * own screens is a history push; moving into or out of the game is a fresh page load, because the live screen owns the
 * canvas and the page's listeners.
 */
@Component({
  selector: 'ks-shell',
  imports: [
    SignInComponent,
    MenuComponent,
    NewGameComponent,
    GameListComponent,
    RoomComponent,
    GameComponent,
    GameMenuComponent,
    AccountBarComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state(); as st) {
      @switch (st.screen.name) {
        @case ('sign-in') {
          <ks-sign-in
            [onRequest]="api.requestLink"
            [onGuest]="guestOn() ? playAsGuest : undefined"
          />
        }
        @case ('menu') {
          <ks-menu
            [email]="me()?.email ?? ''"
            [guest]="me()?.guest === true"
            [load]="loadRows"
            [devTools]="devTools()"
            (newGame)="go({ name: 'new-game' })"
            (continueGame)="go({ name: 'game', game: $event })"
            (signOut)="signedOut()"
            (signIn)="go({ name: 'sign-in' })"
          />
        }
        @case ('new-game') {
          <ks-new-game
            [load]="api.fetchScenarioOptions"
            [create]="api.createGame"
            (started)="go({ name: 'game', game: $event })"
            (back)="go({ name: 'menu' })"
          />
          <div class="games"><ks-game-list /></div>
        }
        @default {
          @switch (prep().step) {
            @case ('ready') {
              <ks-game />
              <ks-game-menu (leave)="go({ name: 'menu' })" (signOut)="signedOut()">
                @if (me(); as m) {
                  <ks-account-bar [me]="m" (gone)="goHome()" />
                }
              </ks-game-menu>
            }
            @case ('room') {
              <ks-room [first]="roomInfo()!" (started)="enter()" />
            }
            @case ('failed') {
              <p id="pick" role="alert" class="failed">{{ failure() }}</p>
            }
            @default {
              <p role="status" class="failed">Opening the game…</p>
            }
          }
        }
      }
    } @else {
      <p role="status" class="failed">Loading…</p>
    }
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
    .failed {
      color: #efe6c8;
      font-family: Georgia, serif;
      padding: 16px;
    }
    .games {
      max-width: 560px;
      margin: 0 auto;
      padding: 0 16px 32px;
      font-family: Georgia, serif;
      color: #2a2118;
      background: #e9dcb8;
    }
  `,
})
export class ShellComponent implements OnInit, OnDestroy {
  protected readonly api = inject(SHELL_API);
  private readonly win = inject(SHELL_WINDOW);
  private readonly now = inject(SHELL_NOW);
  private readonly game = inject(GameService);
  protected readonly state = signal<ShellState | undefined>(undefined);
  protected readonly me = signal<Me | undefined>(undefined);
  protected readonly guestOn = signal(false);
  protected readonly devTools = signal(false);
  protected readonly prep = signal<Prep>({ step: 'working' });
  protected readonly roomInfo = signal<GameInfo | undefined>(undefined);
  protected readonly failure = signal('');
  private liveLoaded = false;
  private stopped = false;

  private readonly onPop = (): void => {
    const st = this.state();
    if (!st) return;
    const next = reduce(st, { type: 'location', search: this.win.location.search });
    if (needsReload(st.screen, next.screen, this.liveLoaded)) {
      this.game.disconnect();
      this.win.location.reload();
      return;
    }
    this.show(next);
  };

  async ngOnInit(): Promise<void> {
    this.win.addEventListener('popstate', this.onPop);
    const me = await this.api.fetchMe().catch(() => undefined);
    if (this.stopped) return;
    this.me.set(me);
    this.api.devToolsEnabled().then(
      (on) => this.devTools.set(on),
      () => undefined,
    );
    if (me === undefined) this.guestOn.set(await this.api.guestEnabled().catch(() => false));
    this.show(initialShell(this.win.location.search, me !== undefined));
  }

  ngOnDestroy(): void {
    this.stopped = true;
    this.win.removeEventListener('popstate', this.onPop);
  }

  /** The main menu's Continue list. */
  protected readonly loadRows = async (): Promise<ContinueRow[]> => {
    const [games, scenarios] = await Promise.all([
      this.api.fetchGames(),
      this.api.fetchScenarios().catch(() => []),
    ]);
    const names = Object.fromEntries(scenarios.map((s) => [s.id, s.name]));
    return continueRows(games, names, this.now());
  };

  /** With the guest cookie set, a fresh page load opens the main menu from the plain URL, or reopens the URL asked for. */
  protected readonly playAsGuest = async (): Promise<string | undefined> => {
    const err = await this.api.startGuest();
    if (err !== undefined) return err;
    this.win.location.reload();
    return undefined;
  };

  protected go(screen: Screen): void {
    const st = this.state()!;
    const next = reduce(st, { type: 'go', screen });
    if (urlFor(next.screen) === urlFor(st.screen) && next.screen.name === st.screen.name) return;
    if (needsReload(st.screen, next.screen, this.liveLoaded)) {
      this.game.disconnect();
      this.win.location.assign(urlFor(next.screen));
      return;
    }
    this.win.history.pushState(null, '', urlFor(next.screen));
    this.show(next);
  }

  protected goHome(): void {
    this.game.disconnect();
    this.win.location.assign('/');
  }

  protected async signedOut(): Promise<void> {
    this.game.disconnect();
    await this.api.signOut();
    if (this.liveLoaded) return this.win.location.assign('/');
    this.me.set(undefined);
    const next = reduce(this.state()!, { type: 'auth', signedIn: false });
    this.win.history.replaceState(null, '', urlFor(next.screen));
    this.show(next);
  }

  private show(next: ShellState): void {
    this.state.set(next);
    if (isLiveScreen(next.screen)) {
      this.liveLoaded = true;
      void this.prepare(next.screen);
    }
  }

  /** Gets the player a seat before the table opens: makes the game for `?new`, joins, waits in the room. */
  private async prepare(screen: Screen): Promise<void> {
    this.prep.set({ step: 'working' });
    try {
      let id =
        screen.name === 'game'
          ? screen.game
          : screen.name === 'game-over'
            ? screen.game
            : undefined;
      let side = screen.name === 'game' ? screen.side : undefined;
      if (id === undefined) {
        const create = screen.name === 'game' ? screen.create : undefined;
        id = await this.api.createQuickGame(create?.side, create?.rate);
        side = undefined;
        this.win.history.replaceState(null, '', `?game=${id}`);
      }
      let info = await this.api.fetchGame(id);
      if (!info.you) {
        const pick = side ?? info.sides.find((s) => !s.taken)?.side;
        if (!pick) throw new Error('every side in this game is taken');
        await this.api.joinSide(id, pick);
        info = await this.api.fetchGame(id);
      }
      if (this.stopped) return;
      if (info.status === 'lobby') {
        this.roomInfo.set(info);
        this.prep.set({ step: 'room', info });
      } else {
        this.enter();
      }
    } catch (e) {
      this.failure.set(e instanceof Error ? e.message : String(e));
      this.prep.set({ step: 'failed', message: this.failure() });
    }
  }

  protected enter(): void {
    this.prep.set({ step: 'ready' });
  }
}
