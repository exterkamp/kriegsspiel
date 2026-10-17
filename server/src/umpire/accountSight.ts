/**
 * Accounts and sight (#533, D39 "As built (#533)"): a commander's `account` may tell his side only
 * of enemies the side could see. An `Observation` stands only if the engine's sight test passes
 * (11.5), and the papers rest on the observations that stood; an account is free prose, so it can
 * carry a sighting the validator refused ("I saw infantry in line at the south end of the bridge").
 *
 * The rule, on what a side knows rather than on names (an account describes an enemy by what he is,
 * "some cavalry", "a battalion", with no name to match): a unit whose own sightings in the turn were
 * all refused, or any unit of a side that has no stood sighting in the turn and no contact in its view,
 * may not describe enemy troops at all. A unit with a sighting that stood, or whose side knows the
 * enemy and which proposed none that were refused, is not screened here.
 *
 * Used twice: the `adjudicate` stage sends such an account back with the resend's problems, so the
 * umpire corrects it; the turn reports withhold it, as the last guard (`screenAccount`).
 */
import { squash } from './leakGuard.js';

/** Words that name the enemy as such. */
const ENEMY_WORDS = /\b(?:enem(?:y|ies)|foes?|foem[ae]n|opponents?|adversar(?:y|ies)|hostile)\b/giu;
/** One enemy word, whole. */
const ENEMY_WORD = /^(?:enem(?:y|ies)|foes?|foem[ae]n|opponents?|adversar(?:y|ies)|hostile)$/iu;

/**
 * Words for a body of troops by arm or size: generic wording that describes an enemy without naming
 * him (#524's generic words, without the articles, "men" and other words own troops use of themselves
 * more often than of the enemy).
 */
const TROOP_WORDS = new Set(
  [
    'infantry cavalry artillery horse foot',
    'hussar hussars dragoon dragoons lancer lancers uhlan uhlans cuirassier cuirassiers',
    'chasseur chasseurs grenadier grenadiers fusilier fusiliers voltigeur voltigeurs',
    'jager jagers jäger jaeger jaegers rifles riflemen skirmisher skirmishers musketeers',
    'guns gunners cannon cannons battery batteries troopers horsemen troops',
    'platoon platoons company companies battalion battalions squadron squadrons',
    'regiment regiments brigade brigades division divisions corps detachment detachments',
    'column columns line lines patrol patrols',
  ]
    .join(' ')
    .split(' '),
);

/** Words before a troop word that make it the speaker's own. */
const OWN_MARKS = new Set(['my', 'our', 'his', 'its', 'own', 'this', 'ours', 'mine']);

/**
 * A unit's own parts and order, which an account speaks of with "the" ("the left company wheeled",
 * "held the line"); another line is "a line".
 */
const OWN_PARTS = new Set(['company', 'companies', 'platoon', 'platoons', 'line', 'lines']);

/** Formation words: after a verb of forming or "in", what the unit takes ("formed column", "in line"). */
const FORMATIONS = new Set(['column', 'columns', 'line', 'lines']);

/** Words that make what follows a formation the unit takes ("formed column"), not a body of troops. */
const FORMATION_VERBS = new Set(['form', 'formed', 'forming', 'forms', 'in', 'into']);

/** A negation just before "enemy": "met no enemy", "saw nothing of the enemy". */
const NEGATED =
  /(?:\bno|\bnor|\bnone of(?: the)?|\bnothing (?:yet |more )?of(?: the| an?| any)?|\bno (?:sign|trace|word) of(?: the| an?| any)?|\b(?:not|never) (?:see|seen|saw|find|found|meet|met|sight|sighted)(?: any| the| an?)?|\bwithout (?:seeing|meeting|finding|sighting)(?: any| the| an?)?)\s*$/iu;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Words before a troop word that make it someone else's even when it is the unit's own arm or kind:
 * "a squadron", "some cavalry", "two battalions", "other hussars" (#558).
 */
const OTHERS_MARKS = new Set(
  'a an some another other others two three four five six several many more their'.split(' '),
);

/**
 * Words that may follow "enemy" without making it enemy troops: places and things of his, not men
 * seen ("the enemy bank", "the enemy headquarters"; #558).
 */
const ENEMY_THINGS = new Set(
  [
    'bank banks side shore shores country ground territory headquarters hq quarter quarters camp',
    'intention intentions plan plans purpose design designs eye eyes attention mind',
  ]
    .join(' ')
    .split(' '),
);

/**
 * Words before "the enemy" that make him the object of a purpose or a hypothesis, not men seen:
 * "to deny the enemy the bridge", "to hold the enemy", "in case the enemy", "should the enemy" (#558).
 * A verb of purpose counts only as an infinitive ("to keep the enemy off"), not as what was done
 * ("kept the enemy in view").
 */
const ENEMY_PURPOSE =
  /(?:\bto (?:deny|keep|prevent|stop|deter|delay|deceive|mislead|lure|hold|distract|forestall)|\b(?:deny|denying|prevent|preventing|forestall|wait for|waited for|waiting for|watch for|watching for|look out for|looking out for|in case|lest|if|unless|should|whether|expect|expecting|await|awaiting))(?: an?| the| any)?\s*$/iu;

/** A modal right after "enemy": what he may do, not what was seen ("before the enemy can cross"). */
const ENEMY_MODAL =
  /^\s*(?:can|could|may|might|would|should|will|must|cannot|try|tries|attempt|attempts)\b/iu;

/** A word's singular and plural: "hussar" and "hussars", "battery" and "batteries". */
function forms(w: string): string[] {
  if (w.endsWith('ies')) return [w, `${w.slice(0, -3)}y`];
  if (w.endsWith('s')) return [w, w.slice(0, -1)];
  if (w.endsWith('y')) return [w, `${w.slice(0, -1)}ies`];
  return [w, `${w}s`];
}

/** The side's own words: what an account may call its own units. */
export interface OwnTerms {
  /** The side's units' names and commanders: "Vanguard", "1st Battalion", "Col. Brandt". */
  names: readonly string[];
  /**
   * The side's units' kinds and the words of their names, singular and plural ("infantry",
   * "battalion", "battalions", "squadron").
   */
  words: readonly string[];
  /**
   * Each unit's own name words by its id, singular and plural ("hussar", "hussars", "squadron",
   * "squadrons" for the Hussar Squadron). A unit's account never describes the enemy by these
   * unless another's mark comes first ("other hussars", "two squadrons"; #558). Its arm or kind
   * ("infantry", "cavalry") is not among them: both sides have infantry, so a bare "infantry in
   * line" may be the enemy's, and only "the infantry" or "our infantry" is the side's own.
   */
  unitWords?: ReadonlyMap<string, readonly string[]>;
}

/** A side's own terms from its units. */
export function ownTermsOf(
  units: readonly { id?: string; name: string; commander?: string; kind?: string; type?: string }[],
): OwnTerms {
  const lower = (ws: readonly string[]) =>
    ws
      .map((w) => w.toLowerCase())
      .filter((w) => w !== '')
      .flatMap(forms);
  const nameWords = (u: (typeof units)[number]) => lower(u.name.split(/[^\p{L}]+/u));
  const wordsOf = (u: (typeof units)[number]) => [
    ...lower([...(u.kind ? [u.kind] : []), ...(u.type ? [u.type] : [])]),
    ...nameWords(u),
  ];
  const names = units.flatMap((u) => [u.name, ...(u.commander ? [u.commander] : [])]);
  const unitWords = new Map<string, readonly string[]>();
  for (const u of units) if (u.id) unitWords.set(u.id, [...new Set(nameWords(u))]);
  return {
    names: names.filter((n) => n.trim() !== ''),
    words: [...new Set(units.flatMap(wordsOf))],
    unitWords,
  };
}

/**
 * Whether the enemy word `word` at `index` in `text` stands for enemy troops seen or met (#558):
 * not negated ("met no enemy"), not his possession ("the enemy's bank"; his troops, "the enemy's
 * column", are read as troop words), not a place or thing of his ("the enemy headquarters"), not
 * the object of a purpose or a hypothesis ("to deny the enemy the bridge", "if the enemy comes")
 * and not what he may do ("before the enemy can cross").
 */
function enemySeen(text: string, index: number, word: string): boolean {
  const before = text.slice(0, index);
  const after = text.slice(index + word.length);
  if (NEGATED.test(before)) return false;
  if (/^['’]/u.test(after)) return false;
  const next = /^\s+(\p{L}+)/u.exec(after)?.[1]?.toLowerCase();
  if (next !== undefined && ENEMY_THINGS.has(next)) return false;
  if (ENEMY_PURPOSE.test(before)) return false;
  if (ENEMY_MODAL.test(after)) return false;
  return true;
}

/**
 * The words in `account` that describe enemy troops, or nothing when it describes none. The enemy
 * as such, seen or met ("the enemy", "the enemy in the wood"; not "met no enemy", "the enemy's
 * bank" or "to deny the enemy the bridge": `enemySeen`), and any word for a body of troops
 * (`TROOP_WORDS`) that is not the side's own: not one of its units' names, not marked as its own
 * ("my squadron", "our infantry"), not a formation the unit takes ("formed column"), not "the"
 * one of its own kinds, name words or parts, singular or plural ("the battalion", "the hussars",
 * "the left company") and, in the account of the unit `unitId`, not one of its own name words
 * unless another's mark comes first ("hussars" from the Hussar Squadron, but "other hussars" or
 * "two squadrons"; #558). A troop word right after an enemy word
 * is always his ("the enemy's line", "enemy hussars").
 */
export function enemyDescribed(
  account: string,
  own: OwnTerms,
  unitId?: string,
): string | undefined {
  let text = squash(account);
  // The side's own names, longest first, so "1st Battalion" goes before "Battalion"; not after "a"
  // or "some": "a cavalry squadron" is someone else's, even if a unit of the side bears the name.
  for (const n of [...own.names].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}])(?<!\\b(?:a|an|some|another|other|two|three|several) )${escape(squash(n))}(?:['’]s)?(?![\\p{L}\\p{N}])`,
      'giu',
    );
    text = text.replace(re, ' ownunit ');
  }
  for (const m of text.matchAll(ENEMY_WORDS)) {
    if (enemySeen(text, m.index, m[0])) return m[0];
  }
  const ownWords = new Set(own.words);
  const unitWords = new Set(unitId === undefined ? [] : (own.unitWords?.get(unitId) ?? []));
  for (const sentence of text.split(/(?<=[.!?;:])\s+/u)) {
    const words = sentence.toLowerCase().match(/[\p{L}][\p{L}'’]*/gu) ?? [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!.replace(/['’]s?$/u, '');
      if (!TROOP_WORDS.has(w)) continue;
      const [prev2 = '', prev = ''] = [words[i - 2], words[i - 1]];
      // The enemy's own troops: "the enemy's line", "enemy hussars" (not "no enemy cavalry").
      const enemyMark = ENEMY_WORD.test(prev.replace(/['’]s?$/u, ''));
      if (enemyMark && !NEGATED.test(words.slice(0, i - 1).join(' '))) return words[i];
      const before = words.slice(Math.max(0, i - 2), i);
      if (before.some((b) => OWN_MARKS.has(b) || b === 'ownunit')) continue;
      const formation = FORMATION_VERBS.has(prev) || (prev === 'a' && FORMATION_VERBS.has(prev2));
      if (FORMATIONS.has(w) && formation) continue;
      if (before.includes('the') && (ownWords.has(w) || OWN_PARTS.has(w))) continue;
      // The unit's own name words: "Hussars watered at the brook" from the Hussar Squadron (#558).
      if (!enemyMark && unitWords.has(w) && !OTHERS_MARKS.has(prev)) continue;
      return words[i];
    }
  }
  return undefined;
}

/** One observation in a proposal: side `side`'s unit `by` saw `unitId` at the turn's `when`. */
export interface SightObservation {
  side: string;
  by: string;
  unitId: string;
  when: 'start' | 'end';
}

/** What a side's units saw in a turn, as the sight check let it stand. */
export interface SideSight {
  /** The side's units with a sighting the sight check refused. */
  refused: ReadonlySet<string>;
  /** The side's units with a sighting that stood. */
  stood: ReadonlySet<string>;
  /** Whether the side knows any enemy: a sighting stood in the turn, or a contact it holds. */
  knowsEnemy: boolean;
}

/** One observation's identity: two with the same key are the same sighting. */
export const observationKey = (o: SightObservation) => `${o.side}|${o.by}|${o.unitId}|${o.when}`;
const keyOf = observationKey;

/**
 * Side `side`'s sight in a turn: its observations in `proposed` that are not in `stood` were refused
 * by the validator. `contacts` is whether the side held any contact besides (its view's contacts).
 */
export function sideSight(
  side: string,
  proposed: readonly SightObservation[],
  stood: readonly SightObservation[],
  contacts: boolean,
): SideSight {
  const kept = new Set(stood.filter((o) => o.side === side).map(keyOf));
  const refused = new Set<string>();
  const seen = new Set<string>();
  for (const o of proposed) {
    if (o.side !== side) continue;
    if (kept.has(keyOf(o))) seen.add(o.by);
    else refused.add(o.by);
  }
  return { refused, stood: seen, knowsEnemy: contacts || seen.size > 0 };
}

/**
 * Why unit `unitId`'s account may not tell its side what it says of the enemy, or nothing when it
 * may: it describes enemy troops (`enemyDescribed`) while none of its own sightings stood and either
 * some were refused or its side knows no enemy at all.
 */
export function accountSightProblem(
  account: string,
  unitId: string,
  sight: SideSight,
  own: OwnTerms,
): string | undefined {
  if (sight.stood.has(unitId)) return undefined;
  const refused = sight.refused.has(unitId);
  if (!refused && sight.knowsEnemy) return undefined;
  const word = enemyDescribed(account, own, unitId);
  if (word === undefined) return undefined;
  return refused
    ? `describes the enemy ("${word}") though the sight check refused every sighting of this unit`
    : `describes the enemy ("${word}") though no unit of the side could see one`;
}
