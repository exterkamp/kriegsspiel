import * as THREE from 'three';
import { buildSceneState } from './table/sceneState.js';
import { TableScene } from './table/TableScene.js';
import { fixtureMap, fixtureView } from './table/fixture.js';
import { GameConnection } from './net/connection.js';
import {
  applyServerMessage,
  gameNowMs,
  initialState,
  withLink,
  withMarkDeleted,
  withMarkPut,
  withPendingOrder,
  type ClientState,
  type PendingOrder,
} from './net/state.js';
import { Hud, buildOrderText } from './hud/hud.js';
import { MarksBar } from './hud/marksBar.js';
import { Gesture, type MarkTool } from './table/markTools.js';
import { newMarkId } from './table/marks.js';
import { pickMinSize } from './table/picking.js';
import type { Dispatch, Mark, WindowAt } from '@kriegsspiel/protocol';
import type { BeliefChoice } from './window/model.js';
import { parseSession, wsUrl } from './session.js';
import { fetchGame } from './lobby/api.js';
import { showGameList, showRoom } from './lobby/lobby.js';
import { fetchMe, showAccountBar, showLogin } from './auth.js';
import { mount } from 'svelte';
import Desk from './desk/Desk.svelte';
import {
  activeView,
  gameId,
  gameState,
  orderSender,
  pauseActions,
  persistDraft,
  persistJournal,
  persistTray,
  showOnTable,
  viewedDispatch,
  windowBelief,
  windowFrame,
  windowHover,
} from './desk/store.js';
import { buildWindowScene } from './window/model.js';
import { isDeskView } from './desk/views.js';
import { registerGame } from './shell/gameHandle.js';

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
  if (params.mode !== 'fixture' && params.mode !== 'menu') {
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
  // The desk marks dispatches read through the store, so keep this copy in step with it.
  gameState.subscribe((s) => (state = s));
  const gameKey = params.mode === 'join' ? params.game : 'fixture';
  persistTray(gameKey);
  persistDraft(gameKey);
  persistJournal(gameKey);
  showOnTable.subscribe((at) => {
    if (!at) return;
    table.panTo(at);
    showOnTable.set(undefined);
  });
  let conn: GameConnection | undefined;
  let orderSeq = 0;
  /** Send finished order wording and remember it as pending. Returns an error for the form, or undefined. */
  const sendOrder = (
    full: string,
    extra: Partial<PendingOrder> = {},
    courier?: 'fast' | 'safe',
  ): string | undefined => {
    if (!conn) return 'Not connected to a game (open with ?new=1 or ?game=…).';
    const orderId = `o-${Date.now().toString(36)}-${++orderSeq}`;
    if (!conn.sendOrder(orderId, full, courier))
      return 'Not connected. Try again when the link is back.';
    const now = state.clock ? gameNowMs(state.clock, Date.now()) : 0;
    state = withPendingOrder(state, { orderId, text: full, sentAtGame: now, ...extra });
    gameState.set(state);
    hud.render(state);
    return undefined;
  };
  const hud = new Hud(app, {
    onSendOrder: (unitId, text) => sendOrder(buildOrderText(state.view, unitId, text)),
  });
  orderSender.set({
    send: (o) =>
      sendOrder(
        o.text,
        {
          toName: o.toName,
          courier: o.courier,
          ...(o.eta === undefined ? {} : { etaGame: o.eta }),
        },
        o.courier,
      ),
  });

  // Marks: the player's own picture of the table. Edits show at once and go to the server, which stores them as sent.
  let tool: MarkTool = 'view';
  let selectedId: string | undefined;
  let gesture: Gesture | undefined;
  let draft: Mark | undefined;
  let lastReport: Dispatch | undefined;
  let markSeq = 0;
  const nowGame = (): number =>
    state.clock ? gameNowMs(state.clock, Date.now()) : (state.view?.atGame ?? 0);
  const marksBar = new MarksBar(app, {
    onTool(t) {
      tool = t;
      gesture = draft = undefined;
      // Drawing tools take the left button; the camera keeps the wheel and the other buttons.
      table.controls.mouseButtons.LEFT = t === 'view' ? THREE.MOUSE.ROTATE : (null as never);
      table.controls.touches.ONE = t === 'view' ? THREE.TOUCH.ROTATE : (null as never);
      redrawMarks();
    },
    onDelete: () => deleteSelected(),
    onPlotReport() {
      const d = lastReport;
      if (!d?.location) return;
      const label = [d.sizeEstimate, d.unit].filter(Boolean).join(' ') || d.from;
      // Plotting the same report again moves its pin rather than stacking a second one.
      const already = state.marks.find((m) => m.sourceReport === d.id);
      commitMark({
        id: already?.id ?? newMarkId(++markSeq, Date.now()),
        kind: 'pin',
        at: d.location,
        label,
        madeAtGame: nowGame(),
        sourceReport: d.id,
      });
    },
    onOverlays: (o) => table.setOverlays(o),
  });
  // The toolbar and the drawing tools belong to the table: in a desk view, hide them and go back to Look.
  const marksEl = app.querySelector<HTMLElement>('#marks');
  let deskOpen = false;
  activeView.subscribe((v) => {
    deskOpen = isDeskView(v);
    if (marksEl) marksEl.hidden = deskOpen;
    if (deskOpen) marksBar.setTool('view');
  });
  const deleteSelected = (): void => {
    if (!selectedId) return;
    state = withMarkDeleted(state, selectedId);
    conn?.deleteMark(selectedId);
    selectedId = undefined;
    redrawMarks();
  };
  const redrawMarks = (): void => {
    const shown = draft ? [...state.marks.filter((m) => m.id !== draft!.id), draft] : state.marks;
    table.setMarks(shown, nowGame(), selectedId);
    marksBar.setAvailable({
      selected: selectedId !== undefined,
      plottable: !!lastReport?.location,
    });
  };
  const commitMark = (mark: Mark): void => {
    state = withMarkPut(state, mark);
    if (conn && !conn.putMark(mark)) {
      if (out)
        out.textContent =
          'Not connected: that mark was not saved, and will be lost when the connection comes back.';
    }
    redrawMarks();
  };
  setInterval(redrawMarks, 2000);
  // The last located report the player opened in the desk viewer is the one Plot report pins.
  viewedDispatch.subscribe((d) => {
    if (!d?.location) return;
    lastReport = d;
    redrawMarks();
  });

  // After the game, the umpire's window replaces the player's picture with the truth at the scrubbed time.
  let windowShown = false;
  const showWindow = (): void => {
    let frame: WindowAt | undefined;
    windowFrame.subscribe((f) => (frame = f))();
    let belief: BeliefChoice = 'none';
    windowBelief.subscribe((b) => (belief = b))();
    windowShown = frame !== undefined;
    if (frame) table.apply(buildWindowScene(frame, belief, fixtureMap));
    else if (state.view) table.apply(buildSceneState(state.view, fixtureMap));
    if (marksEl) marksEl.hidden = windowShown || deskOpen;
  };
  windowFrame.subscribe(showWindow);
  windowBelief.subscribe(showWindow);

  const rerender = () => {
    gameState.set(state);
    hud.render(state);
    if (!windowShown && state.view) table.apply(buildSceneState(state.view, fixtureMap));
    redrawMarks();
  };

  const mapPoint = (e: PointerEvent) => {
    const r = table.pickAt(e.clientX, e.clientY);
    return r.type === 'none' ? undefined : r.coord;
  };
  let down: { x: number; y: number } | undefined;
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY };
    if (deskOpen || windowShown || tool === 'view' || e.button !== 0) return;
    const c = mapPoint(e);
    if (!c) return;
    const span = pickMinSize(fixtureMap);
    gesture = new Gesture(tool, c, {
      id: newMarkId(++markSeq, Date.now()),
      nowGame: nowGame(),
      label: marksBar.peekLabel(),
      marks: state.marks,
      tolerance: span,
      minStep: span / 3,
    });
    canvas.setPointerCapture?.(e.pointerId);
    if (tool === 'select') selectedId = gesture.grabbed?.id;
    draft = gesture.draft();
    redrawMarks();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (windowShown) {
      const r = table.pickAt(e.clientX, e.clientY);
      windowHover.set(r.type === 'piece' && r.pieceKind === 'own' ? r.id : undefined);
      return;
    }
    if (!gesture) return;
    const c = mapPoint(e);
    if (!c) return;
    gesture.update(c);
    draft = gesture.draft();
    redrawMarks();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (gesture) {
      const c = mapPoint(e);
      const made = c ? gesture.finish(c) : gesture.draft();
      const wasSelect = gesture.tool === 'select';
      gesture = draft = undefined;
      if (made) {
        if (!wasSelect) marksBar.takeLabel();
        commitMark(made);
      } else redrawMarks();
      return;
    }
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
    const r = table.pickAt(e.clientX, e.clientY);
    if (out) out.textContent = JSON.stringify(r);
    if (windowShown) {
      // A click pins the unit's notes, so touch and keyboard-less users can read them too.
      windowHover.set(r.type === 'piece' && r.pieceKind === 'own' ? r.id : undefined);
      return;
    }
    if (r.type === 'piece' && r.pieceKind === 'own') hud.selectUnit(r.id);
  });
  canvas.addEventListener('pointercancel', () => {
    gesture = draft = undefined;
    redrawMarks();
  });
  window.addEventListener('keydown', (e) => {
    if (
      e.key === 'Delete' &&
      !deskOpen &&
      selectedId &&
      !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
    )
      deleteSelected();
  });

  if (params.mode === 'join') {
    gameId.set(params.game);
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
    pauseActions.set({
      proposePause: (r) => conn!.proposePause(r),
      proposeResume: () => conn!.proposeResume(),
      vote: (id, yes) => conn!.vote(id, yes),
    });
    conn.start();
    registerGame({ disconnect: () => conn?.stop() });
    // A page kept in the back/forward cache is not closed, so it must come back with a live connection.
    // The listeners live as long as the page, like the client itself.
    window.addEventListener('pagehide', () => conn?.stop());
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) conn?.start();
    });
  } else {
    // No server: the fixture board with an empty desk.
    state = { ...withLink(state, 'offline'), view: fixtureView };
    gameState.set(state);
    hud.render(state);
  }
}

const app = document.getElementById('app');
if (app) void main(app);
