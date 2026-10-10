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
  withRead,
  type ClientState,
} from './net/state.js';
import { Hud, buildOrderText } from './hud/hud.js';
import { MarksBar } from './hud/marksBar.js';
import { Gesture, type MarkTool } from './table/markTools.js';
import { newMarkId } from './table/marks.js';
import { pickMinSize } from './table/picking.js';
import type { Dispatch, Mark } from '@kriegsspiel/protocol';
import { parseSession, wsUrl } from './session.js';
import { mount } from 'svelte';
import Desk from './desk/Desk.svelte';
import { activeView, gameState } from './desk/store.js';
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
    onOpenDispatch(d) {
      state = withRead(state, d.id);
      if (d.location) lastReport = d;
      redrawMarks();
      gameState.set(state);
      hud.render(state, Date.now());
      if (d.location) table.panTo(d.location);
    },
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
      commitMark({
        id: newMarkId(++markSeq, Date.now()),
        kind: 'pin',
        at: d.location,
        label,
        madeAtGame: nowGame(),
        sourceReport: d.id,
      });
    },
    onOverlays: (o) => table.setOverlays(o),
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
      if (out) out.textContent = 'Not connected: that mark is only on this screen for now.';
    }
    redrawMarks();
  };
  setInterval(redrawMarks, 2000);

  const rerender = () => {
    gameState.set(state);
    hud.render(state, Date.now());
    if (state.view) table.apply(buildSceneState(state.view, fixtureMap));
    redrawMarks();
  };

  const mapPoint = (e: PointerEvent) => {
    const r = table.pickAt(e.clientX, e.clientY);
    return r.type === 'none' ? undefined : r.coord;
  };
  let down: { x: number; y: number } | undefined;
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY };
    if (tool === 'view' || e.button !== 0) return;
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
    if (r.type === 'piece' && r.pieceKind === 'own') hud.selectUnit(r.id);
  });
  canvas.addEventListener('pointercancel', () => {
    gesture = draft = undefined;
    redrawMarks();
  });
  window.addEventListener('keydown', (e) => {
    if (
      e.key === 'Delete' &&
      selectedId &&
      !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
    )
      deleteSelected();
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
