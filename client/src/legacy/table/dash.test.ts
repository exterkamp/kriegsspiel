import { describe, expect, it } from 'vitest';
import { dashPolyline } from './dash';

describe('dashPolyline', () => {
  it('cuts a straight line into dashes and gaps', () => {
    const d = dashPolyline(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      10,
      10,
    );
    expect(d).toHaveLength(5);
    expect(d[0]).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(d[1]![0]).toEqual({ x: 20, y: 0 });
  });
  it('keeps a corner inside the dash that crosses it', () => {
    const d = dashPolyline(
      [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 20 },
      ],
      10,
      5,
    );
    expect(d[0]).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
    ]);
  });
  it('returns nothing for a single point', () => {
    expect(dashPolyline([{ x: 1, y: 1 }], 1, 1)).toEqual([]);
  });
});
