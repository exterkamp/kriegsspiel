import type { Paper } from '../../contracts';
export const categories = [
  'urgent',
  'scouts',
  'subordinates',
  'staff',
  'intelligence',
  'rumour',
] as const;
const signature = (p: Paper) =>
  JSON.stringify([
    p.id,
    p.from,
    p.category,
    p.writtenAtGame,
    p.receivedAtGame,
    p.observedAtGame,
    p.location ? [p.location.x, p.location.y] : null,
    p.unitId,
    p.sizeEstimate,
    p.confidence,
    p.text,
  ]);
export function collectPapers(papers: readonly Paper[]) {
  const unique = new Map<string, Paper>();
  const conflicts = new Set<string>();
  let invalid = 0;
  for (const p of papers) {
    if (
      typeof p.id !== 'string' ||
      !p.id.length ||
      p.id.length > 128 ||
      !categories.includes(p.category) ||
      !Number.isFinite(p.receivedAtGame)
    ) {
      invalid++;
      continue;
    }
    const existing = unique.get(p.id);
    if (existing && signature(existing) !== signature(p)) conflicts.add(p.id);
    else if (!existing) unique.set(p.id, p);
  }
  for (const id of conflicts) unique.delete(id);
  return {
    papers: [...unique.values()].sort(
      (a, b) => b.receivedAtGame - a.receivedAtGame || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    ),
    conflicts: conflicts.size,
    invalid,
  };
}
export const gameDate = (value: number | null) =>
  value !== null && Number.isFinite(value) ? `Game time ${value} ms` : 'Unknown';
