import { buildSceneState } from './table/sceneState.js';
import { TableScene } from './table/TableScene.js';
import { fixtureFacings, fixtureMap, fixtureView } from './table/fixture.js';

const app = document.getElementById('app');
if (app) {
  app.innerHTML = `
    <canvas id="table"></canvas>
    <div id="hud"><button id="top">Top-down</button><button id="obl">Oblique</button><span id="pick">Click the map</span></div>`;
  const canvas = app.querySelector<HTMLCanvasElement>('#table')!;
  const table = new TableScene(canvas);
  table.apply(buildSceneState(fixtureView, fixtureMap, fixtureFacings));
  table.start();
  window.addEventListener('resize', () => table.resize());
  app.querySelector('#top')?.addEventListener('click', () => table.snapTopDown());
  app.querySelector('#obl')?.addEventListener('click', () => table.snapOblique());
  let down: { x: number; y: number } | undefined;
  canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
    const r = table.pickAt(e.clientX, e.clientY);
    const out = app.querySelector('#pick');
    if (out) out.textContent = JSON.stringify(r);
  });
  // Debug handle, dev only.
  if (import.meta.env.DEV) (window as unknown as { table: TableScene }).table = table;
}
