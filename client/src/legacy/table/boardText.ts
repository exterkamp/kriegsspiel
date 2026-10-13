import type { BaseMap, SceneState } from './types.js';

/** Where a point is on the map, in words: a ninth of the map by compass, and metres from the north-west corner. */
export function whereText(map: BaseMap, p: { x: number; y: number }): string {
  const col = Math.min(2, Math.max(0, Math.floor((p.x / map.width) * 3)));
  const row = Math.min(2, Math.max(0, Math.floor((p.y / map.height) * 3)));
  const name = [
    ['north-west', 'north', 'north-east'],
    ['west', 'centre', 'east'],
    ['south-west', 'south', 'south-east'],
  ][row]![col]!;
  const m = (v: number) => Math.round(v / 50) * 50;
  return `${name}, ${m(p.x)} m east and ${m(p.y)} m south of the north-west corner`;
}

/** A text alternative to the flat board (#59): the same units, enemy sightings, fights and couriers as lines of text. */
export function boardLines(scene: SceneState | undefined, map: BaseMap): string[] {
  if (!scene) return ['No map yet.'];
  const lines = [
    ...scene.own.map((p) => `Your unit ${p.label}: ${whereText(map, p.position)}.`),
    ...scene.ghosts.map(
      (g) =>
        `Enemy ${g.id}${g.ageTag ? `, ${g.ageTag}` : ''}${g.sizeEstimate ? `, about ${g.sizeEstimate}` : ''}: ${whereText(map, g.position)}.`,
    ),
    ...(scene.engagements ?? []).map((f) => `Fighting: ${whereText(map, f.position)}.`),
    ...(scene.couriers ?? []).map(
      (c) =>
        `Courier${c.etaMin > 0 ? `, ${c.etaMin} min away` : ''}: ${whereText(map, c.position)}.`,
    ),
  ];
  return lines.length > 0 ? lines : ['Nothing on the map.'];
}
