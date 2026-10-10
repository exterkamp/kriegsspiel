import type { Paper } from '../../contracts';

export const categories = [
  'urgent',
  'scouts',
  'subordinates',
  'staff',
  'intelligence',
  'rumour',
] as const;
export type Filter = 'all' | 'papers' | 'notes' | Paper['category'];
const fingerprint = (paper: Paper) =>
  JSON.stringify([
    paper.id,
    paper.from,
    paper.category,
    paper.writtenAtGame,
    paper.receivedAtGame,
    paper.observedAtGame,
    paper.location?.x ?? null,
    paper.location?.y ?? null,
    paper.unitId,
    paper.sizeEstimate,
    paper.confidence,
    paper.text,
  ]);
export function suppliedPapers(papers: readonly Paper[]) {
  const unique = new Map<string, Paper>();
  const conflicts = new Set<string>();
  for (const paper of papers) {
    const prior = unique.get(paper.id);
    if (prior && fingerprint(prior) !== fingerprint(paper)) conflicts.add(paper.id);
    else unique.set(paper.id, paper);
  }
  return {
    papers: [...unique.values()]
      .filter((paper) => !conflicts.has(paper.id))
      .sort(
        (a, b) => a.receivedAtGame - b.receivedAtGame || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      ),
    conflicts: conflicts.size,
  };
}
export function matchesPaper(paper: Paper, query: string, filter: Filter) {
  return (
    filter !== 'notes' &&
    (filter === 'all' || filter === 'papers' || filter === paper.category) &&
    [paper.id, paper.from, paper.category, paper.text].some((text) =>
      text.toLowerCase().includes(query.trim().toLowerCase()),
    )
  );
}
export function gameTime(ms: number) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')} (${ms} game ms)`;
}
export function paperText(paper: Paper) {
  return `[${paper.id}] ${paper.category} — ${paper.from}\nWritten: ${gameTime(paper.writtenAtGame)}\nReceived: ${gameTime(paper.receivedAtGame)}\nObserved: ${paper.observedAtGame === null ? 'unavailable' : gameTime(paper.observedAtGame)}\n${paper.text}`;
}
