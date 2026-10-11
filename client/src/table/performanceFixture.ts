import { SideView } from '@kriegsspiel/protocol';
import { fixtureMap } from './fixture.js';
import { buildSceneState } from './sceneState.js';

/** Synthetic filtered knowledge, never an engine world. Only public coordinator artwork.
 * Browser gate still pending: apply performanceSceneState, then setArtwork with the loaded
 * /hq-preview.svg. Record laptop/browser/viewport/DPR and steady-state + navigation runs.
 */
export const performanceArtworkUrl = '/hq-preview.svg';
export const performanceMap = fixtureMap;

export function makePerformanceView(side = 'blue'): SideView {
  const atGame = 2 * 3_600_000;
  const position = (index: number) => ({
    x: 250 + (index % 10) * 380,
    y: 200 + Math.floor(index / 10) * 240,
  });
  return SideView.parse({
    side,
    atGame,
    ownUnits: Array.from({ length: 30 }, (_, index) => ({
      id: `${side}-performance-${index}`,
      name: `Fixture battalion ${index + 1}`,
      position: position(index),
      facing: (index * 0.37) % (Math.PI * 2),
      formation: 'line',
      footprint: { frontage: 60 + index * 2, depth: 8 + index },
      ...(index === 0
        ? {
            shape: [
              { x: -30, y: 10 },
              { x: 20, y: -10 },
            ],
            formation: 'loose',
          }
        : {}),
      strength: 500 + index,
      morale: 0.75,
      supply: 0.8,
    })),
    visibleEnemies: Array.from({ length: 15 }, (_, index) => ({
      id: `fresh-performance-${index}`,
      position: position(30 + index),
      facing: 0,
      formation: 'line',
      footprint: { frontage: 80, depth: 10 },
      sizeEstimate: 'Perhaps a battalion',
    })),
    lastKnownContacts: Array.from({ length: 15 }, (_, index) => {
      const ageMs = [5 * 60_000, 30 * 60_000, 2 * 3_600_000][index % 3]!;
      return {
        id: `stale-performance-${index}`,
        position: position(45 + index),
        observedAtGame: atGame - ageMs,
        ageMs,
        uncertaintyRadius: 500,
        sizeEstimate: 'A distant column',
      };
    }),
    dispatches: [],
    clock: { gameMsAtAnchor: atGame, wallMsAtAnchor: 0, rate: 1, status: 'paused' },
  });
}

export const performanceView = makePerformanceView();
export const performanceSceneState = buildSceneState(performanceView, performanceMap);

/** Feed requestAnimationFrame timestamps after warmup, at most 10,000 intervals/run.
 * This measures scheduling/frame intervals, NOT GPU render time or a measured FPS claim.
 * Use a fresh sampler per steady-state/transition run. Stop on tab backgrounding; record
 * browser/refresh rate and report percentiles + elapsed time alongside screenshots.
 * No timers/RAF are installed by this helper; the coordinator owns the browser harness.
 */
export class FrameSampler {
  private previous: number | undefined;
  private intervals: number[] = [];
  sample(timestampMs: number): void {
    if (
      !Number.isFinite(timestampMs) ||
      timestampMs < 0 ||
      (this.previous !== undefined && timestampMs <= this.previous)
    ) {
      throw new RangeError('Frame timestamps must increase monotonically');
    }
    if (this.intervals.length >= 10_000) throw new RangeError('Frame sample limit reached');
    if (this.previous !== undefined) this.intervals.push(timestampMs - this.previous);
    this.previous = timestampMs;
  }
  summary(): null | {
    intervals: number;
    elapsedMs: number;
    meanIntervalMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
  } {
    if (this.intervals.length === 0) return null;
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const elapsedMs = this.intervals.reduce((sum, value) => sum + value, 0);
    const percentile = (fraction: number) => sorted[Math.ceil(sorted.length * fraction) - 1]!;
    return {
      intervals: sorted.length,
      elapsedMs,
      meanIntervalMs: elapsedMs / sorted.length,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      maxMs: sorted[sorted.length - 1]!,
    };
  }
}
