import * as THREE from 'three';
import { TableScene } from './FixtureTableScene.js';
import {
  FrameSampler,
  performanceArtworkUrl,
  performanceSceneState,
} from './performanceFixture.js';

/** Dev-only harness for the #49 gate: 60 pieces (30 own, 15 fresh, 15 stale) on the public artwork.
 * Query: `?seconds=10` sampling time, `?orbit=1` slowly orbits the camera to include navigation.
 * The result is left on `window.__tableBenchmark` and in #result.
 */
const params = new URLSearchParams(location.search);
const seconds = Math.min(60, Number(params.get('seconds') ?? 10));
const orbit = params.get('orbit') === '1';
const canvas = document.getElementById('table') as HTMLCanvasElement;
const out = document.getElementById('result')!;
const table = new TableScene(canvas);
const image = new Image();
image.src = performanceArtworkUrl;
await image.decode();
table.apply(performanceSceneState, image);
table.start();
(window as unknown as { __table: TableScene }).__table = table;

const warmupMs = 2000;
const sampler = new FrameSampler();
const begin = performance.now();
const tick = (now: number): void => {
  const t = now - begin;
  if (orbit) {
    const offset = table.camera.position.clone().sub(table.controls.target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.004);
    table.camera.position.copy(table.controls.target).add(offset);
  }
  if (t > warmupMs) sampler.sample(now);
  if (t < warmupMs + seconds * 1000) requestAnimationFrame(tick);
  else finish();
};
const finish = (): void => {
  const info = table.renderer.info;
  const summary = sampler.summary();
  const result = {
    pieces: table.pieceCount,
    dpr: window.devicePixelRatio,
    viewport: [innerWidth, innerHeight],
    orbit,
    summary,
    fps: summary ? 1000 / summary.meanIntervalMs : null,
    drawCalls: info.render.calls,
    triangles: info.render.triangles,
    textures: info.memory.textures,
    userAgent: navigator.userAgent,
  };
  (window as unknown as { __tableBenchmark: unknown }).__tableBenchmark = result;
  out.textContent = JSON.stringify(result, null, 1);
};
requestAnimationFrame(tick);
