import type { GameState, SideId } from '@kriegsspiel/engine';

/** Drops invisible format characters (zero-width spaces, joiners, bidi marks) and collapses runs of whitespace. */
export const squash = (s: string) => s.replace(/\p{Cf}/gu, '').replace(/\s+/gu, ' ');

/**
 * What a side must never read in an LLM's words (#44): the name and commander of every unit of the
 * other side. The view gives an enemy only an id and a coarse size, so neither is ever in a prompt;
 * a model that produces one has made it up or been fed it elsewhere, and the reply is refused.
 * A name made only of generic arm and size words ("Hussar Squadron") is not listed either
 * (`isDistinctive`, #524): describing an enemy by what he is, "a hussar squadron", is what a
 * commander who sees him may say, and it gives away nothing the view does not.
 * Exact figures are not listed, since a figure also matches ordinary numbers: the prose check
 * (`checkProseAgainst`) refuses any number the model was not shown. Ids are checked by each stage
 * against the ids its input holds.
 */
export function hiddenTerms(world: GameState, side: SideId): string[] {
  const termsOf = (u: GameState['units'][number]) => [
    u.name,
    ...(u.commander ? [u.commander] : []),
  ];
  // A term the side's own units also bear is the side's own wording, so it is not a leak.
  const own = new Set(
    world.units
      .filter((u) => u.side === side)
      .flatMap(termsOf)
      .map((t) => t.toLowerCase()),
  );
  return world.units
    .filter((u) => u.side !== side)
    .flatMap(termsOf)
    .filter((t) => t.trim() !== '' && !own.has(t.toLowerCase()) && isDistinctive(t));
}

/**
 * The words that only say what arm and size a body of troops is ("a hussar squadron", "a line
 * battalion", "the guns"), and the articles that join them. A commander may describe an enemy he
 * sees this way, so a name made of nothing else names no one (#524). Kept to arm, size and
 * formation words: anything else (a number, a colour, a place, a surname, "Vanguard") is a name.
 */
export const GENERIC_UNIT_WORDS: ReadonlySet<string> = new Set(
  [
    // articles and joining words
    'a an the of and',
    // arms and the men in them
    'infantry cavalry artillery horse foot line light heavy',
    'hussar hussars dragoon dragoons lancer lancers uhlan uhlans cuirassier cuirassiers',
    'chasseur chasseurs grenadier grenadiers fusilier fusiliers voltigeur voltigeurs',
    'jager jagers jäger jaeger jaegers rifle rifles rifleman riflemen skirmisher skirmishers',
    'musketeer musketeers gun guns gunner gunners cannon cannons battery batteries',
    'trooper troopers horseman horsemen soldier soldiers troop troops men',
    // sizes and formations
    'section sections platoon platoons company companies battalion battalions',
    'squadron squadrons regiment regiments brigade brigades division divisions corps',
    'detachment detachments column columns unit units force forces body party patrol patrols',
  ]
    .join(' ')
    .split(' '),
);

/**
 * Whether a unit's name or commander says more than what kind of troops it is: true when any word
 * of it (split on anything but letters and digits) is not a generic arm, size or joining word.
 * "Hussar Squadron" and "Line infantry" are not distinctive; "2nd Hussars", "Red Vanguard" and a
 * commander's name are.
 */
export function isDistinctive(term: string): boolean {
  const words = squash(term)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== '');
  return words.some((w) => !GENERIC_UNIT_WORDS.has(w));
}

/**
 * The terms found in `text`, as problems. Names match as whole words, ignoring case, invisible
 * format characters and the amount of white space, so a name cannot be smuggled past by
 * lower-casing it, widening its spaces or splitting it with zero-width characters.
 */
export function hiddenIn(text: string, terms: readonly string[]): string[] {
  const plain = squash(text);
  const hits = terms.filter((t) => {
    const escaped = squash(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(plain);
  });
  return [...new Set(hits)].map((t) => `names the other side ("${t}")`);
}
