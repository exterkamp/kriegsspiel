import type { WindowAt, WindowEvent, WindowMark } from '@kriegsspiel/protocol';
import { formatAge, buildSceneState } from '../table/sceneState.js';
import type { BaseMap, SceneState } from '../table/types.js';

/** Whose belief to draw over the true positions: neither, or one side's. */
export type BeliefChoice = 'none' | 'blue' | 'red';

/**
 * The map table at one moment of the replay: every unit where it truly stood, and, if asked, the
 * enemy as one side believed it (live sightings and aged ghosts with their uncertainty rings).
 */
export function buildWindowScene(frame: WindowAt, belief: BeliefChoice, map: BaseMap): SceneState {
  const b = belief === 'none' ? undefined : frame.beliefs[belief];
  const ghosts = buildSceneState(
    {
      side: belief === 'none' ? 'blue' : belief,
      atGame: frame.gameMs,
      ownUnits: [],
      visibleEnemies: b?.visibleEnemies ?? [],
      lastKnownContacts: b?.lastKnownContacts ?? [],
      dispatches: [],
      clock: { gameMsAtAnchor: frame.gameMs, wallMsAtAnchor: 0, rate: 1, status: 'stopped' },
    },
    map,
  ).ghosts;
  return {
    side: belief === 'none' ? 'blue' : belief,
    map,
    own: frame.units
      .filter((u) => u.strength > 0)
      .map((u) => ({
        kind: 'own',
        id: u.id,
        label: u.name,
        side: u.side,
        position: u.position,
        facing: u.facing,
        formation: u.formation,
        footprint: u.footprint,
        ...(u.shape ? { shape: u.shape } : {}),
      })),
    ghosts,
    orderRoutes: [],
  };
}

/** How far back a unit's hover note looks, in game time. */
export const NOTE_WINDOW_MS = 30 * 60_000;

interface Fire {
  attacker: string;
  target: string;
  distance: number;
  cover: unknown;
  aspect: unknown;
  melee: boolean;
  die: number;
  casualties: number;
}

const isFire = (e: WindowEvent): e is WindowEvent & { payload: Fire } =>
  e.type === 'combat.fire' && typeof e.payload === 'object' && e.payload !== null;

/** What happened to a unit lately: the dice, their modifiers and the umpire's rulings about it. */
export function unitNotes(frame: WindowAt, unitId: string): string[] {
  const since = frame.gameMs - NOTE_WINDOW_MS;
  const names = new Map(frame.units.map((u) => [u.id, u.name]));
  const name = (id: string) => names.get(id) ?? id;
  const notes: string[] = [];
  for (const e of frame.events) {
    if (e.time < since) continue;
    if (isFire(e) && (e.payload.attacker === unitId || e.payload.target === unitId)) {
      const p = e.payload;
      const mods = [
        p.melee ? 'melee' : `range ${p.distance} km`,
        p.cover ? `cover ${String(p.cover)}` : undefined,
        p.aspect ? `${String(p.aspect)} aspect` : undefined,
      ].filter(Boolean);
      notes.push(
        `${formatAge(frame.gameMs - e.time).replace(' old', ' ago')}: ${name(p.attacker)} fired on ${name(p.target)}. Die ${p.die}, ${mods.join(', ')}; ${Math.round(p.casualties)} casualties.`,
      );
    }
  }
  for (const r of frame.rulings) {
    if (r.unitId === unitId && r.time >= since)
      notes.push(`Ruling: ${r.narrative} (${r.rationale})`);
  }
  return notes;
}

/** The index of the first mark strictly after `ms` (or before, if `dir` is -1), or -1. */
export function stepMark(marks: readonly WindowMark[], ms: number, dir: 1 | -1): number {
  if (dir > 0) return marks.findIndex((m) => m.ms > ms);
  for (let i = marks.length - 1; i >= 0; i--) if (marks[i]!.ms < ms) return i;
  return -1;
}
