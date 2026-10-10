import type { SideView } from '@kriegsspiel/protocol';
import type { BaseMap } from './types.js';

/** Small copy of the "Hold the Bridge" map (4000 x 3000 m), so the client runs with no server. */
export const fixtureMap: BaseMap = {
  width: 4000,
  height: 3000,
  features: [
    {
      id: 'north-wood',
      kind: 'wood',
      geometry: {
        shape: 'polygon',
        points: [
          { x: 600, y: 300 },
          { x: 1300, y: 350 },
          { x: 1250, y: 900 },
          { x: 650, y: 850 },
        ],
      },
    },
    {
      id: 'south-wood',
      kind: 'wood',
      geometry: {
        shape: 'polygon',
        points: [
          { x: 2700, y: 1900 },
          { x: 3400, y: 1950 },
          { x: 3350, y: 2500 },
          { x: 2750, y: 2450 },
        ],
      },
    },
    {
      id: 'river',
      kind: 'river',
      geometry: {
        shape: 'polyline',
        points: [
          { x: 0, y: 1500 },
          { x: 4000, y: 1500 },
        ],
        width: 200,
      },
    },
    {
      id: 'high-road',
      kind: 'road',
      geometry: {
        shape: 'polyline',
        points: [
          { x: 2050, y: 0 },
          { x: 2050, y: 3000 },
        ],
        width: 20,
      },
    },
    {
      id: 'bridge',
      kind: 'bridge',
      geometry: { shape: 'point', at: { x: 2050, y: 1500 }, radius: 110 },
    },
  ],
};

/** Positions in metres and facings in compass radians, as on the wire. */
export const fixtureView: SideView = {
  side: 'blue',
  atGame: 3_600_000,
  ownUnits: [
    {
      id: 'blue-1',
      name: '1st Battalion',
      position: { x: 1850, y: 2450 },
      facing: 0,
      formation: 'line',
      footprint: { frontage: 85, depth: 8 },
      strength: 600,
      morale: 0.8,
      supply: 1,
    },
    {
      id: 'blue-2',
      name: '2nd Battalion',
      position: { x: 2250, y: 2550 },
      facing: Math.PI / 4,
      formation: 'line',
      footprint: { frontage: 80, depth: 8 },
      strength: 550,
      morale: 0.75,
      supply: 1,
    },
    {
      id: 'blue-3',
      name: 'Cavalry Squadron',
      position: { x: 2050, y: 2750 },
      facing: Math.PI / 2,
      formation: 'line',
      footprint: { frontage: 50, depth: 10 },
      strength: 200,
      morale: 0.85,
      supply: 1,
    },
    {
      // An irregular formation: a skirmish screen bowed along the edge of the southern wood.
      id: 'blue-4',
      name: 'Light Company',
      position: { x: 2700, y: 2200 },
      facing: (3 * Math.PI) / 4,
      formation: 'skirmish',
      footprint: { frontage: 300, depth: 60 },
      shape: [
        { x: -140, y: -20 },
        { x: -70, y: 10 },
        { x: 0, y: 20 },
        { x: 70, y: 0 },
        { x: 140, y: -30 },
      ],
      strength: 120,
      morale: 0.7,
      supply: 1,
    },
  ],
  visibleEnemies: [],
  lastKnownContacts: [
    {
      id: 'contact-1',
      position: { x: 2150, y: 350 },
      observedAtGame: 1_800_000,
      ageMs: 1_800_000,
      uncertaintyRadius: 3000,
      sizeEstimate: 'a battalion',
    },
    {
      id: 'contact-2',
      position: { x: 950, y: 450 },
      observedAtGame: 0,
      ageMs: 3_600_000 + 600_000,
      uncertaintyRadius: 4200,
    },
  ],
  dispatches: [],
  clock: { gameMsAtAnchor: 3_600_000, wallMsAtAnchor: 0, rate: 1, status: 'paused' },
};
