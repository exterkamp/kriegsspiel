/** Starts the app shell: decides the first screen from the session and URL, and moves between screens. */
import { mount, unmount } from 'svelte';
import type { Me } from '../auth.js';
import type { GameSummary } from '../lobby/api.js';
import { continueRows, type ContinueRow, type PlayedGame } from './continueList.js';
import { disconnectGame } from './gameHandle.js';
import GameMenu from './GameMenu.svelte';
import NewGame from './NewGame.svelte';
import MenuScreen from './MenuScreen.svelte';
import SignIn from './SignIn.svelte';
import type { CreateRequest, ScenarioOptions } from './newGame.js';
import {
  initialShell,
  isLiveScreen,
  needsReload,
  reduce,
  urlFor,
  type Screen,
  type ShellState,
} from './screens.js';

export interface ShellDeps {
  app: HTMLElement;
  win: Pick<Window, 'location' | 'history' | 'addEventListener' | 'removeEventListener'>;
  fetchMe: () => Promise<Me | undefined>;
  fetchGames: () => Promise<Array<GameSummary | PlayedGame>>;
  fetchScenarios: () => Promise<Array<{ id: string; name: string }>>;
  fetchScenarioOptions: () => Promise<ScenarioOptions>;
  createGame: (req: CreateRequest) => Promise<string>;
  requestLink: (email: string) => Promise<string | undefined>;
  signOut: () => Promise<void>;
  /** Guest play (D17c). Absent or resolving false: the sign-in screen has no guest button. */
  guestEnabled?: () => Promise<boolean>;
  startGuest?: () => Promise<string | undefined>;
  /** Loads the 3D table and desk into `app` (it reads the URL itself). Called at most once per page. */
  startLive: () => Promise<void>;
  startFixture: (app: HTMLElement) => void;
  now: () => number;
}

export interface Shell {
  readonly state: ShellState;
  go(screen: Screen): void;
  /** Unmounts everything and stops listening to history. */
  stop(): void;
}

export async function startShell(deps: ShellDeps): Promise<Shell> {
  const { app, win } = deps;
  const me = await deps.fetchMe().catch(() => undefined);
  const guestOn = me === undefined && (await deps.guestEnabled?.().catch(() => false)) === true;
  let state = initialShell(win.location.search, me !== undefined);
  let liveLoaded = false;
  let mounted: ReturnType<typeof mount> | undefined;
  let gameMenu: { component: ReturnType<typeof mount>; host: HTMLElement } | undefined;

  const clear = (): void => {
    if (mounted) void unmount(mounted);
    mounted = undefined;
    if (gameMenu) {
      void unmount(gameMenu.component);
      gameMenu.host.remove();
    }
    gameMenu = undefined;
    app.replaceChildren();
  };

  /** A fresh page load is the clean way out of the live client, which owns the canvas and the page's listeners. */
  const leave = (to: Screen): void => {
    disconnectGame();
    win.location.assign(urlFor(to));
  };

  const loadRows = async (): Promise<ContinueRow[]> => {
    const [games, scenarios] = await Promise.all([
      deps.fetchGames(),
      deps.fetchScenarios().catch(() => []),
    ]);
    const names = Object.fromEntries(scenarios.map((s) => [s.id, s.name]));
    return continueRows(games, names, deps.now());
  };

  /** With the guest cookie set, a fresh page load starts a game from the plain menu URL, or reopens the URL asked for. */
  const playAsGuest = async (): Promise<string | undefined> => {
    const err = await deps.startGuest!();
    if (err !== undefined) return err;
    const plain = state.screen.name === 'sign-in' && win.location.search === '';
    if (plain) win.location.assign(urlFor({ name: 'game', create: {} }));
    else win.location.reload();
    return undefined;
  };

  const signedOut = async (): Promise<void> => {
    disconnectGame();
    await deps.signOut();
    if (liveLoaded) return win.location.assign('/');
    state = reduce(state, { type: 'auth', signedIn: false });
    win.history.replaceState(null, '', urlFor(state.screen));
    render();
  };

  function render(): void {
    clear();
    const screen = state.screen;
    if (screen.name === 'sign-in') {
      mounted = mount(SignIn, {
        target: app,
        props: {
          onRequest: deps.requestLink,
          ...(guestOn && deps.startGuest ? { onGuest: playAsGuest } : {}),
        },
      });
    } else if (screen.name === 'menu') {
      mounted = mount(MenuScreen, {
        target: app,
        props: {
          email: me?.email ?? '',
          load: loadRows,
          onNewGame: () => shell.go({ name: 'new-game' }),
          onContinue: (game: string) => shell.go({ name: 'game', game }),
          onSignOut: () => void signedOut(),
          guest: me?.guest === true,
          onSignIn: () => shell.go({ name: 'sign-in' }),
        },
      });
    } else if (screen.name === 'new-game') {
      mounted = mount(NewGame, {
        target: app,
        props: {
          load: deps.fetchScenarioOptions,
          create: deps.createGame,
          onStarted: (game: string) => shell.go({ name: 'game', game }),
          onBack: () => shell.go({ name: 'menu' }),
        },
      });
    } else if (screen.name === 'fixture') {
      deps.startFixture(app);
    } else if (isLiveScreen(screen)) {
      liveLoaded = true;
      void deps.startLive().then(() => {
        const host = document.createElement('div');
        document.body.append(host);
        gameMenu = {
          host,
          component: mount(GameMenu, {
            target: host,
            props: { onLeave: () => leave({ name: 'menu' }), onSignOut: () => void signedOut() },
          }),
        };
      });
    }
  }

  const shell: Shell = {
    get state() {
      return state;
    },
    stop() {
      win.removeEventListener('popstate', onPop);
      clear();
    },
    go(screen) {
      const next = reduce(state, { type: 'go', screen });
      if (urlFor(next.screen) === urlFor(state.screen) && next.screen.name === state.screen.name)
        return;
      if (needsReload(state.screen, next.screen, liveLoaded)) return leave(next.screen);
      state = next;
      win.history.pushState(null, '', urlFor(next.screen));
      render();
    },
  };

  const onPop = (): void => {
    const next = reduce(state, { type: 'location', search: win.location.search });
    if (needsReload(state.screen, next.screen, liveLoaded)) {
      disconnectGame();
      win.location.reload();
      return;
    }
    state = next;
    render();
  };
  win.addEventListener('popstate', onPop);

  render();
  return shell;
}
