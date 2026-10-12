import { describe, expect, it } from 'vitest';
import { arrowHead, pieceCorners, screenToMap, stackLabels } from './flatBoard';
import type { OwnPiece } from './types';

const map = { width: 4000, height: 3000, features: [] };
const piece = (facing: number): OwnPiece => ({
  kind: 'own',
  id: 'u',
  label: 'U',
  side: 'blue',
  position: { x: 1000, y: 1000 },
  facing,
  formation: 'line',
  footprint: { frontage: 200, depth: 100 },
});

describe('flat board geometry', () => {
  it('puts the front of a north-facing piece at the smaller y', () => {
    const [fl, fr, br] = pieceCorners(piece(0), map);
    expect(fl!.y).toBeCloseTo(950);
    expect(fr!.y).toBeCloseTo(950);
    expect(br!.y).toBeCloseTo(1050);
    expect(fr!.x - fl!.x).toBeCloseTo(200);
  });
  it('turns an east-facing piece so its front has the larger x', () => {
    const [fl] = pieceCorners(piece(Math.PI / 2), map);
    expect(fl!.x).toBeCloseTo(1050);
  });
  it('never draws a piece smaller than the minimum size', () => {
    const p = { ...piece(0), footprint: { frontage: 1, depth: 1 } };
    const [a, b] = pieceCorners(p, map);
    expect(b!.x - a!.x).toBeGreaterThan(40);
  });
  it('makes an arrow head at the tip, and none for a zero-length arrow', () => {
    const h = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 20);
    expect(h[0]).toEqual({ x: 100, y: 0 });
    expect(h).toHaveLength(3);
    expect(arrowHead({ x: 5, y: 5 }, { x: 5, y: 5 }, 20)).toEqual([]);
  });
  it('stacks two tags that would overlap and leaves distant ones', () => {
    const out = stackLabels(
      [
        { id: 'a', at: { x: 100, y: 100 }, w: 80 },
        { id: 'b', at: { x: 110, y: 100 }, w: 80 },
        { id: 'c', at: { x: 900, y: 100 }, w: 80 },
      ],
      30,
    );
    expect(out.get('a')).toEqual({ x: 100, y: 100 });
    expect(out.get('b')!.y).toBe(130);
    expect(out.get('c')).toEqual({ x: 900, y: 100 });
  });
  it('maps a screen point to metres through the centred fit', () => {
    const rect = { left: 10, top: 20, width: 800, height: 800 };
    // Scale 0.2: the 4000x3000 map fills the width and is centred vertically (100px bars above and below).
    expect(screenToMap(map, rect, 10, 120)).toEqual({ x: 0, y: 0 });
    expect(screenToMap(map, rect, 410, 420)).toEqual({ x: 2000, y: 1500 });
    expect(screenToMap(map, rect, 410, 30)).toBeUndefined();
  });
});
