import type { Arm, Order, Point, Scenario, Side, Unit } from './sim';

/**
 * The spike's scenario: 3 km by 2 km, north up, a river across the middle with one bridge, a wood on the far bank and
 * a road through the bridge. Blue (the player) holds the south bank; red comes from the north. Four units a side.
 */
const W = 3000;
const H = 2000;
const riverY = (x: number) => 1000 + 60 * Math.sin(x / 480);
const BRIDGE: Point = { x: 1500, y: riverY(1500) };

const river: Point[] = Array.from({ length: 31 }, (_, i) => ({ x: i * 100, y: riverY(i * 100) }));

function unit(
  id: string,
  side: Side,
  arm: Arm,
  name: string,
  short: string,
  x: number,
  y: number,
  strength: number,
  morale: number,
): Unit {
  return {
    id,
    side,
    name,
    short,
    arm,
    pos: { x, y },
    facing: side === 'blue' ? 0 : Math.PI,
    strength,
    startStrength: strength,
    morale,
    home: { x, y: side === 'blue' ? H - 40 : 40 },
    order: { verb: 'hold', waypoints: [] },
    stage: 'fresh',
  };
}

const to = (x: number, y: number): Point => ({ x, y });
const move = (x: number, y: number): Order => ({ verb: 'move', waypoints: [to(x, y)] });

export function spikeScenario(): Scenario {
  return {
    width: W,
    height: H,
    startMinute: 10 * 60,
    crossings: [BRIDGE],
    riverY,
    features: [
      { id: 'river', kind: 'river', name: 'the Aa', points: river },
      {
        id: 'road',
        kind: 'road',
        name: 'the post road',
        points: [to(1500, 0), to(1500, 700), BRIDGE, to(1450, 1400), to(1400, H)],
      },
      {
        id: 'wood',
        kind: 'wood',
        name: 'Brandt wood',
        points: [to(1950, 430), to(2450, 450), to(2520, 780), to(2200, 860), to(1940, 820)],
      },
      { id: 'bridge', kind: 'bridge', name: 'the bridge', points: [BRIDGE] },
    ],
    units: [
      unit('b1', 'blue', 'infantry', '1st Battalion', '1/12', 1350, 1650, 600, 80),
      unit('b2', 'blue', 'infantry', '2nd Battalion', '2/12', 1750, 1700, 550, 75),
      unit('b3', 'blue', 'cavalry', 'Hussar Squadron', 'H/3', 2150, 1800, 200, 85),
      unit('b4', 'blue', 'artillery', 'Foot Battery', 'B/4', 1550, 1850, 140, 80),
      unit('r1', 'red', 'infantry', 'Vanguard Battalion', 'V/9', 1450, 250, 650, 80),
      unit('r2', 'red', 'infantry', 'Line Battalion', 'L/9', 2250, 200, 650, 70),
      unit('r3', 'red', 'cavalry', 'Uhlan Squadron', 'U/2', 2750, 300, 220, 85),
      unit('r4', 'red', 'artillery', 'Horse Battery', 'HB', 1250, 150, 120, 80),
    ],
    redScript: {
      1: {
        r1: move(1500, 800),
        r2: move(2180, 640),
        r3: move(2650, 820),
        r4: move(1300, 640),
      },
      2: {
        r1: { ...move(1440, 1260), note: 'Take the bridge and the rise beyond it.' },
        r2: { verb: 'hold', waypoints: [] },
        r3: { verb: 'screen', waypoints: [to(2650, 900)] },
        r4: { verb: 'hold', waypoints: [] },
      },
      3: {
        r3: move(2950, 150),
        r2: move(2050, 900),
      },
    },
    blueScript: {
      1: {
        b1: move(1430, 1220),
        b2: move(1800, 1300),
        b3: { verb: 'screen', waypoints: [to(2400, 1200)] },
        b4: move(1560, 1420),
      },
    },
  };
}
