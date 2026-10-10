import type { SideView } from '@kriegsspiel/protocol';
import type { Facing, MapGrid, Terrain } from './types.js';

const LEGEND: Record<string, Terrain> = {
  '.': 'open',
  W: 'wood',
  '~': 'river',
  B: 'bridge',
  '=': 'road',
};

export function gridFromRows(rows: string[]): MapGrid {
  const width = rows[0]?.length ?? 0;
  const tiles: Terrain[] = [];
  for (const r of rows) for (const ch of r) tiles.push(LEGEND[ch] ?? 'open');
  return { width, height: rows.length, tiles };
}

/** Small copy of the "Hold the Bridge" layout, so the client runs with no server. */
export const fixtureMap: MapGrid = gridFromRows([
  '....................=...................',
  '....................=...................',
  '......WWWWWWW.......=...................',
  '......WWWWWWW.......=...................',
  '......WWWWWWW.......=...................',
  '....................=...................',
  '....................=...................',
  '~~~~~~~~~~~~~~~~~~~~B~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~B~~~~~~~~~~~~~~~~~~~',
  '....................=...................',
  '....................=...................',
  '....................=......WWWWWWW......',
  '....................=......WWWWWWW......',
  '....................=......WWWWWWW......',
  '....................=...................',
  '....................=...................',
]);

export const fixtureFacings: Record<string, Facing> = {
  'blue-1': 'N',
  'blue-2': 'NE',
  'blue-3': 'E',
};

/** Positions in metres, as on the wire. The table still draws a tile display map (see sceneState). */
export const fixtureView: SideView = {
  side: 'blue',
  atGame: 3_600_000,
  ownUnits: [
    {
      id: 'blue-1',
      name: '1st Battalion',
      position: { x: 1850, y: 1250 },
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
      position: { x: 2250, y: 1350 },
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
      position: { x: 2050, y: 1450 },
      facing: Math.PI / 2,
      formation: 'line',
      footprint: { frontage: 50, depth: 10 },
      strength: 200,
      morale: 0.85,
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
