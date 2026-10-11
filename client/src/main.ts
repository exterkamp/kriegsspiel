import { buildSceneState } from './table/sceneState.js';
import { TableScene } from './table/TableScene.js';
import { fixtureMap, fixtureView } from './table/fixture.js';
import { GameConnection } from './net/connection.js';
import {
  applyServerMessage,
  gameNowMs,
  initialState,
  withLink,
  withPendingOrder,
  withRead,
  type ClientState,
} from './net/state.js';
import { Hud, buildOrderText } from './hud/hud.js';
import { parseSession, wsUrl } from './session.js';
import { fetchGame } from './lobby/api.js';
import { showGameList, showRoom } from './lobby/lobby.js';
import { fetchMe, showAccountBar, showLogin } from './auth.js';
import { mount } from 'svelte';
import Desk from './desk/Desk.svelte';
import { activeView, gameState } from './desk/store.js';
import { isDeskView } from './desk/views.js';

/** Make a game as the signed-in user and take `side` (the server picks one when unset). */
async function createGame(side?: string, rate?: number): Promise<string> {
  const res = await fetch('/games', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...(rate === undefined ? {} : { rate }), ...(side ? { side } : {}) }),
  });
  if (!res.ok) throw new Error(`could not create a game (${res.status})`);
  return ((await res.json()) as { id: string }).id;
}

/** Make sure the signed-in user has a seat in `game`, taking `side` or the first free one. */
async function takeSeat(game: string, side?: string): Promise<void> {
  const info = await fetch(`/games/${encodeURIComponent(game)}`);
  if (info.status === 404) throw new Error('no such game');
  if (!info.ok) throw new Error(`could not read the game (${info.status})`);
  const body = (await info.json()) as {
    you: string | null;
    sides: Array<{ side: string; taken: boolean }>;
  };
  if (body.you) return;
  const pick = side ?? body.sides.find((s) => !s.taken)?.side;
  if (!pick) throw new Error('every side in this game is taken');
  const res = await fetch(`/games/${encodeURIComponent(game)}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ side: pick }),
  });
  if (!res.ok)
    throw new Error(
      res.status === 409 ? `${pick} is already taken` : `could not join (${res.status})`,
    );
}

/** Hot-seat: a button per side to hand the desk over; each reloads the page seated at that side. */
function showSideSwitch(app: HTMLElement, game: string, sides: string[], current?: string): void {
  const bar = document.createElement('div');
  bar.id = 'sides';
  for (const side of sides) {
    const b = document.createElement('button');
    b.textContent = side === current ? `Playing ${side}` : `Switch to ${side}`;
    b.disabled = side === current;
    b.addEventListener('click', () =>
      window.location.assign(`/?game=${encodeURIComponent(game)}&side=${encodeURIComponent(side)}`),
    );
    bar.append(b);
  }
  app.append(bar);
}

async function main(app: HTMLElement): Promise<void> {
  app.innerHTML = `
    <canvas id="table"></canvas>
    <div id="hud"><button id="top">Top-down</button><button id="obl">Oblique</button><span id="pick">Click the map</span></div>`;
  const canvas = app.querySelector<HTMLCanvasElement>('#table')!;
  const table = new TableScene(canvas);
  table.apply(buildSceneState(fixtureView, fixtureMap));
  table.start();
  window.addEventListener('resize', () => table.resize());
  app.querySelector('#top')?.addEventListener('click', () => table.snapTopDown());
  app.querySelector('#obl')?.addEventListener('click', () => table.snapOblique());
  // The desk shell sits over the canvas. The table keeps rendering whichever view is open.
  mount(Desk, { target: app });
  activeView.subscribe((v) => {
    app.dataset.view = v;
    table.setDesk(
      isDeskView(v),
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 600,
    );
  });
  if (import.meta.env.DEV) (window as unknown as { table: TableScene }).table = table;

  let params = parseSession(window.location.search);
  const out = app.querySelector('#pick');
  if (params.mode !== 'fixture') {
    const me = await fetchMe();
    if (!me) {
      // The emailed link opens in this browser and lands back here with a session cookie.
      await showLogin(app);
      return;
    }
    showAccountBar(app, me, () => window.location.assign('/'));
    try {
      if (params.mode === 'lobby') {
        await showGameList(app);
        return;
      }
      if (params.mode === 'create') {
        const game = await createGame(params.side, params.rate);
        history.replaceState(null, '', `?game=${game}`);
        params = { mode: 'join', game };
      } else {
        await takeSeat(params.game, params.side);
        const info = await fetchGame(params.game);
        if (info.status === 'lobby') await showRoom(app, info);
        // Hot-seat: the one account plays both sides, so offer the other side's desk.
        if (info.sessionType === 'hot_seat')
          showSideSwitch(
            app,
            params.game,
            info.sides.map((s) => s.side),
            params.side ?? info.sides[0]?.side,
          );
      }
    } catch (e) {
      if (out) out.textContent = e instanceof Error ? e.message : String(e);
      return;
    }
  }

  let state: ClientState = initialState;
  let conn: GameConnection | undefined;
  let orderSeq = 0;
  const hud = new Hud(app, {
    onSendOrder(unitId, text) {
      if (!conn) return 'Not connected to a game (open with ?new=1 or ?game=…).';
      const orderId = `o-${Date.now().toString(36)}-${++orderSeq}`;
      const full = buildOrderText(state.view, unitId, text);
      if (!conn.sendOrder(orderId, full)) return 'Not connected. Try again when the link is back.';
      const now = state.clock ? gameNowMs(state.clock, Date.now()) : 0;
      state = withPendingOrder(state, { orderId, text: full, sentAtGame: now });
      gameState.set(state);
      hud.render(state, Date.now());
      return undefined;
    },
    onOpenDispatch(d) {
      state = withRead(state, d.id);
      gameState.set(state);
      hud.render(state, Date.now());
      if (d.location) table.panTo(d.location);
    },
  });

  const rerender = () => {
    gameState.set(state);
    hud.render(state, Date.now());
    if (state.view) table.apply(buildSceneState(state.view, fixtureMap));
  };

  let down: { x: number; y: number } | undefined;
  canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
    const r = table.pickAt(e.clientX, e.clientY);
    if (out) out.textContent = JSON.stringify(r);
    if (r.type === 'piece' && r.pieceKind === 'own') hud.selectUnit(r.id);
  });

  if (params.mode === 'join') {
    conn = new GameConnection({
      url: wsUrl(window.location, params.game, params.side),
      onStatus: (s) => {
        state = withLink(state, s);
        rerender();
      },
      onMessage: (m) => {
        state = applyServerMessage(state, m, Date.now());
        rerender();
      },
    });
    conn.start();
    setInterval(() => hud.tick(Date.now()), 250);
  } else {
    // No server: the fixture board with an empty desk.
    state = { ...withLink(state, 'offline'), view: fixtureView };
    gameState.set(state);
    hud.render(state, Date.now());
  }
}

const app = document.getElementById('app');
if (app) void main(app);
