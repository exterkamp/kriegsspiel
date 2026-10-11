import { describe, expect, it } from 'vitest';
import {
  ROAD_CLASS_COST,
  SAMPLE_TERRAIN,
  ScenarioError,
  findPath,
  mm,
  parseTerrain,
  pointMm,
  rasterise,
  terrainAt,
} from './index.js';

const sample = () => parseTerrain(SAMPLE_TERRAIN);
const P = pointMm;

describe('annotated terrain layer', () => {
  it('rasterises the sample annotation to the expected grid', () => {
    const r = rasterise(sample(), mm(10));
    expect([r.cols, r.rows]).toEqual([20, 10]);
    expect(r.rows_).toEqual([
      '::::::...ff.........',
      '::::::...ff.........',
      '.........~~.........',
      '.........~~.........',
      'HHHHHHHHH==HHHHHHHHH',
      'HHHHHHHHH==HHHHHHHHH',
      '..bb.....~~.wwwwww..',
      '..bb.....~~.wwwwww..',
      ',,,,,,,,,~~.wwwwww..',
      ',,,,,,,,,~~.........',
    ]);
  });

  it('carries height tags, road classes, capacity and risk through', () => {
    const m = sample();
    const by = (id: string) => m.features.find((f) => f.id === id)!;
    expect(by('ridge').attrs.height).toBe('high');
    expect(by('wood').attrs.height).toBe('rise');
    expect(terrainAt(m, P(30, 10))?.attrs.height).toBe('high');
    expect(by('highway').attrs.moveCost).toBe(ROAD_CLASS_COST.highway);
    expect(by('track').attrs.moveCost).toBe(ROAD_CLASS_COST.track);
    expect(by('bridge').capacity).toBe(mm(6));
    expect(by('ford').risk).toBe(0.3);
    expect(by('ford').attrs.moveCost).toBeGreaterThan(by('bridge').attrs.moveCost);
  });

  it('rejects attributes on the wrong kind of feature', () => {
    const bad = (extra: object) =>
      parseTerrain({
        width: 10,
        height: 10,
        features: [
          {
            id: 'x',
            kind: 'wood',
            polygon: [
              [1, 1],
              [5, 1],
              [5, 5],
            ],
            ...extra,
          },
        ],
      });
    expect(() => bad({ roadClass: 'highway' })).toThrow(ScenarioError);
    expect(() => bad({ capacity: 5 })).toThrow(ScenarioError);
    expect(() => bad({ risk: 0.5 })).toThrow(ScenarioError);
    expect(() =>
      parseTerrain({
        width: 10,
        height: 10,
        features: [
          {
            id: 'r',
            kind: 'road',
            roadClass: 'motorway',
            polyline: [
              [0, 0],
              [9, 9],
            ],
            width: 2,
          },
        ],
      }),
    ).toThrow(/roadClass/);
  });
});

describe('pathfinding over the annotation', () => {
  const road = (cls: string, y: number) => ({
    id: `r${y}`,
    kind: 'road',
    roadClass: cls,
    polyline: [
      [0, y],
      [1000, y],
    ],
    width: 4,
  });

  it('prefers a better road class over an equally short worse one', () => {
    const m = parseTerrain({
      width: 1000,
      height: 100,
      features: [road('track', 20), road('highway', 80)],
    });
    const onHighway = findPath(m, P(0, 80), P(1000, 80))!;
    const onTrack = findPath(m, P(0, 20), P(1000, 20))!;
    expect(onHighway.cost).toBeLessThan(onTrack.cost);
    // From the middle, going end to end over the highway beats the straight line over open ground.
    expect(findPath(m, P(0, 50), P(1000, 50))!.waypoints.some((w) => w.y === mm(80))).toBe(true);
  });

  const river = {
    width: 400,
    height: 200,
    features: [
      {
        id: 'river',
        kind: 'river',
        polyline: [
          [200, 0],
          [200, 200],
        ],
        width: 20,
      },
    ] as object[],
  };
  const withCrossings = (...crossings: object[]) =>
    parseTerrain({ ...river, features: [...river.features, ...crossings] });

  it('keeps a wide column off a bridge whose capacity is too small', () => {
    const m = withCrossings({
      id: 'b',
      kind: 'bridge',
      at: { x: 200, y: 100 },
      radius: 15,
      capacity: 6,
    });
    expect(findPath(m, P(50, 100), P(350, 100), { width: mm(5) })).not.toBeNull();
    expect(findPath(m, P(50, 100), P(350, 100), { width: mm(10) })).toBeNull();
  });

  it('crosses a ford, slower than a bridge, and only where there is no bridge', () => {
    const ford = { id: 'f', kind: 'ford', at: { x: 200, y: 40 }, radius: 15, risk: 0.4 };
    const bridge = { id: 'b', kind: 'bridge', at: { x: 200, y: 160 }, radius: 15 };
    const viaFord = findPath(withCrossings(ford), P(50, 40), P(350, 40))!;
    const viaBridge = findPath(withCrossings(bridge), P(50, 40), P(350, 40))!;
    expect(viaFord).not.toBeNull();
    expect(viaFord.waypoints.every((w) => Math.abs(w.y - mm(40)) <= mm(15))).toBe(true);
    // The ford is dearer per metre than the bridge, so over the same river it costs more.
    const fordOnly = findPath(
      withCrossings({ ...ford, at: { x: 200, y: 100 } }),
      P(50, 100),
      P(350, 100),
    )!;
    const bridgeOnly = findPath(
      withCrossings({ ...bridge, at: { x: 200, y: 100 } }),
      P(50, 100),
      P(350, 100),
    )!;
    expect(fordOnly.cost).toBeGreaterThan(bridgeOnly.cost);
    expect(viaBridge).not.toBeNull();
    // With both, a start beside the ford still takes the ford when the bridge detour is longer.
    const both = findPath(withCrossings(ford, bridge), P(50, 40), P(350, 40))!;
    expect(both.cost).toBeLessThanOrEqual(viaFord.cost);
  });
});
