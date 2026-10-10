/**
 * "Hold the Bridge" raw scenario data. Plain JSON-compatible; `loadScenario` validates it.
 * All lengths are metres on a 4000 x 3000 m plane (x east, y south). Units stand at free
 * positions with a compass facing in degrees (0 is north, 90 east); their footprints come
 * from their formation unless given.
 */
export const holdTheBridge = {
  id: 'hold-the-bridge',
  name: 'Hold the Bridge',
  seed: 1815,
  map: {
    width: 4000,
    height: 3000,
    features: [
      {
        id: 'north-wood',
        kind: 'wood',
        name: 'Northern wood',
        polygon: [
          [600, 300],
          [1300, 350],
          [1250, 900],
          [650, 850],
        ],
      },
      {
        id: 'south-wood',
        kind: 'wood',
        name: 'Southern wood',
        polygon: [
          [2700, 1900],
          [3400, 1950],
          [3350, 2500],
          [2750, 2450],
        ],
      },
      {
        id: 'river',
        kind: 'river',
        name: 'The river',
        polyline: [
          [0, 1500],
          [4000, 1500],
        ],
        width: 200,
      },
      {
        id: 'high-road',
        kind: 'road',
        name: 'High road',
        polyline: [
          [2050, 0],
          [2050, 3000],
        ],
        width: 20,
      },
      { id: 'bridge', kind: 'bridge', name: 'The bridge', at: { x: 2050, y: 1500 }, radius: 110 },
    ],
  },
  sides: [
    { id: 'blue', name: 'Blue', controller: 'human', hq: { x: 2050, y: 2950 } },
    { id: 'red', name: 'Red', controller: 'scripted', hq: { x: 2050, y: 50 } },
  ],
  units: [
    {
      id: 'blue-1',
      side: 'blue',
      kind: 'infantry',
      name: '1st Battalion',
      at: { x: 1850, y: 2450 },
      facingDeg: 0,
      formation: 'line',
      strength: 600,
      morale: 80,
    },
    {
      id: 'blue-2',
      side: 'blue',
      kind: 'infantry',
      name: '2nd Battalion',
      at: { x: 2250, y: 2550 },
      facingDeg: 0,
      formation: 'line',
      strength: 550,
      morale: 75,
    },
    {
      id: 'blue-3',
      side: 'blue',
      kind: 'cavalry',
      name: 'Cavalry Squadron',
      at: { x: 2050, y: 2750 },
      facingDeg: 0,
      formation: 'line',
      strength: 200,
      morale: 85,
    },
    {
      id: 'red-1',
      side: 'red',
      kind: 'infantry',
      name: 'Vanguard Battalion',
      at: { x: 1950, y: 450 },
      facingDeg: 180,
      formation: 'line',
      strength: 650,
      morale: 80,
    },
    {
      id: 'red-2',
      side: 'red',
      kind: 'infantry',
      name: 'Line Battalion',
      at: { x: 2250, y: 250 },
      facingDeg: 180,
      formation: 'line',
      strength: 650,
      morale: 70,
    },
    {
      id: 'red-3',
      side: 'red',
      kind: 'cavalry',
      name: 'Hussar Squadron',
      at: { x: 1550, y: 550 },
      facingDeg: 180,
      formation: 'line',
      strength: 220,
      morale: 85,
    },
  ],
  victory: {
    objective: [
      [2020, 1470],
      [2080, 1470],
      [2080, 1530],
      [2020, 1530],
    ],
    defender: 'blue',
    attacker: 'red',
    holdMinutes: 180,
  },
};
