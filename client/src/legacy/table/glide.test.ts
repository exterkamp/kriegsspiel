import { describe, expect, it } from 'vitest';
import { NO_GLIDES, drawnAt, glidePoint, gliding, nextGlides } from './glide.js';

const at = (entries: Array<[string, number, number]>) =>
  new Map(entries.map(([k, x, y]) => [k, { x, y }]));

describe('nextGlides', () => {
  it('places pieces at once the first time and when gliding is off', () => {
    const first = nextGlides(NO_GLIDES, at([['own:a', 0, 0]]), 0, 1500);
    expect(first.glides.size).toBe(0);
    const off = nextGlides(first, at([['own:a', 500, 0]]), 0, 0);
    expect(off.glides.size).toBe(0);
    expect(drawnAt(off, 'own:a', { x: 500, y: 0 }, 0)).toEqual({ x: 500, y: 0 });
  });

  it('slides a moved piece from its old place to its new one', () => {
    const s = nextGlides(
      nextGlides(NO_GLIDES, at([['own:a', 0, 0]]), 0, 1500),
      at([['own:a', 1000, 0]]),
      100,
      1500,
    );
    const to = { x: 1000, y: 0 };
    expect(drawnAt(s, 'own:a', to, 100)).toEqual({ x: 0, y: 0 });
    const mid = drawnAt(s, 'own:a', to, 850);
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.x).toBeLessThan(1000);
    expect(drawnAt(s, 'own:a', to, 1600)).toEqual(to);
    expect(gliding(s, 1000)).toBe(true);
    expect(gliding(s, 1600)).toBe(false);
  });

  it('does not glide a new piece or one that barely moved', () => {
    const before = nextGlides(NO_GLIDES, at([['own:a', 0, 0]]), 0, 1500);
    const s = nextGlides(
      before,
      at([
        ['own:a', 0.5, 0],
        ['ghost:r', 100, 100],
      ]),
      0,
      1500,
    );
    expect(s.glides.size).toBe(0);
  });

  it('starts a new glide from where a running one has got to', () => {
    let s = nextGlides(NO_GLIDES, at([['own:a', 0, 0]]), 0, 1000);
    s = nextGlides(s, at([['own:a', 1000, 0]]), 0, 1000);
    const halfway = glidePoint(s.glides.get('own:a')!, 500);
    s = nextGlides(s, at([['own:a', 1000, 1000]]), 500, 1000);
    expect(s.glides.get('own:a')!.from).toEqual(halfway);
  });

  it('keeps a running glide when the same positions are applied again', () => {
    let s = nextGlides(NO_GLIDES, at([['own:a', 0, 0]]), 0, 1000);
    s = nextGlides(s, at([['own:a', 1000, 0]]), 0, 1000);
    const again = nextGlides(s, at([['own:a', 1000, 0]]), 200, 1000);
    expect(again.glides.get('own:a')).toBe(s.glides.get('own:a'));
  });
});
