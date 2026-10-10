import { SideView } from '@kriegsspiel/protocol';
import { describe, expect, it } from 'vitest';
import { fixtureMap, fixtureView } from './fixture.js';
import { FrameSampler, makePerformanceView, performanceSceneState } from './performanceFixture.js';
import { buildSceneState } from './sceneState.js';
import { ghostOpacity, tagLines } from './tagText.js';
import type { GhostPiece, OwnPiece } from './types.js';

const own: OwnPiece = {
  kind: 'own',
  id: 'own',
  label: '1st Battalion',
  side: 'blue',
  facing: 0,
  formation: 'line',
  footprint: { frontage: 80, depth: 8 },
  position: { x: 1, y: 1 },
};
const ghost: GhostPiece = {
  kind: 'ghost',
  id: 'contact',
  position: { x: 2, y: 1 },
  facing: 0,
  uncertaintyRadius: 0,
  ageMs: 0,
  ageTag: 'just now',
};

describe('paper tag knowledge', () => {
  it('labels missing strength and timestamps unavailable instead of inventing reports', () => {
    expect(tagLines(own)).toEqual([
      '1st Battalion',
      'Strength unavailable',
      'Snapshot time unavailable',
      'Report date unavailable',
    ]);
    expect(tagLines({ ...own, strength: 0, snapshotAtGame: 0 })).toContain('Strength: 0');
    expect(tagLines({ ...own, strength: 600, snapshotAtGame: 3_600_000 })).toContain(
      'Snapshot at 1:00:00 game',
    );
  });

  it('distinguishes fresh snapshots from stale observation age/date', () => {
    expect(tagLines({ ...ghost, snapshotAtGame: 3_600_000 })).toEqual([
      'Enemy contact',
      'Strength unavailable',
      'Snapshot at 1:00:00 game',
      'Report date unavailable',
    ]);
    expect(
      tagLines({
        ...ghost,
        ageMs: 30 * 60_000,
        observedAtGame: 1_800_000,
        snapshotAtGame: 3_600_000,
        ageTag: 'untrusted prose',
      }),
    ).toEqual([
      'Enemy contact',
      'Strength unavailable',
      'Observed 30m ago',
      'Observed at 0:30:00 game',
    ]);
    expect(tagLines({ ...ghost, ageMs: 30 * 60_000, snapshotAtGame: 3_600_000 })[3]).toBe(
      'Report date unavailable',
    );
  });

  it('bounds untrusted label text and treats invalid numeric metadata as unavailable', () => {
    expect(tagLines({ ...own, label: 'x'.repeat(1000) })[0]).toHaveLength(42);
    expect(tagLines({ ...own, strength: NaN, snapshotAtGame: Infinity })).toContain(
      'Strength unavailable',
    );
    expect(tagLines({ ...ghost, ageMs: -1, observedAtGame: -1 })).toContain(
      'Observation age unavailable',
    );
  });

  it('carries actual source snapshot/observation metadata with continuous metre coordinates', () => {
    const state = buildSceneState(fixtureView, fixtureMap);
    expect(state.own[0]).toMatchObject({
      snapshotAtGame: fixtureView.atGame,
      strength: fixtureView.ownUnits[0]!.strength,
      position: { x: 1850, y: 2450 },
      facing: 0,
      formation: 'line',
      footprint: fixtureView.ownUnits[0]!.footprint,
    });
    expect(state.ghosts[0]).toMatchObject({
      observedAtGame: 1_800_000,
      snapshotAtGame: fixtureView.atGame,
    });
  });
});

describe('stale visual styling', () => {
  it('fades monotonically with supplied game age and preserves a visible minimum', () => {
    expect(ghostOpacity(0)).toBeGreaterThan(ghostOpacity(30 * 60_000));
    expect(ghostOpacity(30 * 60_000)).toBeGreaterThan(ghostOpacity(2 * 3_600_000));
    expect(ghostOpacity(2 * 3_600_000)).toBeCloseTo(0.2);
    expect(ghostOpacity(Number.MAX_SAFE_INTEGER)).toBeCloseTo(0.2);
    expect(Number.isFinite(ghostOpacity(NaN))).toBe(true);
  });
});

describe('performance fixture and measurement preparation', () => {
  it('supplies 60 unique schema-valid pieces for either side with consistent stale ages', () => {
    for (const side of ['blue', 'red']) {
      const view = makePerformanceView(side);
      expect(SideView.safeParse(view).success).toBe(true);
      expect(view.side).toBe(side);
      const all = [...view.ownUnits, ...view.visibleEnemies, ...view.lastKnownContacts];
      expect(all).toHaveLength(60);
      expect(new Set(all.map((unit) => unit.id)).size).toBe(60);
      for (const contact of view.lastKnownContacts)
        expect(contact.ageMs).toBe(view.atGame - contact.observedAtGame);
      for (const unit of all) {
        expect(unit.position.x).toBeLessThan(fixtureMap.width);
        expect(unit.position.y).toBeLessThan(fixtureMap.height);
      }
    }
    expect(performanceSceneState.own.length + performanceSceneState.ghosts.length).toBe(60);
  });

  it('reports intervals/percentiles from explicit timestamps without installing timers', () => {
    const sampler = new FrameSampler();
    expect(sampler.summary()).toBeNull();
    [100, 116, 132, 172].forEach((timestamp) => sampler.sample(timestamp));
    expect(sampler.summary()).toEqual({
      intervals: 3,
      elapsedMs: 72,
      meanIntervalMs: 24,
      p50Ms: 16,
      p95Ms: 40,
      p99Ms: 40,
      maxMs: 40,
    });
    expect(() => sampler.sample(171)).toThrow(RangeError);
    expect(() => sampler.sample(Infinity)).toThrow(RangeError);
    expect(sampler.summary()!.intervals).toBe(3);
  });
});
