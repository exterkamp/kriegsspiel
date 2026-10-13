/**
 * The test provider's staff check: reads a draft order with the same rules the test parser uses,
 * and adds a few of its own for what a parse cannot show (conditions, clock times, vague timing,
 * contradictions inside the draft and with earlier orders). Deterministic, offline, free.
 *
 * It answers in the real schema from words the input already holds (unit and place names, the
 * draft), so its replies pass `checkStaffCheckOutput` like any model's. It is a rule-based
 * approximation: the real model is expected to be better, and to catch what these patterns miss.
 */
import type { StaffCheckKind, StaffCheckOutput } from '../../orders/staffCheck.js';
import { testParse } from './testParse.js';

interface Unit {
  id: string;
  name: string;
  x: number;
  y: number;
}
interface Place {
  id: string;
  kind: string;
  name?: string;
  x: number;
  y: number;
}
interface EarlierInput {
  id: string;
  text: string;
  sentMinutesAgo: number;
}
interface CheckInput {
  draft: string;
  units: Unit[];
  places: Place[];
  earlierOrders: EarlierInput[];
}

/** An order this recent to the same unit is taken to be still under way. */
const RECENT_MINUTES = 60;

type Finding = StaffCheckOutput['findings'][number];

const lower = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');
const label = (p: Place) => p.name ?? `the ${p.kind}`;

const CONDITION = /\b(?:if|unless|once|whenever|when|provided|in case)\b/;
const CLOCK =
  /\b(?:at (?:dawn|dusk|noon|midnight|first light|nightfall|daybreak|sunrise|sunset)|until (?:dawn|dusk|noon|midnight|nightfall|daybreak|relieved)|by (?:dawn|dusk|noon|midnight|nightfall)|in (?:\d+|an?|one|two|three|four|five|six|ten|twelve) (?:hours?|minutes?)|after (?:dark|nightfall|dawn)|at \d{1,2}(?::\d{2})?(?: ?(?:am|pm|hours))?)\b/;
const VAGUE_TIME =
  /\b(?:soon|later|shortly|eventually|in due course|when ready|when convenient|at the right moment|at your leisure|presently)\b/;
const HOLD = '(?:hold|defend|garrison|stand|occupy|guard|screen)';
const GO =
  '(?:attack|assault|storm|charge|march|advance|move|withdraw|retreat|fall back|pull back)';

function reading(parsed: ReturnType<typeof testParse>, input: CheckInput): string {
  if (parsed.result === 'intents') {
    const unit = input.units.find((u) => u.id === parsed.unitId);
    const placeOf = (id: string) => {
      const p = input.places.find((x) => x.id === id);
      return p ? label(p) : 'where it stands';
    };
    const steps = (parsed.intents ?? []).map((i) =>
      i.kind === 'move'
        ? `march to ${placeOf(i.place)}`
        : i.kind === 'hold'
          ? i.place === 'here'
            ? 'hold where it stands'
            : `hold ${placeOf(i.place)}`
          : i.kind === 'attack'
            ? `attack ${placeOf(i.place)}`
            : `fall back toward ${placeOf(i.place)}`,
    );
    return `${unit?.name ?? 'The unit'} would most likely ${steps.join(', then ')}.`;
  }
  return parsed.result === 'clarification'
    ? 'A subordinate could not be sure what is meant and would send back to ask.'
    : 'A subordinate would not act on this; it is not an order they could carry out.';
}

/** Findings the parse itself shows: what a subordinate would have to ask, or could not do. */
function fromParse(parsed: ReturnType<typeof testParse>): Finding[] {
  if (parsed.result === 'intents') return [];
  if (parsed.result === 'rejection') {
    const reason = parsed.reason ?? '';
    const kind: StaffCheckKind = /\bno (?:place|unit) called\b/.test(reason)
      ? 'unknown_reference'
      : 'ambiguity';
    return [{ kind, text: reason }];
  }
  const question = parsed.question ?? '';
  const kind: StaffCheckKind = /^where\b/i.test(question)
    ? 'missing_place'
    : /\bno place called\b/.test(question)
      ? 'unknown_reference'
      : 'ambiguity';
  return [{ kind, text: question }];
}

function fromWords(text: string): Finding[] {
  const out: Finding[] = [];
  if (CONDITION.test(text)) {
    out.push({
      kind: 'condition',
      text: 'the order depends on something that may not happen, and the officer receiving it cannot wait to find out',
    });
  }
  if (CLOCK.test(text)) {
    out.push({
      kind: 'timing',
      text: 'the order names a time, but the officer acts when it arrives and cannot be relied on to wait',
    });
  }
  if (VAGUE_TIME.test(text)) {
    out.push({ kind: 'missing_time', text: 'the order does not say when it is to be carried out' });
  }
  return out;
}

/** Incompatible demands inside one draft. */
function contradiction(text: string): Finding | undefined {
  const reasons: string[] = [];
  if (
    new RegExp(`\\b${GO}\\b.*\\b(?:do not|don't|must not|never) (?:move|advance|march)\\b`).test(
      text,
    )
  ) {
    reasons.push('it asks for a movement and for the unit not to move');
  }
  if (new RegExp(`\\b${HOLD}\\b[^,;]*\\b(?:and|but)\\b[^,;]*\\b${GO}\\b`).test(text)) {
    reasons.push('it asks the unit to hold and to move or attack at once');
  }
  if (
    /\b(?:withdraw|retreat|fall back|pull back)\b[^,;]*\b(?:and|but)\b[^,;]*\b(?:attack|assault|storm|charge)\b/.test(
      text,
    )
  ) {
    reasons.push('it asks the unit to fall back and to attack');
  }
  if (
    /\b(?:to the last man|at all costs)\b.*\b(?:withdraw|retreat|fall back|pull back)\b/.test(text)
  ) {
    reasons.push('it asks the unit to hold to the last and to retreat');
  }
  return reasons.length > 0 ? { kind: 'contradiction', text: reasons.join('; ') } : undefined;
}

/** Conflicts with orders already sent to the same unit. */
function againstEarlier(draft: ReturnType<typeof testParse>, input: CheckInput): Finding[] {
  if (draft.result !== 'intents') return [];
  const mine = draft.intents ?? [];
  const first = mine[0];
  const last = mine[mine.length - 1];
  if (!first || !last) return [];
  const out: Finding[] = [];
  for (const o of input.earlierOrders) {
    const prior = testParse({ order: o.text, units: input.units, places: input.places });
    if (prior.result !== 'intents' || prior.unitId !== draft.unitId) continue;
    const before = prior.intents ?? [];
    const pLast = before[before.length - 1];
    if (!pLast || pLast.place === 'here' || last.place === 'here') continue;
    const reverses =
      pLast.place === first.place &&
      ((pLast.kind === 'hold' && (first.kind === 'withdraw' || first.kind === 'attack')) ||
        (pLast.kind === 'withdraw' && (first.kind === 'attack' || first.kind === 'move')));
    // A different place only counts while the earlier order is recent enough to be still under way.
    const elsewhere = pLast.place !== last.place && o.sentMinutesAgo <= RECENT_MINUTES;
    if (!reverses && !elsewhere) continue;
    out.push({
      kind: 'contradiction',
      text: `this ${reverses ? 'reverses' : 'cuts across'} order ${o.id}: "${o.text}"`,
      earlierOrder: o.id,
    });
  }
  return out;
}

export function testStaffCheck(input: CheckInput): StaffCheckOutput {
  const text = lower(input.draft);
  const parsed = testParse({ order: input.draft, units: input.units, places: input.places });
  const findings: Finding[] = [
    ...fromParse(parsed),
    ...fromWords(text),
    ...(() => {
      const c = contradiction(text);
      return c ? [c] : [];
    })(),
    ...againstEarlier(parsed, input),
  ];
  return {
    reading: reading(parsed, input),
    ...(parsed.result === 'intents' && parsed.unitId ? { unitId: parsed.unitId } : {}),
    findings: findings.slice(0, 8),
  };
}
