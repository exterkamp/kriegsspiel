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
  /(?:\bno|\bnothing of(?: the)?|\bno (?:sign|trace|word) of(?: the)?|\b(?:not|never) (?:see|seen|saw|find|found|meet|met|sight|sighted)(?: any| the| an?)?|\bwithout (?:seeing|meeting|finding|sighting)(?: any| the| an?)?)\s*$/iu;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The side's own words: what an account may call its own units. */
export interface OwnTerms {
  /** The side's units' names and commanders: "Vanguard", "1st Battalion", "Col. Brandt". */
  names: readonly string[];
  /** The side's units' kinds and the words of their names ("infantry", "battalion", "squadron"). */
  words: readonly string[];
}

/** A side's own terms from its units. */
export function ownTermsOf(
  units: readonly { name: string; commander?: string; kind?: string; type?: string }[],
): OwnTerms {
  const names = units.flatMap((u) => [u.name, ...(u.commander ? [u.commander] : [])]);
  const words = units.flatMap((u) => [
    ...(u.kind ? [u.kind] : []),
    ...(u.type ? [u.type] : []),
    ...u.name.toLowerCase().split(/[^\p{L}]+/u),
  ]);
  return {
    names: names.filter((n) => n.trim() !== ''),
    words: [...new Set(words.map((w) => w.toLowerCase()).filter((w) => w !== ''))],
  };
}

/**
 * The words in `account` that describe enemy troops, or nothing when it describes none. The enemy
 * as such ("the enemy", "enemy columns"; not "met no enemy"), and any word for a body of troops
 * (`TROOP_WORDS`) that is not the side's own: not one of its units' names, not marked as its own
 * ("my squadron", "our infantry"), not a formation the unit takes ("formed column") and not "the"
 * one of its own kinds or parts ("the battalion", "the left company").
 */
export function enemyDescribed(account: string, own: OwnTerms): string | undefined {
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
    if (!NEGATED.test(text.slice(0, m.index))) return m[0];
  }
  const ownWords = new Set(own.words);
  for (const sentence of text.split(/(?<=[.!?;:])\s+/u)) {
    const words = sentence.toLowerCase().match(/[\p{L}][\p{L}'’]*/gu) ?? [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!.replace(/['’]s?$/u, '');
      if (!TROOP_WORDS.has(w)) continue;
      const before = words.slice(Math.max(0, i - 2), i);
      if (before.some((b) => OWN_MARKS.has(b) || b === 'ownunit')) continue;
      const [prev2 = '', prev = ''] = [words[i - 2], words[i - 1]];
      const formation = FORMATION_VERBS.has(prev) || (prev === 'a' && FORMATION_VERBS.has(prev2));
      if (FORMATIONS.has(w) && formation) continue;
      if (before.includes('the') && (ownWords.has(w) || OWN_PARTS.has(w))) continue;
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
  const word = enemyDescribed(account, own);
  if (word === undefined) return undefined;
  return refused
    ? `describes the enemy ("${word}") though the sight check refused every sighting of this unit`
    : `describes the enemy ("${word}") though no unit of the side could see one`;
}
