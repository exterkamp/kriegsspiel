import type { GameState, SideId } from '@kriegsspiel/engine';

/**
 * What a side must never read in an LLM's words (#44): the name and commander of every unit of the
 * other side. The view gives an enemy only an id and a coarse size, so neither is ever in a prompt;
 * a model that produces one has made it up or been fed it elsewhere, and the reply is refused.
 * Exact figures are not listed, since a figure also matches ordinary numbers: the prose check
 * (`checkProseAgainst`) refuses any number the model was not shown. Ids are checked by each stage
 * against the ids its input holds.
 */
export function hiddenTerms(world: GameState, side: SideId): string[] {
  return world.units
    .filter((u) => u.side !== side)
    .flatMap((u) => [u.name, ...(u.commander ? [u.commander] : [])])
    .filter((t) => t.trim() !== '');
}

/** The terms found in `text`, as problems. Names match as whole words, ignoring case. */
export function hiddenIn(text: string, terms: readonly string[]): string[] {
  const hits = terms.filter((t) => {
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text);
  });
  return [...new Set(hits)].map((t) => `names the other side ("${t}")`);
}
