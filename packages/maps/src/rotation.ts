import type { Point, Site } from './contract.js';

/**
 * Whole-degree rotations without runtime trigonometry (#545, D50). Settlement
 * sites turn by whole degrees; their frames read sine and cosine from this
 * literal table (correctly rounded binary64 values of sin k°, k = 0…90), so
 * generation and saved validation get the same bits on every runtime.
 */
const SIN_DEGREES: readonly number[] = Object.freeze([
  0, 0.01745240643728351, 0.03489949670250097, 0.052335956242943835, 0.0697564737441253,
  0.08715574274765818, 0.10452846326765347, 0.12186934340514748, 0.13917310096006544,
  0.15643446504023087, 0.17364817766693036, 0.1908089953765448, 0.20791169081775934,
  0.224951054343865, 0.24192189559966773, 0.25881904510252074, 0.27563735581699916,
  0.2923717047227367, 0.30901699437494745, 0.32556815445715664, 0.3420201433256687,
  0.35836794954530027, 0.374606593415912, 0.39073112848927377, 0.4067366430758002,
  0.42261826174069944, 0.4383711467890774, 0.4539904997395468, 0.46947156278589075,
  0.484809620246337, 0.5, 0.5150380749100542, 0.5299192642332049, 0.5446390350150271,
  0.5591929034707468, 0.573576436351046, 0.5877852522924731, 0.6018150231520483, 0.6156614753256583,
  0.6293203910498375, 0.6427876096865394, 0.6560590289905073, 0.6691306063588582,
  0.6819983600624985, 0.6946583704589973, 0.7071067811865476, 0.7193398003386512,
  0.7313537016191705, 0.7431448254773942, 0.754709580222772, 0.766044443118978, 0.7771459614569709,
  0.7880107536067219, 0.7986355100472928, 0.8090169943749475, 0.8191520442889918,
  0.8290375725550417, 0.838670567945424, 0.848048096156426, 0.8571673007021123, 0.8660254037844386,
  0.8746197071393959, 0.882947592858927, 0.8910065241883679, 0.898794046299167, 0.9063077870366499,
  0.9135454576426009, 0.9205048534524404, 0.9271838545667874, 0.9335804264972017,
  0.9396926207859084, 0.9455185755993168, 0.9510565162951535, 0.9563047559630354,
  0.9612616959383189, 0.9659258262890683, 0.9702957262759965, 0.9743700647852352,
  0.9781476007338057, 0.981627183447664, 0.984807753012208, 0.9876883405951378, 0.9902680687415704,
  0.992546151641322, 0.9945218953682733, 0.9961946980917455, 0.9975640502598242, 0.9986295347545738,
  0.9993908270190958, 0.9998476951563913, 1,
]);

/** Unit vector [cos θ, sin θ] for a whole-degree θ in [0, 360), else undefined. */
export function degreeUnit(degrees: number): Point | undefined {
  if (!Number.isInteger(degrees) || degrees < 0 || degrees >= 360) return undefined;
  const k = degrees % 90,
    s = SIN_DEGREES[k]!,
    c = SIN_DEGREES[90 - k]!;
  // `0 - v` keeps exact quarter turns free of negative zeros.
  switch (Math.floor(degrees / 90)) {
    case 0:
      return [c, s];
    case 1:
      return [0 - s, c];
    case 2:
      return [0 - c, 0 - s];
    default:
      return [s, 0 - c];
  }
}

/**
 * The whole degree in [0, 90) whose square best matches a quarter-turn
 * orientation given as [cos 4φ, sin 4φ] (any length): the k maximising
 * cos(4k − 4φ). Ties go to the smaller k. A zero vector gives undefined.
 */
export function quarterTurnDegrees(v: Point): number | undefined {
  if (!(v[0] * v[0] + v[1] * v[1] > 0)) return undefined;
  let best = 0,
    score = -Infinity;
  for (let k = 0; k < 90; k++) {
    const [c, s] = degreeUnit(4 * k)!,
      dot = c * v[0] + s * v[1];
    if (dot > score) {
      score = dot;
      best = k;
    }
  }
  return best;
}

/**
 * [cos 4φ, sin 4φ] for the direction φ of a vector, by the double-angle
 * identities (square roots and products only). A square's sides are the same
 * under quarter turns, so directions are combined in this space.
 */
export function quarterTurnVector(dx: number, dy: number): Point {
  const m = dx * dx + dy * dy;
  if (!(m > 0)) return [0, 0];
  const c2 = (dx * dx - dy * dy) / m,
    s2 = (2 * dx * dy) / m;
  return [c2 * c2 - s2 * s2, 2 * c2 * s2];
}

/**
 * Width and height of a site's ring in its own frame (#545). A site turned by
 * a whole number of quarter turns, or by no whole degree, is measured on the
 * world axes exactly as before.
 */
export function siteFrameExtents(
  site: Pick<Site, 'anchor' | 'rotationDeg' | 'placementArea'>,
): [number, number] {
  const unit = site.rotationDeg % 90 === 0 ? undefined : degreeUnit(site.rotationDeg);
  if (!unit) {
    // Exactly the world-axis measure that saved maps were certified with.
    const xs = site.placementArea.outer.map((p) => p[0]),
      ys = site.placementArea.outer.map((p) => p[1]);
    return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  }
  const [c, s] = unit,
    [x, y] = site.anchor;
  let minU = Infinity,
    maxU = -Infinity,
    minV = Infinity,
    maxV = -Infinity;
  for (const p of site.placementArea.outer) {
    const dx = p[0] - x,
      dy = p[1] - y,
      u = c * dx + s * dy,
      v = c * dy - s * dx;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  return [maxU - minU, maxV - minV];
}
