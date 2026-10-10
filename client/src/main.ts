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
  type ClientState,
} from './net/state.js';
import { Hud, buildOrderText } from './hud/hud.js';
import { parseSession, wsUrl } from './session.js';
import { mount } from 'svelte';
import Desk from './desk/Desk.svelte';
import { activeView, gameState, persistTray, showOnTable } from './desk/store.js';
import { isDeskView } from './desk/views.js';

async function createGame(side: string, rate?: number): Promise<{ game: string; token: string }> {
  const res = await fetch('/games', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(rate === undefined ? {} : { rate }),
  });
  if (!res.ok) throw new Error(`could not create a game (${res.status})`);
  const body = (await res.json()) as { id: string; tokens: Record<string, string> };
  const token = body.tokens[side];
  if (!token) throw new Error(`no side "${side}" in this scenario`);
  return { game: body.id, token };
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
  if (params.mode === 'create') {
    try {
      const made = await createGame(params.side, params.rate);
      history.replaceState(null, '', `?game=${made.game}&token=${made.token}`);
      params = { mode: 'join', ...made };
    } catch (e) {
      if (out) out.textContent = e instanceof Error ? e.message : String(e);
      return;
    }
  }

  let state: ClientState = initialState;
  // The desk marks dispatches read through the store, so keep this copy in step with it.
  gameState.subscribe((s) => (state = s));
  persistTray(params.mode === 'join' ? params.game : 'fixture');
  showOnTable.subscribe((at) => {
    if (!at) return;
    table.panTo(at);
    showOnTable.set(undefined);
  });
  let conn: GameConnection | undefined;
  let orderSeq = 0;
  const hud = new Hud(app, {
    onSendOrder(unitId, text) {
      if (!conn) return 'Not connected to a game (open with ?new=1 or ?game=…&token=…).';
      const orderId = `o-${Date.now().toString(36)}-${++orderSeq}`;
      const full = buildOrderText(state.view, unitId, text);
      if (!conn.sendOrder(orderId, full)) return 'Not connected. Try again when the link is back.';
      const now = state.clock ? gameNowMs(state.clock, Date.now()) : 0;
      state = withPendingOrder(state, { orderId, text: full, sentAtGame: now });
      gameState.set(state);
      hud.render(state, Date.now());
      return undefined;
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
      url: wsUrl(window.location, params.game, params.token),
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
