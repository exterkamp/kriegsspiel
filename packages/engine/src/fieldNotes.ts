/**
 * The engine's own wording of a report, as a hasty field note from the officer who sent it (#419).
 * This is what a player reads whenever the narrate stage does not replace it: no umpire, a model that
 * failed its checks, or the circuit breaker open. Each kind has several wordings, and a unit's note
 * takes the manner of its commander's public trait (bold, cautious, steady or plain).
 *
 * The wording is chosen by a generator seeded from the game seed and the report id, never the game's
 * own RNG: the choice is the same on every reading and in a replay, and no die roll moves. Nothing
 * here adds a fact: every note says only what the report has (who, what, where, how long ago, how
 * sure), and the manner only colours the officer's closing line.
 */
import { Rng, seedRng } from './rng.js';
import type { Report } from './types.js';

/** The manner a commander's public trait gives his notes. */
export type Temper = 'bold' | 'cautious' | 'steady' | 'plain';

/** Reads the manner from a trait such as "bold and impatient; apt to charge early". */
export function temperOf(trait: string | undefined): Temper {
  const t = (trait ?? '').toLowerCase();
  if (/\b(bold|dashing|aggressive|impatient|rash|fiery|over-reach|charge|presses)\b/.test(t)) {
    return 'bold';
  }
  if (/\b(cautious|careful|slow|hesitant|timid|by the book|waits for orders|prudent)\b/.test(t)) {
    return 'cautious';
  }
  if (/\b(steady|methodical|calm|veteran|stolid|unflappable|holds a line)\b/.test(t))
    return 'steady';
  return 'plain';
}

/**
 * The sending unit's public trait, when the side knows it. Its commander's name is never put in the
 * text: the intelligence officer reads contact notes but may not learn who commands what (roles.ts).
 */
export interface NoteSender {
  trait?: string;
}

interface NoteParts {
  from: string;
  where: string;
  when: string;
  size: string;
  /** Words for how sure the sender is, to open a clause or to close one; empty when sure. */
  hedge: string;
  doubt: string;
}

type Line = (p: NoteParts) => string;
type UnitKind = Exclude<Report['kind'], 'situation' | 'unitLost' | 'courierLost' | 'battle'>;
type StaffKind = 'situation' | 'unitLost' | 'courierLost';

/**
 * First-person openings, in the unit's own voice: at least five per kind. Only an `orderDelivered` note
 * says "your orders" in lower case, so a reader (or a test) can tell the acknowledgement apart.
 */
const BODIES: Record<UnitKind, Line[]> = {
  contact: [
    (p) => `${p.hedge}we have sighted ${p.size} ${p.where}.`,
    (p) => `my vedettes report ${p.size} ${p.where}${p.doubt}.`,
    (p) => `we are in sight of ${p.size} ${p.where}${p.doubt}.`,
    (p) => `there are ${p.size} before us ${p.where}${p.doubt}.`,
    (p) => `${p.hedge}we have ${p.size} in view ${p.where}.`,
  ],
  orderDelivered: [
    (p) => `your orders are in my hands ${p.where}.`,
    (p) => `we have your orders ${p.where}.`,
    (p) => `we have received and understood your orders ${p.where}.`,
    (p) => `your courier found us ${p.where}; we have your orders.`,
    (p) => `I have your orders ${p.where}, and the men are told.`,
  ],
  lowAmmo: [
    (p) => `our ammunition runs short ${p.where}.`,
    (p) => `our cartridge boxes are nearly empty ${p.where}.`,
    (p) => `we are firing our last rounds ${p.where}.`,
    (p) => `I must report that our ammunition will not last ${p.where}.`,
    (p) => `powder and ball are running low with us ${p.where}.`,
  ],
  exhausted: [
    (p) => `my men are exhausted ${p.where}.`,
    (p) => `my men are done in ${p.where}; they can barely stand.`,
    (p) => `we are spent ${p.where}, and the men drop where they halt.`,
    (p) => `I have nothing left in the men ${p.where}; they are worn out.`,
    (p) => `the march and the fight have exhausted us ${p.where}.`,
  ],
  destroyed: [
    (p) => `we have destroyed ${p.size} ${p.where}.`,
    (p) => `we have broken ${p.size} ${p.where}; they are scattered.`,
    (p) => `we have routed ${p.size} ${p.where}.`,
    (p) => `we have cut up ${p.size} ${p.where}; they are gone.`,
    (p) => `the enemy ${p.where} is beaten: we have destroyed ${p.size}.`,
  ],
  engaged: [
    (p) => `we are engaged ${p.where}.`,
    (p) => `the enemy is upon us ${p.where}; we are fighting.`,
    (p) => `we are in action ${p.where}.`,
    (p) => `we have come to blows with the enemy ${p.where}.`,
    (p) => `heavy firing ${p.where}: we are engaged.`,
  ],
  heavyLosses: [
    (p) => `we are taking heavy losses ${p.where}.`,
    (p) => `my ranks are thinned badly ${p.where}; the losses are heavy.`,
    (p) => `we have lost many men ${p.where}.`,
    (p) => `our casualties are grievous ${p.where}, and still mounting.`,
    (p) => `we are bleeding badly ${p.where}.`,
  ],
  broke: [
    (p) => `we have broken and are falling back ${p.where}.`,
    (p) => `the men have given way ${p.where}; I am trying to rally them.`,
    (p) => `we could not hold ${p.where}; we are falling back in disorder.`,
    (p) => `my line has broken ${p.where}. I am gathering what I can.`,
    (p) => `we are driven back ${p.where} and the men will not stand.`,
  ],
};

/** The officer's closing line, by manner: his judgement or question for the general. */
const CLOSINGS: Record<UnitKind, Record<Temper, string[]>> = {
  // Only `plain` is used: see `fieldNote`.
  contact: {
    bold: [],
    cautious: [],
    steady: [],
    plain: ['Shall we engage or watch them?', 'I await orders.', 'I keep them under watch.'],
  },
  orderDelivered: {
    bold: ['We move at once.', 'We are off without delay.'],
    cautious: ['We shall carry them out with care.', 'I shall follow them to the letter.'],
    steady: ['They will be carried out.', 'We set about it now.'],
    plain: ['They will be obeyed.', 'We act on them now.'],
  },
  lowAmmo: {
    bold: [
      'Send cartridges and we will hold with the bayonet meanwhile.',
      'Get us powder and we fight on.',
    ],
    cautious: [
      'Without more ammunition I cannot answer for the position.',
      'May we fall back to resupply?',
    ],
    steady: ['We husband what is left. Send more when you can.', 'I ask for a resupply.'],
    plain: ['Can ammunition be sent forward?', 'Request ammunition, sir.'],
  },
  exhausted: {
    bold: ['Give them an hour and they will go again.', 'They will still fight if they must.'],
    cautious: ['I beg leave to rest them.', 'Should we be relieved?'],
    steady: ['They need rest before more is asked of them.', 'I can hold, but not advance.'],
    plain: ['Can we be relieved?', 'We need rest, sir.'],
  },
  destroyed: {
    bold: ['Shall we pursue?', 'Let us follow them up, sir.'],
    cautious: ['I would not follow without orders.', 'We hold here unless you wish a pursuit.'],
    steady: ['We reform and await orders.', 'We hold the ground taken.'],
    plain: ['Shall we pursue?', 'Your orders, sir?'],
  },
  engaged: {
    bold: ['We will drive them.', 'The men are eager; we press them hard.'],
    cautious: ['I am not certain we can hold. Your orders?', 'Can the reserve be sent?'],
    steady: ['We hold.', 'The men stand well. We hold our ground.'],
    plain: ['We hold for now.', 'I shall send word as it goes.'],
  },
  heavyLosses: {
    bold: ['We hold still, but send me men.', 'We will not give ground, but we need support.'],
    cautious: ['Should we fall back?', 'I fear we cannot stay. May I withdraw?'],
    steady: ['We hold, but we cannot do so long.', 'We stand, but ask to be relieved.'],
    plain: ['Should we fall back?', 'Request support, sir.'],
  },
  broke: {
    bold: [
      'I will turn them again if I can.',
      'Give me time and I will have them back in the line.',
    ],
    cautious: ['We must be relieved.', 'I can do nothing more here without support.'],
    steady: ['I will rally them behind the line.', 'We reform where we can.'],
    plain: ['We must be relieved.', 'Orders, sir?'],
  },
};

/**
 * A broken unit's words while it falls back (#438): it was beaten, so it does not say it holds. Used
 * for a `routed` report in place of the body and closing of an `engaged` or `heavyLosses` note.
 */
const ROUTED_BODIES: Line[] = [
  (p) => `we are being cut up as we fall back ${p.where}.`,
  (p) => `the enemy presses us hard as we fall back ${p.where}; we have lost many men.`,
  (p) => `we are falling back ${p.where}, and the losses are heavy.`,
  (p) => `the men are streaming back ${p.where}, and we are losing them fast.`,
  (p) => `we cannot stand ${p.where}; the enemy is among us as we go back.`,
];
const ROUTED_CLOSINGS: Record<Temper, string[]> = {
  bold: ['I will rally them as soon as we are clear.', 'Give me time and I will turn them again.'],
  cautious: ['We must be relieved.', 'I can do nothing more without support.'],
  steady: ['I will rally them behind the line.', 'We reform where we can.'],
  plain: ['We must be relieved.', 'Orders, sir?'],
};

/** Headquarters' wording of the kinds no unit wrote: the opening situation, a lost unit or courier. */
const STAFF_NOTES: Record<StaffKind, Line[]> = {
  situation: [
    (p) => `${p.from} reports ${p.size} in position ${p.where}; no enemy yet in sight.`,
    (p) => `the army stands ready: ${p.size} in position ${p.where}. Nothing of the enemy as yet.`,
    (p) => `${p.size} posted ${p.where}, sir. The enemy has not shown himself.`,
    (p) => `${p.size} in position ${p.where}. No enemy in sight.`,
    (p) => `we are deployed, ${p.size} ${p.where}. No sign of the enemy.`,
  ],
  unitLost: [
    (p) => `${p.from} is lost ${p.where}, ${p.when}.`,
    (p) => `we have word that ${p.from} is gone ${p.where}, ${p.when}.`,
    (p) => `${p.from} has been destroyed ${p.where}, ${p.when}. We have nothing more.`,
    (p) => `I regret to report ${p.from} lost ${p.where}, ${p.when}.`,
    (p) => `${p.from} is no more; it was lost ${p.where}, ${p.when}.`,
  ],
  // Each says "no word from": a unit that has written since is told apart by `HEARD_SINCE` (#417).
  courierLost: [
    (p) =>
      `no word from ${p.from} ${p.where}: the courier carrying its orders is overdue and must be given up for lost. Send the orders again.`,
    (p) =>
      `there is no word from ${p.from} ${p.where}, and the rider with its orders has not come back: he must be given up for lost. Send the orders again.`,
    (p) =>
      `still no word from ${p.from} ${p.where}. The courier with its orders is overdue and lost. Send them again.`,
    (p) =>
      `we have had no word from ${p.from} ${p.where}; its courier is overdue and must be counted lost. Send the orders again.`,
    (p) =>
      `no word from ${p.from} ${p.where}, and the courier is long overdue: the orders are lost. Send them again.`,
  ],
};

/** Variant of `courierLost` when the unit has sent word since its orders were due (#417). */
const HEARD_SINCE: Line[] = [
  (p) =>
    `${p.from} ${p.where} has sent word, but not that it has its orders: the courier carrying them is overdue and must be given up for lost. Send the orders again.`,
  (p) =>
    `${p.from} ${p.where} has written, but says nothing of its orders: the courier is overdue and lost. Send the orders again.`,
  (p) =>
    `we hear from ${p.from} ${p.where}, though not of its orders; the courier is overdue and must be given up. Send the orders again.`,
  (p) =>
    `${p.from} ${p.where} reports, but has not had its orders: count the courier lost. Send them again.`,
  (p) =>
    `word from ${p.from} ${p.where}, but no sign it has the orders. The courier is overdue and lost. Send the orders again.`,
];

const HEDGES: Record<Report['confidence'], string> = {
  low: 'if my eyes do not deceive me, ',
  medium: 'as far as I can make out, ',
  high: '',
};
const DOUBTS: Record<Report['confidence'], string> = {
  low: ', though I would not swear to it',
  medium: ', as near as we can tell',
  high: '',
};

/** 32-bit FNV-1a of a string, to mix a report id into the seed. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The generator for one report's wording: fixed by the game seed and the report id. */
function wordingRng(seed: number, reportId: string): Rng {
  return new Rng(seedRng((seed ^ hash(reportId)) | 0));
}

/**
 * The field note for report `r`, which reached HQ `leadMs` after it happened. `seed` (the game's) picks
 * the wording; `sender` gives the manner; without either the first wording and the plain manner are used.
 * Every note opens "Sir, " (#323) and gives its age one way, "about N minutes ago" or "just now" (#325).
 */
export function fieldNote(
  r: Report,
  leadMs: number,
  heardSince = false,
  sender: NoteSender = {},
  seed?: number,
): string {
  const mins = Math.round(leadMs / 60_000);
  const parts: NoteParts = {
    from: r.from,
    where: r.place,
    when: mins === 0 ? 'just now' : `about ${mins} ${mins === 1 ? 'minute' : 'minutes'} ago`,
    size: r.sizeEstimate ?? (r.kind === 'situation' ? 'the formations' : 'enemy troops'),
    hedge: HEDGES[r.confidence],
    doubt: DOUBTS[r.confidence],
  };
  const rng = seed === undefined ? undefined : wordingRng(seed, r.id);
  const pick = <T>(list: readonly T[]): T => list[rng ? rng.int(0, list.length - 1) : 0]!;
  if (r.kind === 'battle') return r.text ?? `The umpire has decided the battle ${r.place}.`;
  if (r.kind === 'situation' || r.kind === 'unitLost' || r.kind === 'courierLost') {
    const lines = r.kind === 'courierLost' && heardSince ? HEARD_SINCE : STAFF_NOTES[r.kind];
    return `Sir, ${pick(lines)(parts)}`;
  }
  // A contact note is read by the intelligence officer too, who is not told the officers' manners.
  const temper = r.kind === 'contact' ? 'plain' : temperOf(sender.trait);
  if (r.routed) {
    const body = pick(ROUTED_BODIES)(parts);
    return `Sir, ${body} ${pick(ROUTED_CLOSINGS[temper])} — ${r.from}, ${parts.when}.`;
  }
  const body = pick(BODIES[r.kind])(parts);
  const closing = pick(CLOSINGS[r.kind][temper]);
  // The first word after a rally says so, before the unit says it holds again (#438).
  const opening = r.rallied
    ? `Sir, we have rallied. ${body[0]!.toUpperCase()}${body.slice(1)}`
    : `Sir, ${body}`;
  return `${opening} ${closing} — ${r.from}, ${parts.when}.`;
}
