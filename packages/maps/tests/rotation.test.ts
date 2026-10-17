import { describe, expect, it } from 'vitest';
import {
  degreeUnit,
  quarterTurnDegrees,
  quarterTurnVector,
  siteFrameExtents,
} from '../src/rotation.js';
import { orientedSquare, siteSides } from '../src/planning/sites.js';
import { polygonArea, polygonLocation } from '../src/geometry.js';
import { settlementFrame } from '../src/composition/frame.js';
import type { Point } from '../src/contract.js';

describe('whole-degree rotations without runtime trigonometry (#545)', () => {
  it('reads every whole degree from the literal table', () => {
    for (let d = 0; d < 360; d++) {
      const [c, s] = degreeUnit(d)!,
        t = (d * Math.PI) / 180;
      expect(Math.abs(c - Math.cos(t))).toBeLessThan(1e-15);
      expect(Math.abs(s - Math.sin(t))).toBeLessThan(1e-15);
    }
    expect(degreeUnit(0)).toEqual([1, 0]);
    expect(degreeUnit(90)).toEqual([0, 1]);
    expect(degreeUnit(180)).toEqual([-1, 0]);
    expect(degreeUnit(270)).toEqual([0, -1]);
    // Quarter turns carry no negative zeros.
    expect(Object.is(degreeUnit(90)![0], 0)).toBe(true);
    expect(degreeUnit(30)![1]).toBe(0.5);
    expect(degreeUnit(45)).toEqual([Math.SQRT1_2, Math.SQRT1_2]);
    for (const bad of [-1, 360, 12.5, NaN]) expect(degreeUnit(bad)).toBeUndefined();
  });

  it('combines directions modulo a quarter turn', () => {
    // East, north, west and south are the same square orientation.
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-3, 0],
      [0, -2],
    ])
      expect(quarterTurnDegrees(quarterTurnVector(dx!, dy!))).toBe(0);
    for (let d = 0; d < 360; d += 7) {
      const [c, s] = degreeUnit(d)!;
      expect(quarterTurnDegrees(quarterTurnVector(5 * c, 5 * s))).toBe(d % 90);
    }
    expect(quarterTurnVector(0, 0)).toEqual([0, 0]);
    expect(quarterTurnDegrees([0, 0])).toBeUndefined();
  });

  it('turns a site square without shrinking it below its recorded size', () => {
    for (const extent of [50, 100]) {
      expect(orientedSquare([1000, 1000], extent, 0).outer).toHaveLength(5);
      for (let d = 1; d < 90; d++) {
        const anchor: Point = [1234.5, 2345.25],
          placementArea = orientedSquare(anchor, extent, d),
          site = { anchor, rotationDeg: d, placementArea },
          [width, height] = siteFrameExtents(site);
        expect(placementArea.outer).toHaveLength(9);
        expect(Math.min(width, height)).toBeGreaterThanOrEqual(extent);
        expect(Math.max(width, height)).toBeLessThan(extent + 1e-5);
        expect(polygonArea(placementArea)).toBeGreaterThanOrEqual(extent * extent);
        // Entrances are exact ring vertices, leaving along each side's normal.
        for (const [i, side] of siteSides(site).entries()) {
          expect(polygonLocation(side.point, placementArea)).toBe('boundary');
          expect(side.bearingDeg).toBe(d + 90 * i);
          const [c, s] = degreeUnit(side.bearingDeg)!;
          expect(side.normal[0]).toBeCloseTo(s, 15);
          expect(side.normal[1]).toBeCloseTo(-c, 15);
          const out: Point = [side.point[0] + side.normal[0], side.point[1] + side.normal[1]];
          expect(polygonLocation(out, placementArea)).toBe('outside');
        }
        // The settlement frame maps the square to an axis-aligned local square.
        const f = settlementFrame(site),
          local = f.localPolygon(placementArea).outer;
        for (const p of local) {
          for (const v of [p.x, p.y])
            expect(Math.min(Math.abs(v), Math.abs(Math.abs(v) - extent / 2))).toBeLessThan(1e-5);
          expect(Math.max(Math.abs(p.x), Math.abs(p.y))).toBeCloseTo(extent / 2, 4);
        }
      }
    }
  });

  it('measures saved unturned sites on the world axes exactly as before', () => {
    const placementArea = {
      outer: [
        [0.1, 0.2],
        [100.1, 0.2],
        [100.1, 100.2],
        [0.1, 100.2],
        [0.1, 0.2],
      ] as Point[],
      holes: [],
    };
    for (const rotationDeg of [0, 90, 12.5])
      expect(siteFrameExtents({ anchor: [50.1, 50.2], rotationDeg, placementArea })).toEqual([
        100.1 - 0.1,
        100.2 - 0.2,
      ]);
  });
});
